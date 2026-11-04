#!/usr/bin/env python3
"""Send three labeled test images through the isolated REAL Firebase test branch."""
import json
import os
import sys
import time
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'telemetry'))
from config import load_environment, setting_path
from lookup_telemetry import TelemetryIndex


def read_json(url):
    with urlopen(url, timeout=4) as response:
        return json.load(response)


def main():
    # Allow `python send_firebase_test_images.py` outside the virtual environment.
    venv = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if Path(sys.prefix).resolve() != (ROOT / '.venv').resolve() and venv.is_file():
        import subprocess
        return subprocess.call([str(venv), str(Path(__file__).resolve())])
    load_environment()
    session_path = ROOT / '.runtime/last_test.json'
    if not session_path.exists():
        raise ValueError('First run: python start_terravigil.py --mode test')
    session = json.loads(session_path.read_text())
    mission = session['FIREBASE_MISSION_ID']
    database_path = session['FIREBASE_DETECTIONS_PATH']
    if not mission.startswith('TV-FBTEST-') or database_path != f'TerraVigil/tests/{mission}/detections':
        raise ValueError('Test sender only writes to its isolated TerraVigil/tests mission.')
    base = f"http://127.0.0.1:{session['PORT']}"
    status = read_json(base + '/api/bridge/status')
    if status.get('mission_id') != mission or not status.get('test_mode'):
        raise ValueError('Start the matching test session before sending images.')
    index = TelemetryIndex(session['TELEMETRY_CSV_PATH'], session.get('TELEMETRY_TIMESTAMP_TIMEZONE', 'Asia/Kolkata'))
    index.reload()
    if not index.rows:
        raise ValueError('The selected CSV has no usable GPS samples. Use reference/telemetry.csv for the no-drone test.')
    from PIL import Image, ImageDraw
    import firebase_admin
    from firebase_admin import credentials, db
    image_dir = Path(session['DETECTION_IMAGE_DIR'])
    image_dir.mkdir(parents=True, exist_ok=True)
    rows = [index.rows[0], index.rows[len(index.rows)//2], index.rows[-1]]
    records = {}
    for i, (row, color) in enumerate(zip(rows, ['#62C79C', '#67A7DF', '#E8BC73']), 1):
        name = f'renamed_test_{i:02d}.png'
        picture = Image.new('RGB', (640, 420), '#101B17')
        draw = ImageDraw.Draw(picture)
        draw.rectangle((30, 30, 610, 390), outline=color, width=6)
        draw.ellipse((260, 120, 380, 240), fill=color)
        draw.text((50, 55), f'TERRAVIGIL / TEST IMAGE {i}', fill='white', font_size=28)
        draw.text((50, 280), 'Synthetic fixture. No detector inference.', fill='white', font_size=22)
        draw.text((50, 325), row['timestamp'], fill=color, font_size=20)
        picture.save(image_dir / name)
        records[f'test-image-{i}'] = {'mission_id': mission, 'capture_timestamp': row['timestamp'],
            'timestamp': row['timestamp'], 'image_path': name, 'class_name': f'TEST IMAGE {i}',
            'confidence': None, 'test_record': True,
            'note': 'Synthetic image and metadata; timestamp selected from recorded CSV to test the pipeline. No AI inference.'}
    app = firebase_admin.initialize_app(credentials.Certificate(str(setting_path('FIREBASE_SERVICE_ACCOUNT', 'backend/serviceAccountKey.json'))),
        {'databaseURL': session['FIREBASE_DATABASE_URL'], 'httpTimeout': 15}, name='image-test-sender')
    try:
        db.reference(database_path, app=app).update(records)
        print(f'Sent 3 test records to {database_path}. Waiting for matching and image copies...', flush=True)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            events = read_json(base + '/api/bridge/events')
            selected = [e for e in events if e.get('firebase_id') in records]
            if len(selected) == 3 and all(e['status'] == 'matched' and e.get('image', {}).get('state') == 'ready' for e in selected):
                for event in selected:
                    with urlopen(base + '/api/bridge/images/' + event['event_id'], timeout=4) as response:
                        if response.status != 200 or not response.headers.get('Content-Type', '').startswith('image/'):
                            raise ValueError('A renamed image could not be served by the backend.')
                        response.read(32)
                    match = event['match']
                    print(f"{event['firebase_id']}: {match['latitude']:.7f}, {match['longitude']:.7f} -> {event['image']['filename']}", flush=True)
                print('PASS: 3 received, 3 mapped, 3 renamed images ready. Open the dashboard map.\nThese historical GPS samples may share a position, so markers can overlap.', flush=True)
                return 0
            time.sleep(2)
        print('Sent successfully, but not all records mapped within 60 seconds. Check Firebase & telemetry; retries continue.', flush=True)
        return 2
    finally:
        firebase_admin.delete_app(app)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(f'Test: {error}', file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:
        print(f'Test failed ({type(error).__name__}). Check Firebase credentials, network, and the running test session.', file=sys.stderr)
        raise SystemExit(1)
