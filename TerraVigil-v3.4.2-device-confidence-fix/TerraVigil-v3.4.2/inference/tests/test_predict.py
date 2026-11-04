"""Image boundary and checkpoint integrity tests; no model download required."""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import predict


class RequestTests(unittest.TestCase):
    def test_json_protocol_rejects_arrays_and_overlong_input(self):
        for raw in ('[]', 'invalid-json', '{"pad":"' + 'a' * 65536 + '"}'):
            with self.subTest(raw=raw[:30]), self.assertRaises(predict.InferenceError):
                predict.read_request(io.StringIO(raw))

    def test_cli_returns_json_error_instead_of_traceback(self):
        completed = subprocess.run([sys.executable, str(Path(predict.__file__))], input='[]', text=True, capture_output=True)
        self.assertNotEqual(completed.returncode, 0)
        payload = json.loads(completed.stdout)
        self.assertFalse(payload['ok'])
        self.assertEqual(payload['error']['code'], 'INFERENCE_INVALID_REQUEST')
        self.assertNotIn('Traceback', completed.stderr)

    def test_bundled_checkpoint_matches_supplied_bytes(self):
        self.assertEqual(predict.verify_checkpoint(), '02d9b7eac5d7bbd33e0b8168ea892f24da6099b1fc02e9c87c688b928a464f93')

    def test_altered_checkpoint_is_rejected_before_unpickling(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'best.pt'
            path.write_bytes(b'untrusted replacement')
            with self.assertRaises(predict.InferenceError) as caught:
                predict.verify_checkpoint(path)
            self.assertEqual(caught.exception.code, 'INFERENCE_MODEL_INTEGRITY')

    def test_bad_confidence_or_remote_image_source_is_rejected(self):
        for value in (False, 0, 1.1, '0.5', float('nan')):
            with self.subTest(value=value), self.assertRaises(predict.InferenceError):
                predict.validate_request({'inputPath': '/tmp/image.png', 'annotatedPath': '/tmp/result.jpg', 'confidence': value})
        with self.assertRaises(predict.InferenceError):
            predict.validate_request({'inputPath': 'https://example.com/image.png', 'annotatedPath': '/tmp/result.jpg'})


class ImageTests(unittest.TestCase):
    def setUp(self):
        from PIL import Image
        self.Image = Image
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'image.png'

    def test_verified_image_decodes_as_rgb(self):
        self.Image.new('RGBA', (8, 5), 'red').save(self.path)
        image = predict.decode_image(self.path)
        self.assertEqual(image.mode, 'RGB')
        self.assertEqual(image.size, (8, 5))

    def test_truncated_and_mislabelled_images_are_rejected(self):
        self.Image.new('RGB', (8, 5)).save(self.path)
        self.path.write_bytes(self.path.read_bytes()[:30])
        with self.assertRaises(predict.InferenceError) as caught:
            predict.decode_image(self.path)
        self.assertEqual(caught.exception.code, 'INFERENCE_INVALID_IMAGE')
        self.path.write_text('<svg></svg>')
        with self.assertRaises(predict.InferenceError):
            predict.decode_image(self.path)

    def test_pixel_bomb_and_animated_input_are_rejected(self):
        self.Image.new('RGB', (5000, 4001)).save(self.path)
        with self.assertRaises(predict.InferenceError) as caught:
            predict.decode_image(self.path)
        self.assertEqual(caught.exception.code, 'INFERENCE_IMAGE_TOO_LARGE')
        frames = [self.Image.new('RGB', (5, 5), color) for color in ['red', 'blue']]
        frames[0].save(self.path, format='PNG', save_all=True, append_images=frames[1:])
        with self.assertRaises(predict.InferenceError):
            predict.decode_image(self.path)

    def test_exif_orientation_matches_returned_image_dimensions(self):
        image = self.Image.new('RGB', (8, 5))
        exif = self.Image.Exif(); exif[274] = 6
        image.save(self.path, format='JPEG', exif=exif)
        self.assertEqual(predict.decode_image(self.path).size, (5, 8))


class OutputTests(unittest.TestCase):
    def test_boxes_keep_classes_and_correct_normalized_centers(self):
        rows = [[20, 10, 80, 30, 0.91, 12], [0, 0, 10, 5, 0.8, 4]]
        predictions = predict.format_predictions(rows, width=100, height=50)
        self.assertEqual(len(predictions), 2)
        self.assertEqual(predictions[0], {'classId': 12, 'className': 'land_mines', 'confidence': 0.91, 'bbox': [20.0, 10.0, 80.0, 30.0], 'normalizedCenter': {'x': 0.5, 'y': 0.4}})
        self.assertEqual(predictions[1]['className'], 'military_vehicle')

    def test_unknown_classes_or_nonfinite_model_output_are_rejected(self):
        for row in ([0, 0, 10, 10, 0.8, 99], [0, 0, 10, 10, float('nan'), 12], [0, 0, 10, 10, 1.2, 12]):
            with self.subTest(row=row), self.assertRaises(predict.InferenceError):
                predict.format_predictions([row], width=100, height=100)


if __name__ == '__main__':
    unittest.main()
