'use strict';

const { performance } = require('node:perf_hooks');
const { validCoordinate, vector, distanceM, sphericalSegment, distanceToSegmentM, localProjection, planarDistanceToSegment } = require('./geometry');

const LIMITS = Object.freeze({
  maxEvidence: 1000,
  maxEndpointDistanceM: 1000,
  maxLatitude: 80,
  maxGridNodes: 60000,
  maxExpandedNodes: 30000,
  maxOpenEntries: 120000,
  maxGeometryChecks: 2000000,
  maxComputeMs: 500,
  maxWaypoints: 1024,
  databaseTimeoutMs: 5000,
});

const DISCLAIMER = 'Advisory route relative to recorded confirmed and unconfirmed evidence only. ' +
  'Unknown hazards, terrain, obstacles, traversability, and positional uncertainty are not assessed. ' +
  'This is not a clearance certification or vehicle command.';

function noPath(sessionId, failureReason, failureCode, metadata = {}) {
  return {
    sessionId, pathFound: false, waypoints: [], totalDistanceM: null,
    minStandoffAchievedM: null, confirmedDetectionsNearRoute: null,
    unconfirmedDetectionsNearRoute: null, disclaimer: DISCLAIMER,
    failureReason, failureCode, metadata,
  };
}

class BudgetExceeded extends Error {}

function budgetFor(overrides) {
  // Callers may tighten operational limits, never increase the deployed caps.
  const limits = { ...LIMITS };
  for (const key of ['maxExpandedNodes', 'maxGeometryChecks', 'maxComputeMs']) {
    if (Number.isFinite(overrides[key]) && overrides[key] >= 0) limits[key] = Math.min(limits[key], overrides[key]);
  }
  const deadline = performance.now() + limits.maxComputeMs;
  let checks = 0;
  return {
    limits,
    check(force = false) {
      checks += 1;
      if (checks > limits.maxGeometryChecks || ((force || (checks & 127) === 0) && performance.now() > deadline)) {
        throw new BudgetExceeded();
      }
    },
  };
}

class MinHeap {
  constructor() { this.entries = []; }
  get length() { return this.entries.length; }
  before(a, b) { return a.f < b.f || (a.f === b.f && (a.h < b.h || (a.h === b.h && a.id < b.id))); }
  push(entry) {
    const entries = this.entries;
    entries.push(entry);
    let index = entries.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(entry, entries[parent])) break;
      entries[index] = entries[parent];
      index = parent;
    }
    entries[index] = entry;
  }
  pop() {
    const entries = this.entries;
    const result = entries[0];
    const last = entries.pop();
    if (entries.length) {
      let index = 0;
      while (index * 2 + 1 < entries.length) {
        let child = index * 2 + 1;
        if (child + 1 < entries.length && this.before(entries[child + 1], entries[child])) child += 1;
        if (!this.before(entries[child], last)) break;
        entries[index] = entries[child];
        index = child;
      }
      entries[index] = last;
    }
    return result;
  }
}

function hazardIndex(evidence, cellSize) {
  const cells = new Map();
  for (const hazard of evidence) {
    const key = `${Math.floor(hazard.x / cellSize)},${Math.floor(hazard.y / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(hazard);
  }
  return {
    distance(start, end, radius, budget) {
      let nearest = Infinity;
      const minX = Math.floor((Math.min(start.x, end.x) - radius) / cellSize);
      const maxX = Math.floor((Math.max(start.x, end.x) + radius) / cellSize);
      const minY = Math.floor((Math.min(start.y, end.y) - radius) / cellSize);
      const maxY = Math.floor((Math.max(start.y, end.y) + radius) / cellSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          budget.check();
          const hazards = cells.get(`${x},${y}`);
          if (!hazards) continue;
          for (const hazard of hazards) {
            budget.check();
            nearest = Math.min(nearest, planarDistanceToSegment(hazard, start, end));
          }
        }
      }
      return nearest;
    },
  };
}

function compactPath(path) {
  const compacted = [];
  for (const point of path) {
    if (compacted.length && Math.hypot(point.x - compacted.at(-1).x, point.y - compacted.at(-1).y) < 1e-8) continue;
    while (compacted.length >= 2) {
      const a = compacted.at(-2);
      const b = compacted.at(-1);
      const cross = (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
      const forward = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y);
      if (Math.abs(cross) > 1e-7 || forward < 0) break;
      compacted.pop();
    }
    compacted.push(point);
  }
  return compacted;
}

function searchGrid(start, end, bounds, index, minStandoffM, cautionWeight, budget, metadata) {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  let spacing = Math.max(1.5, minStandoffM / 2, Math.sqrt(width * height / (LIMITS.maxGridNodes - 1000)));
  let columns;
  let rows;
  do {
    columns = Math.ceil(width / spacing) + 1;
    rows = Math.ceil(height / spacing) + 1;
    if (columns * rows > LIMITS.maxGridNodes) spacing *= 1.02;
  } while (columns * rows > LIMITS.maxGridNodes);
  const stepX = width / (columns - 1);
  const stepY = height / (rows - 1);
  const count = columns * rows;
  const startId = count;
  const endId = count + 1;
  metadata.gridSpacingM = Math.max(stepX, stepY);
  metadata.gridNodes = count;

  const pointFor = id => id === startId ? start : id === endId ? end : {
    x: bounds.minX + (id % columns) * stepX,
    y: bounds.minY + Math.floor(id / columns) * stepY,
  };
  const attachments = point => {
    const result = [];
    const x = Math.floor((point.x - bounds.minX) / stepX);
    const y = Math.floor((point.y - bounds.minY) / stepY);
    for (let dy = -1; dy <= 2; dy += 1) {
      for (let dx = -1; dx <= 2; dx += 1) {
        if (x + dx >= 0 && x + dx < columns && y + dy >= 0 && y + dy < rows) result.push((y + dy) * columns + x + dx);
      }
    }
    return result;
  };
  const startNeighbors = attachments(start);
  const endNeighbors = new Set(attachments(end));
  const scores = new Float64Array(count + 2).fill(Infinity);
  const parents = new Int32Array(count + 2).fill(-1);
  const closed = new Uint8Array(count + 2);
  const heap = new MinHeap();
  scores[startId] = 0;
  heap.push({ id: startId, g: 0, h: Math.hypot(end.x - start.x, end.y - start.y), f: Math.hypot(end.x - start.x, end.y - start.y) });
  const hardRadius = minStandoffM + 0.1;
  const influenceRadius = minStandoffM + 30;

  while (heap.length) {
    budget.check(true);
    const current = heap.pop();
    if (closed[current.id] || current.g !== scores[current.id]) continue;
    if (current.id === endId) {
      const path = [];
      for (let id = endId; id !== -1; id = parents[id]) path.push(pointFor(id));
      return compactPath(path.reverse());
    }
    metadata.expandedNodes += 1;
    if (metadata.expandedNodes > budget.limits.maxExpandedNodes) throw new BudgetExceeded();
    closed[current.id] = 1;
    const a = pointFor(current.id);
    let neighbors;
    if (current.id === startId) neighbors = startNeighbors;
    else {
      neighbors = [];
      const x = current.id % columns;
      const y = Math.floor(current.id / columns);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx || dy) && x + dx >= 0 && x + dx < columns && y + dy >= 0 && y + dy < rows) neighbors.push((y + dy) * columns + x + dx);
        }
      }
      if (endNeighbors.has(current.id)) neighbors.push(endId);
    }
    for (const id of neighbors) {
      if (closed[id]) continue;
      const b = pointFor(id);
      const clearance = index.distance(a, b, cautionWeight > 0 ? influenceRadius : hardRadius, budget);
      // The complete edge is checked, including diagonal and endpoint connector
      // edges. The 10cm search margin absorbs projection/compaction error; the
      // final spherical clearance check remains the acceptance authority.
      if (clearance < hardRadius) continue;
      const proximity = Math.max(0, 1 - (clearance - minStandoffM) / 30);
      const cost = Math.hypot(b.x - a.x, b.y - a.y) * (1 + cautionWeight * 6 * proximity * proximity);
      const g = current.g + cost;
      if (g >= scores[id]) continue;
      scores[id] = g;
      parents[id] = current.id;
      const h = Math.hypot(end.x - b.x, end.y - b.y);
      heap.push({ id, g, h, f: g + h });
      if (heap.length > LIMITS.maxOpenEntries) throw new BudgetExceeded();
    }
  }
  return null;
}

function resultForPath(input, waypoints, evidence, budget, metadata) {
  if (waypoints.length > LIMITS.maxWaypoints) throw new BudgetExceeded();
  const segments = waypoints.slice(1).map((point, i) => sphericalSegment(waypoints[i], point));
  let nearest = Infinity;
  let confirmed = 0;
  let unconfirmed = 0;
  const nearRadius = Math.max(30, input.minStandoffM * 2);
  for (const hazard of evidence) {
    let distance = Infinity;
    for (const segment of segments) {
      budget.check();
      distance = Math.min(distance, distanceToSegmentM(hazard.vector, segment));
    }
    nearest = Math.min(nearest, distance);
    if (distance < input.minStandoffM) {
      return noPath(input.sessionId, 'The candidate failed the final segment clearance check. No route is returned.', 'ROUTE_CLEARANCE_FAILED', metadata);
    }
    if (distance <= nearRadius) {
      if (hazard.confirmed) confirmed += 1;
      else unconfirmed += 1;
    }
  }
  budget.check(true);
  return {
    sessionId: input.sessionId, pathFound: true, waypoints,
    totalDistanceM: segments.reduce((sum, segment) => sum + segment.distanceM, 0),
    minStandoffAchievedM: evidence.length ? nearest : null,
    confirmedDetectionsNearRoute: confirmed, unconfirmedDetectionsNearRoute: unconfirmed,
    disclaimer: DISCLAIMER, failureReason: null,
    metadata: { ...metadata, nearRouteDistanceM: nearRadius },
  };
}

function calculateRoute(input, operationalLimits = {}) {
  const { sessionId, start, end, minStandoffM = 5, cautionWeight = 0.6 } = input;
  const metadata = {
    algorithm: 'bounded-local-a-star-v1', distanceModel: 'mean-radius-spherical-earth',
    maxEndpointDistanceM: LIMITS.maxEndpointDistanceM, maxEvidence: LIMITS.maxEvidence,
    maxExpandedNodes: LIMITS.maxExpandedNodes, maxComputeMs: LIMITS.maxComputeMs, expandedNodes: 0,
  };
  if (!validCoordinate(start) || !validCoordinate(end) || !Number.isFinite(minStandoffM) || minStandoffM < 3.5 || minStandoffM > 20 ||
      !Number.isFinite(cautionWeight) || cautionWeight < 0 || cautionWeight > 1 || distanceM(start, end) < 0.01) {
    return noPath(sessionId, 'The route endpoints or parameters are invalid.', 'ROUTE_INVALID_REQUEST', metadata);
  }
  if (!Array.isArray(input.evidence) || input.evidence.length > LIMITS.maxEvidence) {
    return noPath(sessionId, 'The mission evidence exceeds the bounded record limit. No evidence has been omitted to produce a route.', 'ROUTE_EVIDENCE_LIMIT', metadata);
  }
  if (input.evidence.some(hazard => !validCoordinate(hazard))) {
    return noPath(sessionId, 'At least one recorded hazard has missing or invalid coordinates. Its location must be resolved before computing a route.', 'ROUTE_INVALID_EVIDENCE', metadata);
  }
  if (Math.abs(start.lat) > LIMITS.maxLatitude || Math.abs(end.lat) > LIMITS.maxLatitude) {
    return noPath(sessionId, 'This local route planner supports latitudes from -80 to 80 degrees.', 'ROUTE_UNSUPPORTED_GEOGRAPHY', metadata);
  }
  if (Math.abs(start.lon - end.lon) > 180) {
    return noPath(sessionId, 'Routes crossing the dateline are outside this local search window.', 'ROUTE_UNSUPPORTED_GEOGRAPHY', metadata);
  }
  if (distanceM(start, end) > LIMITS.maxEndpointDistanceM) {
    return noPath(sessionId, 'The endpoint distance exceeds the 1,000 metre local route limit.', 'ROUTE_DISTANCE_LIMIT', metadata);
  }
  const projection = localProjection(start, end);
  const a = projection.project(start);
  const b = projection.project(end);
  const paddingM = Math.max(40, minStandoffM * 4);
  const bounds = {
    minX: Math.min(a.x, b.x) - paddingM, maxX: Math.max(a.x, b.x) + paddingM,
    minY: Math.min(a.y, b.y) - paddingM, maxY: Math.max(a.y, b.y) + paddingM,
  };
  const southwest = projection.unproject({ x: bounds.minX, y: bounds.minY });
  const northeast = projection.unproject({ x: bounds.maxX, y: bounds.maxY });
  if (southwest.lon <= -180 || northeast.lon >= 180 || Math.abs(southwest.lat) > 80 || Math.abs(northeast.lat) > 80) {
    return noPath(sessionId, 'The bounded search window reaches an unsupported latitude or the dateline.', 'ROUTE_UNSUPPORTED_GEOGRAPHY', metadata);
  }
  metadata.searchBounds = { southwest, northeast, paddingM };
  metadata.minStandoffM = minStandoffM;
  metadata.cautionWeight = cautionWeight;
  const budget = budgetFor(operationalLimits);
  try {
    const evidence = input.evidence.map(hazard => ({ ...hazard, ...projection.project(hazard), vector: vector(hazard) }));
    for (const hazard of evidence) {
      budget.check();
      if (distanceM(start, hazard) < minStandoffM || distanceM(end, hazard) < minStandoffM) {
        return noPath(sessionId, 'A start or end endpoint is inside the requested standoff from recorded evidence. Move the endpoint outside that exclusion.', 'ROUTE_ENDPOINT_BLOCKED', metadata);
      }
    }
    const direct = sphericalSegment(start, end);
    let directClearance = Infinity;
    for (const hazard of evidence) {
      budget.check();
      directClearance = Math.min(directClearance, distanceToSegmentM(hazard.vector, direct));
    }
    const normalized = { ...input, minStandoffM, cautionWeight };
    if (directClearance >= minStandoffM && (cautionWeight === 0 || directClearance >= minStandoffM + 30)) {
      return resultForPath(normalized, [start, end], evidence, budget, metadata);
    }
    const index = hazardIndex(evidence, minStandoffM + 30);
    const path = searchGrid(a, b, bounds, index, minStandoffM, cautionWeight, budget, metadata);
    if (!path) return noPath(sessionId, 'No route satisfying the requested standoff was found inside the bounded search window at this grid resolution.', 'ROUTE_NO_PATH', metadata);
    const waypoints = path.map(projection.unproject);
    // Preserve the exact selected endpoints. Every segment is checked after this
    // conversion and after collinear compaction, with no unchecked shortcuts.
    waypoints[0] = { lat: start.lat, lon: start.lon };
    waypoints[waypoints.length - 1] = { lat: end.lat, lon: end.lon };
    return resultForPath(normalized, waypoints, evidence, budget, metadata);
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return noPath(sessionId, 'The bounded route search reached its computation budget. No partial or unverified route is returned.', 'ROUTE_SEARCH_LIMIT', metadata);
  }
}

module.exports = { calculateRoute, noPath, LIMITS };
