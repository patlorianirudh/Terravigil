# TerraVigil 3.2 backend

Start the complete app from its root with `npm start`.
Firebase and telemetry settings are in `.env`, copied from `.env.example`.
See ../START_HERE.md and ../README.md for current setup.

The integrated server mounts the mission API, the Firebase bridge, report and RAG
APIs, and compiled frontend on one loopback origin. Local persistent storage is
the default. The Python child authenticates with a local service account, reads
Firebase, matches CSV timestamps, and sends JSON lines to the backend process.

Bridge routes:
- GET /api/bridge/status
- GET /api/bridge/events?mission_id=TV-LIVE-001
- POST /api/bridge/restart
- GET /api/bridge/images/:event_id

These are local application routes, not a public multi-user service. The private
key is never returned through them. The optional older inference API is retained
for compatibility but is absent from app navigation and the default setup.
