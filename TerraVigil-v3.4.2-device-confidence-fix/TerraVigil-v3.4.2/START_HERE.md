# TerraVigil 3.4 — Python startup

## First setup (Windows)

1. Extract this ZIP completely into a new folder. Keep the previous version as a backup.
2. Install Python 3.12 (Python 3.10, 3.11, and 3.12 are supported) and Node.js 22.12+ within version 22, or Node.js 24. Enable Python's **Add to PATH** option. Reopen your terminal after installation.
3. Copy your existing private Firebase key to `backend/serviceAccountKey.json`. The updated ZIP does not redistribute private keys or your old `.env` file.
4. In the folder containing `start_terravigil.py`, open Command Prompt and run:

```text
py -3.12 start_terravigil.py --setup
```

This creates `.venv` with the selected supported Python interpreter, installs the dependencies, creates `backend/.env` if it is missing, and builds the frontend. It does not install the optional on-computer YOLO runtime. The onboard detector continues to provide its existing results.

## Start the automatic live workflow

After setup, run only:

```text
py -3.12 start_terravigil.py
```

This starts the backend, serves the frontend, starts the Mission Planner telemetry listener and starts the Firebase matching loop. Keep the terminal open. In Mission Planner, forward MAVLink as outbound TCP to `127.0.0.1:5760`. Do not separately run the old logger or interactive lookup. If your logger is already running, use `py -3.12 start_terravigil.py --no-telemetry` instead.

Defaults match your latest upload:

```dotenv
FIREBASE_DETECTIONS_PATH=detections
TELEMETRY_CSV_PATH=telemetry/DroneTelemetry/telemetry.csv
TELEMETRY_MAX_GAP_SECONDS=2
```

The root **`/detections`** branch is where your camera screenshot writes its data. Metal-detector records may use the root **`/metal_detections`** branch; the default configuration reads both branches. The older `TerraVigil/detections` branch is a different location. Setup creates a new `.env` from the included example. If you copy an older `.env`, update the detection path above and preserve your own optional API settings.

Every three seconds, the backend reads all detections, processes the newest captures first, converts capture and CSV timestamps to UTC, and automatically selects the nearest valid GPS sample within two seconds. There are **no timestamp entry or y/n prompts**. Pending detections retry when the CSV changes; the frontend refreshes automatically. Each Firebase ID keeps one marker across retries and restarts. Corrections update or retract its marker, and Firebase deletions retract it. An image filename does not control the timestamp lookup.

“Latest” means new detections are picked up automatically. Each image still matches its own capture time. Using the drone's latest position for an old photograph would place that photograph at the wrong location.

## What your screenshots and uploaded recording show

Your uploaded `telemetry/DroneTelemetry/telemetry.csv` is preserved unchanged. It contains **62,443 rows: 62,410 with (0, 0), and 33 with missing coordinates**. None currently supplies a usable map position. Older rows also have fewer fields than the header; the reader handles these without shifting the coordinate columns. New logger rows use one consistent schema.

Your example Firebase time `2026-10-16T08:58:20.379749+00:00` is `14:28:20.379749+05:30`. The lookup screenshot selects `14:31:50.796+05:30`, which is **210.416 seconds later**, and its coordinates are missing. That row cannot locate the capture. Explicit UTC offsets are already handled; do not subtract another 5.5 hours or enlarge the tolerance to force a marker.

Wait for a usable 3D GPS fix in Mission Planner, then capture a new image while telemetry is being recorded. That new detection should map automatically. Old captures need their corresponding valid historical telemetry. The dashboard shows the missing/zero-coordinate counts and the most recent CSV time so a connected Firebase feed is distinguishable from valid GPS.

## Test now, without the drone

```text
py -3.12 start_terravigil.py --mode test
```

Leave the terminal open. The launcher starts the backend and frontend together, opens your browser, generates three small synthetic test images, and sends their metadata through your **real Firebase database**. Their timestamps come from valid rows in `reference/telemetry.csv`.

The sender waits for three mapped records and three renamed image copies, then prints `PASS`. Open **Firebase & telemetry** to see each capture time, matched coordinate, GPS time difference, original filename, renamed filename, and image thumbnail. Click **Open map** or return to the Operations dashboard. The supplied recording contains repeated coordinates, so three markers can overlap.

The test uses a new branch on each launch:

```text
TerraVigil/tests/TV-FBTEST-<date-time-id>/detections
```

Its local data and images are in `.runtime/tests/<mission-id>`. It does not change your live detection branch or rewrite your recorded CSV. A yellow banner identifies this as a software test; the fixtures do not run AI inference. Test records remain available in the test branch for review. To resend the same three records while that test session is running:

```text
python send_firebase_test_images.py
```

Press **Ctrl+C** in the launcher terminal before switching modes.

## Use Pixhawk and Mission Planner

Edit these existing settings in `backend/.env` (do not add duplicate lines):

```dotenv
FIREBASE_ENABLED=true
FIREBASE_DATABASE_URL=https://terravigil-e816d-default-rtdb.asia-southeast1.firebasedatabase.app/
FIREBASE_DETECTIONS_PATH=detections
FIREBASE_SERVICE_ACCOUNT=backend/serviceAccountKey.json
FIREBASE_MISSION_ID=TV-FLIGHT-001
TELEMETRY_CSV_PATH=telemetry/DroneTelemetry/flight-001.csv
MAVLINK_CONNECTION=tcpin:127.0.0.1:5760
MAVLINK_SYSTEM_ID=0
DETECTION_IMAGE_DIR=images
TELEMETRY_MAX_GAP_SECONDS=2
DETECTION_CLOCK_OFFSET_SECONDS=0
```

Use a fresh mission ID and CSV filename for each flight. If the camera includes `mission_id` in its Firebase records, it must match this mission ID. For full flight isolation, use a mission-specific Firebase branch on both sender and receiver.

Run:

```text
py -3.12 start_terravigil.py
```

This starts the app **and** the telemetry logger. Do not also launch a second logger. In Mission Planner, connect to Pixhawk normally, then forward MAVLink as an outbound TCP/client connection to `127.0.0.1:5760` using its MAVLink/SerialOutput utility. The Python program is the listener. Menu labels depend on your Mission Planner version.

Wait for a fresh 3D GPS fix. The terminal displays recorded positions and the configured CSV grows automatically. Now run your existing camera/detector sender. New Firebase detections are read every three seconds, matched against the CSV, stored, and displayed in the selected dashboard mission. Browser data polls every three seconds too, so allow several seconds plus network time.

The logger records only fresh `GLOBAL_POSITION_INT` messages from the selected autopilot with recent valid GPS evidence. It uses Pixhawk `SYSTEM_TIME` plus the position's boot time when available; otherwise it records ground-computer reception time, with `timestamp_source=ground_receive_utc`. That fallback includes link delay. Keep the camera and ground computer clocks synchronized. This workflow plots aircraft GPS at capture time, not a surveyed object position.

If you already have a logger running against the same configured CSV:

```text
py -3.12 start_terravigil.py --no-telemetry
```

If you need only the logger, after setup:

```text
.venv\Scripts\python.exe telemetry\drone_metrics_forwarded.py
```

## Read Firebase against a recorded CSV

```text
py -3.12 start_terravigil.py --mode recorded --csv reference/telemetry.csv --mission TV-RECORDED-CHECK-001
```

This reads the configured real Firebase branch without starting the logger or sending test records. Explicit `mission_id` fields in incoming records must match the selected mission. Timestamp-only records are assigned to the configured mission.

For the newly uploaded recording use `--csv telemetry/DroneTelemetry/telemetry.csv`. Its current rows have no valid position, as explained above. The older `reference/telemetry.csv` is retained for the isolated no-drone test; it is a different recording and must not be used to assign coordinates to unrelated live captures.

## Real image files and automatic renaming

A Firebase filename does not contain the photo bytes. Choose one transfer route:

- `image_path`: copy/synchronize camera files into the configured `images` folder. Files can arrive after metadata; the app retries automatically.
- `image_url`: provide a downloadable HTTPS image URL. Firebase and Google Storage hosts are enabled. Add other exact hostnames to `DETECTION_IMAGE_HOSTS` in `.env` if required; redirects are rejected.
- `storage_path`: provide `gs://your-bucket/path/image.jpg`. The backend uses your Firebase service account to read the private object. A bare storage object path also works if `FIREBASE_STORAGE_BUCKET` is configured.

Accepted images are JPEG, PNG, and WebP, up to 20 MiB and 40 megapixels. The downloaded/copied file is saved under `images/received` as:

```text
20261016T100000000000Z_FB-<event-id>_<source-id>.jpg
```

The timestamp is normalized to UTC. A unique event ID avoids collisions when captures share a timestamp. The source filename is retained in the database and shown in the inbox. Original files and original Firebase records are not renamed or modified by the reader. Image download failures do not block GPS matching.

This payload works with the existing reader:

```json
{
  "mission_id": "TV-FLIGHT-001",
  "capture_timestamp": "2026-10-16T10:00:00.123Z",
  "timestamp": "2026-10-16T10:00:00.123Z",
  "image_path": "camera_renamed_photo.jpg",
  "storage_path": "gs://YOUR_STORAGE_BUCKET/captures/camera_renamed_photo.jpg",
  "class_name": "YOUR_ACTUAL_DETECTOR_CLASS",
  "confidence": 0.91
}
```

Use the **actual image capture time**, not the Firebase upload/server time or a time inferred from the filename. `capture_timestamp` takes priority over `timestamp`. ISO times with explicit offsets and Unix seconds/milliseconds are supported. Bare local timestamps use the configured source timezone.

An optional Python sender is included for environments with Python 3.10–3.12. Configure `FIREBASE_STORAGE_BUCKET` with the exact bucket name from your Firebase console, then call `publish_detection(...)` from your existing detector, or run:

```text
.venv\Scripts\python.exe telemetry\publish_detection.py --image images\capture.jpg --timestamp "2026-10-16T10:00:00.123Z" --class-name YOUR_ACTUAL_DETECTOR_CLASS --confidence 0.91 --record-id capture-0001
```

It uploads the photo to Storage with a unique capture-time filename and writes the record after the upload succeeds. A stable `--record-id` makes retries update that same event. This is an optional transfer helper; the script does not capture frames, run the model, or configure the onboard camera environment. Do not change real capture timestamps to force a match.

## Frontend and troubleshooting

- If your YOLO records show **unknown class**, read [YOLO_CLASS_FIX.md](YOLO_CLASS_FIX.md). The updated importer resolves placeholder labels from actual class IDs; the included Jetson adapter sends the real model class even for a custom model whose landmine class is ID 0.

- Open the launcher URL, usually `http://localhost:3000`. Do not open an HTML file directly.
- Tailwind is pinned to **3.4.17** to match this app's PostCSS configuration and existing styles. Production build and Vite development startup were checked; a prebuilt frontend is included. Do not run `npm install tailwindcss@latest` against this version.
- The Model Inference tab is absent. Old `/model` links open Firebase & telemetry.
- After changing frontend source: `py -3.12 start_terravigil.py --rebuild`.
- For development: run the Python launcher, then in a second terminal run `npm --prefix frontend run dev` and open `http://localhost:5173`. API requests are proxied to port 3000.
- Port occupied: stop the old app, or add `--port 3001` to the Python command. The compiled frontend uses the same port as the backend. Vite's development proxy targets port 3000.
- GPS waiting: check Mission Planner forwarding, autopilot heartbeat, a recent 3D fix, and the CSV path. Zero coordinates and invalid/stale fixes are not mapped.
- Time gap too large: compare the original capture time, UTC match time and CSV range in the inbox. Check the flight recording and clocks. Only use a measured `DETECTION_CLOCK_OFFSET_SECONDS` correction.
- Image waiting: check the original camera filename, folder synchronization or Storage access. A valid map marker can exist while the photo is still transferring.
- To generate a report without an AI key, choose **Factual snapshot · no AI**. Optional Gemini narrative/RAG uses your existing setup; restore your own `GEMINI_API_KEY` in the new `.env` if needed.

## Optional one-off lookup

The backend already performs this automatically. To inspect one timestamp as JSON, without any interactive prompt:

```text
python lookup_telemetry.py "2026-10-16T08:58:20.379749+00:00"
```

Exit code 0 means matched; 2 means pending/invalid. The configured CSV, source timezones and tolerance are used. No code falls back to an unrelated latest position.

## Verification included with this update

See `VERIFICATION.md` for the checks performed and their limits. No real drone flight was performed in this environment.
