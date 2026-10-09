## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `b2269d459a511d4cd2b1753baa8843ff01c2d5fb`. Diff base resolved live: `d390a62e65554fab359866bd3c6eae44c00829d0`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC(1), valid chart slots: `buildOutputConfig.ts:215` now writes `{ xAxis: groupBy, yAxis: alias }`. The new test in
  `buildOutputConfig.test.ts` asserts `toEqual({ xAxis: "region", yAxis: "sum_revenue" })`. Against the unfixed
  builder (`{ category, value }`) that assertion fails, so I accept the red-first claim from reading the diff. I did not
  re-run it against the old code.
- AC(2), examples: the dashboard and combined examples now bind output panels by `outputId` only. The combined example
  now carries `aggregation: { agg: "sum" }` on a `metric` Output attached to cast step `s1`. Four new
  `AssistantProposalToolSchemasSpec` tests derive their key sets from `OutputConfigValidation.KnownKeys`, and include a
  non-vacuity check. All four appear by name in my `sbt testFull` log.
- AC(3), tidy-ups: the no-op `doc shouldBe a[String]` is removed and the long chain in `PipelineService.scala:690`
  is split. The ticket's premise validation already found the "both prompts" wording fixed.
- All tasks are marked [x] and match the diff. No scope creep: the one-string PatchSetExample summary fix is
  self-approved in design Planner Notes. The stale "render-only" text in the live `pipeline-output-sheet` spec is
  corrected through the MODIFIED delta, which takes effect at archive. The remodel doc carries dated correction notes
  (D6).
- `CONSTRAINTS: []`: nothing to honor.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: clean (zero warnings)
- `npm run format:check`: all files pass
- `npm run typecheck`: clean
- `npm test`: 481 suites / 5067 tests passed
- `npm --prefix frontend run build`: exit 0
- `cd backend && sbt testFull`: 6413 succeeded, 0 failed, 4 canceled (pre-existing). The HEL-1390 suite ran.
- Also, because an e2e file was added: `npm run check:e2e-types` and `npm run check:e2e-evidence-paths` are clean
  (64 files scanned).
- `npm run check:scala-quality`: passes. File-size warnings are informational only (the schemas file is 542 lines,
  the spec file 373; both were already over budget).

Mechanical rules: no inline FQNs, no `any`, no dead code, no TODO/FIXME. No design-token surface changed (no
CSS/TSX).

Issues: none blocking (see suggestions).

### Phase 3: UI Review — PASS
I confirmed the fix live against the worktree app (DEV_PORT 6822 / BACKEND_PORT 9729; `assert-phase.sh servers` →
PASS):

1. **Committed e2e spec, run by me:** `e2e/hel1390-chart-tail-aggregate-live.spec.ts` passed (7.4s).
   - `POST /api/pipelines/:id/outputs` returned 201.
   - Stored `config.fieldMapping = {"xAxis":"region","yAxis":"sum_amount"}`.
   - The aggregate step persisted.
2. **The gap the executor admitted (it never checked that the chart renders), now closed.** In a separate manual
   flow, as a throwaway user, through the real UI sheet:
   - I picked chart / group-by `region` / value `amount` / Sum and clicked "Add as tail with aggregate".
   - I clicked "Run pipeline". `GET /api/outputs/:id/rows` returned `materialized: true` with rows
     `[{north,4},{west,9},{east,10}]`.
   - I placed the Output on a dashboard. Its live ECharts option had `xAxis.data = ["north","west","east"]` and
     series `sum_amount` = `[4,9,10]`. The canvas is 505x148, and the chart is visibly drawn.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1390/evidence/.concertino/runs/HEL-1390/eval1/tail-chart-renders.png`.
   - No console errors during the flow. The only error in the session was a 404 on `GET /pipelines/:id/schedule`,
     the app's normal "no schedule" response and unrelated to this change.
3. Breakpoints and accessibility: no layout, CSS or component changes. The sheet controls I drove all have
   accessible names (comboboxes "Group by field", "Aggregation value field", "Aggregation function"; button "Add as
   tail with aggregate"). A resize sweep has no surface to exercise here.

Residue: everything was deleted by exact id.
- API deletes, all 204: dashboard `2d2aec4c-…`, pipeline `90ce52bd-…`, source `5bb6c963-…`.
- Users `6755fddf-…` (left by the e2e spec) and `e0feb0e8-…` (mine) were deleted from the DB in one transaction,
  together with the one `pipeline_run_rate_window` row that blocked the delete through a non-cascading FK.
- After that, the DB shows 0 rows for both users, and 0 rows for the e2e spec's pipeline, source and output ids.

### On the committed e2e spec (orchestrator question)
- **Is it CI-gated?** Yes. CI's `e2e` job runs Playwright by glob with `testDir: ./e2e`. The file is not in
  `playwright.config.ts` `testIgnore`, so it runs in CI and passes typecheck and the evidence-path check.
- **Does it belong in the repo?** Yes. Design D3 asked for exactly this seam test. Client and server each passed
  their own tests while disagreeing on the wire, and only a seam test catches that regression class. It follows the
  sibling pattern (`hel1304`, `hel1351`): log every id, delete by exact id in `finally`.
- **Cleanup reliability:**
  - The pipeline and source are deleted reliably (verified as 0 rows after my run).
  - Two weaknesses, both shared with the sibling specs, so I list them as non-blocking: the deletes in `finally`
    never check their status (a failed delete is silent), and the throwaway user is left behind. The API has no
    user-delete endpoint, and the CI DB is ephemeral, so this only leaves residue in the local dev DB.
  - Locally I cleaned the user up by hand.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `e2e/hel1390-chart-tail-aggregate-live.spec.ts`: extend the spec to `POST /api/pipelines/:id/run` and assert that
  `GET /api/outputs/:id/rows` returns `region`/`sum_amount` columns. That makes it prove the stored mapping names
  columns that actually exist at the aggregate node, not just that the server accepted the keys. Also assert the
  `finally` delete statuses (expect 204) so a cleanup failure is visible.
- Same spec: the hedge `Array.isArray(outputs) ? outputs : outputs.items` hides the real response shape. Pin the one
  shape the endpoint returns.
- `PipelineService.scala:694-708`: the `.flatMap { _ =>` body is still indented at the chain's level and closes with
  two `}` in the same column. Indent the body one level so the block structure is readable. This was pre-existing,
  but this line was the tidy-up's target.
- `AssistantProposalToolSchemasSpec`: `out.fields("kind").asInstanceOf[JsString]` would throw a bare
  ClassCastException on a malformed example. A `collect { case JsString(k) => k }` with a `fail(...)` clue would read
  better. Test-only.
