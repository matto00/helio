# HEL-1606: Web-font swap reflows overview rows ~100-250ms after first paint (e2e flake risk on row double-click tests)

## Description

Found by the HEL-1605 final-gate skeptic (round 2), measured locally.

### What happens

On a document's first page load, the web fonts (Schibsted Grotesk, JetBrains Mono) arrive about 100-250ms after the
overview rows first paint. Each row on /pipelines and /sources shrinks from 55px to 53px, so a mid-list row (row 15)
moves up about 34px and its Delete button moves right 1-2px. The same shift happens on main (cd64409ad); it is not
caused by HEL-1605.

### Why it matters

- **CI flake risk.** The row double-click e2e tests (`e2e/hel1574-shell-rail.spec.ts` HEL-1604 test at 820/375 and the
  re-enabled 375 test, plus `e2e/hel1605-row-delete-confirm.spec.ts`) wait for the row's top to stop moving, but that
  wait can finish before the font swap. If the swap lands between Playwright computing the double-click point and the
  first press, both presses hit a neighbouring row's actions-cell `TD`. Observed once in 33 local runs during HEL-1605
  delivery; not reproduced in ~100 further gestures. CI runs with `retries: 0`, so expect a low single-digit percent
  failure rate.
- **Real users.** Someone who double-clicks a row Delete within ~0.3s of the first page load can still hit the shift.

### Suggested fix (treat as a claim)

- Tests: once a row is visible, `page.waitForFunction(() => document.fonts.status === "loaded")` in `gotoSettled` /
  `placeBottomNearViewportEdge` (`e2e/support/rowDeleteGesture.ts`) and in the re-enabled 375 test's bare `page.goto`
  (`e2e/hel1574-shell-rail.spec.ts` ~:372). `document.fonts.ready` straight after `goto` does NOT work: it resolves
  before any font load has started. The wait is on fonts, not labels, so it does not conflict with HEL-1605's "must not
  wait for labels to settle" AC.
- Product: preload the two fonts or use metric-matched fallback fonts.

## Acceptance Criteria

- [ ] The row double-click e2e tests wait for web fonts before computing a gesture point, and pass `--repeat-each=30`
  locally with 2 workers.
- [ ] (Optional, product) No row-height change between first paint and font load on /pipelines and /sources.

## Driver additions (run brief, 2026-10-15)

- Verify the mechanism by probe; measure the failure rate before and after under repeats.
- Check whether a shared e2e helper (e2e/support/) should own the wait so other layout-sensitive specs can reuse it.
- Do not add retries or raise timeouts as the fix.
- Test-only; the optional product AC is out of scope for this run (see proposal Non-goals).

Evidence: `.concertino/runs/HEL-1605/evidence/openspec/changes/stabilize-row-delete-confirm/skeptic-final-2.md` and
`skeptic-final-evidence-2/reflow2.log`, `flake-run1.log` (main checkout).

origin_kind: followup
origin_ticket: HEL-1605
