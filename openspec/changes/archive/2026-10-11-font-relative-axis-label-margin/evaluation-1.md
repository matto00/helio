## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `081b415f19114ea26d9059f71e223c4c369d441c`. Review base (resolved fresh): `2e02b79511fab222ac2bc73a142fc61e0979f192`.
All evaluator evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1512/evidence/` under `eval1-*`. That directory is the durable run directory, outside the worktree.

### Phase 1: Spec Review — PASS

Issues: none.

- AC 7/7 days at 375 on both heatmaps: met. My runs: heatX and heat8X both show Mon..Sun at 375 (10px font, gaps 14.571 and 12.000) and at 1440 (12px font), in light and dark (`eval1-e2e-hel1512-run1..3.txt`).
- AC 10/10 bins at 1440: met in light and dark, min gap 16.75.
- AC font-relative gap floors: the e2e asserts at least 14 px for 12px labels and at least 12 px for 10px labels, with an epsilon of 0.05. It reads the floor from the rendered label font, not the viewport. Every measured gap clears its floor. heat8X at 375 sits exactly on the floor (12.000) and did so in all 3 of my runs and both control runs.
- AC hist20 at 1440 with margin 7.2: it meets the gap with 5 of 20 labels shown. The min gap is 22.75 in light and 15.75 in dark, the same in every run. No escalation is needed (Decision 6), and the result is recorded in `hel1512-measurements.md`.
- AC no regression to HEL-1305 or HEL-1306: all specs pass (see Phase 3). In the unchanged-path snapshot, exactly 4 of 32 keys changed: `heatmap`, `histogram`, `timestamp x: heatmap` and `timestamp x: histogram`. All 4 are category x axes (`eval1-snapshot-changed-keys.txt`). No time-axis or reference-mark entry changed.
- Tasks 1.1–3.5 are all done and match the diff. The spec delta matches the implemented behaviour.
- CONSTRAINTS C1–C5 are honoured:
  - C1 (red first): reproduced independently, see Phase 2.
  - C2: the diff adds no `eslint-disable` and no colour changes.
  - C3: I ran the specs myself.
  - C4: every run registered its own `@example.test` user, confirmed through `currentUserId` → `/api/auth/me`, with ids logged in the transcripts. The run registry was cleaned up afterwards.
  - C5: there is one global factor of 0.6.

### Phase 2: Code Review — FAIL

Gates, run fresh in WORKTREE_PATH:

| Gate | Result | Transcript |
|---|---|---|
| `npm run lint` | exit 0 | `eval1-gates-lint-format.txt` |
| `npm run format:check` | exit 0 | `eval1-gates-lint-format.txt` |
| `npm test` | 568/568 suites, 6209 tests, 19 snapshots pass; helio-mcp 454 pass | `eval1-gates-test-build.txt` |
| `npm run typecheck`, `check:e2e-types` | exit 0 | `eval1-gates-test-build.txt` |
| `npm --prefix frontend run build` | exit 0 | `eval1-gates-test-build.txt` |

Red-first and mutation checks. I used a throwaway detached worktree, now removed; the delivery worktree was not modified.

- **Unit tests against main's source** (main's `buildChartOption.ts`, `heatmapHistogramOptions.ts` and snapshot, with the new test file): 4 of 5 fail, each by an assertion failure, not an import error (`Expected: 0 / Received: undefined`, …) — `eval1-unit-red-main.txt`. The remaining test is the "other chart types untouched" guard, which correctly passes on main.
- **e2e on main.** The browser was served a mutated Vite module through `page.route`: the branch's gated spreads were forced off, which is equivalent to main because they are the only `buildChartOption` change. Result: light-1440 and dark-1440 go red on `10 of 10 bins` (received 5: "10 to 20", "30 to 40", …), and 375 passes, as on main. This matches the executor's `hel1512-e2e-red-main.txt` (`eval1-e2e-mut-main.txt`, harness `eval1-mut/`).
- **Mutation: compact path inherits 7.2.** I dropped the compact `textMargin` recompute.
  - Unit: `compact path recomputes…` goes red (Expected 6, Received 7.2) — `eval1-mutation-A-unit.txt`.
  - e2e: 375 light and dark go red on `heatmap (6 rows) day labels`, with heat8X showing 4 of 7 (Mon, Wed, Fri, Sun) — `eval1-e2e-mut-compactInherits72.txt`.
- **Mutation: no explicit lineHeight.** `categoryLabelLineHeight` returns undefined.
  - Unit: 13 tests go red, including 3 in the new file and the snapshot GUARD entries (`eval1-mutation-B-unit.txt`).
  - e2e: 375 light and dark go red on `heat8Y labels overlap`. All 6 rows are shown with 5 overlapping pairs (`eval1-e2e-mut-noLineHeight.txt`).
  - So the relaxed heat8Y assertion (more than 0 shown, plus no overlap) still detects the lineHeight regression without a CJK font. The overlap probe takes label heights from real canvas text metrics, not from ECharts' under-measured box, which makes it independent of the fix it guards. 1440 does not catch it because all 6 rows fit there; 375 is the detecting width.

Code review findings:

- **Readability (the one blocking finding):** `frontend/src/features/panels/ui/buildChartOption.ts:36-48`. The new `fontSizeOf` helper (lines 42–46) was inserted between `defaultOption`'s explanatory comment (lines 36–41, "`type`/`data` only — no placeholder `name` … Kept type-shaped so `EChartsOption` inference below still holds …") and `defaultOption` itself (line 48). That comment now sits directly on top of `fontSizeOf`'s JSDoc and reads as describing the wrong declaration. See CR1.
- DRY, modularity, types, error handling and security: fine.
  - The helpers live in `heatmapHistogramOptions.ts`.
  - `fontSizeOf` narrows `unknown` with a `typeof` check rather than a cast.
  - No `any`, no dead code, no TODO.
  - The compact override is correctly gated on `showsEveryCategoryLabel` for x and on heatmap for y.
- The tests are meaningful: the mutations above show the unit and e2e tests catch both named regressions.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` on 6944/9851 (`assert-phase servers` PASS) and stopped by exact PID afterwards. No sbt process remains.

- **hel1512 spec:** 4/4 pass (light/dark × 1440/375), run 3 times. Every run gave the same measurements (`eval1-e2e-hel1512-run1..3.txt`).
- **Regression specs:**
  - hel1311: 9/9 (`eval1-e2e-hel1311-heatmap-histogram-charts.txt`)
  - hel1305: 6/6 (`eval1-e2e-hel1305-chart-time-axis.txt`)
  - hel1306: 8/8 (`eval1-e2e-hel1306-chart-reference-lines.txt`)
  - All cover light and dark at 1440 and 375.
- **Extra breakpoints, 1100 desktop and 768 mobile stack:** no overlaps on any axis, and every x gap is at or above its floor (`eval1-e2e-breakpoints-1100-768.txt`).
- **Console:** the only errors and warnings are a pre-login 401 on `/api/auth/me`, ECharts zero-size warnings during mount, and an init-script `localStorage` access error on about:blank. The counts are identical on the main-equivalent run (`eval1-e2e-console-check.txt` and `eval1-e2e-console-check-main.txt`), so none of it comes from this change.
- **Visual check:** screenshots are in `eval1-mut/shots-none/` (unmutated control run). I looked at hist10 at 1440 in light and dark, hist20 dark at 1440, hist10 light at 375, heat dark at 375, and heat8 in light and dark at 375. Shown labels are visibly separated and none run together. Whether the layout is aesthetically right is for the skeptic to judge.
- No interactive elements changed, so accessibility and keyboard checks are N/A.

### Overall: FAIL

### Change Requests

1. `frontend/src/features/panels/ui/buildChartOption.ts:42-46`: move `fontSizeOf` (with its JSDoc) so the `//` comment on lines 36–41 sits directly above `export const defaultOption` again. Either place it below `defaultOption` or `COMPACT_AXIS_LABEL_FONT_SIZE`, or, preferably, move it into `heatmapHistogramOptions.ts` beside `CATEGORY_LABEL_DEFAULT_FONT_SIZE` and import it. The second option also keeps `buildChartOption.ts` from growing further past the ~400-line budget. No behaviour change. Re-run lint and the unit tests.

### Non-blocking Suggestions

- `buildChartOption.ts` grew from 389 to 418 lines, crossing CONTRIBUTING's ~400-line threshold. Per CONTRIBUTING, propose a split in the PR description (moving `fontSizeOf` per CR1 recovers about 6 lines).
- `heatmapHistogramOptions.ts`: the `categoryXLabelMargin` JSDoc ("Vertical component 0: the heatmap row (y) axis stacks its labels, so it gets no margin") mixes two facts. The 0 is the X axis' vertical margin, and the y axis receives no `textMargin` at all. Consider "`[vertical, horizontal]`: only the horizontal gap matters on an x axis".
- `CATEGORY_LABEL_SHOW_ALL` and `CATEGORY_X_LABEL_MARGIN_PER_PX_FONT` are exported but used only inside their module. Consider dropping `export`.
