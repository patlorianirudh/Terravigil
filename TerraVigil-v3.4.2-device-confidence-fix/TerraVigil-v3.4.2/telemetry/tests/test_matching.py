import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lookup_telemetry import TelemetryIndex, parse_timestamp
from firebase_bridge import process_detection


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.file = Path(self.folder.name) / 'telemetry.csv'
        self.file.write_text('timestamp_local,latitude,longitude,gps_fix_type\n'
                             '2026-10-15T14:25:20+05:30,17.3975,78.4893,3\n'
                             '2026-10-15T14:25:22+05:30,17.3976,78.4894,3\n')
        self.index = TelemetryIndex(self.file)
        self.index.reload()

    def test_timezone_equivalence(self):
        result = self.index.lookup('2026-10-15T08:55:20Z')
        self.assertTrue(result['matched'])
        self.assertEqual(result['gap_seconds'], 0)
        self.assertEqual(result['latitude'], 17.3975)

    def test_different_clock_time_must_not_be_matched(self):
        result = self.index.lookup('2026-10-15T14:25:20Z')
        self.assertFalse(result['matched'])
        self.assertNotIn('latitude', result)

    def test_nearest_tie_prefers_earlier_sample(self):
        result = self.index.lookup('2026-10-15T08:55:21Z', max_gap=1)
        self.assertEqual(result['latitude'], 17.3975)
        self.assertEqual(result['method'], 'nearest')

    def test_gap_boundary_and_no_unbounded_match(self):
        self.assertTrue(self.index.lookup('2026-10-15T08:55:24Z', max_gap=2)['matched'])
        result = self.index.lookup('2026-10-15T08:55:24.001Z', max_gap=2)
        self.assertEqual(result['status'], 'outside_tolerance')
        self.assertNotIn('latitude', result)

    def test_naive_timestamp_requires_explicit_zone(self):
        self.assertEqual(self.index.lookup('2026-10-15 14:25:20')['status'], 'invalid_timestamp')
        self.assertTrue(self.index.lookup('2026-10-15 14:25:20', detection_timezone='Asia/Kolkata')['matched'])

    def test_epoch_seconds_and_milliseconds(self):
        value = parse_timestamp('2026-10-15T08:55:20Z').timestamp()
        for stamp in (value, value * 1000, str(int(value * 1000))):
            self.assertTrue(self.index.lookup(stamp)['matched'])

    def test_malformed_and_nonfinite_timestamps(self):
        for stamp in ('bad', None, True, float('nan'), '2026-10-15'):
            self.assertEqual(self.index.lookup(stamp)['status'], 'invalid_timestamp')

    def test_pending_event_resolves_after_csv_append(self):
        stamp = '2026-10-15T08:56:00Z'
        self.assertFalse(self.index.lookup(stamp)['matched'])
        with self.file.open('a') as f:
            f.write(f'{stamp},18,79,3\n')
        self.index.reload()
        self.assertEqual(self.index.lookup(stamp)['latitude'], 18)

    def test_partial_line_not_read_until_complete(self):
        with self.file.open('a') as f:
            f.write('2026-10-15T08:56:00Z,18,79,3')
        self.index.reload()
        self.assertFalse(self.index.lookup('2026-10-15T08:56:00Z')['matched'])
        with self.file.open('a') as f:
            f.write('\n')
        self.index.reload()
        self.assertTrue(self.index.lookup('2026-10-15T08:56:00Z')['matched'])

    def test_bad_coordinates_and_no_fix_are_rejected(self):
        self.file.write_text('timestamp,latitude,longitude,gps_fix_type\n'
                             '2026-10-15T08:55:20Z,91,20,3\n'
                             '2026-10-15T08:55:20Z,17,78,1\n'
                             '2026-10-15T08:55:20Z,,78,3\n'
                             '2026-10-15T08:55:20Z,nan,78,3\n')
        self.index.reload()
        self.assertEqual(self.index.summary['rejected_rows'], 4)
        self.assertEqual(self.index.lookup('2026-10-15T08:55:20Z')['status'], 'waiting_for_telemetry')

    def test_missing_csv_clears_old_index(self):
        self.file.unlink()
        self.index.reload()
        self.assertEqual(self.index.summary['state'], 'missing')
        self.assertFalse(self.index.lookup('2026-10-15T08:55:20Z')['matched'])

    def test_clock_correction_is_explicit_and_audited(self):
        result = self.index.lookup('2026-10-15T08:55:10Z', clock_offset=10)
        self.assertTrue(result['matched'])
        self.assertEqual(result['capture_timestamp'], '2026-10-15T08:55:10.000000Z')
        self.assertEqual(result['lookup_timestamp'], '2026-10-15T08:55:20.000000Z')

    def test_detection_identity_and_capture_timestamp(self):
        record = {'capture_timestamp': '2026-10-15T08:55:20Z', 'timestamp': '2026-10-15T09:00:00Z', 'confidence': 0.91}
        a = process_detection('abc', record, self.index, 'M1', 2, 'UTC', 0)
        b = process_detection('abc', record, self.index, 'M1', 2, 'UTC', 0)
        self.assertEqual(a, b)
        self.assertTrue(a['match']['matched'])
        self.assertNotEqual(a['event_id'], process_detection('abc', record, self.index, 'M2', 2, 'UTC', 0)['event_id'])

    def test_firebase_sensor_device_sets_landmine_label_and_keeps_both_confidence_fields(self):
        for device in ('camera', 'metal'):
            with self.subTest(device=device):
                event = process_detection('sensor-' + device, {
                    'timestamp': '2026-10-15T08:55:20Z',
                    'device': device,
                    'class_name': 'unknown_object',
                    'confidence_score': 0.5968,
                    'confidence_percent': 59.68,
                    'image_path': 'detection_camera_20261028.jpeg',
                }, self.index, 'M1', 2, 'UTC', 0)
                self.assertEqual(event['device'], device)
                self.assertEqual(event['class_name'], 'land_mines')
                self.assertAlmostEqual(event['confidence'], 0.5968)
                self.assertAlmostEqual(event['confidence_score'], 0.5968)
                self.assertAlmostEqual(event['confidence_percent'], 59.68)
                self.assertTrue(event['match']['matched'])

    def test_firebase_metal_detector_alias_is_normalized_to_metal(self):
        event = process_detection('sensor-metal-detector', {
            'timestamp': '2026-10-15T08:55:20Z',
            'device': 'metal_detector',
            'class_name': 'unknown_object',
            'confidence_score': 0.0387,
            'confidence_percent': 3.87,
        }, self.index, 'M1', 2, 'UTC', 0)
        self.assertEqual(event['device'], 'metal')
        self.assertEqual(event['class_name'], 'land_mines')
        self.assertAlmostEqual(event['confidence_score'], 0.0387)

    def test_firebase_confidence_percent_can_supply_missing_normalized_score(self):
        event = process_detection('percent-only', {
            'timestamp': '2026-10-15T08:55:20Z', 'device': 'camera',
            'confidence_percent': 59.68,
        }, self.index, 'M1', 2, 'UTC', 0)
        self.assertAlmostEqual(event['confidence_score'], 0.5968)
        self.assertAlmostEqual(event['confidence_percent'], 59.68)
        self.assertEqual(event['class_name'], 'land_mines')

    def test_dst_ambiguous_time_rejected(self):
        with self.assertRaises(ValueError):
            parse_timestamp('2026-11-01T01:30:00', 'America/New_York')

    def test_uploaded_schema_and_zero_gps_explain_pending_then_accept_new_row(self):
        self.file.write_text('timestamp_utc,latitude,longitude,gps_fix_type,satellites\n'
                             '2026-10-16T14:31:50.796+05:30,,,,\n'
                             '2026-10-16T14:32:00+05:30,0,0\n')
        self.index.reload()
        self.assertEqual(self.index.summary['rejection_reasons']['missing_coordinates'], 1)
        self.assertEqual(self.index.summary['rejection_reasons']['zero_coordinates'], 1)
        self.assertEqual(self.index.summary['short_rows'], 1)
        result = self.index.lookup('2026-10-16T08:58:20.379749+00:00')
        self.assertEqual(result['status'], 'waiting_for_telemetry')
        self.assertAlmostEqual(result['nearest_record_gap_seconds'], 210.416251, places=5)
        self.assertNotIn('latitude', result)
        # A new valid position maps its corresponding new capture without stdin input.
        with self.file.open('a') as f:
            f.write('2026-10-16T14:32:01+05:30,17.3975,78.4893,3,12\n')
        self.index.reload()
        self.assertTrue(self.index.lookup('2026-10-16T09:02:01.000Z')['matched'])
        self.assertFalse(self.index.lookup('2026-10-16T08:58:20.379749+00:00')['matched'])

    def test_same_timestamp_detections_are_distinct_and_names_do_not_control_gps(self):
        a = process_detection('first', {'timestamp': '2026-10-15T08:55:20Z', 'image_path': 'renamed.jpg'}, self.index, 'M', 2, 'UTC', 0)
        b = process_detection('second', {'timestamp': '2026-10-15T08:55:20Z', 'image_path': 'another.jpg'}, self.index, 'M', 2, 'UTC', 0)
        self.assertTrue(a['match']['matched'])
        self.assertEqual(a['match'], b['match'])
        self.assertNotEqual(a['event_id'], b['event_id'])

    def test_zero_gps_rejected_even_when_fix_column_is_incorrectly_valid(self):
        self.file.write_text('timestamp,latitude,longitude,gps_fix_type\n2026-10-15T08:55:20Z,0,0,3\n')
        self.index.reload()
        self.assertEqual(self.index.summary['valid_rows'], 0)
        self.assertFalse(self.index.lookup('2026-10-15T08:55:20Z')['matched'])


if __name__ == '__main__':
    unittest.main()
