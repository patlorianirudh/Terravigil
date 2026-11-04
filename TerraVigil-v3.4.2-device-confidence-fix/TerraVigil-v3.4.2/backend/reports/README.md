# Immutable mission reports

`createReportRouter({ getDB, ragService, dataDir })` exports an Express router. Mount it under `/api` (the application's integrated server also supports the legacy direct paths).

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/reports?sessionId=...` | Ready editions, newest first; optional exact mission filter |
| GET | `/api/reports/:id` | Frozen edition metadata |
| POST | `/api/reports` | `{sessionId, includeAi?: boolean}`; returns 201 after persistence |
| GET | `/api/reports/:id/download?format=pdf` | PDF attachment; PDF is the default format |
| GET | `/api/reports/:id/download?format=csv` | UTF-8 CSV attachment with a BOM |

An edition contains all mission registry, detection, observation, telemetry and image inference run records present when it is captured. Risk totals count only stored confirmed classifications. Unconfirmed visual and unresolved metal records are separate. Counts refer to records, not deduplicated physical objects. Image-only model predictions are included without contributing to mine counts or inventing target GPS.

Reports default to `generationMode: "factual"` and need no AI provider. Explicit `includeAi: true` calls `ragService.prepare` and then `ragService.ask`; failure returns a non-2xx response with `code`, `error`, `message` and `narrativeError`. It does not create a factual replacement. Successful RAG reports have `generationMode: "rag"`, the actual narrative, and frozen mission-scoped citations. A source mutation during generation rejects the edition.

Metadata extends the frontend's `ReportItem` with `csvDownloadUrl`, `sourceHash`, `pdfHash`, `csvHash`, `generationMode`, `narrative`, `narrativeError`, `sources`, `narrativeSources`, `synthetic`, `recordCounts`, `hashSemantics` and `limitations`. `recordCounts` includes `unknownClassification`, `confirmedRiskUnknown`, `imageInferenceRuns`, `imagePredictions` and `unlocalizedImagePredictions`.

`sources` contains only the frozen factual source inventory. `narrativeSources` is a separate array in the exact RAG source order, with explicit one-based `citationNumber` values. Narrative `[1]` refers to `narrativeSources[0]`, not the first factual source. The PDF labels narrative citations with those numbers. CSV exports them as `narrative_source` rows whose `record_id` equals `citationNumber`; factual inventory entries remain separate `source` rows. Factual reports have an empty `narrativeSources` array.

## Storage and integrity

Editions are reserved with atomic directory creation under `<dataDir>/reports/editions/<reportNumber>`. Processes sharing the same data directory cannot claim the same number. Failed operations may leave a reserved number; numbers are never reused. PDF, CSV and `snapshot.json` files are flushed before `manifest.json`; the ready database record is inserted last. The API never accepts source records or filenames, and downloads derive fixed filenames from a validated report ID and numeric edition.

- `sourceHash`: SHA256 of the complete frozen source snapshot encoded as UTF-8 canonical JSON.
- `contentHash`: SHA256 of the exact canonical JSON stored in `snapshot.json`, including report identity, summary, sources, limitations and optional narrative. It excludes the hash itself and the generated file bytes.
- Citation `sha256`: SHA256 of the entire referenced source record in canonical JSON.
- `pdfHash` / `csvHash`: SHA256 of the exact downloadable bytes. CSV hashing includes the UTF-8 BOM and CRLF row separators.

Canonical JSON recursively sorts object keys, preserves array order, serializes dates as ISO strings, and has no optional whitespace. Source arrays are sorted before freezing. Download responses verify the saved manifest and byte hash before sending a file. Hashes detect changed content; they are not signatures or proof of sensor authenticity.

The CSV uses `record_type,record_id,field,value` rows so all fields, including nested model predictions and vendor telemetry, are retained. Nested values are JSON. Quoting follows CSV escaping rules; potentially executable spreadsheet cells receive a leading apostrophe. Original values remain intact in the snapshot and PDF appendix.

The PDF embeds the included DejaVu fonts for consistent rendering. Their redistribution notice is in `assets/fonts/LICENSE.txt`. Non-ASCII source characters are escaped visibly in the PDF; the snapshot and CSV retain original UTF-8. Images remain labeled references and are not fetched during generation.

Run the report HTTP regressions with `node --test test/reports.test.cjs` from `backend`, and the full backend suite with `npm test`.

Version 3.2 reports include declared Jetson Nano 4GB / ZD550 / Pixhawk hardware and Firebase total, matched, pending, invalid and removed counts. New reports reject simulated sources; old synthetic report editions are hidden. The PDF retains aircraft GPS provenance and the CSV freezes the same source data.
