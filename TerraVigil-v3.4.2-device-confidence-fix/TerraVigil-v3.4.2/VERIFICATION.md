# TerraVigil 3.4 verification

Checked on 16 October 2026 using Linux, Python 3.12 and Node.js 24. These are software integration checks; no physical drone flight was performed.

## Results

- Authenticated read of the actual Firebase `/detections` branch succeeded: 48 records received, 48 pending, none invalid. Live source records were not edited. Their uploaded CSV has 62,443 rows, all unusable for GPS mapping: 62,410 zero-coordinate rows and 33 rows without coordinates.
- Real Firebase test used the isolated `TerraVigil/tests/TV-FBTEST-20261016-102000-030afc/detections` branch. Three labeled test images and valid fixture telemetry produced three mapped observations, three uniquely renamed images and working image HTTP endpoints. This did not run model inference.
- A fourth test detection arrived before its matching CSV row. It stayed pending. A partially written CSV row was ignored. Completing the row automatically produced coordinates 17.39753, 78.48933, with a 0.000251-second capture-to-GPS gap.
- A running Chromium dashboard changed from three to four map observations without reloading, navigating or confirming a lookup. Replaying the Firebase record did not duplicate it. Correcting its timestamp to one without matching GPS automatically removed its marker. Deleting the test record reconciled the inbox. The three test image records remain in the isolated branch for inspection.
- The newest capture remained first in the inbox when older records retried. Original image paths were preserved and cached copies had UTC capture-time filenames.
- Production TypeScript check and Vite build passed. A rebuilt `frontend/dist` is included. Tailwind is pinned to 3.4.17, matching this project's PostCSS/CSS configuration.
- Frontend: 146 tests passed. Backend: 112 tests passed; one optional external-provider check skipped. Python: 30 tests passed. Cases cover timezone equivalence, seconds/milliseconds, late and partial CSV writes, the screenshot's 210.416-second gap, zero/missing GPS, identity across retries, renamed-image lookup, corrections and deletions.
- TCP MAVLink smoke test: two generated fresh GPS position messages produced exactly two valid CSV rows, while ten attitude messages created no duplicate positions. Sensor UTC timestamps and coordinates were checked.
- Vite development startup on port 5173 passed with no Tailwind/PostCSS error overlay. The old `/model` URL redirected to `/connections`; the real 48-record inbox and zero-GPS diagnostic rendered.
- Browser tests recorded no JavaScript page errors. Connections rendered at 390 × 844 without document-level horizontal overflow; its table scrolls independently.

## Problems corrected in the uploaded project

1. `firebase_bridge.py` imported `TelemetryIndex`, but the replacement interactive `lookup_telemetry.py` no longer defined it. The automatic importable interface is restored; lookup never calls `input()`.
2. The app watched `TerraVigil/detections`, while the screenshots write to root `/detections`. All live defaults now match the screenshot.
3. The logger used a hard-coded CSV path and repeated cached GPS on unrelated MAVLink messages. It now respects the configured shared path, writes fresh valid GPS only, reports waiting-for-fix reasons, and uses a consistent header.
4. The frontend had Tailwind v4 with a v3 configuration. Its manifest, lockfile and built assets now agree.
5. A unified Python startup launches the backend, frontend server, Firebase bridge and optional telemetry logger. No batch file is needed. Existing root script names remain as compatibility entry points and use the installed project virtual environment.
6. Pending detections explain missing/zero GPS. The closest CSV timestamp is shown even if that row has unusable coordinates. A connected Firebase feed is not presented as proof of GPS availability.

## Limits

No Windows host, physical Pixhawk, Mission Planner UI, CSI Camera Module 2, onboard model or actual flight was tested here. The software and MAVLink protocol path were exercised with labeled test inputs. External satellite tiles were unavailable in this environment; GPS markers and the coordinate grid still rendered. Basemap imagery requires network access. Private Firebase Storage upload/download requires the team's bucket and access settings; this run used local test image bytes with real Firebase metadata. A Linux path such as `/home/kmit/.../image.jpg` in Firebase is metadata, not a remotely downloadable photo: synchronize the file to the configured image folder or publish a Storage/HTTPS image reference.

The uploaded live CSV is retained byte-for-byte. Missing historical GPS cannot be recovered from an image timestamp alone. New captures need valid telemetry at their capture time. Markers locate the aircraft at capture, not the exact ground location of an object. If Pixhawk UTC is unavailable, ground reception timestamps include telemetry link delay.

## Repeat the checks

From the extracted project root, after setup:

```text
npm test
.venv\Scripts\python.exe -m unittest discover -s telemetry/tests -v
.venv\Scripts\python.exe telemetry/tests/mavlink_smoke.py
py -3.12 start_terravigil.py --mode test
```

The test-mode command writes only to a new isolated test branch and opens the dashboard. Temporary browser tooling and screenshots used during development are not included in the ZIP.
