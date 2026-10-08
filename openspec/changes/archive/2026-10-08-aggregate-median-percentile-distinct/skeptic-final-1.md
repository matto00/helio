## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `5d590c42c94a19e26e6e26c4a5282a0c706f4bc9`. Diff base resolved live with `resolve-review-base.sh`: `e8381591fe52ffed36f846db990a274afc938add`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/aggregate-median-percentile-distinct/HEL-1310`.

### What I verified (with evidence)

**Diff read in full** (`git diff e8381591...HEAD`, backend main and test code, frontend, golden JSON). The change matches design D1–D9:
- `Aggregation.p: Option[Double]`.
- One rule, `aggregationProblem`, is used by `validateRawConfig`, `validateAggregate` and `apply`.
- `percentileOf` implements `percentile_cont`.
- Inference gains the new cases, and `inferAggregate` now lowercases `fn`.
- The prompt fn lists are derived from `SupportedFunctions`.
- `AggregateConfig.tsx` adds the new fns, the hints and the p input.

The other aggregate-fn enumerations I found are out of scope by design: `schemas/**` output `aggregation` enums, and the helio-mcp `MetricAggregationSpec`/pivot-matrix lists. Step config is free JSON, and helio-mcp passes it through to backend validation.

**AC1: correct values, grouped and ungrouped, empty/null handling.**
- Re-ran the backend in a `git archive` export of the reviewed SHA, because the live `sbt run` holds the worktree. Command: `sbt testOnly AggregateStepSpec PipelineAnalyzeServiceSpec AggregateFnDocDriftSpec PatchSetApplyServiceSpec *PipelineProposalServiceValidateSpec *PipelineStepRoutesSpec`. Result: 313 run, 313 succeeded, 0 failed, exit 0.
- Read the new tests. They cover odd and even median, p90 = 9.1, p0 = min, p100 = max, numeric strings with null and non-numeric values, NaN, [Inf, Inf], count_distinct, grouped input, an all-null group, both empty-input branches, and the throw on invalid configs for empty and non-empty input.
- Checked live against the running backend with my own CSV (all-string columns), grouped by team.
  - team a, durations 1..10: med 5.5, p90 9.1, p95 9.55 (h = 8.55).
  - team b, durations 10/20/30/40: med 25, p90 37, p95 38.5 (h = 2.85 gives 30 + 0.85·10).
  - I checked every value by hand.

**AC2: analyze/infer types match apply.**
- Live `GET /analyze` gives outputSchema `med: float`, `p90: float`, `tests: integer`, `P95UP: float`. `P95UP` uses upper-case `PERCENTILE`, which confirms the lowercase fix.
- The parity test iterates `AggregateStep.SupportedFunctions` and has no hand-copied list. Its mutation-red claim is backed by the evaluator's persisted mutation logs. I accepted that, and the code confirms the test structure.

**AC3: selectable in the editor; accepted and rejected by write-path validation.**
- Live REST create:
  - `p` on `count_distinct` gives 422 "'p' is only valid for percentile, not 'count_distinct'".
  - `p = 100.01` gives 422 "must be between 0 and 100".
  - `p: "90"` gives 422 (decode path).
  - A valid 4-aggregation config gives 201.
- Specs I re-ran cover proposal validate and patch-set create and update.
- Jest: `AggregateConfig|PipelineDetailPage`, 8 suites and 216 tests, all passing.

**UI (servers verified as this worktree).**
- Both listeners have their cwd in this worktree: PID 3496167 (vite, port 6742) in `.../HEL-1310/frontend`, and PID 3495352 (java, port 9649) in `.../HEL-1310/backend`. Both started at 11:36, after the commit at 11:33.
- The fn picker lists all 8 fns.
- Choosing `percentile` seeds p = 50, both in the input and in the stored config.
- Clearing p shows the inline error, and the stored config is unchanged.
- `150` shows the error, and the stored p stays 90.
- Switching to `median` removes the input, and the stored row has no `p` key.
- Light and dark parity: the p input and its error use the same `ui-input` and inline-error treatment as the sibling alias/fn/field controls. There is no new CSS, and the shared `TextField` and `InlineError` components are used.
- Console: the only error is the existing `GET .../schedule` 404 for a pipeline with no schedule. This diff does not touch that code.

Screenshots (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.skeptic-hel1310-editor-1.png` (dark, editor)
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.skeptic-hel1310-uppercase-row.png` (dark, PERCENTILE row and the preview values)
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.skeptic-hel1310-p-error-dark.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.skeptic-hel1310-fn-picker-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.skeptic-hel1310-p-error-light.png`

**Ruling (a): count_distinct counts a blank CSV cell `""`. Acceptable, not a defect for this ticket.**
- I confirmed it live: team b returns `tests = 3` for x, y, x and a blank. The CSV path keeps blanks as `""`; there is no blank-to-null conversion in the ingest code I grepped.
- The spec delta says "distinct non-null values". `count` has always counted `""` the same way.
- Making only `count_distinct` treat `""` as null would split the two counting fns on the same field. That would be a new inconsistency, and it is a platform decision about CSV blank semantics, not this ticket's.
- The ticket's motivating case can overcount by one where pandas would not, because pandas reads blanks as NaN. That is real, so I recommend a follow-up below. It does not block shipping.

**Ruling (b): the frontend is case-sensitive about `fn`. Non-blocking.**
- I confirmed it live: a stored `"PERCENTILE"` row renders as `Select…` with no hint and no p input. The backend accepts and computes that row correctly.
- This already happens for every fn: a stored `"SUM"` also renders as `Select…`, because the Select value is matched exactly.
- It does not destroy data. Editing alias or field spreads the row, so `fn` and `p` are kept. Re-picking `percentile` re-seeds p = 50, but only when the user does it.
- Agent prompts list the fns in lowercase.

**Dev-DB residue created by this gate (nothing deleted):**
- users: `7941a4ec-711b-4827-9324-0b481bc3550a` (`skeptic-hel1310-1791485730943@example.test`, tier free)
- user_sessions: `22a5b621-beb4-474b-83ce-ad7da2fbdad4`
- product_events: `7bf92b30-d631-4b28-a613-2622944fc7c6` (`signup_completed`)
- pipeline_run_rate_window: 1 row for that user
- data_sources: `8195c28b-8bff-45cd-a4c0-66a0f69dfc93`. Upload file: `csv/8195c28b-8bff-45cd-a4c0-66a0f69dfc93.csv` in the shared uploads root.
- pipelines: `95d2bca3-7a92-4d6f-ae2a-17bedbbdc612`
- pipeline_roots: `f7150ee7-6cd9-4a53-9e4d-d882fd18a933`
- pipeline_steps: `b2a5b544-cf9f-4b2a-8092-86a9b3a65e60`
- pipeline_runs: `e7d7bc1c-b513-4bf8-8106-4978290e19a5`
- Not created: node_snapshots, outputs, dashboards and api_tokens (0 each).
- The three 422 probes persisted nothing (one step only).
- Browser state:
  - `helio-theme` is restored to `dark`.
  - The browser session now holds my user's cookie.
  - Scratch export: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1310` (outside the repo).

### Verdict: CONFIRM

### Non-blocking notes
1. Follow-up ticket: blank-cell semantics for CSV-sourced string columns in `count` and `count_distinct`, decided together. Options are treating `""` as null at ingest or in the counting fns, or documenting a filter-first recipe. The helio-news "distinct failing tests" case will overstate by 1 when blanks are present.
2. Follow-up: normalize `fn` case in the editor (`AggregateConfig.tsx`). One way is to lowercase it in the Select value, the `FN_HINTS` lookup and the `agg.fn === "percentile"` check. Another is to lowercase `fn` at write time on the backend. This already affects every fn; the new p input just makes it more visible.
3. The p input has no visible label once it holds a value: the placeholder `p (0-100)` disappears, so only `90` shows. This matches the unlabeled alias/fn/field controls in the same row, and the hint above does say "percentile p". A small leading label or an always-visible suffix would read better.
4. `tasks.md` 4.3 is still unticked. The UI evidence is in evaluation-1.md and in this report.
5. Gate-chain note: the evaluator's mtime/ordering claims about the server start time and the commit time were re-derived independently here (process `lstart` against `git log` `%cd`), not taken from the evidence directory.
