import { describe, expect, it } from 'vitest';

import { ABSENT, fmtArea, fmtCount, fmtElapsedMs, fmtLatLon, fmtNum, fmtScore } from './formatters';

/** The em-dash rule: absent input never formats as a number. */
describe('formatters', () => {
  it('renders absent values as an em-dash', () => {
    expect(fmtNum(null)).toBe(ABSENT);
    expect(fmtNum(undefined)).toBe(ABSENT);
    expect(fmtNum(Number.NaN)).toBe(ABSENT);
    expect(fmtCount(null)).toBe(ABSENT);
    expect(fmtScore(null)).toBe(ABSENT);
    expect(fmtArea(null)).toBe(ABSENT);
    expect(fmtLatLon(null, 78.1)).toBe(ABSENT);
    expect(fmtElapsedMs(null)).toBe(ABSENT);
  });

  it('distinguishes zero from absent', () => {
    expect(fmtNum(0, 1, 'm')).toBe('0.0 m');
    expect(fmtScore(0)).toBe('0.00');
    expect(fmtArea(0)).toBe('0 m²');
  });

  it('promotes area to hectares only past 1 ha', () => {
    expect(fmtArea(48)).toBe('48 m²');
    expect(fmtArea(9_999)).toBe('9,999 m²');
    expect(fmtArea(12_500)).toBe('1.25 ha');
  });

  it('formats coordinates to six decimals with hemispheres', () => {
    expect(fmtLatLon(17.385421, -78.486671)).toBe('17.385421° N, 78.486671° W');
  });

  it('formats elapsed milliseconds', () => {
    expect(fmtElapsedMs(0)).toBe('0m 00s');
    expect(fmtElapsedMs(245_000)).toBe('4m 05s');
    expect(fmtElapsedMs(4_320_000)).toBe('1h 12m');
  });
});
