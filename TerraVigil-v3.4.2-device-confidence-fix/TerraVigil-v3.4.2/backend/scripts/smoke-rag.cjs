'use strict';

const baseArg = process.argv.find(value => value.startsWith('--base='));
const missionArg = process.argv.find(value => value.startsWith('--mission='));
const shouldPrepare = process.argv.includes('--prepare');
const base = (baseArg ? baseArg.slice('--base='.length) : 'http://localhost:3000').replace(/\/$/, '');
const mission = missionArg ? missionArg.slice('--mission='.length) : process.env.MISSION_ID;

function print(label, response, body) {
  const category = response.ok ? 'ok' : body && body.code ? body.code : 'http_error';
  const ids = body && Array.isArray(body.sources)
    ? body.sources.map(source => `${source.source_type}:${source.record_id ?? 'summary'}`).join(',') : '';
  console.log(JSON.stringify({ label, status: response.status, category, source_ids: ids }));
}

(async () => {
  if (!mission) throw new Error('Pass --mission=MISSION_ID or set MISSION_ID.');
  const documents = await fetch(`${base}/missions/${encodeURIComponent(mission)}/rag-documents`);
  const documentsBody = await documents.json().catch(() => ({}));
  print('documents', documents, documentsBody);
  if (shouldPrepare) {
    const prepared = await fetch(`${base}/missions/${encodeURIComponent(mission)}/create-embeddings`, { method: 'POST' });
    print('prepare', prepared, await prepared.json().catch(() => ({})));
  }
  const search = await fetch(`${base}/missions/${encodeURIComponent(mission)}/search?q=${encodeURIComponent('What is the highest risk level?')}`);
  print('search', search, await search.json().catch(() => ({})));
  const ask = await fetch(`${base}/missions/${encodeURIComponent(mission)}/ask?q=${encodeURIComponent('What is the highest risk level?')}`);
  print('ask', ask, await ask.json().catch(() => ({})));
})().catch(error => {
  console.error(JSON.stringify({ category: 'client_error', message: error.message }));
  process.exitCode = 1;
});
