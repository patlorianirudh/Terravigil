#!/usr/bin/env python3
"""Upload one captured image to Firebase Storage and publish its detection metadata.

Call publish_detection(...) from your existing detector, or use the CLI.
The caller supplies the actual capture time; this script performs no AI inference.
"""
import argparse
import hashlib
import json
import os
import uuid
from pathlib import Path
from config import load_environment, setting_path
from lookup_telemetry import parse_timestamp, iso
from detection_class import detection_class, normalize_class_id
from yolo_metadata import yolo_detection_metadata


def publish_detection(image, capture_timestamp, class_name=None, confidence=None, *, class_id=None, bucket_name=None, record_id=None, app=None):
    # Validate before creating an app, uploading bytes or writing Firebase. A
    # placeholder must never be silently published as the actual model label.
    normalized_id = normalize_class_id(class_id)
    if class_id is not None and normalized_id is None:
        raise ValueError('class_id must be a non-negative integer.')
    class_name, normalized_id = detection_class({'class_name': class_name, 'class_id': normalized_id})
    if class_name is None:
        raise ValueError('Missing YOLO class: supply the actual class name, a known bundled-model class ID, or use publish_yolo_detection().')
    import firebase_admin
    from firebase_admin import credentials, db, storage
    load_environment()
    image = Path(image)
    if image.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} or not image.is_file():
        raise ValueError('Supply an existing PNG, JPEG, or WebP image.')
    if not 0 < image.stat().st_size <= 20 * 1024 * 1024:
        raise ValueError('Image must be 1 byte to 20 MiB.')
    capture = parse_timestamp(capture_timestamp)  # Explicit UTC offset required.
    if confidence is not None and (type(confidence) not in (float, int) or not 0 <= confidence <= 1):
        raise ValueError('Confidence must be between 0 and 1.')
    bucket_name = bucket_name or os.getenv('FIREBASE_STORAGE_BUCKET')
    if not bucket_name:
        raise ValueError('Set FIREBASE_STORAGE_BUCKET to the exact bucket name shown in Firebase Storage.')
    own_app = app is None
    if own_app:
        app = firebase_admin.initialize_app(credentials.Certificate(str(setting_path('FIREBASE_SERVICE_ACCOUNT', 'backend/serviceAccountKey.json'))),
            {'databaseURL': os.environ['FIREBASE_DATABASE_URL'], 'httpTimeout': 15}, name='capture-' + uuid.uuid4().hex)
    try:
        reference = db.reference(os.getenv('FIREBASE_DETECTIONS_PATH', 'detections'), app=app)
        if record_id is not None and (not record_id or any(c in record_id for c in '.#$[]/')):
            raise ValueError('record_id must be a valid Firebase child key.')
        # Pass a stable record_id when retrying the same capture to avoid duplicates.
        key = record_id or reference.push().key
        safe_key = hashlib.sha256(key.encode()).hexdigest()[:16]
        filename = capture.strftime('%Y%m%dT%H%M%S%fZ') + '_' + safe_key + image.suffix.lower()
        mission = os.getenv('FIREBASE_MISSION_ID', 'TV-LIVE-001')
        object_name = f'TerraVigil/captures/{mission}/{filename}'
        blob = storage.bucket(bucket_name, app=app).blob(object_name)
        content_type = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}[image.suffix.lower()]
        blob.upload_from_filename(str(image), content_type=content_type, timeout=30)
        record = {'mission_id': mission, 'capture_timestamp': iso(capture), 'timestamp': iso(capture),
                  'image_path': image.name, 'storage_path': f'gs://{bucket_name}/{object_name}',
                  'class_name': class_name, 'confidence': confidence}
        if normalized_id is not None:
            record['class_id'] = normalized_id
        reference.child(key).set(record)
        return {'firebase_id': key, 'renamed_filename': filename, **record}
    finally:
        if own_app:
            firebase_admin.delete_app(app)


def publish_yolo_detection(image, capture_timestamp, result, *, box_index, bucket_name=None, record_id=None, app=None):
    """Publish one real YOLO box using that result's class catalog.

    Pass the original image capture timestamp, not the upload/inference time.
    For multiple boxes call once per selected box with distinct stable keys.
    """
    metadata = yolo_detection_metadata(result, box_index=box_index)
    return publish_detection(image, capture_timestamp, **metadata, bucket_name=bucket_name,
                             record_id=record_id, app=app)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--timestamp', required=True, help='Actual capture time, e.g. 2026-10-16T10:00:00Z')
    parser.add_argument('--class-name', help='Actual detector label; placeholders such as unknown are rejected.')
    parser.add_argument('--class-id', type=int, help='Actual class ID; without a name, uses the bundled model catalog.')
    parser.add_argument('--confidence', type=float)
    parser.add_argument('--bucket')
    parser.add_argument('--record-id')
    args = parser.parse_args()
    result = publish_detection(args.image, args.timestamp, args.class_name, args.confidence, class_id=args.class_id, bucket_name=args.bucket, record_id=args.record_id)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError) as error:
        print(f'Capture: {error}')
        raise SystemExit(1)
    except Exception as error:
        print(f'Capture upload failed ({type(error).__name__}). Check Firebase/Storage credentials, permissions, and network. Retry with the same --record-id.')
        raise SystemExit(1)
