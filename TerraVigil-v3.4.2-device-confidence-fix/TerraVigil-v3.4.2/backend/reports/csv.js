'use strict';

const { canonicalJson, recordId } = require('./snapshot');

function cell(value) {
  let text = value == null ? '' : typeof value === 'object' ? canonicalJson(value) : String(value);
  // Spreadsheet apps may trim whitespace/control characters before interpreting a formula.
  // Protect every cell, including IDs and field names, without changing the frozen source.
  if (/^[\s\x00-\x1f\x7f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function createCsv(content, contentHash) {
  const rows = [['record_type', 'record_id', 'field', 'value']];
  const add = (kind, id, fields) => {
    for (const [field, value] of Object.entries(fields)) rows.push([kind, id, field, value]);
  };
  add('report', content.id, {
    schema: content.schema, reportNumber: content.reportNumber, sessionId: content.sessionId,
    siteName: content.siteName, generatedAt: content.generatedAt, generationMode: content.generationMode,
    hardware: content.hardware, synthetic: content.synthetic, testMode: content.testMode, sourceHash: content.sourceHash, contentHash, formulaVersion: content.formulaVersion,
    hashSemantics: content.hashSemantics, recordCounts: content.recordCounts, narrative: content.narrative, limitations: content.limitations
  });
  add('summary', content.id, content.summary);
  for (const [collection, kind] of [['missions', 'mission'], ['detections', 'detection'], ['observations', 'observation'], ['telemetry', 'telemetry'], ['inference_runs', 'inference_run'], ['firebase_events', 'firebase_event']]) {
    (content.snapshot[collection] || []).forEach((record, index) => add(kind, recordId(record, kind, index), record));
  }
  content.sources.forEach((source, index) => add('source', String(index + 1), source));
  content.narrativeSources.forEach(source => add('narrative_source', String(source.citationNumber), source));
  return Buffer.from('\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n', 'utf8');
}

module.exports = { createCsv };
