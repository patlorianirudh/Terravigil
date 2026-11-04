import { useId } from 'react';

// A conceptual illustration only. These curves never enter the survey map or data model.
function project(u: number, v: number): [number, number] {
  const hill = 108 * Math.exp(-((u + 0.15) ** 2 * 2.6 + (v - 0.1) ** 2 * 3.7));
  const ridge = 28 * Math.sin(u * 4 + v * 2) * Math.cos(v * 3);
  return [450 + (u - v) * 183, 394 + (u + v) * 99 - hill - ridge];
}

function lineAt(index: number, cross: boolean): string {
  return Array.from({ length: 49 }, (_, step) => {
    const a = -1 + (index / 28) * 2;
    const b = -1 + (step / 48) * 2;
    const [x, y] = project(cross ? b : a, cross ? a : b);
    return `${step ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function TerrainIllustration({ stage = 0 }: { stage?: number }) {
  const id = useId().replaceAll(':', '');
  return (
    <svg
      className={`terrain-illustration terrain-stage-${stage}`}
      viewBox="0 0 900 710"
      fill="none"
      role="img"
      aria-labelledby={`${id}-title ${id}-description`}
    >
      <title id={`${id}-title`}>An aerial survey, illustrated</title>
      <desc id={`${id}-description`}>
        A wireframe landscape beneath a survey aircraft. Visual and metal observations are separate
        inputs for review. This drawing is illustrative and contains no measured terrain or
        detections.
      </desc>
      <defs>
        <pattern id={`${id}-grid`} width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50 0H0V50" className="terrain-background-grid" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="900" height="710" fill={`url(#${id}-grid)`} />
      <g className="terrain-frame">
        <path d="M60 100V65H95M805 65H840V100M60 595V630H95M805 630H840V595" />
        <path d="M440 65H460M450 55V75M440 630H460M450 620V640" />
      </g>
      <g className="terrain-base">
        <path d="M84 396 450 594 816 396 450 198Z" />
        <path d="M84 412 450 610 816 412M84 428 450 626 816 428" />
        <path d="M84 396V428M450 594V626M816 396V428" />
      </g>
      <g className="terrain-mesh">
        {Array.from({ length: 29 }, (_, i) => (
          <path key={`a${i}`} d={lineAt(i, false)} />
        ))}
        {Array.from({ length: 29 }, (_, i) => (
          <path key={`b${i}`} d={lineAt(i, true)} />
        ))}
      </g>
      <g className="terrain-scan" aria-hidden="true">
        <path d="M238 309 596 503" />
        <path d="M246 302 604 496" />
      </g>
      <g className="terrain-observation terrain-visual">
        <path d="m310 359 11-18 11 18Z" />
        <path className="terrain-callout" d="M321 342V296H185" />
        <text x="107" y="286">
          VISUAL CANDIDATE
        </text>
      </g>
      <g className="terrain-observation terrain-metal">
        <path d="m579 365 10-10 10 10-10 10Z" />
        <path className="terrain-callout" d="M589 354V299H750" />
        <text x="617" y="289">
          METAL SIGNATURE
        </text>
      </g>
      <g className="terrain-observation terrain-fusion">
        <ellipse cx="461" cy="416" rx="39" ry="21" strokeDasharray="3 5" />
        <ellipse cx="461" cy="416" rx="11" ry="6" />
        <path className="terrain-callout" d="M461 437V542H655" />
        <text x="500" y="563">
          EVIDENCE + UNCERTAINTY
        </text>
      </g>
      <g className="terrain-beam" aria-hidden="true">
        <path d="M461 151 369 357M461 151 555 364" strokeDasharray="4 8" />
        <ellipse cx="461" cy="364" rx="93" ry="45" strokeDasharray="3 7" />
      </g>
      <g className="terrain-aircraft" aria-hidden="true">
        <path d="m461 135-52-24m52 24 49-25m-49 25-47 26m47-26 50 27" strokeWidth="5" />
        <ellipse cx="409" cy="110" rx="27" ry="12" />
        <ellipse cx="511" cy="110" rx="27" ry="12" />
        <ellipse cx="414" cy="161" rx="27" ry="12" />
        <ellipse cx="512" cy="162" rx="27" ry="12" />
        <path d="m443 125 18-9 19 9v24l-19 10-18-10Z" />
        <path d="m443 125 18 11 19-11M461 136v23" />
        <path d="M458 149h6v8h-6z" />
      </g>
      <text className="terrain-label" x="75" y="90">
        FIG. 01 / OBSERVATION SYSTEM
      </text>
      <text className="terrain-label" x="75" y="664">
        ILLUSTRATIVE TERRAIN · NOT SURVEY DATA
      </text>
      <text className="terrain-label" x="758" y="664">
        T / V
      </text>
    </svg>
  );
}
