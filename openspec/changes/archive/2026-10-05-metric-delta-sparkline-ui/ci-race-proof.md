# CI race: provenance click after a viewport resize (HEL-1275)

CI run 37410662796 (light only): after `page.setViewportSize({ width: 1440 })` reflowed the grid,
the click on the card's "Data provenance" button landed on the card body and opened the panel detail
modal instead of the popover.

## Fix (test only)
`layoutSettled(locator)` in `e2e/hel1275-metric-delta-sparkline.spec.ts`: an `expect.poll` that
needs four consecutive `boundingBox()` reads to be identical (intervals 50-250ms, no fixed sleep).
Applied after each `setViewportSize` (card), before the first provenance click (card and button),
and before the second provenance click (the filtered panel's button). The filtered-panel click is
the only other click after the resize and had the same exposure; the later in-app navigation clicks
follow no resize. No product code changed.

## RED: NOT reproduced locally (stated honestly)
Scratch copy of the spec (deleted afterwards) with every `layoutSettled` call removed:
- CDP `Emulation.setCPUThrottlingRate` rate 8, resize 1440 then click, 4 repeats x 2 themes: 8/8 passed.
- rate 20, plus a deliberately racing, un-awaited resize (1100 then 1440) while clicking, 3 repeats
  x 2 themes: 6/6 passed.
Playwright's own click actionability (stable for two frames) absorbed the reflow in every local
attempt, so I have no red run for the misclick and make no claim of one. The wait is justified by the
CI error-context snapshot, not by a local reproduction.

## GREEN
Real spec, `nice -n 19`, `--workers=2 --repeat-each=4` (both themes): 8 passed (42.1s).
lint, typecheck, format:check pass.
