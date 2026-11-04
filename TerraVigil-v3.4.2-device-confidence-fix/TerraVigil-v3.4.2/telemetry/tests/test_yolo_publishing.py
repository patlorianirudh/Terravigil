"""Exercise the real publishing/import path using isolated in-memory Firebase doubles."""
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import publish_detection as publisher
from firebase_bridge import process_detection
from lookup_telemetry import TelemetryIndex
from yolo_metadata import yolo_detection_metadata


class Scalar:
    """Tensor-like scalar without a dependency on PyTorch or CUDA."""
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


def result(names=None, classes=(12,), confidences=(0.91,)):
    return SimpleNamespace(
        names={12: 'land_mines'} if names is None else names,
        boxes=SimpleNamespace(cls=[Scalar(value) for value in classes],
                              conf=[Scalar(value) for value in confidences]),
    )


class YoloPublishingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.image = self.folder / 'renamed_capture.jpg'
        self.image.write_bytes(b'image bytes for upload double')
        self.capture = '2026-10-15T14:25:20.123456+05:30'
        self.utc = '2026-10-15T08:55:20.123456Z'
        csv = self.folder / 'telemetry.csv'
        csv.write_text('timestamp,latitude,longitude,gps_fix_type\n'
                       f'{self.utc},17.3975,78.4893,3\n')
        self.index = TelemetryIndex(csv)
        self.index.reload()
        self.app = object()
        self.records = {}
        self.actions = []

        def child(key):
            def save(record):
                # Persist actual JSON-compatible values, as the Firebase SDK must.
                self.records[key] = json.loads(json.dumps(record, allow_nan=False))
                self.actions.append(('write', key))
            return SimpleNamespace(set=save)

        self.reference = Mock()
        self.reference.child.side_effect = child
        self.reference.push.return_value = SimpleNamespace(key='generated-key')

        def blob(object_name):
            def upload(filename, **kwargs):
                self.assertEqual(filename, str(self.image))
                self.assertEqual(kwargs['content_type'], 'image/jpeg')
                self.actions.append(('upload', object_name))
            return SimpleNamespace(upload_from_filename=upload)

        self.bucket = Mock()
        self.bucket.blob.side_effect = blob
        self.firebase = types.ModuleType('firebase_admin')
        self.firebase.db = SimpleNamespace(reference=Mock(return_value=self.reference))
        self.firebase.storage = SimpleNamespace(bucket=Mock(return_value=self.bucket))
        self.firebase.credentials = SimpleNamespace(Certificate=Mock())
        self.firebase.initialize_app = Mock(return_value=self.app)
        self.firebase.delete_app = Mock()
        patches = (
            patch.dict(sys.modules, {'firebase_admin': self.firebase}),
            patch.object(publisher, 'load_environment'),
            patch.dict(os.environ, {'FIREBASE_DETECTIONS_PATH': 'tests/no-network',
                                    'FIREBASE_MISSION_ID': 'TV-LOCAL-TEST'}),
        )
        for context in patches:
            context.start()
            self.addCleanup(context.stop)

    def publish(self, **kwargs):
        return publisher.publish_detection(self.image, self.capture,
                                           bucket_name='unit-test-bucket',
                                           record_id='capture-1', app=self.app, **kwargs)

    def publish_yolo(self, prediction, box_index=0, key='capture-1'):
        return publisher.publish_yolo_detection(self.image, self.capture, prediction,
                                                box_index=box_index, bucket_name='unit-test-bucket',
                                                record_id=key, app=self.app)

    def imported(self, key='capture-1'):
        return process_detection(key, self.records[key], self.index,
                                 'TV-LOCAL-TEST', 2, 'UTC', 0)

    def test_publisher_json_roundtrip_retains_class_capture_time_confidence_and_gps(self):
        published = self.publish(class_name='land_mines', class_id=12, confidence=0.91)
        stored = self.records['capture-1']
        self.assertEqual(stored['capture_timestamp'], self.utc)
        self.assertEqual(stored['timestamp'], self.utc)
        self.assertEqual(stored['class_name'], 'land_mines')
        self.assertEqual(stored['class_id'], 12)
        self.assertEqual(stored['confidence'], 0.91)
        self.assertEqual(stored['image_path'], self.image.name)
        self.assertEqual([action[0] for action in self.actions], ['upload', 'write'])
        self.assertTrue(published['renamed_filename'].startswith('20261015T085520123456Z_'))
        self.assertTrue(stored['storage_path'].endswith(published['renamed_filename']))
        imported = self.imported()
        for field in ('class_name', 'class_id', 'confidence', 'image_path'):
            self.assertEqual(imported[field], stored[field])
        self.assertEqual(imported['timestamp_original'], self.utc)
        self.assertTrue(imported['match']['matched'])
        self.assertEqual(imported['match']['latitude'], 17.3975)
        self.assertEqual(imported['match']['longitude'], 78.4893)
        self.assertEqual(imported['match']['gap_seconds'], 0)

    def test_unknown_with_known_id_is_corrected_before_firebase_write(self):
        self.publish(class_name='Unknown class', class_id='12', confidence=0.88)
        self.assertEqual(self.records['capture-1']['class_name'], 'land_mines')
        self.assertEqual(self.records['capture-1']['class_id'], 12)
        self.assertEqual(self.imported()['class_name'], 'land_mines')

    def test_unknown_without_resolvable_class_is_rejected_before_upload_or_write(self):
        for name, class_id in (('unknown', None), (None, None), ('None', 999), ('N/A', None)):
            with self.subTest(name=name, class_id=class_id):
                with self.assertRaisesRegex(ValueError, 'Missing YOLO class'):
                    self.publish(class_name=name, class_id=class_id)
        self.assertEqual(self.records, {})
        self.assertEqual(self.actions, [])
        self.firebase.db.reference.assert_not_called()
        self.firebase.storage.bucket.assert_not_called()
        self.firebase.initialize_app.assert_not_called()

    def test_actual_yolo_catalog_can_label_class_zero_as_land_mines(self):
        self.publish_yolo(result(names={0: 'land_mines'}, classes=(0,), confidences=(0.97,)))
        stored = self.records['capture-1']
        self.assertEqual(stored['class_id'], 0)
        self.assertEqual(stored['class_name'], 'land_mines')
        self.assertEqual(stored['confidence'], 0.97)
        self.assertEqual(self.imported()['class_name'], 'land_mines')
        self.assertEqual(self.imported()['match']['capture_timestamp'], self.utc)

    def test_yolo_preserves_actual_nonmine_class_and_supported_catalog_shapes(self):
        for names in ({0: 'civilian'}, {'0': 'civilian'}, ['civilian'], ('civilian',)):
            with self.subTest(names=names):
                self.publish_yolo(result(names=names, classes=(0,), confidences=(0.64,)))
                self.assertEqual(self.records['capture-1']['class_name'], 'civilian')
                self.assertEqual(self.imported()['class_name'], 'civilian')

    def test_explicit_box_selection_creates_distinct_records_and_stable_retries(self):
        predictions = result(names={0: 'land_mines', 1: 'civilian'},
                             classes=(0, 1), confidences=(0.93, 0.74))
        first = self.publish_yolo(predictions, box_index=0, key='frame-7-box-0')
        second = self.publish_yolo(predictions, box_index=1, key='frame-7-box-1')
        retry = self.publish_yolo(predictions, box_index=0, key='frame-7-box-0')
        self.assertEqual(len(self.records), 2)
        self.assertEqual(first, retry)
        self.assertNotEqual(first['renamed_filename'], second['renamed_filename'])
        first_event = self.imported('frame-7-box-0')
        second_event = self.imported('frame-7-box-1')
        self.assertNotEqual(first_event['event_id'], second_event['event_id'])
        self.assertEqual(first_event['match'], second_event['match'])
        self.assertEqual(first_event['class_name'], 'land_mines')
        self.assertEqual(second_event['class_name'], 'civilian')

    def test_bad_confidence_is_rejected_without_upload_or_write(self):
        for confidence in (True, False, -0.1, 1.1, float('nan'), float('inf'), '0.9', []):
            with self.subTest(confidence=confidence):
                with self.assertRaises(ValueError):
                    self.publish(class_name='land_mines', confidence=confidence)
                with self.assertRaises(ValueError):
                    self.publish_yolo(result(confidences=(confidence,)))
        self.assertEqual(self.actions, [])
        self.assertEqual(self.records, {})

    def test_bad_class_id_is_rejected_without_upload_or_write(self):
        for class_id in (True, False, -1, 12.5, float('nan'), float('inf'), 'bad', {}):
            with self.subTest(class_id=class_id):
                with self.assertRaises(ValueError):
                    self.publish(class_name='land_mines', class_id=class_id)
                with self.assertRaises(ValueError):
                    self.publish_yolo(result(classes=(class_id,)))
        self.assertEqual(self.actions, [])
        self.assertEqual(self.records, {})

    def test_missing_or_placeholder_result_names_never_use_bundled_fallback(self):
        for names in ({}, {12: 'unknown'}, {12: '  UNKNOWN\tCLASS '},
                      {12: None}, {0: 'land_mines'}, [], 'land_mines'):
            with self.subTest(names=names):
                with self.assertRaisesRegex(ValueError, 'no real label'):
                    self.publish_yolo(result(names=names))
        self.assertEqual(self.actions, [])
        self.assertEqual(self.records, {})

    def test_box_index_and_unavailable_results_fail_before_publishing(self):
        for box_index in (True, -1, 0.0, '0', 1):
            with self.subTest(box_index=box_index):
                with self.assertRaises(ValueError):
                    self.publish_yolo(result(), box_index=box_index)
        with self.assertRaisesRegex(ValueError, 'no detection boxes'):
            self.publish_yolo(SimpleNamespace(names={12: 'land_mines'}))
        self.assertEqual(self.actions, [])
        self.assertEqual(self.records, {})

    def test_adapter_alone_is_usable_without_firebase_or_model_execution(self):
        metadata = yolo_detection_metadata(result(), box_index=0)
        self.assertEqual(metadata, {'class_name': 'land_mines', 'class_id': 12, 'confidence': 0.91})
        self.assertEqual(self.actions, [])
        self.firebase.initialize_app.assert_not_called()
        self.firebase.db.reference.assert_not_called()


if __name__ == '__main__':
    unittest.main()
