// Check the current local backend without editing it or printing credentials.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');

async function main() {
  const backend = process.argv[2];
  if (!backend || !fs.existsSync(path.resolve(backend, 'package.json'))) {
    console.error('Usage: npm run check:gemini -- "C:\\path\\to\\backend"');
    process.exitCode = 1;
    return;
  }
  const requireBackend = createRequire(path.resolve(backend, 'package.json'));
  let dotenv;
  try {
    dotenv = requireBackend('dotenv');
  } catch {
    console.error(
      'dotenv is not installed in this backend. Select your current RAG backend; the supplied older upload does not include it.',
    );
    process.exitCode = 1;
    return;
  }

  let backendEnv = {};
  try {
    // parse avoids dotenv startup logging and does not change the shell environment.
    backendEnv = dotenv.parse(fs.readFileSync(path.resolve(backend, '.env')));
    console.log('Backend .env loaded locally.');
  } catch {
    console.log('Backend .env could not be read; checking the existing environment.');
  }
  const key = (process.env.GEMINI_API_KEY ?? backendEnv.GEMINI_API_KEY ?? '').trim();
  if (!key || /^(YOUR[_ -]|REPLACE[_ -]|PASTE[_ -])/i.test(key)) {
    console.error(
      'API key missing or a placeholder. Set GEMINI_API_KEY in the backend .env locally; do not share it.',
    );
    process.exitCode = 1;
    return;
  }
  console.log('API key is present. Its validity has not yet been verified.');
  if (
    process.env.GEMINI_API_KEY !== undefined &&
    backendEnv.GEMINI_API_KEY &&
    backendEnv.GEMINI_API_KEY.trim() !== key
  ) {
    console.log(
      'The shell GEMINI_API_KEY overrides backend .env. Use the intended local configuration before retrying.',
    );
  }

  const modelName = (process.env.GEMINI_MODEL ?? backendEnv.GEMINI_MODEL ?? '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(modelName)) {
    console.error(
      'Set GEMINI_MODEL to the exact model ID used by your backend generation module. This diagnostic has no default model.',
    );
    process.exitCode = 1;
    return;
  }
  if (
    process.env.GEMINI_MODEL !== undefined &&
    backendEnv.GEMINI_MODEL &&
    backendEnv.GEMINI_MODEL.trim() !== modelName
  ) {
    console.log(
      'The shell GEMINI_MODEL overrides backend .env. Confirm it matches the backend generation module.',
    );
  }

  let GoogleGenerativeAI;
  try {
    ({ GoogleGenerativeAI } = requireBackend('@google/generative-ai'));
  } catch {
    console.error(
      '@google/generative-ai is not installed in this backend. This diagnostic uses the existing SDK architecture; it does not install or migrate it.',
    );
    process.exitCode = 1;
    return;
  }
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: modelName });
  const result = await model.generateContent('Reply with the word OK.', { timeout: 30000 });
  if (!result.response.text().trim()) throw new Error('EMPTY_RESPONSE');
  console.log(
    'Gemini generateContent succeeded. Next test the mission /ask route and sources; this check alone does not complete Stage 10.',
  );
}

main().catch((error) => {
  // Provider errors may contain request URLs or credentials. Never print them.
  const message = String(error?.message || '');
  const details = JSON.stringify(error?.errorDetails || []);
  if (/API_KEY_INVALID|API key not valid/i.test(message + details)) {
    console.error(
      'API_KEY_INVALID: check the key in Google AI Studio, update backend .env locally, restart the backend, then retry.',
    );
  } else if (error?.status === 403) {
    console.error(
      'Gemini denied access. Check the key project, API permissions, restrictions, and key status in Google AI Studio.',
    );
  } else if (error?.status === 404) {
    console.error(
      'Gemini model unavailable. Check model availability and match GEMINI_MODEL to the backend. This is separate from key authentication.',
    );
  } else if (error?.status === 429) {
    console.error('Gemini quota or rate limit reached. Check project quota before retrying.');
  } else {
    console.error(
      'Gemini direct test failed. Check model configuration, network access, and service availability. No provider error or key was logged.',
    );
  }
  process.exitCode = 1;
});
