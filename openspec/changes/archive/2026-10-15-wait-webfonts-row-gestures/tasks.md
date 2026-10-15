## Standing Constraints

- [C1] No retries, no raised test/expect timeouts, no skip/fixme as the fix (driver rule + ticket).
- [C3] waitForWebFonts must close the request-not-yet-started window: it requires the target row's own fonts to be `loaded`/`error` (mandatory, not optional), selects the live stylesheet link (not the <noscript> copy), and the D1 probe logs that case.
- [C2] Every cited test run shows this worktree's paths and non-zero test counts; Playwright <=2 workers, nice -n 19.

### Tests

## 1. Probe and baseline

- [x] 1.1 Write a scratch probe (not committed) logging stylesheet media, document.fonts faces/status and a mid-row rect per frame; run >=20 loads; record whether status==="loaded" is ever vacuous when a row is first visible (evidence: probe log)
- [x] 1.2 Write a forced-delay repro (page.route delaying fonts.gstatic.com) on a fake-clock (installFreshClock) double-click test that fails on base; also probe a stylesheet abort and whether a service worker is active; record the red run (evidence: log)
- [x] 1.3 Baseline: run hel1574-shell-rail + hel1605-row-delete-confirm row double-click tests at --repeat-each=30 --workers=2 on base; record pass/fail counts (evidence: log)

## 2. Helper and adoption

- [x] 2.1 Add e2e/support/webFonts.ts `waitForWebFonts(page)` per design D2/D3/D3a (allow `unloaded`, no `loading`, stylesheet applied, bounded, loud on timeout); verify lint/typecheck pass
- [x] 2.2 Call it from settledRowTop in rowDeleteGesture.ts (not gotoSettled); verify by grep, with line numbers, that every design D4 call site (hel1574 :374, :477+; hel1605 :95/:100, :156/:171, I19 :216-236, I17 :273-307) reaches it before its gesture point
- [x] 2.3 Re-run the forced-delay repro on the fix and show it passes (green after red)

## 3. Verification

- [x] 3.1 After: same --repeat-each=30 --workers=2 runs on the fix; record pass/fail counts next to the baseline
- [x] 3.2 Run the full e2e suite on the final head (workers=2); record counts
