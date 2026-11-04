# TerraVigil 3.4.1 detection display patch

This update fixes Firebase class-field handling and removes the Visual candidates summary card marked in the supplied screenshot. The Confirmed mines, Metal observations and Review queue cards remain. The register opens on All observations so the current camera detections are visible; the existing tabs still filter the same records.

## What changed

- The importer accepts explicit class names from `class_name`, `className`, `label`, `name`, or a text `class`. Class IDs can come from `class_id`, `classId`, `cls`, or numeric `class`. A singular nested `detection` or `prediction` object is also supported. Top-level metadata takes precedence; prediction arrays are not arbitrarily reduced to one object.
- ID-only records use the supplied `inference/model.json` catalog. In this model, class `12` is `land_mines`; class `0` is a different class. An explicit name takes precedence over the catalog. Send a class name if the onboard model uses another catalog.
- A timestamp and image path alone cannot establish the model class. Such records now say **Class not supplied** instead of the importer inventing the literal **Unknown class**. A supplied but unmapped ID remains visible as its ID in the register. Filenames do not determine class or GPS.
- Camera-only status badges now read **Visual detection**, with a tooltip explaining that metal corroboration is absent. The internal status remains `UNCONFIRMED`. The **Confirmed mines** count still means recorded visual plus metal corroboration; this patch does not manufacture metal evidence.
- The frontend has been rebuilt and is included in `frontend/dist`.

Telemetry recording, CSV contents, timestamp matching, GPS coordinates, image handling, database schema, risk calculation, reports, RAG, and the Python launcher have not been changed. Model Inference navigation was already absent and remains so.

## Run or update

Keep your working installation as a backup. For an existing installation, copy only the changed source files listed below and replace its `frontend/dist` directory with the rebuilt one. **Do not overwrite your existing `backend/.env`, credentials, `backend/data`, images, or active telemetry CSV with the archive copies.** Keep your existing paths and settings.

Stop the old application, then run from your application folder:

```text
python start_terravigil.py
```

If you already run the telemetry logger separately, keep using your existing command and start with `python start_terravigil.py --no-telemetry`. The startup and installation behavior are unchanged. A fresh extraction needs your existing Firebase service-account configuration; no credentials have been added.

On restart, the bridge rereads Firebase. Previously imported records still present in Firebase are updated through the existing fingerprint/upsert mechanism when their normalized class changes. This does not duplicate map observations. Class metadata absent from Firebase cannot be recovered from the image path; include the actual model output in the publisher, for example:

```json
{
  "timestamp": "2026-10-27T10:00:00Z",
  "image_path": "capture.jpg",
  "class_name": "land_mines",
  "class_id": 12,
  "confidence": 0.91
}
```

This is a schema example, not a record to upload. Use the real capture timestamp, prediction, and image reference.

## Verification for this patch

Checked on 27 October 2026 with Python 3.12 and Node.js 24 on Linux:

- Frontend: **148 tests passed**; TypeScript check and production Vite build passed. ESLint completed with no errors and three existing nullish-coalescing warnings in ConnectionsPage.
- Backend: **113 tests passed**, one optional external-provider test skipped. A new Python-to-backend regression verifies that class-ID normalization repairs an old label, keeps one observation across replay, preserves coordinates and image references, and does not falsely confirm the event.
- Python: **27 focused tests passed** (10 class-normalization tests and 17 existing timestamp/CSV-matching tests).
- The unchanged Python launcher started the application with Firebase and aircraft telemetry disabled, and served the compiled frontend and API successfully. Backend tests cover SPA routes, image endpoints, corrected timestamps, late telemetry, deletion and replay.
- Full Python discovery remains blocked by an existing test/source mismatch: `telemetry/tests/test_capture_pipeline.py` imports `PositionRecorder` from `telemetry/drone_metrics_forwarded.py`, but the uploaded logger does not define it. Both files are retained unchanged to preserve the team's working logger. This is not a passing full Python suite.

No live Firebase credentials, Mission Planner connection, physical drone, or metal detector were available for validation. Browser visual verification was unavailable because the local Chromium download failed; the UI was checked through component/integration tests and a production build. The original `VERIFICATION.md` is retained as historical documentation of the supplied version, not as evidence of checks performed for this patch.

## Changed files

Runtime Python:

```text
telemetry/firebase_bridge.py
telemetry/detection_class.py (new)
```

Frontend source:

```text
frontend/src/components/map/TacticalMap.tsx
frontend/src/components/ui/ClassificationBadge.tsx
frontend/src/lib/classification.ts
frontend/src/pages/ConnectionsPage.tsx
frontend/src/pages/DetectionDetailPage.tsx
frontend/src/pages/DetectionsPage.tsx
frontend/src/pages/LiveConsolePage.tsx
frontend/src/pages/RiskMapPage.tsx
frontend/src/pages/SettingsPage.tsx
frontend/src/services/bridge.ts
frontend/src/styles/evidence.css
frontend/dist/ (rebuilt assets)
```

Regression tests and notes:

```text
backend/test/bridge.test.cjs
frontend/src/pages/MissionIntegration.test.tsx
telemetry/tests/test_detection_class.py (new)
PATCH_NOTES_3.4.1.md (new)
```

Existing package versions and lockfiles are unchanged. Installed dependencies and machine-specific virtual environments are not bundled.
