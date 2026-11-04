#!/usr/bin/env node
/**
 * Contrast audit for the design tokens in src/styles/index.css.
 *
 * Two thresholds, because WCAG 2.1 has two:
 *   text pairs           → 4.5:1 (1.4.3 Contrast Minimum)
 *   control-boundary and → 3:1   (1.4.11 Non-text Contrast)
 *   graphical-object pairs
 *
 * P-20.13 states "all pairs ≥ 4.5:1". Applied literally to hairline dividers
 * that separates one dark panel from another, that would put bright lines
 * through every table row in a dense instrument display — and 1.4.11 does not
 * ask for it. Dividers are therefore audited but not gated; anything an
 * operator has to see to operate a control is gated at 3:1, and all text at
 * 4.5:1.
 *
 * Exits non-zero if a gated pair fails, so this is a check, not just a report.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const css =
  readFileSync(`${root}/src/styles/index.css`, 'utf8') +
  '\n' +
  readFileSync(`${root}/src/styles/briefing.css`, 'utf8');

const tokens = {};
for (const m of css.matchAll(/--(color-[\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
  tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
}

/**
 * Glass is not a colour token, so its effective background has to be computed:
 * translucent white composited over the ambient field. Text sitting on a glass
 * panel is measured against that, not against `surface` — otherwise the audit
 * checks a background that is not actually behind anything.
 */
function readAlpha(name, fallback) {
  const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)`));
  return m ? Number(m[1]) : fallback;
}

function composite(base, over, alpha) {
  return base.map((c, i) => Math.round(c * (1 - alpha) + over[i] * alpha));
}

const WHITE = [255, 255, 255];
tokens['glass-over-field'] = composite(
  tokens['color-background'],
  WHITE,
  readAlpha('glass-fill', 0.045),
);
tokens['glass-strong-over-field'] = composite(
  tokens['color-background'],
  WHITE,
  readAlpha('glass-fill-strong', 0.075),
);

function luminance([r, g, b]) {
  const a = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function contrast(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// kind: 'text' → gated at 4.5 · 'ui' → gated at 3 · 'info' → reported only
const pairs = [
  ['presentation accent on background', 'color-presentation-accent', 'color-background', 'text'],
  ['presentation ink on accent', 'color-presentation-ink', 'color-presentation-accent', 'text'],
  ['presentation ink on paper', 'color-presentation-ink', 'color-presentation-paper', 'text'],
  ['presentation focus on paper', 'color-presentation-ink', 'color-presentation-paper', 'ui'],
  ['text-primary on background', 'color-text-primary', 'color-background', 'text'],
  ['text-primary on surface', 'color-text-primary', 'color-surface', 'text'],
  ['text-primary on surface-elevated', 'color-text-primary', 'color-surface-elevated', 'text'],
  ['text-primary on surface-sunken', 'color-text-primary', 'color-surface-sunken', 'text'],
  ['text-secondary on surface', 'color-text-secondary', 'color-surface', 'text'],
  ['text-secondary on surface-sunken', 'color-text-secondary', 'color-surface-sunken', 'text'],
  ['text-muted on surface', 'color-text-muted', 'color-surface', 'text'],
  ['text-muted on surface-sunken', 'color-text-muted', 'color-surface-sunken', 'text'],
  ['accent on background', 'color-accent', 'color-background', 'text'],
  ['accent on surface', 'color-accent', 'color-surface', 'text'],

  // Glass chrome: text on a translucent sheet over the ambient field.
  ['text-primary on glass', 'color-text-primary', 'glass-over-field', 'text'],
  ['text-secondary on glass', 'color-text-secondary', 'glass-over-field', 'text'],
  ['text-muted on glass', 'color-text-muted', 'glass-over-field', 'text'],
  ['accent-bright on glass', 'color-accent-bright', 'glass-over-field', 'text'],
  ['text-primary on glass-strong', 'color-text-primary', 'glass-strong-over-field', 'text'],
  ['text-muted on glass-strong', 'color-text-muted', 'glass-strong-over-field', 'text'],

  ['status ok on surface', 'color-status-ok', 'color-surface', 'text'],
  ['status ok on ok-fill', 'color-status-ok', 'color-status-ok-fill', 'text'],
  ['status warning on surface', 'color-status-warning', 'color-surface', 'text'],
  ['status warning on warning-fill', 'color-status-warning', 'color-status-warning-fill', 'text'],
  ['status critical on surface', 'color-status-critical', 'color-surface', 'text'],
  [
    'status critical on critical-fill',
    'color-status-critical',
    'color-status-critical-fill',
    'text',
  ],
  ['status offline on surface', 'color-status-offline', 'color-surface', 'text'],
  ['status info on surface', 'color-status-info', 'color-surface', 'text'],
  ['status info on info-fill', 'color-status-info', 'color-status-info-fill', 'text'],

  // The risk ramp — P-20.13 requires these to be audited, and they never were.
  ['risk high on surface', 'color-risk-high', 'color-surface', 'text'],
  ['risk high on high-fill', 'color-risk-high', 'color-risk-high-fill', 'text'],
  ['risk medium on surface', 'color-risk-medium', 'color-surface', 'text'],
  ['risk medium on medium-fill', 'color-risk-medium', 'color-risk-medium-fill', 'text'],
  ['risk low on surface', 'color-risk-low', 'color-surface', 'text'],
  ['risk low on low-fill', 'color-risk-low', 'color-risk-low-fill', 'text'],

  // Risk bands must also be separable from each other, not just from the panel.
  ['risk high vs medium', 'color-risk-high', 'color-risk-medium', 'info'],
  ['risk medium vs low', 'color-risk-medium', 'color-risk-low', 'info'],

  ['border-control on surface (control edge)', 'color-border-control', 'color-surface', 'ui'],
  [
    'border-control on surface-sunken (control edge)',
    'color-border-control',
    'color-surface-sunken',
    'ui',
  ],
  ['focus-ring on surface', 'color-focus-ring', 'color-surface', 'ui'],
  ['focus-ring on surface-sunken', 'color-focus-ring', 'color-surface-sunken', 'ui'],

  ['border on surface (divider, ungated)', 'color-border', 'color-surface', 'info'],
  ['border-strong on surface (divider, ungated)', 'color-border-strong', 'color-surface', 'info'],
];

const MINIMUM = { text: 4.5, ui: 3, info: 0 };

let failures = 0;
console.log('pair\tratio\tgate\tresult');
for (const [label, fgName, bgName, kind] of pairs) {
  const fg = tokens[fgName];
  const bg = tokens[bgName];
  if (!fg || !bg) {
    console.log(`${label}\tMISSING TOKEN`);
    failures += 1;
    continue;
  }
  const ratio = contrast(fg, bg);
  const gate = MINIMUM[kind];
  const ok = ratio >= gate;
  if (!ok) failures += 1;
  const gateLabel = gate === 0 ? 'report' : `${gate.toFixed(1)}:1`;
  console.log(
    `${label}\t${ratio.toFixed(2)}:1\t${gateLabel}\t${gate === 0 ? '—' : ok ? 'pass' : 'FAIL'}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} gated contrast pair(s) failed.`);
  process.exit(1);
}
console.log('\nOK: every gated contrast pair passes.');
