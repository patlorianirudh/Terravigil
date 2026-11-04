#!/usr/bin/env node
/**
 * Token check for src/components and src/pages.
 *
 * Two rules:
 *
 * 1. Colour comes from tokens. No raw hex, no arbitrary colour literal,
 *    anywhere. Non-negotiable — it is what keeps the contrast audit meaningful.
 *
 * 2. The chrome/instrument split holds. Glass, blur, gradients and glow belong
 *    to chrome (shell, panels, modals, controls). They are forbidden on
 *    INSTRUMENT surfaces — the map and the components an operator reads a
 *    measurement off — because a blurred or glowing coordinate is a legibility
 *    failure on a field laptop in daylight. PRD §20.4 forbids these outright;
 *    this is the narrower line we actually hold.
 *
 * Exits non-zero with a list of violations.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scanned = ['src/components', 'src/pages'];

const colourPatterns = [
  {
    re: /\b(?:text|bg|border|from|via|to|fill|stroke|decoration|outline|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00)\b/,
    name: 'raw Tailwind palette color',
  },
  // `\b` is no help here: `_` is a word character, so `#5898E0_1px` inside a
  // Tailwind arbitrary value slipped past a boundary-anchored pattern.
  { re: /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/, name: 'raw hex color' },
  { re: /\[(?:#|rgb\(|rgba\(|hsl\(|hsla\()/, name: 'arbitrary color literal' },
  {
    re: /\b(?:text|bg|border|from|via|to|fill|stroke|decoration|outline|ring)-\[(?:#|rgb|hsl)/,
    name: 'arbitrary Tailwind color',
  },
];

/** Files whose whole job is displaying a measurement. Opaque, unblurred. */
const instrumentFiles = [
  /components[/\\]map[/\\]/,
  /components[/\\]ui[/\\]MetricReadout\.tsx$/,
  /components[/\\]ui[/\\]ConfidenceLedger\.tsx$/,
  /components[/\\]ui[/\\]SweepRibbon\.tsx$/,
];

const effectPatterns = [
  { re: /\bbackdrop-blur\b|\bglass\b|\bglass-strong\b/, name: 'glass/blur on an instrument surface' },
  { re: /\bbg-gradient-|\bdrop-shadow\b|\bshadow-glow-/, name: 'gradient/glow on an instrument surface' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

/** Blank out comments while preserving line numbering — a comment is not code. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const violations = [];
for (const scope of scanned) {
  for (const file of walk(join(root, scope))) {
    const rel = relative(root, file);
    const isInstrument = instrumentFiles.some((re) => re.test(rel));
    const active = isInstrument ? [...colourPatterns, ...effectPatterns] : colourPatterns;

    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        for (const { re, name } of active) {
          if (re.test(line)) {
            violations.push(`${rel}:${i + 1} [${name}] ${line.trim()}`);
          }
        }
      });
  }
}

if (violations.length > 0) {
  console.error('TOKEN VIOLATIONS:');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`OK: tokens and the chrome/instrument split hold across ${scanned.join(', ')}`);
