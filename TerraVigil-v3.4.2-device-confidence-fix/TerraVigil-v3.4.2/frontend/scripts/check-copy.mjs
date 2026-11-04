#!/usr/bin/env node
/**
 * Copy-law check (PRD P-20.14 / P-23.8).
 *
 * No UI string may tell an operator that ground is clear, safe, or secure.
 * This is the highest-severity failure mode in the product and it is a wording
 * failure, not a technical one — so it gets a lint rule, like any other
 * invariant we refuse to re-check by hand.
 *
 * Scans string literals and JSX text in src/components and src/pages. Code
 * identifiers are not scanned: `useSafePath` is a function name, not something
 * an operator reads. Phrases that exist precisely to deny a clearance claim
 * ("SWEPT ≠ CLEARED") are allowlisted below.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scanned = ['src/components', 'src/pages'];

const FORBIDDEN = [
  { re: /\bclear(ed|s|ing)?\b/i, name: 'clear' },
  { re: /\ball[- ]clear\b/i, name: 'all clear' },
  { re: /\bsafe(ly|ty)?\b/i, name: 'safe' },
  { re: /\bsecure(d|ly)?\b/i, name: 'secure' },
  { re: /\bmine[- ]free\b/i, name: 'mine-free' },
];

/**
 * Approved exceptions, matched case-insensitively and removed before scanning.
 * Each one is a denial of a clearance claim, a route path kept for
 * compatibility, or the name of a safety concept the operator must see.
 */
const ALLOWED = [
  'swept ≠ cleared',
  'not a cleared lane',
  'no area shown here has been cleared',
  'cannot declare ground clear',
  'has not been cleared',
  'safety-sensitive',
  '/safe-path',
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

/** Blank out comments while preserving line numbering. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Quoted strings plus JSX text nodes — everything an operator can read. */
function readableFragments(text) {
  const fragments = [];
  const patterns = [
    /'(?:[^'\\\n]|\\.)*'/g,
    /"(?:[^"\\\n]|\\.)*"/g,
    /`(?:[^`\\]|\\.)*`/g,
    />([^<>{}]+)</g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      fragments.push(match[1] ?? match[0]);
    }
  }
  return fragments;
}

function sanitise(fragment) {
  let out = fragment.toLowerCase();
  for (const allowed of ALLOWED) out = out.split(allowed).join(' ');
  return out;
}

const violations = [];
for (const scope of scanned) {
  for (const file of walk(join(root, scope))) {
    const source = readFileSync(file, 'utf8');
    const raw = source.split('\n');
    stripComments(source)
      .split('\n')
      .forEach((line, index) => {
        for (const fragment of readableFragments(line)) {
          const text = sanitise(fragment);
          for (const { re, name } of FORBIDDEN) {
            if (re.test(text)) {
              violations.push(`${relative(root, file)}:${index + 1} [${name}] ${raw[index].trim()}`);
              return;
            }
          }
        }
      });
  }
}

if (violations.length > 0) {
  console.error('COPY-LAW VIOLATIONS (a UI string implies ground is clear/safe/secure):');
  for (const v of violations) console.error('  ' + v);
  console.error('\nSee PRD §20.6 for the mandated vocabulary.');
  process.exit(1);
}
console.log(`OK: 0 forbidden clearance words across ${scanned.join(', ')}`);
