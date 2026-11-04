'use strict';

// All published distances use the mean-radius spherical Earth model. Search
// coordinates are only a local approximation; final acceptance uses these arcs.
const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;
const clamp = value => Math.max(-1, Math.min(1, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);

function validCoordinate(point) {
  return point !== null && typeof point === 'object' && !Array.isArray(point) &&
    typeof point.lat === 'number' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    typeof point.lon === 'number' && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180;
}

function vector(point) {
  const latitude = point.lat * RAD;
  const longitude = point.lon * RAD;
  const cosLat = Math.cos(latitude);
  return [cosLat * Math.cos(longitude), cosLat * Math.sin(longitude), Math.sin(latitude)];
}

function angularDistance(a, b) {
  return Math.atan2(norm(cross(a, b)), clamp(dot(a, b)));
}

function distanceM(a, b) {
  return angularDistance(vector(a), vector(b)) * EARTH_RADIUS_M;
}

function sphericalSegment(a, b) {
  const start = vector(a);
  const end = vector(b);
  const perpendicular = cross(start, end);
  const magnitude = norm(perpendicular);
  const angle = Math.atan2(magnitude, clamp(dot(start, end)));
  const normal = magnitude > 1e-15 ? perpendicular.map(value => value / magnitude) : null;
  return { start, end, normal, tangent: normal ? cross(normal, start) : null, angle, distanceM: angle * EARTH_RADIUS_M };
}

function distanceToSegmentM(hazardVector, segment) {
  if (segment.normal) {
    const along = Math.atan2(dot(hazardVector, segment.tangent), dot(hazardVector, segment.start));
    if (along >= 0 && along <= segment.angle) {
      const across = Math.atan2(Math.abs(dot(hazardVector, segment.normal)),
        Math.hypot(dot(hazardVector, segment.start), dot(hazardVector, segment.tangent)));
      return across * EARTH_RADIUS_M;
    }
  }
  return Math.min(angularDistance(hazardVector, segment.start), angularDistance(hazardVector, segment.end)) * EARTH_RADIUS_M;
}

function localProjection(start, end) {
  const lat = (start.lat + end.lat) / 2;
  const lon = (start.lon + end.lon) / 2;
  const scaleX = EARTH_RADIUS_M * RAD * Math.cos(lat * RAD);
  const scaleY = EARTH_RADIUS_M * RAD;
  return {
    project: point => ({ x: (point.lon - lon) * scaleX, y: (point.lat - lat) * scaleY }),
    unproject: point => ({ lat: lat + point.y / scaleY, lon: lon + point.x / scaleX }),
  };
}

function planarDistanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy);
}

module.exports = { validCoordinate, vector, distanceM, sphericalSegment, distanceToSegmentM, localProjection, planarDistanceToSegment };
