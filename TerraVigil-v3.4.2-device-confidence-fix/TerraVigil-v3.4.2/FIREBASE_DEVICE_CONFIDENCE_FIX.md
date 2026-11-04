# Firebase camera/metal detection fix

This update makes Firebase detections with `device: "camera"` or `device: "metal"` display as **Landmine**, rather than an unknown object, while retaining the source device as a separate label.

## Firebase fields handled

- `device`: `camera`, `metal`, or `metal_detector` (normalized to `metal`)
- `confidence_score`: normalized score (for example, `0.5968`)
- `confidence_percent`: percentage (for example, `59.68`)
- `timestamp` and `image_path`: retained as the event's timestamp and image reference

When either supported device is present, the bridge normalizes `class_name` to `land_mines`. If only `confidence_percent` is present, the normalized score is derived from it. Legacy confidence fields remain supported.

## How the dashboard distinguishes detections

- **Landmine · Camera** — visual detector observation. The camera confidence is displayed, and the point uses the visual/unconfirmed marker.
- **Landmine · Metal detector** — metal sensor observation. The metal sensor reading is shown separately and is not incorrectly treated as YOLO confidence; the point uses the metal/unresolved marker.

The source device alone does not mean the mine has been independently confirmed by both sensors. Existing confirmed statuses are preserved.

The bridge reads both `/detections` and `/metal_detections` by default. Override `FIREBASE_DETECTIONS_PATH` with a comma-separated list when your Firebase layout uses different branches.

## Launching the updated dashboard

Run the normal launcher:

```bash
py -3.12 start_terravigil.py
```

The launcher now detects when frontend source files are newer than the prebuilt dashboard and rebuilds the frontend automatically. Use `py -3.12 start_terravigil.py --rebuild` to force a rebuild. A network connection is required if frontend dependencies have to be installed.

## Regression checks

Targeted Python telemetry tests and the new Firebase bridge/report classification tests cover both device types, the `0.5968` / `59.68%` example, confidence fallback, and the camera-versus-metal distinction.
