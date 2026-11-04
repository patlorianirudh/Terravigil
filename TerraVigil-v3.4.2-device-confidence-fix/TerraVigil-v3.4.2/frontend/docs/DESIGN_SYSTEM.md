# TerraVigil — Fieldwork design system

The rebuilt frontend uses an opaque operational workspace: warm charcoal, quiet green accents, precise typography, and hairline structure. It replaces the prior floating glass panels and ambient effects. All screens share the same tokens, navigation, action styling, and responsive behavior.

## Visual hierarchy

- Workspace rail: fixed 218 px navigation with grouped destinations and an explicit selected state. Collapsible; compact at tablet widths; replaced by a bottom bar on phones.
- Workspace bar: page location, keyboard-searchable navigation (`Ctrl/Cmd K`), connection context, account access.
- Workspace page headers: Inter Tight, sentence case, concise purpose; static headings receive a 140 ms GSAP opacity/transform transition. Operations uses a larger two-line editorial heading. Sensor readings do not animate.
- Panels: solid surfaces with 1 px borders and 6–8 px corner radii. No drop shadows, glow, translucency, or decorative gradients.
- Numbers: IBM Plex Mono with tabular numerals. Readings never animate on receipt.
- Primary action: a single solid mint treatment; secondary actions use a bordered neutral surface.

All fonts ship locally. Core maps draw a geographic coordinate grid without an external tile dependency. Custom tile providers remain configurable.

## Semantic palette

`src/styles/index.css` owns all colors. `src/styles/tokens.ts` mirrors the exact colors for Leaflet, SVG, and Recharts.

| Meaning               | Treatment                                           |
| --------------------- | --------------------------------------------------- |
| Workspace action      | Mint                                                |
| System nominal        | Green + status icon                                 |
| System degraded       | Amber + warning icon                                |
| System fault          | Coral + fault icon                                  |
| System unavailable    | Gray + offline icon                                 |
| Confirmed HIGH risk   | Rose, solid circle, explicit band label             |
| Confirmed MEDIUM risk | Mauve, translucent circle, explicit band label      |
| Confirmed LOW risk    | Periwinkle, hollow circle, explicit Confirmed label |
| Unconfirmed visual    | Neutral triangle                                    |
| Unresolved metal      | Neutral diamond                                     |

Risk colors deliberately differ from system-health colors. A correctly reported high-risk observation is not an instrument failure. Risk is never represented by color alone.

## Product signatures

1. **Confidence ledger**: separate visual and metal rows, numerical values, threshold ticks, hatching for missing sensor passes.
2. **Sweep ribbon**: true recorded altitude, pass bands, and classification-coded event ticks; no synthetic readings are inferred from absent data.
3. **Reticle**: reserved for map and imagery frames.
4. **Evidence discipline**: confirmed records, visual observations, and metallic observations remain distinct in maps, tables, and filters.

## Responsive and accessible behavior

Desktop layouts prioritize a large map with supporting evidence. At smaller widths, panels stack, tables scroll in their own regions, and navigation becomes compact. Search and session dialogs support keyboard access. Form labels, visible focus states, reduced motion, text equivalents for chart content, and minimum hit areas are maintained.

The browser in the current authoring environment blocks localhost. Responsive rules have been source-reviewed and the briefing has DOM interaction checks; final rendered sizes on target hardware remain unverified.

## Data states

Production defaults to the live service adapter. Local development explicitly selects demo mode through `.env.development`; `npm run demo` uses `.env.demo`. Every demo page bears a persistent SIMULATED DATA banner. Demo records are synthetic and do not certify surveyed ground. Missing evidence stays missing. Demo report records contain metadata rather than pretend PDFs; demonstration assistant responses are clearly labeled and are not RAG output.

Coverage pages retain the permanent SWEPT ≠ CLEARED notice. Observed track and uncertainty radii are drawn from supplied geometry. Unsupported computed surfaces do not receive decorative stand-ins.

## Quality gates

`npm run check:tokens` rejects raw color literals and raw Tailwind palette classes in UI source. `npm run check:copy` enforces operational terminology. `npm run check:boundaries` protects the service seam. `npm run check:contrast` audits foregrounds against surfaces, including the risk ramp and controls.

## Presentation view (2.1)

`/briefing` introduces the project with a large type scale, an olive accent, an ivory walkthrough section, and labeled isometric wireframe artwork. The user explicitly requested GSAP effects. Longer motion is limited to this presentation: a finite introduction, scroll reveals, and chapter transitions. The artwork is illustrative and is never a source of measured terrain, detections, or map data. The same source supplies this route in standalone, demo, and live builds.

GSAP uses scoped matchMedia contexts that revert on unmount or preference changes. Reduced motion disables the effects. A pause control restores static content and removes scroll triggers. The synthetic-data notice remains visible while scrolling the demo briefing.
