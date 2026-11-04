#!/usr/bin/env python3
"""Read-only Firebase check using the same configuration as TerraVigil."""
import os
from pathlib import Path


def main():
    from dotenv import load_dotenv
    import firebase_admin
    from firebase_admin import credentials, db
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / 'backend/.env')
    key = Path(os.getenv('FIREBASE_SERVICE_ACCOUNT') or 'backend/serviceAccountKey.json')
    if not key.is_absolute():
        key = root / key
    app = firebase_admin.initialize_app(credentials.Certificate(str(key)), {
        'databaseURL': os.getenv('FIREBASE_DATABASE_URL', 'https://terravigil-e816d-default-rtdb.asia-southeast1.firebasedatabase.app/'), 'httpTimeout': 15})
    try:
        data = db.reference(os.getenv('FIREBASE_DETECTIONS_PATH', 'detections'), app=app).get() or {}
        print(f'Authenticated Firebase read succeeded. {len(data)} detection records.')
        for key, value in list(data.items())[-10:]:
            if isinstance(value, dict):
                print(key, value.get('class_name'), value.get('capture_timestamp', value.get('timestamp')), value.get('image_path'))
    finally:
        firebase_admin.delete_app(app)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Firebase check failed ({type(error).__name__}). Check credentials, network, and backend/.env.'); raise SystemExit(1)
