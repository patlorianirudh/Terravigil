import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from firebase_bridge import process_detection
from lookup_telemetry import TelemetryIndex
from detection_class import normalize_class_id, normalize_class_name


class DetectionClassTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        csv = Path(folder.name) / 'telemetry.csv'
        csv.write_text('timestamp,latitude,longitude,gps_fix_type\n'
                       '2026-10-15T08:55:20Z,17.3975,78.4893,3\n')
        self.index = TelemetryIndex(csv)
        self.index.reload()

    def event(self, metadata):
        return process_detection('capture-1', {
            'timestamp': '2026-10-15T08:55:20Z',
            'image_path': 'renamed-land_mines.jpg', 'confidence': 0.91,
            **metadata,
        }, self.index, 'TV-LIVE-001', 2, 'UTC', 0)

    def test_explicit_name_aliases_preserve_the_supplied_label(self):
        for key in ('class_name', 'className', 'label', 'name', 'class'):
            with self.subTest(key=key):
                event = self.event({key: '  civilian_vehicle  '})
                self.assertEqual(event['class_name'], 'civilian_vehicle')
                self.assertIsNone(event['class_id'])

    def test_ids_resolve_against_the_bundled_model_catalog(self):
        for key in ('class_id', 'classId', 'cls', 'class'):
            for value in (12, 12.0, '12', ' 12 '):
                with self.subTest(key=key, value=value):
                    event = self.event({key: value})
                    self.assertEqual(event['class_id'], 12)
                    self.assertEqual(event['class_name'], 'land_mines')

    def test_zero_is_a_valid_class_and_not_a_landmine(self):
        for value in (0, '0', 0.0):
            with self.subTest(value=value):
                event = self.event({'class_id': value})
                self.assertEqual(event['class_id'], 0)
                self.assertEqual(event['class_name'], 'camouflage_soldier')

    def test_explicit_name_takes_precedence_over_catalog_and_aliases(self):
        event = self.event({'class_name': 'custom_detector_label', 'className': 'other',
                            'class_id': 12, 'classId': 0})
        self.assertEqual(event['class_name'], 'custom_detector_label')
        self.assertEqual(event['class_id'], 12)

    def test_blank_or_invalid_aliases_do_not_mask_valid_metadata(self):
        event = self.event({'class_name': ' ', 'className': ['bad'], 'label': 'civilian',
                            'class_id': False, 'classId': 5})
        self.assertEqual(event['class_name'], 'civilian')
        self.assertEqual(event['class_id'], 5)

    def test_placeholder_names_do_not_mask_a_real_model_class_id(self):
        for placeholder in ('unknown', 'Unknown class', '  UNKNOWN  CLASS\t',
                            'unknown_class', 'unknown-class', 'unclassified',
                            'None', 'NULL', 'N/A', 'Not supplied',
                            'class not supplied', 'Class_Not_Supplied'):
            for name_key in ('class_name', 'className', 'label', 'name', 'class'):
                with self.subTest(placeholder=placeholder, name_key=name_key):
                    event = self.event({name_key: placeholder, 'class_id': 12})
                    self.assertEqual(event['class_name'], 'land_mines')
                    self.assertEqual(event['class_id'], 12)

    def test_placeholder_names_do_not_mask_valid_alias_or_nested_metadata(self):
        event = self.event({'class_name': 'unknown', 'className': 'N/A',
                            'label': 'civilian_vehicle'})
        self.assertEqual(event['class_name'], 'civilian_vehicle')
        self.assertIsNone(event['class_id'])
        for nested in ('detection', 'prediction'):
            with self.subTest(nested=nested):
                event = self.event({'class_name': 'Unknown class', 'class_id': None,
                                    nested: {'class_name': 'unknown', 'classId': 12}})
                self.assertEqual(event['class_name'], 'land_mines')
                self.assertEqual(event['class_id'], 12)

    def test_placeholders_without_a_known_class_do_not_create_a_landmine(self):
        for metadata in ({'class_name': 'unknown'}, {'class': 'N/A'},
                         {'class_name': 'unknown', 'class_id': 999}):
            with self.subTest(metadata=metadata):
                event = self.event(metadata)
                self.assertIsNone(event['class_name'])
                self.assertEqual(event['class_id'], metadata.get('class_id'))
                self.assertEqual(event['image_path'], 'renamed-land_mines.jpg')
                self.assertTrue(event['match']['matched'])

    def test_public_class_normalizers_keep_valid_values_and_reject_placeholders(self):
        self.assertEqual(normalize_class_name(' land_mines '), 'land_mines')
        self.assertEqual(normalize_class_name('unknown_object'), 'unknown_object')
        self.assertEqual(normalize_class_name('background'), 'background')
        self.assertIsNone(normalize_class_name(' UNKNOWN\n class '))
        self.assertIsNone(normalize_class_name(None))
        self.assertEqual(normalize_class_id('0'), 0)
        self.assertEqual(normalize_class_id(12.0), 12)
        self.assertIsNone(normalize_class_id(True))
        self.assertIsNone(normalize_class_id('12.5'))

    def test_unknown_id_remains_unknown_without_guessing(self):
        event = self.event({'class_id': 999})
        self.assertEqual(event['class_id'], 999)
        self.assertIsNone(event['class_name'])

    def test_invalid_ids_and_structured_labels_are_not_classifications(self):
        for value in (True, False, -1, -1.0, 12.5, float('nan'), float('inf'),
                      '', ' ', 'NaN', 'Infinity', '-1', '12.5', [], {}, None):
            with self.subTest(value=value):
                event = self.event({'class_id': value})
                self.assertIsNone(event['class_id'])
                self.assertIsNone(event['class_name'])
        for value in (True, 12, ['land_mines'], {'name': 'land_mines'}):
            with self.subTest(label=value):
                self.assertIsNone(self.event({'class_name': value})['class_name'])

    def test_missing_metadata_does_not_use_the_filename_or_trigger(self):
        event = self.event({'detected': True})
        self.assertIsNone(event['class_id'])
        self.assertIsNone(event['class_name'])
        self.assertEqual(event['confidence'], 0.91)
        self.assertEqual(event['image_path'], 'renamed-land_mines.jpg')
        self.assertEqual(event['match']['latitude'], 17.3975)
        self.assertEqual(event['match']['longitude'], 78.4893)
        self.assertEqual(event['match']['gap_seconds'], 0)

    def test_singular_nested_metadata_only_and_top_level_precedence(self):
        for key in ('detection', 'prediction'):
            with self.subTest(key=key):
                self.assertEqual(self.event({key: {'classId': 12}})['class_name'], 'land_mines')
                self.assertIsNone(self.event({key: [{'classId': 12}]})['class_name'])
                event = self.event({'class_name': 'civilian', key: {'classId': 12}})
                self.assertEqual(event['class_name'], 'civilian')
                self.assertIsNone(event['class_id'])
        self.assertIsNone(self.event({'predictions': [{'classId': 12}, {'classId': 0}]})['class_name'])

    def test_normalized_class_updates_payload_without_changing_match_or_identity(self):
        unnamed = self.event({})
        named = self.event({'classId': 12})
        self.assertEqual(named['event_id'], unnamed['event_id'])
        self.assertEqual(named['match'], unnamed['match'])
        self.assertEqual(named['timestamp_original'], unnamed['timestamp_original'])
        self.assertNotEqual(named, unnamed)
        self.assertNotIn('metal_detected', named)
        self.assertNotIn('status', named)


if __name__ == '__main__':
    unittest.main()
