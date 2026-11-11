'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { isPractice, DEPLOYMENT } = require('../production-data');
const { fuseMissionObservations } = require('../fusion/fuse');
const root = path.resolve(__dirname, '../..');

function resolveSetting(value, fallback) {
  return path.resolve(root, value?.trim() || fallback);
}

// ── Live CSV tail ─────────────────────────────────────────────────────────
// Reads the last rows of the telemetry CSV the MAVLink logger appends to.
// Purely read-only: no Firebase, no database, so it stays fast at 1 s polls.
const LIVE_TAIL_BYTES = 64 * 1024;
const LIVE_MERGE_ROWS = 40;
const LIVE_MERGE_WINDOW_MS = 15_000;
function parseBooleanText(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}
function parseNumberText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
function splitCsvLine(line) {
  // The telemetry logger writes plain comma-separated values without quoting.
  return line.split(',');
}
function readLiveTail(csvPath) {
  let header;
  try {
    const handle = fs.openSync(csvPath, 'r');
    try {
      const head = Buffer.alloc(4096);
      const read = fs.readSync(handle, head, 0, head.length, 0);
      const text = head.toString('utf8', 0, read);
      const firstLineEnd = text.indexOf('\n');
      header = splitCsvLine((firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)).trim());
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return { error: 'read' };
  }
  let stat;
  try { stat = fs.statSync(csvPath); } catch { return { error: 'stat' }; }
  const handle = fs.openSync(csvPath, 'r');
  try {
    const length = Math.min(LIVE_TAIL_BYTES, stat.size);
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, stat.size - length);
    const text = buffer.toString('utf8');
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    // Drop a possibly partial first line (cut by the tail window).
    if (length < stat.size && lines.length > 0) lines.shift();
    if (length >= stat.size) lines.shift(); // header row
    return { header, lines, stat };
  } finally {
    fs.closeSync(handle);
  }
}
function mergeLiveRows(header, lines) {
  const merged = {};
  const newest = lines.at(-1) ?? null;
  const newestTime = newest === null ? null : Date.parse(splitCsvLine(newest)[0]);
  // Walk backwards so the newest row wins; a row only fills fields that are
  // still empty (each MAVLink message updates a subset of the columns).
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - LIVE_MERGE_ROWS); index -= 1) {
    const values = splitCsvLine(lines[index]);
    const rowTime = Date.parse(values[0]);
    if (Number.isFinite(newestTime) && Number.isFinite(rowTime) &&
      newestTime - rowTime > LIVE_MERGE_WINDOW_MS) break;
    header.forEach((column, position) => {
      const value = values[position];
      if (value === undefined || value.trim() === '') return;
      if (merged[column] === undefined) merged[column] = value.trim();
    });
  }
  return merged;
}
function liveTelemetryFromCsv(csvPath) {
  if (!csvPath || !fs.existsSync(csvPath)) {
    return { state: 'missing', message: 'Telemetry CSV not found. Start the MAVLink logger or check TELEMETRY_CSV_PATH.', csv_path: csvPath ?? null };
  }
  const tail = readLiveTail(csvPath);
  if (tail.error || !tail.header || !Array.isArray(tail.lines)) {
    return { state: 'missing', message: 'Telemetry CSV could not be read.', csv_path: csvPath };
  }
  if (tail.lines.length === 0) {
    return { state: 'waiting', message: 'Telemetry CSV has no rows yet. Values appear as soon as MAVLink telemetry is logged.', csv_path: csvPath };
  }
  const merged = mergeLiveRows(tail.header, tail.lines);
  const timestamp = merged.timestamp_utc ?? null;
  const parsedTime = timestamp === null ? null : Date.parse(timestamp);
  const numeric = (column) => parseNumberText(merged[column]);
  const latitude = numeric('latitude');
  const longitude = numeric('longitude');
  return {
    state: 'live',
    message: 'Streaming from the telemetry CSV.',
    csv_path: csvPath,
    csv_size_bytes: tail.stat.size,
    csv_mtime: tail.stat.mtime.toISOString(),
    tail_rows: tail.lines.length,
    timestamp,
    age_ms: parsedTime !== null && Number.isFinite(parsedTime) ? Math.max(0, Date.now() - parsedTime) : null,
    latitude, longitude,
    latitude_valid: latitude !== null && Math.abs(latitude) <= 90 && (longitude !== null && Math.abs(longitude) <= 180),
    altitude_m: numeric('altitude_m'),
    relative_altitude_m: numeric('relative_altitude_m'),
    ground_speed_m_s: numeric('ground_speed_m_s'),
    roll_deg: numeric('roll_deg'),
    pitch_deg: numeric('pitch_deg'),
    yaw_deg: numeric('yaw_deg'),
    battery_voltage_v: numeric('battery_voltage_v'),
    battery_remaining_percent: numeric('battery_remaining_percent'),
    flight_mode: merged.flight_mode || null,
    armed: parseBooleanText(merged.armed),
    gps_fix_type: numeric('gps_fix_type'),
    satellites: numeric('satellites'),
    hdop: numeric('hdop'),
    timestamp_source: merged.timestamp_source || null,
    received_at_utc: merged.received_at_utc || null,
    time_boot_ms: numeric('time_boot_ms'),
    system_id: numeric('system_id'),
    fields: merged,
  };
}
function readBridgeConfig(env = process.env) {
  const credentials = resolveSetting(env.FIREBASE_SERVICE_ACCOUNT,
    fs.existsSync(path.join(root, 'backend/serviceAccountKey.json')) ? 'backend/serviceAccountKey.json' :
    fs.existsSync(path.join(root, 'serviceAccountKey.json')) ? 'serviceAccountKey.json' : 'backend/serviceAccountKey.json');
  const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const config = {
    enabled: env.FIREBASE_ENABLED !== 'false', credentials,
    python: env.TELEMETRY_PYTHON || (fs.existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3'),
    csv: resolveSetting(env.TELEMETRY_CSV_PATH, 'telemetry/DroneTelemetry/telemetry.csv'),
    testMode: env.TERRAVIGIL_TEST_MODE === 'true',
    imageDir: resolveSetting(env.DETECTION_IMAGE_DIR, 'images'),
    databaseUrl: env.FIREBASE_DATABASE_URL || 'https://terravigil-e816d-default-rtdb.asia-southeast1.firebasedatabase.app/',
    databasePath: env.FIREBASE_DETECTIONS_PATH || 'detections',
    missionId: env.FIREBASE_MISSION_ID || 'TV-LIVE-001',
    detectionTimezone: env.FIREBASE_TIMESTAMP_TIMEZONE || 'Asia/Kolkata',
    telemetryTimezone: env.TELEMETRY_TIMESTAMP_TIMEZONE || 'Asia/Kolkata',
    maxGap: Number(env.TELEMETRY_MAX_GAP_SECONDS || 2),
    clockOffset: Number(env.DETECTION_CLOCK_OFFSET_SECONDS || 0),
    poll: Number(env.FIREBASE_POLL_SECONDS || 3),
  };
  if (!/^https:\/\/[a-z0-9.-]+\.(firebasedatabase\.app|firebaseio\.com)\/?$/i.test(config.databaseUrl)) throw new Error('Use a Firebase HTTPS database URL.');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(config.missionId) || ['SAMPLE-TV001', 'TV-TELEMETRY-DEMO'].includes(config.missionId)) throw new Error('Use a distinct live FIREBASE_MISSION_ID.');
  if (!Number.isFinite(config.maxGap) || config.maxGap < 0 || config.maxGap > 60 || !Number.isFinite(config.clockOffset) || !Number.isFinite(config.poll) || config.poll < 1 || config.poll > 60) throw new Error('Invalid timestamp matching or poll settings.');
  return config;
}

function createBridgeService({ getDB, config: suppliedConfig } = {}) {
  let config, configError;
  try { config = suppliedConfig || readBridgeConfig(); } catch (error) { configError = error.message; }
  let child = null, timer = null, stopping = false;
  let queue = Promise.resolve();
  let state = { state: configError ? 'error' : 'stopped', message: configError || 'Connection has not started.', last_sync: null };
  const refreshConfig = () => {
    if (suppliedConfig) return;
    // The .env is read at application startup. Restarting reconnects credentials/files.
    config = readBridgeConfig(); configError = undefined;
  };
  async function ensureMission(db, missionId) {
    if (isPractice({ mission_id: missionId })) throw new Error('Practice records are disabled.');
    const existing = await db.collection('missions').findOne({ mission_id: missionId });
    if (existing?.hardware?.edgeComputer === DEPLOYMENT.edgeComputer) return;
    await db.collection('missions').updateOne({ mission_id: missionId }, {
      $setOnInsert: { _id: `mission-${missionId}`, mission_id: missionId,
        date: new Date().toISOString(), location: 'Firebase / Pixhawk survey', status: 'ACTIVE',
        source: 'firebase_telemetry', notes: 'Image capture timestamps matched to Pixhawk GPS. These are aircraft positions, not surveyed target positions.' },
      $set: { hardware: DEPLOYMENT, test_mode: config.testMode === true }
    }, { upsert: true });
  }
  async function ingest(message) {
    if (message.type === 'status') {
      if (message.source !== 'fixture') state = { ...state, ...message };
      return;
    }
    if (isPractice(message.event ?? message)) throw new Error('Practice records are disabled.');
    const db = await getDB();
    if (message.type === 'detection') {
      const event = message.event;
      if (!event?.event_id || !event.mission_id || !event.match) throw new Error('Invalid bridge event');
      await ensureMission(db, event.mission_id, event.synthetic === true);
      const saved = await db.collection('firebase_events').findOne({ _id: event.event_id });
      const encoded = JSON.stringify(event);
      if (saved?.fingerprint === encoded && saved.status !== 'removed') return;
      const match = event.match;
      const rawDevice = typeof event.device === 'string' ? event.device.trim().toLowerCase() : '';
      const device = rawDevice === 'metal_detector' ? 'metal'
        : ['camera', 'metal'].includes(rawDevice) ? rawDevice : null;
      const confidenceScore = Number.isFinite(event.confidence_score) ? event.confidence_score
        : Number.isFinite(event.confidence) ? event.confidence : null;
      const confidencePercent = Number.isFinite(event.confidence_percent) ? event.confidence_percent
        : confidenceScore === null ? null : confidenceScore * 100;
      const className = device ? 'land_mines' : event.class_name;
      const record = { ...event, device, class_name: className,
        confidence: confidenceScore, confidence_score: confidenceScore, confidence_percent: confidencePercent,
        _id: event.event_id, status: match.status, fingerprint: encoded,
        first_received_at: saved?.first_received_at || new Date().toISOString(), updated_at: new Date().toISOString() };
      // Write the observation before the event fingerprint so a crash is retriable.
      if (match.matched && Number.isFinite(match.latitude) && Number.isFinite(match.longitude)) {
        const imageUrl = `/api/bridge/images/${event.event_id}`;
        await db.collection('observations').updateOne({ _id: event.event_id }, { $set: {
          observation_id: event.event_id, mission_id: event.mission_id, timestamp: match.capture_timestamp,
          latitude: match.latitude, longitude: match.longitude,
          yolo_confidence: device === 'metal' ? null : confidenceScore,
          confidence_score: confidenceScore, confidence_percent: confidencePercent, device,
          class_name: className, class_id: event.class_id, image_path: event.image_path,
          image_url: imageUrl, image_original_path: event.image_path, image_local_filename: event.image?.filename || null,
          image_state: event.image?.state || 'missing', test_record: event.test_record === true, metal_detected: null, metal_signal: null, status: 'UNCONFIRMED', layer: 'LAYER_2',
          risk_level: null, source: 'firebase_telemetry', firebase_id: event.firebase_id, synthetic: event.synthetic,
          location_source: 'aircraft_gps_at_capture', target_location_known: false,
          confirmation_source: device === 'metal' ? 'metal_sensor_only' : device === 'camera' ? 'camera_detector_only' : 'visual_only', timestamp_original: event.timestamp_original,
          telemetry_timestamp: match.telemetry_timestamp, telemetry_match_gap_seconds: match.gap_seconds,
          telemetry_match_method: match.method, telemetry_csv_line: match.csv_line,
          lookup_timestamp: match.lookup_timestamp, clock_offset_seconds: match.clock_offset_seconds,
          telemetry_max_gap_seconds: match.max_gap_seconds,
        } }, { upsert: true });
      } else {
        // A corrected timestamp can invalidate an older match. Retract the old marker.
        await db.collection('observations').deleteOne({ _id: event.event_id });
      }
      await db.collection('firebase_events').replaceOne({ _id: event.event_id }, record, { upsert: true });
      // Sensor fusion: a camera detection near a metal hit (in time + space) is
      // upgraded to CONFIRMED with a risk level. Runs after each ingest so the
      // dashboard reflects agreement as soon as both sensors have reported.
      try {
        await fuseMissionObservations(db, event.mission_id);
      } catch (fusionError) {
        // Fusion is additive; a failure must not block event ingestion.
        console.warn('Sensor fusion pass failed:', fusionError?.message || fusionError);
      }
    } else if (message.type === 'snapshot') {
      // Reconcile deletions even after restarting: the Python process has no old keys.
      if (message.mission_id !== config.missionId || !Array.isArray(message.event_ids)) throw new Error('Invalid snapshot');
      const present = new Set(message.event_ids);
      const stored = await db.collection('firebase_events').find({ mission_id: message.mission_id }).toArray();
      for (const row of stored) {
        if (!present.has(row._id) && row.status !== 'removed') {
          await db.collection('observations').deleteOne({ _id: row._id });
          await db.collection('firebase_events').updateOne({ _id: row._id }, { $set: { status: 'removed', updated_at: new Date().toISOString() } });
        }
      }
    } else if (message.type === 'removed') {
      await db.collection('observations').deleteOne({ _id: message.event_id });
      await db.collection('firebase_events').updateOne({ _id: message.event_id }, { $set: { status: 'removed', updated_at: new Date().toISOString() } });
    } else if (message.type === 'telemetry') {
      await ensureMission(db, message.mission_id, message.synthetic === true);
      const known = new Set((await db.collection('telemetry').find({ mission_id: message.mission_id }).toArray()).map(row => row._id));
      const rows = message.rows.filter(row => !known.has(row._id));
      if (rows.length) await db.collection('telemetry').insertMany(rows);
    }
  }
  function launch() {
    const args = ['-u', path.join(root, 'telemetry/firebase_bridge.py'), '--csv',
      config.csv, '--image-dir', config.imageDir,
      '--credentials', config.credentials, '--database-url', config.databaseUrl, '--database-path', config.databasePath,
      '--mission', config.missionId, '--max-gap', String(config.maxGap),
      '--clock-offset', String(config.clockOffset), '--poll', String(config.poll),
      '--detection-timezone', config.detectionTimezone, '--telemetry-timezone', config.telemetryTimezone];
    const processChild = spawn(config.python, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } });
    let ingestError = null, reportedError = false;
    const lines = readline.createInterface({ input: processChild.stdout });
    lines.on('line', line => {
      queue = queue.then(async () => {
        const message = JSON.parse(line);
        if (message.type === 'status' && message.state === 'error') reportedError = true;
        await ingest(message);
      }).catch(() => {
        ingestError = new Error('Bridge data could not be stored. Check local disk access and restart the connection.');
        state = { ...state, state: 'error', message: ingestError.message };
        // Stop the child so replay retries unacknowledged data after storage recovers.
        processChild.kill();
      });
    });
    // Never echo SDK tracebacks or credential information to browser responses.
    processChild.stderr.resume();
    const finished = new Promise((resolve, reject) => {
      processChild.once('error', () => reject(new Error('Python could not start. Run python start_terravigil.py --setup or set TELEMETRY_PYTHON.')));
      processChild.once('close', code => {
        queue.then(() => code === 0 && !ingestError && !reportedError ? resolve() :
          reject(ingestError || new Error('Bridge stopped. Run setup and check Firebase access, credentials, and timestamps.')));
      });
    });
    return { processChild, finished };
  }
  async function start() {
    stopping = false;
    clearTimeout(timer);
    if (child) return;
    try { refreshConfig(); } catch (error) { state = { ...state, state: 'error', message: error.message }; return; }
    if (!config.enabled) { state = { ...state, state: 'disabled', message: 'Firebase ingestion is disabled in backend/.env.' }; return; }
    if (!fs.existsSync(config.credentials)) {
      state = { ...state, state: 'needs_setup', message: 'Place serviceAccountKey.json in backend, then choose Reconnect. The key stays on this computer.' };
      return;
    }
    try { await ensureMission(await getDB(), config.missionId, false); }
    catch { state = { ...state, state: 'error', message: 'Cannot prepare the live mission. Check local database access.' }; return; }
    // Re-scan stored observations so existing data reflects the current fusion
    // thresholds even before any new Firebase event arrives.
    try { await refusion(); }
    catch (fusionError) { console.warn('Startup sensor fusion pass failed:', fusionError?.message || fusionError); }
    state = { ...state, state: 'connecting', message: 'Authenticating and reading Firebase detections…' };
    const task = launch(); child = task.processChild;
    task.finished.catch(error => {
      if (!stopping) state = { ...state, state: 'error', message: error.message };
    }).finally(() => {
      child = null;
      if (!stopping) { timer = setTimeout(() => { void start(); }, 10000); timer.unref?.(); }
    });
  }
  async function stop() {
    stopping = true; clearTimeout(timer);
    if (child) {
      const previous = child;
      await new Promise(resolve => { previous.once('close', resolve); previous.kill(); });
    }
    await queue;
  }
  async function restart() { await stop(); await start(); }
  async function status() {
    const db = await getDB();
    const mission = config?.missionId || 'TV-LIVE-001';
    const events = await db.collection('firebase_events').find({ mission_id: mission }).toArray();
    return { ...state, running: !!child, mission_id: mission, test_mode: config?.testMode === true,
      counts: { total: events.filter(e => e.status !== 'removed').length,
        matched: events.filter(e => e.status === 'matched').length,
        pending: events.filter(e => ['waiting_for_telemetry', 'outside_tolerance'].includes(e.status)).length,
        invalid: events.filter(e => e.status.startsWith('invalid')).length },
      config: config ? { database_url: config.databaseUrl, database_path: config.databasePath,
        credentials_present: fs.existsSync(config.credentials), csv_present: fs.existsSync(config.csv),
        csv_path: config.csv, image_directory: config.imageDir, max_gap_seconds: config.maxGap,
        clock_offset_seconds: config.clockOffset, detection_timezone: config.detectionTimezone,
        telemetry_timezone: config.telemetryTimezone, poll_seconds: config.poll } : null };
  }
  async function events(missionId) {
    const db = await getDB();
    // Retry updates to older detections must not hide the newest image capture.
    return (await db.collection('firebase_events').find({ mission_id: missionId || config?.missionId }).toArray())
      .sort((a, b) => {
        const capture = row => Number.isFinite(Date.parse(row.match?.capture_timestamp))
          ? Date.parse(row.match.capture_timestamp) : 0;
        return capture(b) - capture(a) || String(b.first_received_at).localeCompare(String(a.first_received_at));
      })
      .slice(0, 500).map(({ fingerprint, ...record }) => record);
  }
  async function imageFile(eventId) {
    if (!config || !/^FB-[a-f0-9]{24}$/.test(eventId)) return null;
    const db = await getDB();
    const row = await db.collection('firebase_events').findOne({ _id: eventId });
    if (!row || (!row.image_path && !row.image?.local_path)) return null;
    const filename = row.image?.state === 'ready' && /^received\/[A-Za-z0-9_.-]+$/.test(row.image.local_path || '')
      ? row.image.local_path : path.posix.basename(String(row.image_path || '').replaceAll('\\', '/'));
    if (!/\.(jpg|jpeg|png|webp)$/i.test(filename)) return null;
    try {
      const realRoot = fs.realpathSync(config.imageDir);
      const candidate = fs.realpathSync(path.join(realRoot, filename));
      const relative = path.relative(realRoot, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(candidate).isFile()) return null;
      return candidate;
    } catch { return null; }
  }
  function liveTelemetry() {
    // Read the CSV directly (config may be unavailable when the bridge is in
    // an error state); fall back to the default logger path.
    const csvPath = config?.csv || path.resolve(root, 'telemetry/DroneTelemetry/telemetry.csv');
    return liveTelemetryFromCsv(csvPath);
  }
  /**
   * Re-run sensor fusion over every stored observation for the mission. Safe to
   * call repeatedly; used on startup and by the manual re-fuse endpoint so
   * existing data reflects the current thresholds.
   */
  async function refusion() {
    const db = await getDB();
    const mission = config?.missionId || 'TV-LIVE-001';
    return fuseMissionObservations(db, mission);
  }
  return { start, stop, restart, status, events, imageFile, ingest, liveTelemetry, refusion };
}
module.exports = { createBridgeService, readBridgeConfig };
