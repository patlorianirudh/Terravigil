# Mission route computation

`createRoutingRouter({ connectDB })` registers the additive read-only endpoint
`POST /missions/:mission_id/route`. Mission IDs are exact strings. The body takes
numeric `start` and `end` `{ lat, lon }` coordinates, `minStandoffM` from 3.5 to 20
(default 5), and `cautionWeight` from 0 to 1 (default 0.6). An optional `sessionId`
must equal the path mission ID. Endpoints must be distinct by at least 1 cm.

Every detection and observation belonging to that mission is an exclusion,
including LOW, unknown-risk, and unconfirmed records. Missing or invalid record
coordinates prevent computation. Collection membership supplies the confirmed
versus unconfirmed counts; risk and status text never reduce an exclusion.

The deterministic local A* searches eight-connected grid edges and explicit
endpoint connectors. Every entire edge is checked; diagonals cannot jump through
an exclusion. Local equirectangular geometry uses an additional 10 cm search
margin. Increasing caution adds a nonnegative cost near hazards without reducing
the requested exclusion. Only collinear waypoints are compacted. All returned
segments, including endpoints and compacted segments, must then pass exact
point-to-minor-great-circle-arc clearance on a mean-radius spherical Earth
(6,371,008.8 m). Published distance is the sum of these arcs; published standoff is
the minimum over all complete segments and all mission evidence. It is null only
when there is no evidence. This model does not account for survey accuracy or
ellipsoidal geodesy.

The endpoint separation cap is 1,000 m. The search rectangle is their local
bounding box with 40–80 m padding on each side (four times the standoff, at least
40 m), so either side is at most approximately 1,160 m. Routes or windows beyond
80 degrees latitude or crossing the dateline are refused. Grid spacing is at
least 1.5 m or half the standoff, and may increase to keep at most 60,000 grid
nodes. Search stops at 30,000 expanded nodes, 120,000 queued entries, 2,000,000
geometry/bucket operations, or 500 ms of synchronous computation. Final routes
have at most 1,024 waypoints. A narrow valid corridor may be missed at this
resolution; a failed bounded search is not proof that no geographic path exists.

At most 1,000 combined mission records are allowed. MongoDB reads are capped
before transfer and have a 5 second maximum server execution time; the complete
connection/read phase also has a 5 second response deadline. Excess evidence or
any exhausted search budget returns no route, never a partial path or a route
computed after silently dropping evidence.

A success returns camelCase `SafePathResult` fields plus `metadata` describing
the bounds. Near-route counts mean records within `max(30, 2 * minStandoffM)`
metres of any returned segment, once per record. A computed refusal returns HTTP
200, `pathFound: false`, empty waypoints, null metrics/counts, a fixed human
`failureReason`, and a route-specific `failureCode`. Malformed requests return
400 `ROUTE_INVALID_REQUEST`, absent missions return 404
`ROUTE_MISSION_NOT_FOUND`, and dependency errors return 503 `ROUTE_UNAVAILABLE`.
Dependency exception text is never returned. No LLM, provider, writes, terrain
data, or vehicle controls are involved.

The result is an advisory path relative to recorded point evidence. It does not
certify ground clearance, unknown hazards, traversability, or physical safety.
