# TerraVigil 3.4

Firebase detection metadata → automatic capture timestamp lookup in Pixhawk telemetry CSV → coordinates and renamed evidence images on the dashboard map.

Start with **START_HERE.md**. The entry point is Python:

```text
py -3.12 start_terravigil.py --setup
py -3.12 start_terravigil.py
```

To test with labeled images without a drone:

```text
py -3.12 start_terravigil.py --mode test
```

The live source defaults to Firebase `/detections` and `telemetry/DroneTelemetry/telemetry.csv`, matching your latest upload. New detections and late CSV rows are processed automatically, without interactive lookup prompts. The inbox shows the latest capture first.

**Your uploaded CSV has 62,443 rows but no usable GPS coordinates.** The dashboard explains this instead of placing markers at (0, 0). Capture new images after Mission Planner has valid GPS, or supply the corresponding historical valid telemetry.

This updated copy preserves the application's dashboard, mission history, RAG, and factual PDF/CSV reporting. It fixes the Tailwind/PostCSS startup mismatch, replaces the outdated telemetry logger, adds a unified Python launcher and real Firebase image test, and adds asynchronous image retrieval/copying with timestamp-based filenames. Model Inference is not in the navigation.

The prebuilt frontend is included. Node.js 22.12+ within version 22 or version 24 and Python 3.10–3.12 are required. Use Python 3.12 if installing fresh. Credentials and `.env` secrets are not bundled; copy your existing `serviceAccountKey.json` into `backend` before testing. Original recorded CSVs are retained.

The reader does not write to Firebase. The separate test sender writes only to an isolated `TerraVigil/tests` branch. The optional capture publisher writes real images/records when explicitly invoked. Capture markers represent aircraft GPS; visual observations remain unconfirmed.

Useful commands after setup:

```text
py -3.12 start_terravigil.py --help
py -3.12 start_terravigil.py --mode recorded --csv reference/telemetry.csv
python send_firebase_test_images.py
npm test
.venv\Scripts\python.exe -m unittest discover -s telemetry/tests -v
.venv\Scripts\python.exe telemetry/tests/mavlink_smoke.py
```

Implementation entry points: `start_terravigil.py`, `telemetry/firebase_bridge.py`, `telemetry/lookup_telemetry.py`, `telemetry/image_cache.py`, `telemetry/drone_metrics_forwarded.py`, and `backend/bridge/service.js`.

Frontend compatibility reference: https://tailwindcss.com/docs/upgrade-guide (v4 moved its PostCSS plugin and changed CSS directives; this project retains its v3 configuration with a pinned v3 dependency).
