// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BriefingPage as BriefingComponent } from './BriefingPage';

let BriefingPage: typeof BriefingComponent;
let container: HTMLDivElement;
let root: Root;
let reducedMotion = true;

beforeAll(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('no-preference')
      ? !reducedMotion
      : query.includes('reduce') && reducedMotion,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('scrollTo', vi.fn());
  ({ BriefingPage } = await import('./BriefingPage'));
});

async function commit(action: () => void) {
  await act(async () => {
    action();
    // Allow React's queued effects to settle within the test transaction.
    await Promise.resolve();
  });
}

async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await commit(() => {
    root.render(
      <StrictMode>
        <MemoryRouter>
          <BriefingPage />
        </MemoryRouter>
      </StrictMode>,
    );
  });
}

function required(selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

afterEach(async () => {
  await commit(() => {
    root.unmount();
  });
  container.remove();
  reducedMotion = true;
});

describe('project briefing interactions', () => {
  it('supports keyboard workflow navigation with an associated evidence explanation', async () => {
    await mount();
    const first = required('#chapter-tab-0');
    first.focus();
    await commit(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(required('#chapter-tab-1').getAttribute('aria-selected')).toBe('true');
    expect(required('#chapter-panel').textContent).toContain('Two sensors. One standard.');
    expect(document.activeElement?.id).toBe('chapter-tab-1');
    await commit(() => {
      required('#chapter-tab-1').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      );
    });
    expect(required('#chapter-panel').textContent).toContain('Put uncertainty on the map.');
    expect(document.activeElement?.id).toBe('chapter-tab-2');
  });

  it('renders complete content without animation when reduced motion is requested', async () => {
    await mount();
    expect(required('h1').textContent).toContain('See the ground.');
    expect(container.querySelector('svg[role="img"]')?.textContent).toContain(
      'no measured terrain or detections',
    );
    expect(required('.briefing-headline > span').style.opacity).toBe('');
    expect(required('.briefing-primary').getAttribute('href')).toBe('/');
    expect(container.textContent).toContain('Requires connected services'.toUpperCase());
  });

  it('stops GSAP presentation motion and removes scroll triggers when paused', async () => {
    reducedMotion = false;
    await mount();
    const { ScrollTrigger } = await import('gsap/ScrollTrigger');
    expect(ScrollTrigger.getAll().length).toBeGreaterThan(0);
    await commit(() => {
      required('button[aria-label="Pause presentation motion"]').click();
    });
    expect(
      required('button[aria-label="Enable presentation motion"]').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(required('.briefing-headline > span').style.opacity).toBe('');
    expect(ScrollTrigger.getAll()).toHaveLength(0);
    expect(required('button[aria-label="Replay introduction"]').hasAttribute('disabled')).toBe(
      true,
    );
  });
});

// ScrollTrigger owns a module-level timer; stop it before jsdom is torn down.
afterAll(async () => {
  const { ScrollTrigger } = await import('gsap/ScrollTrigger');
  const { gsap } = await import('gsap');
  ScrollTrigger.disable();
  gsap.ticker.sleep();
});
