#!/usr/bin/env node
/**
 * Architectural boundary check: nothing under src/components or src/pages may
 * import the backend-contract seam (http/dto/mappers) or any fixture module.
 * Pages talk to `services/api` and `services/socket` through hooks; they must
 * never know a wire field name or open a fetch of their own.
 * Exits non-zero with a list of violations if the boundary is crossed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scanned = ['src/components', 'src/pages'];
const forbidden = [
  /services\/http/,
  /services\/dto/,
  /services\/mappers/,
  /services\/mock/,
  /services\/live/,
  /mockData/,
  /mock\/catalog/,
  /mock\/fixtures/,
  /mock\/geo/,
  /fixtures/,
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

const violations = [];
for (const scope of scanned) {
  for (const file of walk(join(root, scope))) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (/import|from\s+['"]/.test(line) && forbidden.some((re) => re.test(line))) {
        violations.push(`${relative(root, file)}: ${line.trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('BOUNDARY VIOLATIONS (contract-seam or fixture imports in components/pages):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`OK: 0 seam/fixture imports across ${scanned.join(', ')}`);
