import React, { useMemo, useState } from 'react';

import type { Detection, TrackPoint } from '../../domain/types';
import { fmtNum, fmtTime } from '../../lib/formatters';
import { CLASSIFICATION_GLYPH } from '../../lib/classification';

interface SweepRibbonProps {
  trackPoints?: TrackPoint[];
  detections?: Detection[];
  className?: string;
}

const VIEW_W = 1000;
const VIEW_H = 56;
const PAD_TOP = 4;

interface Plotted {
  x: number;
  y: number;
  point: TrackPoint;
}

interface Band {
  x: number;
  width: number;
  pass: 'survey' | 'confirmation';
}

/**
 * The sweep ribbon (§20.4 signature 2).
 *
 * A session's altitude profile along a time axis, with the two-pass structure
 * drawn as bands underneath and detections as ticks where they were observed.
 * One glance answers: has this ground had a confirmation pass, or only a survey
 * pass? That question is the whole operational architecture, and it is not
 * legible anywhere else in the UI.
 */
export const SweepRibbon: React.FC<SweepRibbonProps> = ({
  trackPoints = [],
  detections = [],
  className = '',
}) => {
  const [hovered, setHovered] = useState<Plotted | null>(null);

  const model = useMemo(() => {
    const points = trackPoints
      .filter(
        (p): p is TrackPoint & { position: { altAglM: number } } =>
          typeof p.position.altAglM === 'number' &&
          Number.isFinite(p.position.altAglM) &&
          Number.isFinite(Date.parse(p.tUtc)),
      )
      .sort((a, b) => Date.parse(a.tUtc) - Date.parse(b.tUtc));

    const first = points.at(0);
    const last = points.at(-1);
    if (first === undefined || last === undefined || points.length < 2) return null;

    const t0 = Date.parse(first.tUtc);
    const t1 = Date.parse(last.tUtc);
    const span = Math.max(1, t1 - t0);
    const maxAlt = Math.max(...points.map((p) => p.position.altAglM), 1);

    const toX = (iso: string): number => ((Date.parse(iso) - t0) / span) * VIEW_W;

    const plotted: Plotted[] = points.map((point) => ({
      x: toX(point.tUtc),
      y: PAD_TOP + (1 - point.position.altAglM / maxAlt) * (VIEW_H - PAD_TOP),
      point,
    }));

    // Contiguous runs of the same pass become one band, so a two-pass mission
    // reads as two or three blocks rather than a hundred slivers.
    const bands: Band[] = [];
    for (const [i, entry] of plotted.entries()) {
      const pass = entry.point.pass;
      if (pass === null) continue;
      const nextX = plotted[i + 1]?.x ?? VIEW_W;
      const previous = bands.at(-1);
      if (previous?.pass === pass && Math.abs(previous.x + previous.width - entry.x) < 1.5) {
        previous.width = nextX - previous.x;
      } else {
        bands.push({ x: entry.x, width: Math.max(1, nextX - entry.x), pass });
      }
    }

    const area = [
      `M ${plotted[0]?.x.toFixed(2) ?? '0'} ${String(VIEW_H)}`,
      ...plotted.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`),
      `L ${plotted.at(-1)?.x.toFixed(2) ?? String(VIEW_W)} ${String(VIEW_H)}`,
      'Z',
    ].join(' ');

    const ticks = detections
      .map((d) => ({ detection: d, x: toX(d.firstObservedAt) }))
      .filter((t) => Number.isFinite(t.x) && t.x >= 0 && t.x <= VIEW_W);

    return { plotted, bands, area, ticks, maxAlt, t0, t1 };
  }, [trackPoints, detections]);

  return (
    <section
      aria-label="Sweep ribbon: altitude profile and pass timeline"
      className={`border-t border-border bg-surface px-4 py-2 ${className}`}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="type-section-heading">Sweep ribbon</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-3 rounded-[1px] bg-accent/30 ring-1 ring-inset ring-accent"
            />
            Survey pass
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-3 rounded-[1px] bg-ok/30 ring-1 ring-inset ring-ok"
            />
            Confirmation pass
          </span>
          {hovered !== null && (
            <span className="text-text-primary">
              {fmtTime(hovered.point.tUtc)} · {fmtNum(hovered.point.position.altAglM, 2, 'm AGL')} ·{' '}
              {hovered.point.pass ?? 'pass unknown'}
            </span>
          )}
        </div>
      </div>

      {model === null ? (
        <p className="flex h-[56px] items-center rounded-[2px] border border-dashed border-border bg-surface-sunken px-3 font-mono text-[11px] text-text-muted">
          The ribbon requires at least two samples with reported AGL altitude and timestamps.
        </p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Altitude profile over ${String(model.plotted.length)} track points, with ${String(model.ticks.length)} detections marked`}
            className="h-[56px] w-full rounded-[2px] border border-border bg-surface-sunken"
            onMouseLeave={() => {
              setHovered(null);
            }}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientX - rect.left) / rect.width;
              const target = ratio * VIEW_W;
              let nearest: Plotted | null = null;
              for (const p of model.plotted) {
                if (nearest === null || Math.abs(p.x - target) < Math.abs(nearest.x - target))
                  nearest = p;
              }
              setHovered(nearest);
            }}
          >
            {model.bands.map((band, i) => (
              <rect
                key={`${String(i)}-${band.pass}`}
                x={band.x}
                y={0}
                width={band.width}
                height={VIEW_H}
                className={band.pass === 'confirmation' ? 'fill-ok/15' : 'fill-accent/10'}
              />
            ))}

            <path
              d={model.area}
              className="fill-accent/25 stroke-accent"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />

            {model.ticks.map(({ detection, x }) => (
              <g key={detection.id}>
                <line
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={VIEW_H}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className={
                    detection.classification === 'confirmed'
                      ? riskStroke(detection.riskBand)
                      : 'stroke-text-muted'
                  }
                />
                <circle
                  cx={x}
                  cy={5}
                  r={3}
                  className={
                    detection.classification === 'confirmed'
                      ? riskFill(detection.riskBand)
                      : 'fill-text-muted'
                  }
                />
              </g>
            ))}

            {hovered !== null && (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={0}
                y2={VIEW_H}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="stroke-text-primary"
              />
            )}
          </svg>

          <div className="mt-1 flex justify-between font-mono text-[10px] text-text-muted">
            <span>{fmtTime(new Date(model.t0).toISOString())}</span>
            <span>peak {fmtNum(model.maxAlt, 1, 'm AGL')}</span>
            <span>{fmtTime(new Date(model.t1).toISOString())}</span>
          </div>

          {model.ticks.length > 0 && (
            <p className="sr-only">
              {model.ticks
                .map(
                  ({ detection }) =>
                    `${CLASSIFICATION_GLYPH[detection.classification]} ${detection.classification} at ${fmtTime(detection.firstObservedAt)}`,
                )
                .join('; ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

function riskStroke(band: Detection['riskBand']): string {
  if (band === 'high') return 'stroke-risk-high';
  if (band === 'medium') return 'stroke-risk-medium';
  if (band === 'low') return 'stroke-risk-low';
  return 'stroke-text-secondary';
}

function riskFill(band: Detection['riskBand']): string {
  if (band === 'high') return 'fill-risk-high';
  if (band === 'medium') return 'fill-risk-medium';
  if (band === 'low') return 'fill-risk-low';
  return 'fill-text-secondary';
}
