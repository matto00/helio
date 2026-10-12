## Standing Constraints

- [C1] Red first: every behaviour change has a test recorded failing before the fix; guards are shown failable by mutation. No new eslint-disable.
- [C2] Contrast and visual state are measured from the running app (computed styles), light and dark, at 1440 and 375; never eyeballed. WCAG 2.5.3: a visible label is contained in the accessible name.
- [C3] Identity: each sub-agent registers its own throwaway @example.test user, records its id up front, verifies via /api/auth/me before any probe, never acts as matt@helio.dev, and deletes dev-DB residue by exact id only.
- [C4] No --no-verify, HUSKY=0 or core.hooksPath override; no pkill/pgrep/killall; no writes under ~, /tmp or the main checkout root (evidence goes to the run evidence dir); quoted heredocs; heavy jobs under nice -n 19; shut down every sbt server started.

## 1. History rows apply conditional formats (item 5)

- [x] 1.1 RED first: add `HistoryRows`/`OutputHistoryModal` tests (table Output with a cell rule and a row rule; row rule + changed-row on the same row; collection Output mapping `value`; metric Output stays unstyled; no-rules render unchanged) and record them failing before the change (verify: jest output saved to evidence)
- [x] 1.2 Add a pure helper mapping collection rules to value-column cell rules, with unit tests (verify: helper tests pass)
- [x] 1.3 Pass the Output's current rules from `OutputHistoryModal` through `HistoryRows` to `TableRenderer.conditionalFormats` per design D1-D4 (verify: 1.1 tests now pass)
- [x] 1.4 Keep the changed-row highlight visible per design D4 (Change-cell class + history-scoped rule, tokens only), proven by a specificity assertion that reads the CSS source (jest maps CSS to styleMock, so no jsdom computed style) recorded failing first; history selector specificity at least (0,2,3) so it survives future pinning; apply the Change-cell class only when the Output has rules so a no-rules Output's DOM is unchanged (design-gate round 3 notes) (verify: assertion passes)

## 2. Metric unit contrast (item 2)

- [x] 2.1 Measure the current light and dark unit AND label contrast in the running app (computed colour vs panel surface) and record it (verify: numbers in evidence) -- done by the evaluator: openspec/changes/archive/2026-10-11-conditional-format-followups/evaluation-1.md, evidence dir eval1-screens
- [x] 2.2 RED first: add a guard test covering both the unit and the label that fails at the 60% light mix (verify: recorded failing run)
- [x] 2.3 Introduce the per-theme mix token and use it in every `.panel-content__metric-unit` and `.panel-content__metric-label` colour rule (verify: guard passes; re-measure unit and label >= 4.5:1 light and dark at 1440 and 375; custom panel text colour still followed)

## 3. One footer save-blocked prop (item 4)

- [x] 3.1 Guard tests (refactor: proven failable by deliberate mutation, mutation run recorded) that Save is disabled for invalid rules, an invalid histogram bin count, and an invalid reference mark via the single prop (verify: mutation run recorded failing)
- [x] 3.2 Fold `saveDisabled` into `saveBlocked` in `OutputEditorFooter` and `OutputEditorSheet` (verify: tests pass, `grep -rn saveDisabled frontend/src` is empty)

## 4. Select invalid visual state (item 6)

- [x] 4.1 RED first: a test asserting the invalid Select trigger rule exists/applies (CSS-rule test in the style of the existing token guards, or computed style) (verify: recorded failing run)
- [x] 4.2 Add `.ui-select__trigger[aria-invalid="true"]` to the invalid selectors in `inputs.css` (verify: test passes; computed border `--app-error` and focused halo `--app-error-surface` in both themes in the running app; valid Select unchanged)

## 5. Verification

- [x] 5.1 Running-app check of the history modal (table and collection Outputs with rules), the metric unit and label, a history row that is both changed and ruled, and an invalid Select in light and dark at 1440 and 375, screenshots in the run evidence dir (verify: screenshots + measured contrast numbers) -- done by the evaluator: openspec/changes/archive/2026-10-11-conditional-format-followups/evaluation-1.md, evidence dir eval1-screens
- [x] 5.2 lint (zero warnings, no new eslint-disable), typecheck, format:check, full jest (verify: all pass)
