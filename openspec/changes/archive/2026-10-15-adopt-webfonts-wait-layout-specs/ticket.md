# HEL-1613: Adopt waitForWebFonts in other layout-measuring e2e specs (hel1510 0.1px card overflow, hel813 Connectors at 768)

## Description

Origin: HEL-1606 (PR matto00/helio#1037, 563a4c476), lane-reported. Label: Follow-up. Priority: Low.

HEL-1606 added `e2e/support/webFonts.ts` `waitForWebFonts(target)`. The app's font stylesheet loads non-blocking (`media="print"`, swapped on load), so until it applies, `document.fonts.status` already reads "loaded" and layout shifts 2-34px when the web fonts land. During HEL-1606's full-suite runs, two unrelated specs failed once each, and both passed 75/75 in isolation:

* `hel1510`: a card overflowed by 0.1px;
* `hel813`: Connectors at 768px.

Both look like layout measured during the font swap.

Do: confirm the mechanism by probe, using HEL-1606's forced-font-delay method. Then adopt `waitForWebFonts` in those specs and in any other spec that asserts pixel geometry or overflow; sweep them with a recorded grep. Show each converted spec red under the forced delay and green after. No retries or raised timeouts.

## Acceptance Criteria

1. The font-swap mechanism for `hel1510` and `hel813` (768px Connectors) is confirmed or refuted by probe, using HEL-1606's forced-font-delay method (archive: `openspec/changes/archive/2026-10-15-wait-webfonts-row-gestures/`).
2. Every e2e spec that asserts pixel geometry or overflow is swept with a recorded grep (command + full hit list + per-spec classification recorded as evidence).
3. Each spec where the font swap can affect the measurement adopts `waitForWebFonts`, and each converted spec is shown red under the forced delay and green after.
4. No retries, no raised timeouts.
5. The FULL e2e suite passes locally on the final head (Playwright at most 2 workers, `nice -n 19`).
