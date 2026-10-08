## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `5d590c42c94a19e26e6e26c4a5282a0c706f4bc9` (HEAD of `feature/aggregate-median-percentile-distinct/HEL-1310`).
Diff base (resolved live via `resolve-review-base.sh`): `e8381591fe52ffed36f846db990a274afc938add`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (correct values, grouped and ungrouped, empty/null handling): `AggregateStepSpec` covers every scenario in the spec delta: odd/even median, p90 = 9.1, p0/p100, numeric strings with null and non-numeric, NaN excluded, [Inf, Inf] stays Inf, count_distinct with 1L/1.0, grouped input, an all-null group, and empty input on both branches. I also checked the grouped values in the running app (Phase 3).
- AC2 (analyze/infer types match apply): `aggResultType` gains the new cases, and `inferAggregate` now lowercases the fn. The parity test iterates `AggregateStep.SupportedFunctions`. I confirmed it fails under mutation myself (Phase 2).
- AC3 (selectable in the editor; accepted by MCP/proposal validation): the editor offers all three functions (checked live). Write-time `validateRawConfig` is tested on REST create and update (`PipelineStepRoutesSpec`), proposal validate (`PipelineProposalServiceValidateSpec`) and patch-set create and update (`PatchSetApplyServiceSpec`). MCP `add_pipeline_step` goes through the same `addStepReporting`/`validateRawConfig` path.
- No AC was reinterpreted. There is no scope creep: Output `aggregation`, the smart shapes and groupby are untouched, as the design says.
- `workflow-state.md` `CONSTRAINTS: []`, so there is nothing to honor beyond the Iron Laws.
- Task 4.3 is still `[ ]` in `tasks.md`. The executor had no browser. The evaluator ran the check at the orchestrator's direction (Phase 3 below) and it passed. Ticking the box is bookkeeping, listed under non-blocking suggestions.

### Phase 2: Code Review — PASS
Issues: none blocking.

I re-ran every gate myself (fresh evidence):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0. `npm --prefix frontend run build`: exit 0.
- `npm test`: the first run had 5 failures in 2 suites (one was `PipelineDetailPage.test.tsx`). That run happened while a full `sbt testFull` compile was running alongside it. The next three runs were all green (475/475 suites, 4970/4970 tests), including two targeted re-runs of `PipelineDetailPage|AggregateConfig`. I attribute the failures to load-induced timing, not this diff. This attribution comes from the re-runs, not from a probe that isolated the cause.
- `sbt testFull`: run in a throwaway detached worktree at the reviewed SHA (`git worktree add --detach`, `backend/.env` copied), because the live `sbt run` dev server occupies the delivery worktree's sbt. Result: 6231 run, 6231 succeeded, 0 failed, exit 0. The new specs appear in the log, including the parity test, `AggregateFnDocDriftSpec`, and the REST/proposal/patch-set write-path tests. The throwaway worktree was removed afterwards (`git worktree list` shows no straggler, and no java process has a cwd in it).
- `npm run check:scala-quality`: clean (no inline FQNs; `scala.util.Try` is imported).

**I checked the parity test's mutation-red claim myself:**
1. Mutation A: removed `count_distinct` from `aggResultType`'s integer case. Running `testOnly com.helio.domain.engine.PipelineAnalyzeServiceSpec` gave 2 FAILED, including `(HEL-1310 parity) *** FAILED *** fn=count_distinct: Some("string") was not equal to Some("integer")`. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.eval-evidence/hel1310-mut1.log`
2. Mutation B: added a new fn `mode` to `SupportedFunctions`, with an apply case returning a Double and no inference case. Only the parity test failed: `fn=mode: Some("string") was not equal to Some("float")`. This shows the test iterates `SupportedFunctions` and has no hand-copied list. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.eval-evidence/hel1310-mut2.log`

Both mutations were reverted in the throwaway worktree before it was removed. The delivery worktree was never modified (`git status` is clean and HEAD is unchanged).

Code checklist:
- One validity rule (`AggregateStep.aggregationProblem`) is shared by write-time `validateRawConfig`, analyze (`validateAggregate`) and `apply` (validated before both branches). DRY is honored, and the "Unsupported aggregation function" literal is kept.
- `percentileOf` matches design Decision 3 (percentile_cont) exactly. `lazy val sorted` avoids sorting for fns that don't need it. `agg.p.get` is safe because validation runs first.
- Frontend: `TextField` and `InlineError` are shared components (DESIGN.md §6 [mechanical]). There is no new CSS and no inline style. The input has an accessible name (`aria-label="Percentile p N"`).
- File sizes: `AggregateStep.scala` is 189 lines. `AggregateConfig.tsx` is 319 lines (over the ~250 soft budget, under the ~400 split threshold). `PipelineAnalyzeService.scala` was already oversized and shrank by 4 lines net.
- Tests are meaningful: invalid configs are rejected on each write path, persistence is checked (`should have size 4`, `listByPipelineInternal ... shouldBe empty`), and the no-`p` round-trip is byte-identical.

### Phase 3: UI Review — PASS
Servers: `start-servers.sh` and `assert-phase.sh servers` both reported `PASS servers`. Following MISTAKES.md, I checked that the reused servers belong to this build. Both listening PIDs (java 3495352 on 9649, vite 3496167 on 6742) have their cwd in this worktree's `backend`/`frontend`, and both started at 11:36:39/11:36:43, after the commit at 11:33:10. A live `POST .../steps` with `percentile` and no `p` returned `422 {"message":"percentile requires 'p' (0-100)"}`, which is new-code behavior.

The browser held another lane's stale session (`eval-hel1179-...`, user `4619b8c1-...`). I did not log that session out. I registered a fresh user, and the new cookie replaced it in this browser only.

Flow, done in the pipeline editor on a real uploaded CSV (all columns inferred as `string`, so the numeric-string path was exercised). Data: team a has durations 1..10 and tests t1..t5 in pairs; team b has 10/20/30/40 and tests x, y, x and a blank cell. Group by `team`:
- The fn picker lists `median`, `percentile` and `count_distinct`, each showing its hint.
- Switching to `percentile` revealed the `Percentile p 2` spinbutton, seeded with `50`.
- Clearing it showed the inline error "Percentile p must be a number between 0 and 100", and the stored config kept `p: 50.0`, so nothing was emitted. Entering `150` (dark theme) and `-1` (light theme) showed the same inline error.
- Switching the row to `median` removed the p input, and the stored config had no `p` key (the server accepted it). Switching back reseeded 50. Entering 90 stored `"p":90`.
- Keyboard: ArrowUp on the focused input emitted and stored 91, and ArrowDown restored 90.
- Run pipeline: "Run status: succeeded — Snapshot replaced: 2 rows". Preview:
  - team a: med 5.5, p90 9.1, tests 5. All correct.
  - team b: med 25, p90 37, tests 3. The median and p90 are correct (p90: h = 2.7, so 30 + 0.7·10). For tests, the blank CSV cell counts as a distinct non-null value (see non-blocking note 3).
- The schema chips showed `med: float`, `p90: float`, `tests: integer`, matching the inferred types.
- Both themes: the p input and inline error use the same `ui-input` and `inline-error` treatment as the neighboring alias/fn/field controls in light and dark. The error is red in both themes, and the focused input shows an accent border.
- Breakpoints 375 / 768 / 1100 / 1440: no document horizontal overflow and no row overflow. The p input spans the row width and is 32px tall.
- Console: the only error from this change's flow was `404 .../schedule`, a GET for a pipeline with no schedule. That code is not touched by this diff. While aliases were empty I also saw repeated "Encountered two children with the same key `added-`". These come from `StepSchemaDiffChips.tsx:29` (`key={\`added-${field.name}\`}`) when several aggregation rows have an empty alias. That code is not touched by this diff and the same thing happens with `sum` rows.

Evidence (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.eval-evidence/hel1310-c1-p-error-theme1.png` (dark, p=150 error)
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.eval-evidence/hel1310-c1-p-error-light.png` (light, p=-1 error)
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.eval-evidence/hel1310-c1-steps-dark.png` (dark, configured step with preview and inferred-type chips)
- `/home/matt/Development/helio/.concertino/runs/HEL-1310/evidence/.eval-evidence/hel1310-c1-steps-light-perror.png` (light, step card)

### Dev-DB residue (all created by this evaluation; nothing deleted)
- users: `c8ec93ab-8d97-4f6d-8795-c328c721b75c` (`eval-hel1310-c1-1791485132522@example.test`, tier free)
- user_sessions: `d79d36be-043e-416b-8c52-8d13451615e5`
- product_events: `13b81226-6bb6-42af-bedc-830ac2c2d9a6` (`signup_completed`)
- pipeline_run_rate_window: 1 row for user `c8ec93ab-8d97-4f6d-8795-c328c721b75c`
- data_sources: `a8a6dea7-4e42-4010-b948-2a395730c2fe` ("HEL-1310 eval CI durations"). The upload file is `csv/a8a6dea7-4e42-4010-b948-2a395730c2fe.csv` in the shared uploads root.
- pipelines: `885ac540-ba31-402a-98c3-81c47b8fa053` ("HEL-1310 eval aggregate")
- pipeline_roots: `3c93ce68-dea0-49c3-9dab-e577335cef83`
- pipeline_steps: `5da87cc4-e8fd-4e8a-acdb-51e35a87fac2`
- pipeline_runs: `88e38fd3-1faa-4a56-a85e-fe79a33b0cb5` (succeeded)
- None of these were created: share links/share_tokens (0), outputs (0), dashboards (0), node_snapshots (0), api_tokens (0). There was nothing to revoke.
- The 422 probe POST created nothing (step count stayed at 1).
- Browser state: `localStorage['helio-theme']` was set to `light` for the check and then restored to its prior value `dark`. The viewport was left at 1440x900.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
1. `tasks.md`: tick 4.3 and cite this report (evaluation-1.md) as the UI evidence and residue record.
2. `frontend/src/features/pipelines/ui/stepConfigs/AggregateConfig.tsx`: `agg.fn === "percentile"` is case-sensitive. A config written by an agent with `"PERCENTILE"` passes the backend (which lowercases) but renders in the editor with no p input and no hint. Consider normalizing `agg.fn.toLowerCase()` for the p-input condition and the `FN_HINTS` lookup.
3. `count_distinct` on CSV sources counts a blank cell as a distinct value: the empty string is non-null, the same convention `count` already uses (team b gave 3, not 2). This matches design D4 and the spec. For the helio-news "distinct failing tests" use case it can overstate by 1, so it may be worth a follow-up ticket on CSV blank-to-null semantics. That would be a cross-cutting change, not this ticket's.
4. The p input's inline error is not linked to the input (`aria-invalid` and `aria-describedby` are missing). This matches the existing ~30 `InlineError variant="text"` call sites, so it is a codebase-wide pattern, not a regression.
5. `percentileOf`: a fractional position between `-Inf` and a finite value (or `+Inf`) gives NaN, which spray-json writes as null. This is the same class of result as an existing `sum` over ±Inf. It could be documented next to the existing [Inf, Inf] comment.
6. `openspec/specs/pipeline-aggregate-op/spec.md` Purpose still says "TBD". Task 5.1 defers updating it to archive, so make sure the archive step actually does it.
