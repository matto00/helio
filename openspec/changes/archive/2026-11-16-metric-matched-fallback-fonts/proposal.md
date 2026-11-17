## Why

Helio's web fonts (Schibsted Grotesk, JetBrains Mono, Fraunces) load with `display=swap`. Until they arrive the page
renders in the platform's fallback font, whose metrics differ, so text re-wraps when the swap happens. Under a wide
fallback (DejaVu Sans, as on CI/Ubuntu) Home's run timeline jumps 8px on phones and 22-24px at 620-1280px on a cold
load, worse than before HEL-1665 (4px). Every other page has the same unmanaged swap.

## What Changes

- Declare metric-matched fallback `@font-face` rules (`size-adjust`, `ascent-override`, `descent-override`,
  `line-gap-override`, `src: local(...)`) for the sans, mono and serif web faces, one per common platform fallback
  (Arial/Liberation Sans/Arimo family and DejaVu), and put them in the `--font-face-*` stacks right after the web font.
- Commit a reproducible derivation (script + recorded inputs) for the override numbers.
- Assert the cold-load swap in the HEL-1665 Home shift spec (at most 4px) instead of only recording it.
- Measure base vs head in the CI-like environment (Playwright noble image + DejaVu), light and dark, all AC widths;
  confirm the "Serif headings" swap.
- New e2e: Home under a larger browser default font size.
- Cheap extras: remove the nested `aria-hidden` in `DashboardShelf.tsx`; correct the archived HEL-1665 design.md figure
  (22-26px -> 22-24px). Update DESIGN.md §3 (a new web face needs a matched fallback).

## Capabilities

### New Capabilities

### Modified Capabilities
- `frontend-theme-system`: adds a requirement that each web font face has metric-matched fallback faces.
- `home-page`: the cold-load web-font swap is bounded (at most 4px under the CI-like fallback) instead of recorded only.

## Impact

`frontend/src/theme/theme.css` (global: every page and the landing page), the theme token tests, e2e
`hel1665-home-phone-stability.spec.ts`, one new e2e spec, `DashboardShelf.tsx`, DESIGN.md, one archived design.md.
No backend, no API, no new runtime dependency (local() fallbacks download nothing).

## Non-goals

- Placeholder polish (one skeleton bar per line at 431-604px): a design change to the skeleton; filed as a follow-up.
- Self-hosting the web fonts or changing `display=swap`.
- ECharts canvas font strings (`chartAppearance.ts`): canvas text does not reflow page layout.
