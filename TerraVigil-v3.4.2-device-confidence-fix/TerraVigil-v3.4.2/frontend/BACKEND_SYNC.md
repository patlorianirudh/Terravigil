# Frontend and backend integration

The current UI is served by the integrated Express app. Use [START_HERE.md](../START_HERE.md) for setup and [VERIFICATION.md](../VERIFICATION.md) for executed checks.

| API | Frontend workflow |
| --- | --- |
| GET /api/missions and mission detail/evidence endpoints | Select a mission; view its persisted records, track and risk summaries |
| GET /api/inference/status; POST /api/inference/predict | Verify the supplied checkpoint runtime, upload an image and inspect actual predictions |
| POST /api/missions/:id/create-embeddings | Generate/reuse a versioned MiniLM index of the selected mission |
| GET /api/missions/:id/search and /ask | Retrieve mission sources and generate Gemini answers with citations |
| GET/POST /api/reports | List immutable editions and generate factual or AI-assisted reports |
| GET /api/reports/:id/download?format=pdf or csv | Download frozen report files |
| POST /api/missions/:id/route | Compute an advisory A-to-B route from recorded coordinates and preferences |
| GET /api/system/health | Show storage, provider, embeddings, inference and reporting state |

REST reads refresh while relevant pages are active. No WebSocket, drone control or live sensor transport is supplied. Stored synthetic data remains labeled. Uploaded image locations do not establish object ground positions. Unlocalized image evidence cannot be used for routing standoff.

Gemini keys stay in backend/.env. Missing provider configuration, failed indexing, model failures and report errors are visible; the integrated path never substitutes fixture answers.
