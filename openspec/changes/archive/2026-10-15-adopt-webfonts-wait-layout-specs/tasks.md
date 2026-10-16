## Standing Constraints

- [C1] No retries, no raised test/expect timeouts, no skip/fixme as the fix.
- [C2] Every cited test run shows this worktree's paths and non-zero counts; Playwright <=2 workers, `nice -n 19`; jest <=3 workers.
- [C4] Wait before each measurement step whose element holds newly rendered text, scoped to that element, never inside an assertion retry loop (skeptic-design-1 #1).
- [C5] Forced delay = held font responses released at chosen points, plus fallback-only and per-family mixed states; never a tuned timer alone (skeptic-design-1 #2).
- [C3] A spec is converted only with red-under-forced-delay then green proof (design D3/D5); refuted specs are reported, not changed.

## 1. Probe and sweep

- [x] 1.1 Held-response (release-at-point) probe per design D1 of hel1510 and hel813 surface 7 (768 and 430px) on base: record asserted values and red/green (evidence/probe-*.log); verdict CONFIRMED/REFUTED per spec
- [x] 1.2 Recorded sweep: grep command(s), full hit list, per-file classification ASSERTS-GEOMETRY / POSITION-ONLY / N/A with line numbers (evidence/sweep.md)
- [x] 1.3 Forced-delay run of every ASSERTS-GEOMETRY test from 1.2 on base; mark each red (convert) or font-insensitive (leave) in sweep.md

## 2. Helper and conversions

- [x] 2.1 Generalise waitForWebFonts scope to `closest("tr") ?? target` (D4); confirm row callers unchanged (hel1605/hel1574 still pass)
- [x] 2.2 Adopt the wait in every spec/helper marked convert, before each measurement step with newly rendered text, scoped to the narrowest measured container (D4); update the helper comment
- [x] 2.3 Re-run each converted test under the same forced delay: green (evidence/redgreen-*.log); lint + typecheck pass

## 3. Verification

- [x] 3.1 Full e2e suite on the final head, `--workers=2`, `nice -n 19`; record counts (evidence/full-suite.log)
