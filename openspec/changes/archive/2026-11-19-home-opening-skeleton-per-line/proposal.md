## Why

Home's opening-line loading placeholder (`.home-opening__ghost`, HEL-1665) holds the hidden default sentence so the timeline does not move when the summary arrives, but it draws one absolutely positioned skeleton bar, vertically centred, over the whole placeholder. Where the hidden sentence wraps to two lines (431-604px in Sans, and other widths and type styles), the user sees one bar floating between two lines instead of one bar per line like every other text skeleton. Deferred twice (HEL-1665, HEL-1737); this closes it.

## What Changes

- The hidden default sentence inside the placeholder is wrapped in one inline element that carries the shared skeleton class (`ui-skeleton`: its token gradient, shimmer animation and reduced-motion/motion-off flat fill), made visible inside the hidden paragraph with transparent text and `box-decoration-break: clone` (plus the `-webkit-` prefix), so the browser paints one rounded bar per line fragment. No JS line counting.
- The single absolutely positioned `Skeleton` bar over the placeholder (`.home-opening__skeleton-line`) and its CSS are removed.
- The `Skeleton` component and `Skeleton.css` are unchanged. The placeholder's layout (height, wrap, nowrap band from 605px) is unchanged, so the HEL-1665 0px series and the HEL-1737 320-1300px placeholder sweep stay green.

## Capabilities

### New Capabilities

### Modified Capabilities
- `home-page`: the opening line's loading placeholder shows one skeleton bar per rendered line of the hidden default sentence.

## Impact

- `frontend/src/features/home/ui/HomeOpeningLine.tsx` (placeholder markup), `frontend/src/features/home/ui/HomePage.css` (placeholder rules), their unit tests (`HomePage.css.test.ts`, `HomePage.test.tsx`).
- New e2e spec for the per-line bars; existing hel1665/hel1678/hel1572 Home specs re-run as guards.
- No API, schema, backend or migration change.
