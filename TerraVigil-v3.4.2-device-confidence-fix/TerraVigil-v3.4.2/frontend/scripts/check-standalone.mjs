#!/usr/bin/env node
/** Execute the delivered HTML in a DOM harness. No visual/browser-engine claim. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const file = new URL('../TerraVigil-preview.html', import.meta.url);
const errors = [];
const logs = new VirtualConsole();
logs.on('error', (...entries) => {
  errors.push(
    entries
      .map((entry) => String(entry?.stack ?? entry))
      .join(' ')
      .slice(0, 1200),
  );
});
logs.on('jsdomError', (error) => {
  // JSDOM's CSS parser does not support all compiled CSS. It cannot verify layout.
  if (error.type !== 'css parsing') errors.push(error.message.slice(0, 250));
});
const dom = new JSDOM(await fs.readFile(fileURLToPath(file), 'utf8'), {
  url: file.href,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: logs,
  beforeParse(window) {
    // Modern browser APIs absent from JSDOM, supplied solely for this harness.
    window.structuredClone = structuredClone;
    window.matchMedia = (query) => ({
      matches: query.includes('reduce') && !query.includes('no-preference'),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    });
    window.scrollTo = () => {};
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // Exercise Leaflet's DOM lifecycle without pretending JSDOM paints a canvas.
    window.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy(
        { canvas: this },
        {
          get(target, property) {
            return property in target ? target[property] : () => {};
          },
        },
      );
    };
  },
});
try {
  for (
    let attempt = 0;
    attempt < 60 && !dom.window.document.querySelector('.leaflet-container');
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(errors, [], 'Standalone runtime errors');
  assert.equal(dom.window.location.hash, '#/');
  assert.ok(
    dom.window.document.querySelector('.ops-intro-title')?.textContent.includes('Your survey.'),
  );
  assert.ok(
    dom.window.document.querySelector('.demo-notice')?.textContent.includes('SIMULATED DATA'),
  );
  assert.ok(dom.window.document.querySelector('.leaflet-container .leaflet-pane'));
  assert.ok(
    dom.window.document
      .querySelector('.leaflet-control-attribution')
      ?.textContent.includes('Leaflet'),
  );
  assert.ok(dom.window.document.querySelector('button[aria-label="Zoom in"]'));
  dom.window.document.querySelector('button[aria-label="Map layers"]').click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(dom.window.document.querySelector('.map-layer-menu'));
  const toggle = dom.window.document.querySelector('.map-layer-menu button');
  const before = toggle.getAttribute('aria-pressed');
  toggle.click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.notEqual(toggle.getAttribute('aria-pressed'), before);
  dom.window.document.querySelector('a[href="#/route"]').click();
  for (
    let attempt = 0;
    attempt < 60 && !dom.window.document.querySelector('.route-endpoint-card');
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const endpointText = () =>
    [...dom.window.document.querySelectorAll('.route-endpoint-card p')].map(
      (element) => element.textContent,
    );
  assert.deepEqual(endpointText(), ['Select a point on the map', 'Select a point on the map']);
  dom.window.document.querySelector('button[aria-label="Zoom in"]').click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    endpointText(),
    ['Select a point on the map', 'Select a point on the map'],
    'Map controls must not pick route endpoints',
  );
  dom.window.document
    .querySelector('.leaflet-container')
    .dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, clientX: 120, clientY: 100 }),
    );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.notEqual(
    endpointText()[0],
    'Select a point on the map',
    'A map click must still pick an endpoint',
  );
  assert.deepEqual(errors, [], 'Leaflet interaction runtime errors');
  console.log(
    'PASS: standalone opens Operations with Leaflet, attribution, demo banner, layer toggle, and route endpoint picking; zoom clicks do not pick endpoints. JSDOM checks lifecycle and events, not canvas drawing or visual layout.',
  );
} finally {
  dom.window.close();
}
