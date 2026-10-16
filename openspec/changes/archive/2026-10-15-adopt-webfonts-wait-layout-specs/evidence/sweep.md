# HEL-1613 sweep: e2e specs that assert pixel geometry or overflow

## Exact command, v2 (also saved as `sweep-command.sh`; full output in `sweep-hits.txt`: 218 hit lines, 41 files, run on HEAD 792a90769)

v2 (cycle 2, evaluation-1 CR1) adds the non-DOM text-measurement terms `getBoundingRect|measureText|getTextRect|getBBox|getComputedTextLength|createRange`.
The only new FILE is `hel1512-category-axis-labels.spec.ts` (`getTextRect`, `getBBox`, `getComputedTextLength`, `createRange`: 0 hits). `sweep-hits-v1-dom-only.txt` is the original 210-line DOM-only list (pre-change tree), kept for the record; line numbers in the v1 list for hel1444 and webFonts.ts predate this change's edits.

```bash
grep -rnE 'boundingBox|getBoundingClientRect|scrollWidth|clientWidth|offsetWidth|overflow|toHaveScreenshot|toBeInViewport|scrollHeight|clientHeight|offsetHeight|elementFromPoint|getClientRects|offsetTop|scrollTop|getBoundingRect|measureText|getTextRect|getBBox|getComputedTextLength|createRange' e2e --include='*.ts' --exclude='zz*'
```

(`--exclude='zz*'` only drops this change's own uncommitted scratch probes.) Run on the pre-change tree for the
specs; the two files this change edits are classified on the pre-change tree too.

## How each file was classified (D2/D3)

* ASSERTS-GEOMETRY: an `expect` depends on a px measurement, overflow, or an element-at-point result.
* POSITION-ONLY: the box only aims a pointer / drag, or is logged; no assertion on the number.
* A conversion needs a forced-delay RED (D3). Four forced-state runs over every non-quarantined hit spec
  (`scratch/sweepfiles.txt.txt`, 31 files, run on the unmodified specs via a Playwright preload, see `scratch/`):
  * `forced-sweep-css-block.log` FALLBACK-ONLY (stylesheet aborted for the whole test): 205 passed, 16 failed.
  * `forced-sweep-late-1500.log` LATE SWAP (stylesheet and every font response delayed 1.5 s): 220 passed, 1 failed.
  * `forced-sweep-fontfirst-n1.log` FIRST MEASUREMENT IN FALLBACK (stylesheet withheld until the spec's first geometry
    measurement, then re-attached and settled before the next one; 128 releases logged, so not vacuous): 163 passed
    (hel1444/1574/1605/1562 excluded from this run: see below).
  * Held-response probes of hel1510 and hel813 surface 7 (`probe-*.log`, section "Probes" in `probes.md`).

## Per file

| file (lines relied on) | class | result |
| --- | --- | --- |
| hel1444-footnoted-chart-canvas.spec.ts (219-255 `measure`, 404, 463-466; 598, 651, 697) | ASSERTS-GEOMETRY | **CONVERT, main test (:381 x4).** Fallback-only: the stacked control bar is 58px vs the 57px (+0.5) it must not exceed, for bar-two-w2/w4 and bar-range-w2/w4 at 1504 and 1900, light and dark (`forced-sweep-css-block.log`; `redgreen-hel1444-base-RED.log`: 4 failed). Late-swap, first-measurement and every other test in the file (:568 D2 keying, :631 typing, :676 phone stack) stay green: font-insensitive, unchanged. |
| hel813-mobile-touch-target-floor.spec.ts + support/touchTargetProbe.ts (spec 205; probe 78-268) | ASSERTS-GEOMETRY (44px floors, hit-extent bisect) | **REFUTED for fonts, unchanged.** Surface 7 / 430 + 768: heights are fixed (CTA 44, dialog buttons 32, row trigger 28, toolbar 32), only widths move (78.38 to 80, 129.91 to 128, 131.91 CTA) and all stay far above the floor; green in every held/released state, see `probes.md`. Green in all four sweep runs. |
| hel1510-output-editor-table-overflow.spec.ts (53-122) | ASSERTS-GEOMETRY | **REFUTED for fonts, unchanged.** See `probes.md`: green in fallback-only, held-forever and release at every point for each family; competing cause measured (modal entrance animation). |
| hel1605-row-delete-confirm.spec.ts, hel1574-shell-rail.spec.ts, support/rowDeleteGesture.ts | ASSERTS-GEOMETRY / POSITION | Already use `waitForWebFonts` through `settledRowTop` (HEL-1606). Helper generalised backward-compatibly; 25 passed after (`row-callers-hel1605-hel1574.log`). Their 11 fallback-only failures are expected: the helper requires the live stylesheet, which that mode removes. |
| hel1512-category-axis-labels.spec.ts (46-109 `axisLabels`: ECharts `getBoundingRect` + canvas `measureText`; asserts at 317 no overlaps, 322-331 `minGap + 0.05 >= 14` (12px font) / `>= 12` (10px)) | ASSERTS-GEOMETRY (canvas label geometry) | **font-insensitive under delay, unchanged.** `hel1512-*.log` (4 tests each, all 4 passed in EVERY state; each log starts with a cwd/HEAD/ports header): baseline; fallback-only; late swap 1500ms; fonts released after the first axis read (fontfirst N=1); MIXED: stylesheet withheld until just before the spec's fixed `waitForTimeout(1500)`, i.e. ECharts laid the charts out in the fallback face and the labels are measured after the web faces applied (E); and the same mixed release holding one family at a time (JetBrains Mono, Schibsted Grotesk, Fraunces; the held family's `@font-face` blocks are removed from the served stylesheet until release). Measured min gaps at 1504 (floor 14, epsilon 0.05): hist10 16.75 baseline / 14.85 fallback-only (the evaluator's value, reproduced) / 16.75 in every other state; hist20 15.75 or 22.75 (varies within identical font states, so ECharts layout, not fonts); hist5 105.3-107; hist12 48.75-51.25; heatX 90.61-91.36. At 375 (floor 12, 10px font) every value is identical in all states (hist10 13.04, hist20 17.2, heatX 14.57). Lowest margin to a floor anywhere: hist10 fallback-only 14.85 vs 14, 0.85px. No state red, so per C3/D3 it is not converted. Margin of 0.85px in the fallback face is recorded as the nearest-to-red value. |
| hel1311-heatmap-histogram-charts.spec.ts (302-312 `poly.getBoundingRect()` of the visualMap colour bar) | ASSERTS-GEOMETRY (legend bar box, not text) | font-insensitive (a colour polygon; green in all earlier sweep runs). |
| hel1562-landing-page.spec.ts (122-125 page overflow `scrollWidth - clientWidth`) | ASSERTS-GEOMETRY | font-insensitive: the overflow tests are green in every state. The one failure in the late and fallback-only runs is `a stale hint bounces once ... :80`, a `waitForURL("/login")` (not geometry) that times out whenever the stylesheet route is intercepted; passes in isolation on base. Follow-up candidate, not a font-measurement defect. |
| hel1398-chart-narrow-footnotes.spec.ts (35-263) | ASSERTS-GEOMETRY (footnote line counts, widths) | font-insensitive (green fallback-only, late, first-measurement). |
| hel1065-pin-toggle-css-fixes.spec.ts (169-177, 197-199, 236-283) | ASSERTS-GEOMETRY (label/icon rects in ONE evaluate, ellipsis, pin button inside `th`) | font-insensitive (green in all runs). |
| hel1307-conditional-formatting.spec.ts (336-337) | ASSERTS-GEOMETRY (`scrollWidth > clientWidth` on a long note) | font-insensitive (long text overflows in both faces). |
| hel1023-breakpoint-layout-derivation.spec.ts (225, 443-450) | ASSERTS-GEOMETRY (grid rects, page `scrollWidth <= innerWidth`) | font-insensitive. |
| hel773-top-anchored-mobile-nav-sheet.spec.ts (72-77, 147-155, 226, 270-319, 470) | ASSERTS-GEOMETRY (sheet/bar rects, element-at-point) | font-insensitive. |
| hel1003-actions-menu-keyboard-reach.spec.ts (96-119) | ASSERTS-GEOMETRY (row widths in ranges) | font-insensitive. |
| hel1275-metric-delta-sparkline.spec.ts (46, 224-226) | ASSERTS-GEOMETRY (sparkline inside card, beside the delta text) | font-insensitive in all runs (three boxes read in one `Promise.all`). |
| hel1306 (484), hel1311 (504, 523), hel1277 (174) | ASSERTS-GEOMETRY (44px control heights) | font-insensitive (heights are CSS min-heights). |
| hel503 (251-253), hel510 (76-77) | ASSERTS-GEOMETRY (x alignment within 1-2px) | font-insensitive. |
| hel1260 (89-147), hel1028 (77, 112-185) | ASSERTS-GEOMETRY (grid item rect before/after) | font-insensitive. |
| hel1331 (178 `toBeInViewport`), hel588 (346) , hel1350 (172) | ASSERTS-GEOMETRY (inside viewport / bounds) | font-insensitive. |
| hel1090 (442-457) | POSITION-ONLY (overflowPx is only logged; `focusedBox.y >= 0`) | n/a |
| hel1230 (83), hel1457 (44, 120), hel572 (173), hel588 (226), hel1311 (102), hel1350 (157, 211), hel1351 (68, 245), hel1392 (195), hel1306 (348), hel1277 (309) | POSITION-ONLY (drag handle / canvas click point; chart height read) | n/a, green in all runs. |
| focus-presence-guard.spec.ts (64, 305), state-surface-contrast-guard.spec.ts (225), support/focusPresenceProbe.ts (56-121) | POSITION-ONLY / filter (rect non-zero, clipping ancestors) | n/a. |
| hel520-focus-presence-guard.regression.spec.ts (294, comment only) | N/A, `testIgnore`d harness | not run. |
| hel716 (quarantined HEL-961), hel909 (HEL-963), hel912 (HEL-992), hel968 (HEL-991) | quarantined in `playwright.config.ts` `testIgnore` | not run, not changed. |
| support/webFonts.ts (56) | the helper itself | generalised (D4). |

Re-run note: the first late-1500 and css-block logs overlapped another lane's run against these servers and were
discarded. Both were re-run in isolation (no other playwright process on 7045/9952; the HEL-1575 lane runs on its own
ports 7007/9914) with the same spec set and injection: late-1500 220 passed / 1 failed (same hel1562 test), css-block
205 passed / 16 failed (same 16 tests). Counts and classification are unchanged. The re-runs were on the converted tree,
so the 4 hel1444 failures in `forced-sweep-css-block.log` are now the converted test's `waitForWebFonts did not settle`
(this mode removes the stylesheet the wait requires); the base-code failure text (bar 58 vs 57.5) is in
`redgreen-hel1444-base-RED.log` and the earlier discarded run showed the same.

Limits of the evidence (stated, not hidden): the sweep runs exercise three end-to-end font states per test, not every
interleaving. A relational assertion that straddles a swap in a state none of the runs produced would not be caught by
the sweep; for hel1510 and hel813 surface 7 the interleavings were exercised directly (probes).

## Base drift after merging origin/main (cycle 3, HEAD 86663f574)

`sweep-hits-v3-merged.txt` is the recorded command re-run on the merged head (248 hit lines, 43 files). Against v2
(218 lines, 41 files) there are exactly two new files; every other file's hit COUNT is unchanged. The merge also
rewrote selectors in about 20 specs (HEL-1579 spine: `showOutputs(page)`, `.spine-row*`, `.step-focused*`), none of
which touch a geometry assertion (diff checked: only locators and `expect(...).toBeVisible/Enabled/HaveText/HaveCount`
changed). `e2e/hel1444-footnoted-chart-canvas.spec.ts` and `e2e/support/webFonts.ts` are byte-identical to the
pre-merge commit 7cb6b72e3 (`git diff` empty), so the hel1444 red/green pair (`redgreen-hel1444-*.log`) still stands.

| new / changed file | class | result |
| --- | --- | --- |
| hel1579-pipeline-spine-layout.spec.ts (29 hits: page `scrollHeight <= innerHeight` :135-169, 381; row/field/chip boxes :141-255; header `scrollWidth - clientWidth`, rects :267-290, 431-455; menu box :479; trunk/branch boxes :336) | ASSERTS-GEOMETRY (page fits without scroll, header keeps one row, no clipping) | **font-insensitive under every forced state; not converted.** 9 tests, run 9 passed in: baseline (`v3-hel1579-A`), fallback-only (B), late swap 1500ms (C), first measurement in fallback then web (D, N=1; 7 releases), and holds of JetBrains Mono and Schibsted Grotesk released after the first measurement (E). The accent-audit test failed once each in N=3 (rerun: 9 passed) and in the Fraunces hold (failed again on rerun); the failure is NOT a measurement: the page shows "Couldn't load this pipeline's steps" because the trace records `429 Too Many Requests` on `/steps`, `/outputs`, `/data-sources`, `/dashboards`. That test walks 10+ spine rows x 4 theme/accent combinations in one user session and trips the per-user `/api` rate limit (120/min) when it runs fast. Unrelated to fonts (it passed in 7 other font states); follow-up candidate for the spec's author. |
| support/accentAudit.ts (131: `getBoundingClientRect` to find visible elements) | POSITION-ONLY / filter | n/a (used by hel1579 and state-surface-contrast-guard). |
| files whose selectors changed in the merge and carry geometry assertions: hel1510, hel1275, hel1277, hel1306, hel1311, hel1331, hel1350, hel1444, state-surface-contrast-guard, hel813 | as classified above | Re-run together on the merged head (71 tests): fallback-only 67 passed / 4 failed (the four hel1444 canvas-floors tests, `waitForWebFonts did not settle`, the expected fallback-only behaviour of the converted test: that mode removes the stylesheet the wait requires); late 1500ms 71 passed; first-measurement-in-fallback 71 passed (63 releases logged). hel1510 now opens the Outputs through `showOutputs` (desktop: spine OUTPUTS section) and is still green in all three. |

Environment note: the shared dev database has migration V136 applied (another lane) but not V135, which the merged
head carries, so the backend refuses to start on it (`Detected resolved migration not applied ... 135`). The merged-head
runs use a dedicated database `helio_hel1613` (`DATABASE_URL` exported to backend start-up and to the e2e user-cleanup),
the same way other lanes use `helio_hel157x`. Every merged-head log header names it.

Full e2e suite on the merged head (`v3-full-suite.log`, header: cwd, HEAD 86663f574, ports 7045/9952, DB helio_hel1613,
loadavg 8.51 at start / 4.65 at end, run under the driver's `flock` with `--workers=2` and `nice -n 19`):
**312 passed, 0 failed, 0 skipped (15.0m)**. The `*.log` files are gitignored; the driver persists them separately.

## Base drift after merging origin/main again (re-gate, HEAD 7e6967545, HEL-1576)

`sweep-hits-v4-merged.txt`: 248 lines, 43 files, per-file counts identical to v3 (line shifts only in hel1230, hel909,
hel1260, hel1457, hel1028; hel1023's `GRID_MARGIN` 18 -> 12 is a grep-invisible change and was included). The 32
geometry files (225 tests) were re-run in fallback-only / late-1500 / first-measurement-in-fallback, and the 10
dashboard-grid/meta-row specs under one-family holds: no font-driven red. Per-spec values, the hel1350 injector-budget
analysis (not a font defect; passes 8/8 with a non-blocking release), and the re-run hel1444 red/green pair (58 vs 57
-> 57) are in `../evaluation-4.md`. Full suite on 7e6967545: 312 passed (`v6-full-suite.log`, load 2.31 at start).
