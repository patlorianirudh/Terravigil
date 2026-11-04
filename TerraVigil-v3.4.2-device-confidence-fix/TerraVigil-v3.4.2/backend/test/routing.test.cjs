'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { memoryDb } = require('./helpers/memory-db.cjs');

const DEGREE_M = 111195.0802335329;
const point = (x, y = 0) => ({ lat: y / DEGREE_M, lon: x / DEGREE_M });
const record = (x, y = 0, extra = {}) => ({
  mission_id: 'M1', latitude: point(x, y).lat, longitude: point(x, y).lon,
  status: 'CONFIRMED', risk_level: 'HIGH', ...extra,
});
const request = extra => ({ start: point(-50), end: point(50), minStandoffM: 5, cautionWeight: 0, ...extra });

async function withServer(seed, callback, connectDB) {
  const { createRoutingRouter, routeJsonErrorHandler } = require('../routing/routes');
  const db = memoryDb({ missions: [{ mission_id: 'M1' }], ...seed });
  const app = express();
  app.use(express.json());
  app.use(routeJsonErrorHandler);
  app.use(createRoutingRouter({ connectDB: connectDB || (async () => db) }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body = request(), mission = 'M1') => {
    const response = await fetch(`${base}/missions/${encodeURIComponent(mission)}/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try { return await callback(post, db, base); }
  finally {
    server.closeIdleConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

// Independent check in this small equatorial fixture. Checking interiors as well
// as vertices catches routes that jump or cut diagonally through an exclusion.
function fixtureClearance(waypoints, hazards) {
  let nearest = Infinity;
  for (let i = 1; i < waypoints.length; i += 1) {
    const a = { x: waypoints[i - 1].lon * DEGREE_M, y: waypoints[i - 1].lat * DEGREE_M };
    const b = { x: waypoints[i].lon * DEGREE_M, y: waypoints[i].lat * DEGREE_M };
    for (const hazard of hazards) {
      const x = hazard.longitude * DEGREE_M;
      const y = hazard.latitude * DEGREE_M;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
    }
  }
  return nearest;
}

test('returns the direct mission route with measured distance and no invented standoff when evidence is empty', async () => {
  await withServer({}, async (post, db) => {
    const { status, body } = await post();
    assert.equal(status, 200);
    assert.equal(body.sessionId, 'M1');
    assert.equal(body.pathFound, true);
    assert.deepEqual(body.waypoints, [point(-50), point(50)]);
    assert.ok(Math.abs(body.totalDistanceM - 100) < 0.001);
    assert.equal(body.minStandoffAchievedM, null);
    assert.equal(body.confirmedDetectionsNearRoute, 0);
    assert.equal(body.unconfirmedDetectionsNearRoute, 0);
    assert.equal(body.failureReason, null);
    assert.match(body.disclaimer, /advisory/i);
    assert.match(body.disclaimer, /terrain|traversab/i);
    assert.equal(db.calls.some(call => /insert|update|delete|replace/.test(call.operation)), false);
  });
});

test('detours around a hazard in the middle of an otherwise clear segment', async () => {
  const hazards = [record(0)];
  await withServer({ detections: hazards }, async post => {
    const first = await post();
    const second = await post();
    assert.equal(first.status, 200);
    assert.equal(first.body.pathFound, true);
    assert.ok(first.body.waypoints.length > 2);
    assert.deepEqual(first.body.waypoints[0], point(-50));
    assert.deepEqual(first.body.waypoints.at(-1), point(50));
    assert.ok(first.body.totalDistanceM > 100);
    assert.ok(fixtureClearance(first.body.waypoints, hazards) >= 5 - 0.001);
    assert.ok(first.body.minStandoffAchievedM >= 5);
    assert.deepEqual(second.body.waypoints, first.body.waypoints);
  });
});

test('applies the full requested exclusion to LOW and unknown-risk evidence from both collections', async () => {
  for (const [collection, risk_level] of [['detections', 'LOW'], ['observations', 'LOW'], ['observations', 'UNKNOWN']]) {
    const hazards = [record(0, 0, { risk_level, status: collection === 'observations' ? 'UNCONFIRMED' : 'CONFIRMED' })];
    await withServer({ [collection]: hazards }, async post => {
      const { body } = await post(request({ minStandoffM: 20 }));
      assert.equal(body.pathFound, true, `${collection}/${risk_level}: ${body.failureReason}`);
      assert.ok(fixtureClearance(body.waypoints, hazards) >= 20 - 0.001);
    });
  }
});

test('does not fabricate a route when either endpoint is on confirmed or unconfirmed evidence', async () => {
  for (const [collection, x] of [['detections', -50], ['observations', 50]]) {
    await withServer({ [collection]: [record(x)] }, async post => {
      const { status, body } = await post();
      assert.equal(status, 200);
      assert.equal(body.pathFound, false);
      assert.deepEqual(body.waypoints, []);
      assert.equal(body.totalDistanceM, null);
      assert.equal(body.minStandoffAchievedM, null);
      assert.match(body.failureReason, /start|end|endpoint/i);
    });
  }
});

test('checks the full endpoint radius even for an unconfirmed low-risk record', async () => {
  await withServer({ observations: [record(-46, 0, { risk_level: 'LOW' })] }, async post => {
    const { body } = await post();
    assert.equal(body.pathFound, false);
    assert.deepEqual(body.waypoints, []);
  });
});

test('returns no path through an exclusion wall spanning the bounded search window', async () => {
  const hazards = Array.from({ length: 201 }, (_, i) => record(0, i * 4 - 400));
  await withServer({ detections: hazards }, async post => {
    const { body } = await post();
    assert.equal(body.pathFound, false);
    assert.deepEqual(body.waypoints, []);
    assert.match(body.failureReason, /bounded|window|limit/i);
  });
});

test('reports standoff from segment interiors, distance over the complete route, and evidence counts by collection', async () => {
  await withServer({ detections: [record(0, 12)], observations: [record(10, -15), record(0, 90)] }, async post => {
    const { body } = await post();
    assert.equal(body.pathFound, true);
    assert.ok(Math.abs(body.totalDistanceM - 100) < 0.001);
    assert.ok(Math.abs(body.minStandoffAchievedM - 12) < 0.001);
    assert.equal(body.confirmedDetectionsNearRoute, 1);
    assert.equal(body.unconfirmedDetectionsNearRoute, 1);
  });
});

test('caution weight favors additional clearance while preserving the same hard standoff', async () => {
  const hazards = [record(0)];
  await withServer({ detections: hazards }, async post => {
    const shortest = (await post(request({ cautionWeight: 0 }))).body;
    const cautious = (await post(request({ cautionWeight: 1 }))).body;
    assert.equal(shortest.pathFound, true);
    assert.equal(cautious.pathFound, true);
    assert.ok(cautious.minStandoffAchievedM > shortest.minStandoffAchievedM + 0.5);
    assert.ok(fixtureClearance(cautious.waypoints, hazards) >= 5 - 0.001);
    assert.ok(cautious.totalDistanceM > shortest.totalDistanceM);
  });
});

test('keeps exact mission identity and ignores hazards in other missions', async () => {
  await withServer({
    missions: [{ mission_id: ' M 1 ' }, { mission_id: 'M1' }],
    detections: [record(-50), record(50, 0, { mission_id: 'M 1' })],
    observations: [record(0, 0, { mission_id: 'another' })],
  }, async (post, db) => {
    const { status, body } = await post(request({ sessionId: ' M 1 ' }), ' M 1 ');
    assert.equal(status, 200);
    assert.equal(body.sessionId, ' M 1 ');
    assert.equal(body.pathFound, true);
    assert.equal(body.minStandoffAchievedM, null);
    assert.ok(db.calls.filter(call => ['missions', 'detections', 'observations'].includes(call.collection))
      .every(call => call.query.mission_id === ' M 1 '));
  });
});

test('returns a route-specific missing mission error', async () => {
  await withServer({}, async post => {
    const { status, body } = await post(request(), 'missing');
    assert.equal(status, 404);
    assert.equal(body.code, 'ROUTE_MISSION_NOT_FOUND');
  });
});

test('rejects mismatched or non-string request mission identities', async () => {
  await withServer({}, async post => {
    for (const sessionId of ['M2', 1, null, ['M1'], { mission_id: 'M1' }]) {
      const { status, body } = await post(request({ sessionId }));
      assert.equal(status, 400);
      assert.equal(body.code, 'ROUTE_INVALID_REQUEST');
    }
  });
});

test('strictly rejects malformed, non-finite, coerced, or out-of-range route parameters', async () => {
  const bodies = [
    null, [], {}, request({ start: null }), request({ end: [] }),
    request({ start: { lat: '0', lon: 0 } }), request({ start: { lat: false, lon: 0 } }),
    request({ start: { lat: null, lon: 0 } }), request({ end: { lat: 91, lon: 0 } }),
    request({ end: { lat: 0, lon: 181 } }), request({ end: { lat: 0 } }),
    ...[3.49, 20.01, null, '5', false].map(minStandoffM => request({ minStandoffM })),
    ...[-0.01, 1.01, null, '0.5', false].map(cautionWeight => request({ cautionWeight })),
  ];
  await withServer({}, async (post, db) => {
    for (const body of bodies) {
      const response = await post(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.body.code, 'ROUTE_INVALID_REQUEST');
    }
    assert.equal(db.calls.length, 0);
  });
});

test('uses the documented defaults and rejects endpoints within their default exclusion', async () => {
  await withServer({ observations: [record(-45.5)] }, async post => {
    const { body } = await post({ start: point(-50), end: point(50) });
    assert.equal(body.pathFound, false);
  });
});

test('fails closed for every kind of missing or invalid evidence coordinate', async () => {
  const invalid = [
    { latitude: null }, { longitude: undefined }, { latitude: '0' },
    { latitude: false }, { latitude: NaN }, { longitude: Infinity },
    { latitude: 91 }, { longitude: -181 },
  ];
  for (const fields of invalid) {
    await withServer({ observations: [record(0, 0, { risk_level: 'LOW', ...fields })] }, async post => {
      const { status, body } = await post();
      assert.equal(status, 200);
      assert.equal(body.pathFound, false);
      assert.deepEqual(body.waypoints, []);
      assert.match(body.failureReason, /coordinate|location/i);
    });
  }
});

test('refuses unsupported distance, high latitude, and dateline windows without returning a route', async () => {
  const bodies = [
    request({ start: point(0), end: point(1100) }),
    request({ start: { lat: 85, lon: 0 }, end: { lat: 85, lon: 0.001 } }),
    request({ start: { lat: 0, lon: 179.999 }, end: { lat: 0, lon: -179.999 } }),
  ];
  await withServer({}, async post => {
    for (const body of bodies) {
      const { status, body: result } = await post(body);
      assert.equal(status, 200);
      assert.equal(result.pathFound, false);
      assert.deepEqual(result.waypoints, []);
      assert.match(result.failureReason, /limit|latitude|dateline|distance|window/i);
    }
  });
});

test('refuses excess mission evidence instead of silently dropping records', async () => {
  await withServer({ detections: Array.from({ length: 1001 }, () => record(0, 80)) }, async post => {
    const { status, body } = await post();
    assert.equal(status, 200);
    assert.equal(body.pathFound, false);
    assert.match(body.failureReason, /evidence|record|limit/i);
  });
});

test('stops a search at its node budget and returns no partial route', () => {
  const { calculateRoute } = require('../routing/engine');
  const result = calculateRoute({
    sessionId: 'M1', ...request(), evidence: [{ ...point(0), confirmed: true }],
  }, { maxExpandedNodes: 1 });
  assert.equal(result.pathFound, false);
  assert.deepEqual(result.waypoints, []);
  assert.match(result.failureReason, /budget|limit/i);
});

test('sanitizes database exceptions without exposing error text or provider status', async () => {
  await withServer({}, async post => {
    const { status, body } = await post();
    assert.equal(status, 503);
    assert.equal(body.code, 'ROUTE_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('secret-canary'), false);
  }, async () => { const error = new Error('secret-canary mongodb://credentials'); error.status = 401; throw error; });
});

test('sanitizes malformed JSON and percent-encoded mission IDs on route requests', async () => {
  await withServer({}, async (_post, _db, base) => {
    for (const [path, body] of [['/missions/M1/route', '{secret-canary'], ['/missions/%E0%A4%A/route', JSON.stringify(request())]]) {
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.code, 'ROUTE_INVALID_REQUEST');
      assert.equal(JSON.stringify(result).includes('secret-canary'), false);
    }
  });
});
