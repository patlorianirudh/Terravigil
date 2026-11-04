#!/usr/bin/env python3
"""Bounded JSON-over-stdio inference for the exact supplied TerraVigil checkpoint.

Input JSON: {inputPath, annotatedPath, confidence?: 0.25, device?: "cpu"}.
--check validates the checkpoint and runs a small CPU/device prediction. All
runtime logs go to stderr; stdout contains exactly one JSON response.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import warnings

ROOT = Path(__file__).resolve().parent
WEIGHTS = ROOT / 'weights' / 'best.pt'
MANIFEST = json.loads((ROOT / 'model.json').read_text(encoding='utf-8'))
CLASS_NAMES = {item['id']: item['name'] for item in MANIFEST['classes']}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_DIMENSION = 8192
MAX_REQUEST_BYTES = 65536


class InferenceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def read_request(stream) -> dict:
    raw = stream.read(MAX_REQUEST_BYTES + 1)
    try:
        if len(raw) > MAX_REQUEST_BYTES:
            raise ValueError('request too large')
        request = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        if not isinstance(request, dict):
            raise ValueError('object required')
        return request
    except (ValueError, TypeError):
        raise InferenceError('INFERENCE_INVALID_REQUEST', 'Provide one JSON object containing local image and annotation paths.') from None


def verify_checkpoint(path: Path = WEIGHTS) -> str:
    """No pickle loading occurs until the supplied model bytes pass this check."""
    try:
        path = Path(path)
        if not path.is_file():
            raise InferenceError('INFERENCE_MODEL_MISSING', 'Bundled inference/weights/best.pt is missing.')
        if path.stat().st_size != MANIFEST['bytes']:
            raise InferenceError('INFERENCE_MODEL_INTEGRITY', 'Checkpoint differs from the supplied best.pt. Restore the bundled model.')
        with path.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hashlib.sha256(source.read()).hexdigest()
    except OSError:
        raise InferenceError('INFERENCE_MODEL_MISSING', 'The bundled model cannot be read.') from None
    if digest != MANIFEST['sha256']:
        raise InferenceError('INFERENCE_MODEL_INTEGRITY', 'Checkpoint checksum does not match the supplied best.pt. Restore the bundled model.')
    return digest


def validate_request(request: dict) -> dict:
    if not isinstance(request, dict):
        raise InferenceError('INFERENCE_INVALID_REQUEST', 'Provide one JSON request object.')
    confidence = request.get('confidence', 0.25)
    if type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0.01 <= confidence <= 1:
        raise InferenceError('INFERENCE_INVALID_REQUEST', 'Confidence must be a number from 0.01 to 1.')
    paths = {}
    for key in ('inputPath', 'annotatedPath'):
        value = request.get(key)
        if not isinstance(value, str) or not value or len(value) > 8192 or '\x00' in value or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', value):
            raise InferenceError('INFERENCE_INVALID_REQUEST', 'Image and annotation paths must be local filesystem paths.')
        paths[key] = Path(value).expanduser().resolve()
    if paths['inputPath'] == paths['annotatedPath'] or paths['annotatedPath'].suffix.lower() not in ('.jpg', '.jpeg'):
        raise InferenceError('INFERENCE_INVALID_REQUEST', 'Use a distinct JPEG path for the annotation output.')
    return {**paths, 'confidence': float(confidence), 'device': validate_device(request.get('device', 'cpu'))}


def validate_device(value) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'cpu|mps|(?:cuda:)?[0-9]+', value):
        raise InferenceError('INFERENCE_INVALID_REQUEST', 'INFERENCE_DEVICE must be cpu, mps or a CUDA device such as 0.')
    return value


def decode_image(path: Path):
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError:
        raise InferenceError('INFERENCE_RUNTIME_UNAVAILABLE', 'Pillow is missing. Install inference/requirements.txt into the selected Python environment.') from None
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        size = Path(path).stat().st_size
        if size < 1:
            raise InferenceError('INFERENCE_INVALID_IMAGE', 'The uploaded image is empty.')
        if size > MAX_IMAGE_BYTES:
            raise InferenceError('INFERENCE_IMAGE_TOO_LARGE', 'Images must be at most 10 MiB.')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(path) as candidate:
                width, height = candidate.size
                if width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION or width * height > MAX_IMAGE_PIXELS:
                    raise InferenceError('INFERENCE_IMAGE_TOO_LARGE', 'Images must be at most 20 megapixels and 8192 pixels per side.')
                if candidate.format not in ('JPEG', 'PNG', 'WEBP') or getattr(candidate, 'n_frames', 1) != 1:
                    raise InferenceError('INFERENCE_INVALID_IMAGE', 'Provide one still JPEG, PNG or WebP image.')
                candidate.verify()
            with Image.open(path) as candidate:
                candidate.load()
                return ImageOps.exif_transpose(candidate).convert('RGB')
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InferenceError('INFERENCE_IMAGE_TOO_LARGE', 'Images must be at most 20 megapixels.') from None
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError):
        raise InferenceError('INFERENCE_INVALID_IMAGE', 'The image is damaged, incomplete or not a supported JPEG, PNG or WebP file.') from None


def format_predictions(rows, width: int, height: int) -> list:
    predictions = []
    if len(rows) > 300:
        raise InferenceError('INFERENCE_INVALID_OUTPUT', 'The model returned too many predictions.')
    for row in rows:
        if len(row) != 6 or any(type(value) not in (int, float) or not math.isfinite(value) for value in row):
            raise InferenceError('INFERENCE_INVALID_OUTPUT', 'The model returned invalid bounding boxes.')
        x1, y1, x2, y2, confidence, class_number = row
        class_id = int(class_number)
        if class_id != class_number or class_id not in CLASS_NAMES or not 0 <= confidence <= 1:
            raise InferenceError('INFERENCE_INVALID_OUTPUT', 'The model returned an unexpected class or confidence.')
        x1, x2 = max(0.0, min(float(width), float(x1))), max(0.0, min(float(width), float(x2)))
        y1, y2 = max(0.0, min(float(height), float(y1))), max(0.0, min(float(height), float(y2)))
        if x2 <= x1 or y2 <= y1:
            raise InferenceError('INFERENCE_INVALID_OUTPUT', 'The model returned an empty bounding box.')
        predictions.append({'classId': class_id, 'className': CLASS_NAMES[class_id], 'confidence': float(confidence),
                            'bbox': [x1, y1, x2, y2], 'normalizedCenter': {'x': (x1 + x2) / (2 * width), 'y': (y1 + y2) / (2 * height)}})
    return predictions


def load_model(device: str):
    verify_checkpoint()
    # Inference uses only local weights; runtime package installation and model
    # downloads are explicit setup operations, never request-time side effects.
    os.environ.setdefault('YOLO_CONFIG_DIR', str(Path(tempfile.gettempdir()) / 'terravigil-ultralytics'))
    os.environ.setdefault('YOLO_AUTOINSTALL', 'false')
    os.environ.setdefault('YOLO_OFFLINE', 'true')
    os.environ.setdefault('MPLBACKEND', 'Agg')
    try:
        Path(os.environ['YOLO_CONFIG_DIR']).expanduser().mkdir(parents=True, exist_ok=True)
        import torch
        import torchvision
        import ultralytics
        from ultralytics import YOLO
    except (ImportError, OSError) as error:
        raise InferenceError('INFERENCE_RUNTIME_UNAVAILABLE', f'Python inference dependencies are unavailable ({type(error).__name__}: {error}). Install inference/requirements.txt into the selected Python environment.') from None
    try:
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        # This exercises the compiled torchvision operator, detecting mismatched
        # CPU/CUDA wheels before readiness can be reported.
        torchvision.ops.nms(torch.tensor([[0.0, 0.0, 1.0, 1.0]]), torch.tensor([0.5]), 0.5)
        model = YOLO(str(WEIGHTS), task='detect', verbose=False)
        names = {int(key): value for key, value in model.names.items()}
        if model.task != 'detect' or names != CLASS_NAMES:
            raise InferenceError('INFERENCE_MODEL_INVALID', 'The loaded model task or class names differ from the supplied checkpoint metadata.')
        runtime = {'python': sys.version.split()[0], 'torch': torch.__version__, 'torchvision': torchvision.__version__, 'ultralytics': ultralytics.__version__}
        metadata = {'name': MANIFEST['name'], 'sha256': MANIFEST['sha256'], 'task': 'detect', 'device': device,
                    'classes': MANIFEST['classes'], 'trainingUltralytics': MANIFEST['trainingUltralytics']}
        return model, runtime, metadata
    except InferenceError:
        raise
    except Exception as error:
        raise InferenceError('INFERENCE_MODEL_INVALID', f'The model could not be loaded by this runtime ({type(error).__name__}: {str(error)[:400]}).') from None


def annotate(image, predictions: list, output_path: Path):
    from PIL import ImageDraw, ImageFont
    canvas = image.copy()
    draw = ImageDraw.Draw(canvas)
    line_width = max(2, round(min(canvas.size) / 300))
    font = ImageFont.load_default(size=max(12, min(32, round(min(canvas.size) / 40))))
    for prediction in predictions:
        color = '#e33c44' if prediction['className'] == 'land_mines' else '#f2b84b'
        x1, y1, x2, y2 = prediction['bbox']
        draw.rectangle((x1, y1, x2, y2), outline=color, width=line_width)
        label = f"{prediction['className']} {prediction['confidence']:.1%}"
        bounds = draw.textbbox((0, 0), label, font=font)
        text_width, text_height = bounds[2] - bounds[0], bounds[3] - bounds[1]
        text_x = max(0, min(int(x1), canvas.width - text_width - 8))
        text_y = max(0, int(y1) - text_height - 8)
        draw.rectangle((text_x, text_y, text_x + text_width + 8, text_y + text_height + 8), fill=color)
        draw.text((text_x + 4, text_y + 4 - bounds[1]), label, font=font, fill='#141414')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents silently replacing existing files in CLI usage.
    with output_path.open('xb') as target:
        canvas.save(target, format='JPEG', quality=92)
        target.flush()
        os.fsync(target.fileno())


def run(request: dict, check: bool = False) -> dict:
    if check:
        device = validate_device(request.get('device', os.environ.get('INFERENCE_DEVICE', 'cpu')))
        model, runtime, metadata = load_model(device)
        import numpy as np
        # A real forward pass is required for readiness; no placeholder detections.
        model.predict(source=np.zeros((64, 64, 3), dtype=np.uint8), imgsz=64, conf=0.99, device=device,
                      verbose=False, save=False, stream=False, max_det=1)
        return {'ok': True, 'ready': True, 'model': metadata, 'runtime': runtime}
    request = validate_request(request)
    image = decode_image(request['inputPath'])
    model, runtime, metadata = load_model(request['device'])
    results = model.predict(source=image, imgsz=640, conf=request['confidence'], device=request['device'],
                            verbose=False, save=False, stream=False, max_det=300, quantize=None)
    if len(results) != 1 or results[0].boxes is None:
        raise InferenceError('INFERENCE_INVALID_OUTPUT', 'The detector did not return one image result.')
    rows = results[0].boxes.data.detach().cpu().tolist()
    predictions = format_predictions(rows, image.width, image.height)
    annotate(image, predictions, request['annotatedPath'])
    return {'ok': True, 'model': metadata, 'runtime': runtime, 'image': {'width': image.width, 'height': image.height}, 'predictions': predictions}


def main() -> int:
    try:
        check = len(sys.argv) == 2 and sys.argv[1] == '--check'
        if len(sys.argv) > 1 and not check:
            raise InferenceError('INFERENCE_INVALID_REQUEST', 'Usage: python inference/predict.py [--check]')
        # --check works interactively without requiring stdin. Node passes its
        # device through the environment as well as the request protocol.
        request = {'device': os.environ.get('INFERENCE_DEVICE', 'cpu')} if check and sys.stdin.isatty() else ({} if check else None)
        if request is None:
            request = read_request(sys.stdin)
        elif check and not sys.stdin.isatty():
            raw = sys.stdin.read(MAX_REQUEST_BYTES + 1)
            if raw.strip(): request = read_request(io.StringIO(raw))
        with contextlib.redirect_stdout(sys.stderr):
            result = run(request, check=check)
        print(json.dumps(result, allow_nan=False, separators=(',', ':')))
        return 0
    except InferenceError as error:
        print(json.dumps({'ok': False, 'error': {'code': error.code, 'message': str(error)}}, allow_nan=False))
        return 2
    except Exception as error:
        print(json.dumps({'ok': False, 'error': {'code': 'INFERENCE_RUNTIME_UNAVAILABLE', 'message': f'Model inference failed ({type(error).__name__}: {str(error)[:400]}). Run the setup check and confirm the selected device.'}}, allow_nan=False))
        return 3


if __name__ == '__main__':
    raise SystemExit(main())
