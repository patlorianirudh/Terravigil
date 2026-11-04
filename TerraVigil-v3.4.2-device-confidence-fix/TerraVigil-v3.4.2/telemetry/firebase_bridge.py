#!/usr/bin/env python3
"""Read Firebase and local telemetry; emit NDJSON to the local backend. Never writes Firebase."""
import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from lookup_telemetry import TelemetryIndex, numeric, parse_timestamp
from image_cache import ImageCache
from config import load_environment, setting_path
from detection_class import detection_class

ROOT = Path(__file__).resolve().parents[1]


def emit(kind, **payload):
    print(json.dumps({'type': kind, **payload}, allow_nan=False, separators=(',', ':')), flush=True)


def event_id(mission, key):
    return 'FB-' + hashlib.sha256(f'{mission}\0{key}'.encode()).hexdigest()[:24]


def process_detection(key, record, index, mission, max_gap, tz, offset, synthetic=False):
    identity = event_id(mission, key)
    if not isinstance(record, dict):
        return {'event_id': identity, 'firebase_id': key, 'mission_id': mission, 'synthetic': synthetic,
                'match': {'matched': False, 'status': 'invalid_record', 'reason': 'Expected a JSON object.'}}
    timestamp = record.get('capture_timestamp') if record.get('capture_timestamp') is not None else record.get('timestamp')
    match = index.lookup(timestamp, max_gap, tz, offset)
    # New drone records publish an explicit sensor type and confidence in both
    # normalized and percentage form. Keep the legacy aliases for older captures.
    raw_device = record.get('device')
    device = raw_device.strip().lower() if isinstance(raw_device, str) else None
    if device == 'metal_detector':
        device = 'metal'
    if device not in {'camera', 'metal'}:
        device = None

    confidence_score = numeric(record.get('confidence_score'))
    if confidence_score is not None and not 0 <= confidence_score <= 1:
        confidence_score = None

    confidence_percent = numeric(record.get('confidence_percent'))
    if confidence_percent is not None and not 0 <= confidence_percent <= 100:
        confidence_percent = None
    # Prefer either explicitly named Firebase field over legacy aliases.
    if confidence_score is None and confidence_percent is not None:
        confidence_score = confidence_percent / 100.0
    if confidence_score is None:
        confidence_score = numeric(record.get('confidence', record.get('yolo_confidence')))
        if confidence_score is not None and not 0 <= confidence_score <= 1:
            confidence_score = None
    if confidence_percent is None and confidence_score is not None:
        confidence_percent = confidence_score * 100.0

    class_name, class_id = detection_class(record)
    # In this Firebase schema `device` is the sensor channel that has already
    # detected a landmine candidate, not the model's arbitrary class label.
    if device in {'camera', 'metal'}:
        class_name = 'land_mines'
    return {'event_id': identity, 'firebase_id': key, 'mission_id': mission, 'synthetic': synthetic, 'test_record': record.get('test_record') is True,
            'timestamp_original': timestamp, 'class_name': class_name,
            'class_id': class_id, 'device': device,
            'confidence': confidence_score, 'confidence_score': confidence_score,
            'confidence_percent': confidence_percent,
            'image_path': str(record.get('image_path') or record.get('image_filename') or record.get('filename') or '')[:2000],
            'image_url': str(record.get('image_url') or '')[:4000], 'match': match}


def capture_epoch(record, tz='Asia/Kolkata'):
    try:
        return parse_timestamp(record.get('capture_timestamp', record.get('timestamp')),
                               tz).timestamp()
    except (AttributeError, ValueError, TypeError, OverflowError):
        return float('-inf')


def run(args):
    mission = args.mission
    index = TelemetryIndex(args.csv, args.telemetry_timezone)
    app, reference = None, None
    if args.fixture:
        data_reader = lambda: json.loads(Path(args.fixture).read_text(encoding='utf8'))
    else:
        import firebase_admin
        from firebase_admin import credentials, db
        app = firebase_admin.initialize_app(credentials.Certificate(args.credentials),
            {'databaseURL': args.database_url, 'httpTimeout': 15}, name=f'bridge-{os.getpid()}')
        references = [
            (database_path.strip(), db.reference(database_path.strip(), app=app))
            for database_path in args.database_path.split(',')
            if database_path.strip()
        ]
        if not references:
            raise ValueError('At least one Firebase detection path is required.')
        def data_reader():
            merged = {}
            for database_path, reference in references:
                for key, record in (reference.get() or {}).items():
                    merged[f'{database_path}:{key}'] = record
            return merged
    images = ImageCache(args.image_dir, app=app, allowed_hosts=args.image_hosts.split(','), bucket=args.storage_bucket)
    emitted, track_emitted, failures = {}, set(), 0
    previous_snapshot_ids = None
    try:
        while True:
            started = time.monotonic()
            try:
                index.reload()
                snapshot = data_reader()
                if snapshot is None:
                    snapshot = {}
                if not isinstance(snapshot, dict):
                    raise ValueError('Firebase detection path must contain an object keyed by detection ID')
                snapshot = {key: record for key, record in snapshot.items() if not isinstance(record, dict) or not record.get('mission_id') or record.get('mission_id') == mission}
                snapshot_ids = sorted(event_id(mission, str(key)) for key in snapshot)
                if snapshot_ids != previous_snapshot_ids:
                    emit('snapshot', mission_id=mission, event_ids=snapshot_ids)
                    previous_snapshot_ids = snapshot_ids
                counts = {'total': len(snapshot), 'matched': 0, 'pending': 0, 'invalid': 0}
                # Send changed events only. The backend also deduplicates durably across restarts.
                for key, record in sorted(snapshot.items(), key=lambda item: capture_epoch(item[1], args.detection_timezone), reverse=True):
                    event = process_detection(str(key), record, index, mission, args.max_gap,
                                              args.detection_timezone, args.clock_offset, bool(args.fixture))
                    if isinstance(record, dict):
                        event['image'] = images.resolve(event, record)
                    match = event['match']
                    counts['matched' if match.get('matched') else 'invalid' if match['status'].startswith('invalid') else 'pending'] += 1
                    fingerprint = json.dumps(event, sort_keys=True)
                    if emitted.get(key) != fingerprint:
                        emit('detection', event=event)
                        emitted[key] = fingerprint
                # Explicit removals retract the map item while retaining its audit record.
                for key in set(emitted) - set(snapshot):
                    emit('removed', event_id=event_id(mission, str(key)), mission_id=mission)
                    del emitted[key]
                # Thin the flight track to at most one sample per second. Detection lookup
                # always uses the full-resolution index, not this display series.
                track = []
                seen_seconds = set()
                for row in index.rows:
                    second = int(row['epoch'])
                    if second in seen_seconds:
                        continue
                    seen_seconds.add(second)
                    identity = event_id(mission, 'track:' + row['timestamp'])
                    if identity in track_emitted:
                        continue
                    raw = row['raw']
                    track.append({'_id': identity, 'mission_id': mission, 'timestamp': row['timestamp'],
                                  'latitude': row['latitude'], 'longitude': row['longitude'],
                                  'altitude_amsl_m': numeric(raw.get('altitude_m')),
                                  'relative_altitude_m': numeric(raw.get('relative_altitude_m')),
                                  'ground_speed_ms': numeric(raw.get('ground_speed_m_s')),
                                  'heading_deg': numeric(raw.get('yaw_deg')),
                                  'battery_percent': numeric(raw.get('battery_remaining_percent')),
                                  'gps_fix_type': numeric(raw.get('gps_fix_type')),
                                  'synthetic': bool(args.fixture), 'source': 'pixhawk_csv'})
                    track_emitted.add(identity)
                for start in range(0, len(track), 500):
                    emit('telemetry', mission_id=mission, synthetic=bool(args.fixture), rows=track[start:start+500])
                emit('status', state='connected', mission_id=mission, counts=counts,
                     last_sync=datetime.now(timezone.utc).isoformat(), telemetry=index.summary,
                     source='fixture' if args.fixture else 'firebase',
                     message='Watching detections and telemetry; matches update the map automatically.' if index.rows else
                             'Firebase connected. No usable GPS positions in the CSV yet; detections will retry automatically.')
                failures = 0
                if args.once:
                    return 0
            except Exception as error:
                # Provider exception text can contain URLs, tokens, or private paths.
                # Return a useful category without echoing the exception payload.
                failures += 1
                emit('status', state='error', error_type=type(error).__name__, mission_id=mission,
                     telemetry=index.summary, message='Read failed. Check the network, Firebase access, and telemetry file. Retrying automatically.')
                if args.once:
                    return 1
            time.sleep(max(0.1, min(30, args.poll * max(1, failures)) - (time.monotonic() - started)))
    finally:
        images.close()
        if app is not None:
            import firebase_admin
            firebase_admin.delete_app(app)


def main():
    load_environment()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image-dir', default=str(setting_path('DETECTION_IMAGE_DIR', 'images')))
    parser.add_argument('--image-hosts', default=os.getenv('DETECTION_IMAGE_HOSTS', ''))
    parser.add_argument('--storage-bucket', default=os.getenv('FIREBASE_STORAGE_BUCKET', ''))
    parser.add_argument('--csv', default=str(setting_path('TELEMETRY_CSV_PATH', 'telemetry/DroneTelemetry/telemetry.csv')))
    parser.add_argument('--credentials', default=str(setting_path('FIREBASE_SERVICE_ACCOUNT', 'backend/serviceAccountKey.json')))
    parser.add_argument('--database-url', default=os.getenv('FIREBASE_DATABASE_URL', 'https://terravigil-e816d-default-rtdb.asia-southeast1.firebasedatabase.app/'))
    parser.add_argument('--database-path', default=os.getenv('FIREBASE_DETECTIONS_PATH', 'detections'))
    parser.add_argument('--mission', default=os.getenv('FIREBASE_MISSION_ID', 'TV-LIVE-001'))
    parser.add_argument('--max-gap', type=float, default=float(os.getenv('TELEMETRY_MAX_GAP_SECONDS', '2')))
    parser.add_argument('--clock-offset', type=float, default=float(os.getenv('DETECTION_CLOCK_OFFSET_SECONDS', '0')))
    parser.add_argument('--detection-timezone', default=os.getenv('FIREBASE_TIMESTAMP_TIMEZONE', 'Asia/Kolkata'))
    parser.add_argument('--telemetry-timezone', default=os.getenv('TELEMETRY_TIMESTAMP_TIMEZONE', 'Asia/Kolkata'))
    parser.add_argument('--poll', type=float, default=float(os.getenv('FIREBASE_POLL_SECONDS', '3')))
    parser.add_argument('--fixture')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    if args.max_gap < 0 or args.max_gap > 60 or not 1 <= args.poll <= 60:
        parser.error('max-gap must be 0..60 seconds and poll must be 1..60 seconds')
    try:
        return run(args)
    except Exception as error:
        emit('status', state='error', error_type=type(error).__name__,
             message='Bridge could not start. Run setup and check the credential file and configuration.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
