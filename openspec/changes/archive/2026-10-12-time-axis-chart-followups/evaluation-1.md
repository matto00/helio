## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `23c67032274ebca17797467169819e2b81a96462` (e522ef8fd executor + 23c670322 orchestrator AC3/spec
correction) against a live-resolved base, `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`. All gate output from this
review is in `/home/matt/Development/helio/.concertino/runs/HEL-1508/evidence/eval-1/`.

### Phase 1: Spec Review — FAIL

The code is correct against ACs 1-6 and the spec delta. What fails is that the planning artifacts were not
updated after the AC3 correction.

- AC1 (same-instant fallback): PASS. `planTimeAxis` (`frontend/src/utils/chartTimePlan.ts:51-80`) falls back
  only for vertical `bar` with one point per row and a repeated epoch-millis instant. Rows are instant-ordered,
  with unparseable x last. Line, scatter, multi-series, aggregate and horizontal charts are unaffected (the
  GUARD matrix covers all of these). Measured in the running app: 5 bars at distinct x (91/170/248/327/406 px
  at 1440; 39/88/137/186/235 at 375), category axis `['2026-09-01','2026-09-01','2026-09-02','2026-09-04','']`.
- AC2 (omitted-date note): PASS. Shows "1 row…" / "3 rows…" / "1 group…" in the histogram-note slot and
  classes. No note on a category chart or a fallback chart.
- AC3 (gap everywhere): PASS in code. The category and time single-series and auto-detect builders return
  `null`; scatter omits the point. In the running app, hovering the gap x on a single-series line returned an
  empty tooltip in all four theme/width runs. That matches the corrected AC3.
- AC4/AC5: PASS. The spec delta states the cast-to-`timestamp` path, and the x-axis-categories requirement
  cross-references the time-axis and gap requirements. `openspec validate time-axis-chart-followups --type
  change` reports the change as valid.
- AC6: PASS (see Phase 2/3).
- Scope: no creep. Edits are limited to the D1a resolver swap in `buildChartOption.ts`.
- CONSTRAINTS C1-C4 are honoured in the diff:
  - no `eslint-disable`, `any`, `@ts-`, `color-mix` or TODO was added;
  - red-first and GUARD labelling are both present.
- **Issue: planning artifacts contradict the corrected AC3 and spec.** 23c670322 corrected `ticket.md` and the
  spec delta, but not:
  - `design.md:136`: D7(h), "the tooltip `valueFormatter` gives `—` for a single-series gap"
  - `design.md:155`: D8, "Hover a gap and show `—`"
  - `tasks.md:37`: 5.2, "`—` tooltip"
  - the test name at `frontend/src/features/panels/ui/buildChartOption.timeAxis.followups.test.ts:224`, "the
    tooltip shows a single-series gap as an em dash". It describes a user-visible behaviour that the corrected
    spec says does not exist: a single-series gap has no hover target.

  These files are archived as the record of what shipped, so they must not contradict the spec.

### Phase 2: Code Review — PASS

Gates, all run fresh by me in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | root 48 suites / 454 tests; frontend 572 suites / 6839 tests; exit 0 |
| `npm --prefix frontend run build` | exit 0 |

Files: `lint.txt`, `format.txt`, `typecheck.txt`, `jest-full.txt`, `build.txt`.

- **Red on 849dd96c9, independently confirmed.** I ran the four new/changed test files in a throwaway
  worktree detached at 849dd96c9 (`red-on-849dd96c9.txt`): 18 failed, 30 passed. The failures are behavioural:
  - fallback: 5
  - gap/scatter/normalized/tooltip: 9
  - ChartRenderer note: 3
  - the updated `buildChartOption.timeAxis.test.ts` NaN→null pin: 1

  `chartTimePlan.test.ts` fails to compile on base because the module is absent. That is not a behavioural
  red. The plan's own behaviour is shown red by the executor's mutation (i), whose evidence I read. The
  scratch worktree was removed afterwards.
- **GUARD mutation re-run by me, with a different mutation from the executor's two.**
  - Mutation: `buildDataOptionCore` builds a time axis from a line-plan when the plan says
    `category-fallback`. The plan is left untouched, so the oracle line (317) cannot catch it.
  - Result: the GUARD went red on the agreement assertion `hasTimeAxis(option) === (kind === "time")`
    (`chartTimePlan.test.ts:318`) for "bar / repeated / vertical / raw", "bar / repeated+unparseable" and
    "bar / auto-detect" (`mutation-eval-builder-ignores-fallback.txt`). Reverted afterwards.
- **ChartRenderer and buildChartOption cannot disagree.**
  - `ChartRenderer.tsx:93-107` calls `resolveChartPlan` with exactly the seven props it forwards to
    `ChartPanel`. `ChartPanel` → `useChartOption` → `buildChartOption` calls the same resolver with the same
    props, and hands `plan.timePlan` to the data builders. Builders recompute only when called directly with
    no plan.
  - `resolveChartPlan`'s chart type (`resolveChartType(appearance?.chart ?? defaultChartAppearance)`) is
    identical to what `appearanceToEChartsOption` derived before (`chartAppearance.ts:181`).
  - Columns come from the same `resolveDataColumns` the builders use.
  - The RTL test also pins "no note on a fallback bar".
- **Null-reader audit spot check.** `toPercentShares` keeps `null` (`chartTypeOptions.ts:98-101`).
  `chartOverlayOption` aligns by category or instant. `referenceMarksOption` takes its extent from the marks.
  None treats a gap as 0.
- Click selection is unaffected by the fallback reorder: it uses `params.name`, the raw x, not `dataIndex`.
- Type safety, DRY and dead code: clean. The old `timedRows` and the inline time-aggregate parse moved into the
  plan, and each x is parsed once.

### Phase 3: UI Review — PASS

- **Servers.** Started with `start-servers.sh` on 6940/9847 (`PASS servers`). I verified the PIDs were mine by
  age and cwd and stopped them by exact PID (3311063, 3311043, 3309420, 3309110, 3309064). Both ports are free.
- **e2e (my run, `e2e.txt`).** hel1305, hel1306, hel1311, hel1512 and hel1508 specs: **31 passed, 0 failed,
  0 flaky**. Teardown deleted the 31 recorded users.
- **Independent headless check** (`running-app.cjs`, results in `running-app-results.json`, screenshots in
  `screens/`):
  - Throwaway user `hel1508-eval-1791789329403-71121@example.test`, id `a76c2b6a-ff4f-4fdf-a7ec-db6d928dc165`,
    verified via `/api/auth/me` before any probe.
  - Everything was deleted by exact id: dashboard, 2 pipelines and 2 data sources returned 204, and the user
    was removed with the shared exact-id SQL (0 rows left). Two earlier aborted attempts also cleaned up fully
    (`running-app-log.txt`).
  - Results were the same in light and dark at 1440 and 375:

| Chart | What was measured |
| --- | --- |
| Fallback bar | category axis, 5 distinct bars, data `[5,9,null,7,3]`, gap bar has no height, no note |
| Single-series gap line | time axis, `[t,null]` at 2026-09-02, no vertex drawn, hover tooltip empty; note "1 row with no readable date not shown." |
| 240-row time line | truncation note "Based on the first 200 of 240 rows." then "3 rows with no readable date not shown." directly below |
| Plain category bar (string x, numeric y) | category axis, values unchanged, truncation note only, no time note |

  - At 375 both notes fit the 285 px card without overflow (scrollWidth equals clientWidth) and nothing
    overlaps.
  - Console errors: none.
- Accessible names and keyboard behaviour: unchanged. The note is a static `<p>` with a `title`, the same as
  the histogram note.

### Overall: FAIL

### Change Requests

1. `openspec/changes/time-axis-chart-followups/design.md:136`: reword D7(h) to "the tooltip `valueFormatter`
   renders a missing value (`null`) as `—`; this is visible in a multi-series axis tooltip. A single-series
   gap has no hover target (AC3 as corrected)."
2. `openspec/changes/time-axis-chart-followups/design.md:155`: replace "Hover a gap and show `—`" with
   "Hover a single-series gap: no tooltip (no hover target); a multi-series axis tooltip shows `—`".
3. `openspec/changes/time-axis-chart-followups/tasks.md:37`: change 5.2's "`—` tooltip" to "single-series gap
   has no hover target; `—` in multi-series axis tooltips".
4. `frontend/src/features/panels/ui/buildChartOption.timeAxis.followups.test.ts:224`: rename the test so it
   does not claim a single-series tooltip shows `—`, for example "the tooltip formatter renders a null value as
   an em dash". Keep the assertion, which is still a valid formatter-level pin. Optionally move it next to a
   multi-series case.

### Non-blocking Suggestions

- `proposal.md:9`: "Tooltips already show `—` for a missing value". Consider narrowing it to multi-series axis
  tooltips so it matches the corrected AC3.
- `buildChartOption.ts` is 420 lines; it was 412 on base and was already over the ~400 threshold in
  CONTRIBUTING.md. Mention a split in the PR body.
- On the fallback bar, ECharts' automatic category-label interval hides alternate labels: the second
  `2026-09-01` and `2026-09-04` are unlabeled at both 1440 and 375. Every bar is still drawn. This is a visual
  judgment for the skeptic, not a mechanical defect.
- `red-plan-guard.txt` records a missing-module compile failure, not a behavioural red. The plan's behaviour
  is evidenced by mutation (i). Future runs could capture a behavioural red for the plan tests directly.
