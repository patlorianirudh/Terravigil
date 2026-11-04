# TerraVigil 3.4.2 YOLO class fix

The previous class-field fix did not handle literal placeholder labels. A Firebase record with `class_name: "unknown"` could keep that text even when its class ID identified the object. This revision treats missing-label placeholders as absent and resolves the actual supplied class metadata.

The optional publisher now includes `class_id` and rejects unresolved placeholder labels before upload/write. The new `yolo_detection_metadata()` and `publish_yolo_detection()` helpers use the selected box's class ID and the actual YOLO result's names mapping, preserving confidence and the original capture timestamp. They work with custom model catalogs, including a landmine class numbered 0. They do not silently treat every unknown object as a landmine.

Read **YOLO_CLASS_FIX.md** for both ground-station update instructions and the Jetson sender integration. The actual camera/inference sender was not supplied, so this archive cannot update its existing send loop automatically. If that script sends no usable class metadata, apply the documented one-line payload update using the two included helper files, or provide that script for a direct patch. A frontend rename alone cannot recover a model output that was never sent.

Existing usable Firebase records are replayed into the local dashboard on restart. The read-only importer does not alter source records in Firebase. The publisher change applies when the new helper is called by the sender. No live Firebase records were edited during development.

## Validation

Checked on 27 October 2026, Python 3.12 and Node.js 24:

- **42 focused Python tests passed:** 14 class normalization, 17 timestamp/CSV matching, and 11 publishing/YOLO-adapter tests.
- **12 backend bridge tests passed**, including placeholder-class repair, preserved coordinates, stable IDs, replay, image serving and deletion behavior.
- Publisher tests exercise actual JSON serialization, a mocked Firebase upload/write, then the real timestamp importer. They verify unknown plus class ID 12, a custom class 0 catalog, non-mine labels, multiple boxes and retries, and invalid/missing metadata with no write.
- Frontend source and compiled assets are unchanged from the tested 3.4.1 release (148 frontend tests and production build passed in that release). No UI rebuild was necessary for this revision.

No real YOLO inference, Jetson hardware, camera or live Firebase write was performed. The previously documented full Python-suite mismatch involving the unchanged logger's missing `PositionRecorder` remains outside this class-only patch. These results are focused tests, not a claim that full Python discovery passes.

The telemetry logger, CSV, timestamp lookup, GPS mapping, confirmation rules, frontend, RAG and package dependencies are unchanged from 3.4.1. Preserve existing settings, credentials, mission files and recorded CSVs when applying the runtime files listed in YOLO_CLASS_FIX.md. Earlier patch notes are retained as historical context.
