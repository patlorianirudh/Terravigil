import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from drone_metrics_forwarded import PositionRecorder, open_csv, FIELDS
from image_cache import ImageCache
from firebase_bridge import process_detection
from lookup_telemetry import TelemetryIndex
from PIL import Image


def message(kind, system=1, component=1, **values):
    return SimpleNamespace(get_type=lambda: kind, get_srcSystem=lambda: system, get_srcComponent=lambda: component, **values)


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.recorder = PositionRecorder()
        self.recorder.consume(message('HEARTBEAT', type=2, autopilot=3, base_mode=0, custom_mode=0), 1792051200, 1)

    def fix(self, fix=3, now=1):
        return self.recorder.consume(message('GPS_RAW_INT', fix_type=fix, satellites_visible=12, eph=85), 1792051200, now)

    def position(self, boot=1000, now=2, system=1):
        return self.recorder.consume(message('GLOBAL_POSITION_INT', system=system, time_boot_ms=boot, lat=173975323, lon=784893248, alt=590190, relative_alt=1828), 1792051200, now)

    def test_requires_fresh_3d_fix_and_only_logs_position_messages(self):
        self.assertIsNone(self.position())
        self.fix(2)
        self.assertIsNone(self.position(1100))
        self.assertIsNone(self.fix(3))
        self.assertIsNotNone(self.position(1200))
        self.assertIsNone(self.recorder.consume(message('ATTITUDE', roll=.1, pitch=.2, yaw=.3), 1792051200, 3))
        self.assertIsNone(self.position(1300, now=10))

    def test_duplicate_and_other_vehicle_ignored(self):
        self.fix()
        self.assertIsNone(self.position(system=2))
        self.assertIsNotNone(self.position())
        self.assertIsNone(self.position())

    def test_autopilot_clock_and_receive_fallback_have_provenance(self):
        self.fix()
        row = self.position()
        self.assertEqual(row['timestamp_source'], 'ground_receive_utc')
        self.recorder.consume(message('SYSTEM_TIME', time_unix_usec=1792051200000000, time_boot_ms=1000), 1792051205, 2)
        row = self.position(1500, now=3)
        self.assertEqual(row['timestamp_source'], 'pixhawk_system_time')
        self.assertTrue(row['timestamp_utc'].endswith('.500Z'))
        self.assertNotEqual(row['timestamp_utc'], row['received_at_utc'])

    def test_reboot_requires_new_fix(self):
        self.fix()
        self.position(5000)
        self.assertIsNone(self.position(100))
        self.fix(now=3)
        self.assertIsNotNone(self.position(200, now=4))

    def test_csv_schema_mismatch_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'flight.csv'
            p.write_text('timestamp_local,latitude,longitude\n')
            before = p.read_bytes()
            with self.assertRaises(ValueError):
                open_csv(p)
            self.assertEqual(p.read_bytes(), before)
            p.unlink()
            handle, writer = open_csv(p)
            handle.close()
            self.assertEqual(p.read_text().strip(), ','.join(FIELDS))


class ImagePipelineTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.cache = ImageCache(self.root / 'images')
        self.addCleanup(self.cache.close)
        self.cache.root.mkdir()
        self.png = self.cache.root / 'renamed_picture.png'
        Image.new('RGB', (20, 20), 'green').save(self.png)
        csv = self.root / 'gps.csv'
        csv.write_text('timestamp_utc,latitude,longitude,gps_fix_type\n2026-10-15T08:55:20Z,17.3975,78.4893,3\n')
        self.index = TelemetryIndex(csv)
        self.index.reload()
        self.record = {'timestamp': '2026-10-15T08:55:20Z', 'image_path': 'renamed_picture.png'}

    def event(self, key='key'):
        return process_detection(key, self.record, self.index, 'FLIGHT', 2, 'UTC', 0)

    def test_filename_does_not_control_lookup_and_original_is_preserved(self):
        event = self.event()
        result = self.cache.materialize(event, self.record)
        self.assertTrue(event['match']['matched'])
        self.assertTrue(result['filename'].startswith('20261015T085520000000Z_FB-'))
        self.assertEqual((self.cache.root / result['local_path']).read_bytes(), self.png.read_bytes())
        self.assertTrue(self.png.exists())
        self.assertEqual(self.cache.materialize(event, self.record), result)

    def test_two_images_same_capture_time_do_not_collide(self):
        a = self.cache.materialize(self.event('a'), self.record)
        b = self.cache.materialize(self.event('b'), self.record)
        self.assertNotEqual(a['filename'], b['filename'])

    def test_missing_image_does_not_prevent_gps_match(self):
        self.png.unlink()
        self.assertTrue(self.event()['match']['matched'])
        with self.assertRaisesRegex(ValueError, 'Waiting for the camera'):
            self.cache.materialize(self.event(), self.record)

    def test_traversal_and_symlink_escape_blocked(self):
        outside = self.root / 'outside.png'
        Image.new('RGB', (2, 2)).save(outside)
        (self.cache.root / 'evil.png').symlink_to(outside)
        for name in ['../outside.png', 'evil.png']:
            with self.assertRaises(ValueError):
                self.cache.materialize(self.event(), {**self.record, 'image_path': name})

    def test_malformed_image_and_nonallowed_remote_url_rejected(self):
        self.png.write_text('not an image')
        with self.assertRaisesRegex(ValueError, 'valid supported'):
            self.cache.materialize(self.event(), self.record)
        for url in ['http://127.0.0.1/test.png', 'https://127.0.0.1/test.png', 'https://storage.googleapis.com@evil.example/a']:
            with self.assertRaises(ValueError):
                self.cache.materialize(self.event(), {'image_url': url})

    def test_allowed_https_image_download_and_rename(self):
        payload = self.png.read_bytes()
        class Response(io.BytesIO):
            pass
        opener = SimpleNamespace(open=lambda *a, **kw: Response(payload))
        with patch('image_cache.build_opener', return_value=opener):
            result = self.cache.materialize(self.event(), {'timestamp': self.record['timestamp'], 'image_url': 'https://storage.googleapis.com/my-bucket/photo.png'})
        self.assertEqual(result['state'], 'ready')
        self.assertEqual((self.cache.root / result['local_path']).read_bytes(), payload)

    def test_corrected_capture_time_changes_copy_name(self):
        a = self.cache.signature(self.record)
        self.record['timestamp'] = '2026-10-15T08:55:21Z'
        self.assertNotEqual(a, self.cache.signature(self.record))

    def test_remote_failure_does_not_block_local_gps_processing(self):
        result = self.cache.resolve(self.event(), {'image_url': 'https://127.0.0.1/a.png'})
        self.assertIn(result['state'], ['pending', 'waiting'])
        self.assertTrue(self.event()['match']['matched'])


if __name__ == '__main__':
    unittest.main()
