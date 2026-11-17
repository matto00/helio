## Why

Home's opening sentence is capped at `max-width: 40ch`. A `ch` is the advance of the rendered font's `0`, so the cap
is narrower in the metric-matched fallback faces (HEL-1678) than in the web font: about 560px versus 600px at 24px. On a
cold load the sentence therefore wraps differently before and after the web font arrives. HEL-1678 recorded a 30px swap
at 610px (base 24px) and a two-line-to-one-line reflow at desktop widths when the summary data lands before the web font.
size-adjust cannot fix this: it scales the letter average, not the digit advance alone.

## What Changes

- Root causes differ: at desktop with data before the web font, the real sentence's `40ch` shrinks in the fallback;
  at 605-613px the loading ghost is container-bound (its cap does not bind) and the fallback-rendered default sentence
  is wider than the web-font one.
- The real opening sentence's cap becomes a font-independent measure in `em` (scales with the sentence's own font size
  and the user's default font size, but not with which face renders), set to the web font's own `40ch` for each type
  style (Sans, Serif, Mono), so a settled Home with the web fonts loaded wraps exactly as today.
- The hidden placeholder (`.home-opening__ghost`) takes the same per-style measure, so placeholder and real sentence
  break identically in both the fallback and the web font.
- For the 605-613px band, the sentence and ghost get Home-opening-only fallback faces with a smaller `size-adjust`
  (web font first, so nothing changes once it loads), but only if a measurement first shows that is feasible within
  4% of HEL-1678's values. Otherwise the band goes to the owner as an escalation and the band's spec text and tests are
  rewritten per the answer.
- New e2e assertions: the cold-load swap is at most 4px across the 605-613px band and at desktop widths when data
  arrives before the web font, light and dark, under the CI-like font set. They fail on base first.
- The existing HEL-1665 "keeps the 40ch measure" assertion is restated as "keeps the web font's 40ch width and line
  count" (the computed cap is no longer literally `40ch`, but equals it in the web font).
- Optional, time-boxed: one skeleton bar per placeholder line at 431-604px, only if pure CSS on the existing ghost;
  otherwise filed as a follow-up.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `home-page`: the "Phone layout keeps the run timeline in the first viewport" requirement's cold-load swap bound is
  extended to the 605-613px band and to desktop widths with data arriving before the web font; the 605-615px carve-out
  is removed.

## Impact

- `frontend/src/features/home/ui/HomePage.css` (opening sentence and ghost caps; per type style).
- `e2e/hel1665-home-phone-stability.spec.ts` (new widths, data-first cold-load case, restated measure assertion).
- `openspec/specs/home-page/spec.md` via the delta.
- No backend, schema, API or dependency change.
