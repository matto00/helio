## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established** — read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec
deltas (`specs/pipeline-run-execution/spec.md`, `specs/pipeline-proposal-apply/spec.md`), and the full
`git diff main...HEAD` (22 files, +1498/-140) myself; treated `files-modified.md` and
`evaluation-1.md` as claims, not facts.

- **Backend test suite, re-run fresh, by me, independently** (`cd backend && sbt -Dsbt.color=false
  test`, not reused from the evaluator's report):
  ```
  [info] Run completed in 3 minutes, 15 seconds.
  [info] Total number of tests run: 3319
  [info] Suites: completed 210, aborted 0
  [info] Tests: succeeded 3319, failed 0, canceled 0, ignored 0, pending 0
  [info] All tests passed.
  [success] Total time: 196 s (0:03:16.0)
  EXIT_CODE=0
  ```
  Confirmed the specific new/updated HEL-758 test names actually ran (grepped the log): `completes a
  real run for a healthy rest_api/sql base source`, `fails an ordinary run for an unreachable
  rest_api/sql source`, `previews a step for a healthy rest_api/sql base source`, `POST
  /pipelines/:id/run returns 200 ... rest_api/sql source`, `GET .../preview returns 200 ...`,
  `loadRows: RestSource/SqlSource fetches via the connector ...`. Also independently ran `npm run
  check:scala-quality` myself → `Scala code-quality check: clean (125 soft warning(s))` (0 hard
  violations; all soft file-size warnings are on files unrelated to new logic, pre-existing per the
  file line counts).
- **`git diff` grep for inline FQNs** in the changed Scala files (`com\.helio\.`, `org\.apache\.pekko\.`,
  `spray\.json\.`, `java\.util\.` outside `import` lines) — none found. Confirms the `feedback_no_inline_fqns` house rule held.
- **Traced every AC to real code + re-run evidence**:
  1. REST pipeline run → `InProcessPipelineEngine.scala` new `RestSource` case (via
     `connector.fetch`) + `PipelineRunService.runPipeline`'s rejection removed. Live-verified: I
     independently clicked "Run pipeline" on `HEL-758 Eval REST Pipeline`
     (`/pipelines/c2c4b648-c5e3-48d5-a534-55fa6ce71dc9`, a real `jsonplaceholder.typicode.com/users`
     source) myself — fresh run, not reused evidence — UI showed `Run status: succeeded`, "Snapshot
     replaced: 10 rows", "Last run: 39 seconds ago".
  2. SQL pipeline run → `SqlSource` case (via `SqlConnector.fetch`) + rejection removed. Live-verified:
     I independently clicked "Run pipeline" on `HEL-758 Eval SQL Pipeline`
     (`/pipelines/7dc43485-c453-4ca3-ae2a-f18c9a9b8d1e`) myself — "Snapshot replaced: 1 rows".
  3. `previewStep` for rest_api/sql → rejection block removed in `PipelineRunService.previewStep`.
     Live-verified: expanding the REST pipeline's "Limit rows" step rendered a real preview data grid
     (10 rows of live JSONPlaceholder data, e.g. `Leanne Graham` / `Sincere@april.biz`), not a 422.
  4. Proposal-apply reaches a real completed run for a healthy source, and preserves HEL-755's
     fail-safe blocked-run behavior for a genuinely unreachable/misconfigured source →
     `PipelineApplyProposalRollbackSpec.scala` diff confirmed: the two previously-blocked tests now
     assert `resp.run.blocked shouldBe false` / `"succeeded"`; the two schema-fetch-failure tests
     (lines 125-182) are left unchanged and still assert the blocked outcome; a new test asserts a
     *run-time* (post-schema-inference) fetch failure now rolls back like any other run failure. All
     ran green in my independent `sbt test` run.
  5. `static`/`csv`/`text`/`pdf`/`image` unchanged → diff shows those `loadRows` cases and their test
     files untouched; full suite green.
  6. Chosen approach + reasoning stated in `design.md` → confirmed present (D1-D7), including the
     corrected `jsRowToRow` design and the row-bound/nullable-connector-threading rationale.
- **Design-vs-implementation cross-check, line by line**, for every touched file
  (`InProcessPipelineEngine.scala`, `PipelineRowJson.scala`, `PipelineRunService.scala`,
  `ApiRoutes.scala`, `PipelineProposalService.scala`, and all 5 touched test files) against
  `design.md`'s D1-D7 and `tasks.md`'s items — all `[x]` items match the diff.
- **One real deviation from the plan, verified as correct and necessary, not scope creep**:
  `proposal.md`'s Impact section and `tasks.md` item 3.2 both state "no behavioral code change
  expected" for `PipelineProposalService.scala`. The actual diff adds a real behavioral change: the
  `createPipeline` guard becomes `SparkUnsupportedKinds.contains(resolved.kind) ||
  resolved.fetchError.isDefined` (previously kind-only). I traced why this is necessary: on `main`,
  `SparkUnsupportedKinds` contained `rest_api`/`sql`, so *every* inline rest_api/sql source hit the
  kind-based guard regardless of `fetchError` — connectivity was irrelevant. Emptying
  `SparkUnsupportedKinds` (this ticket's actual, planned change) without the added `fetchError`
  disjunct would have silently sent an inline source whose *schema-fetch already failed at creation
  time* through to `pipelineRunService.submit`, which fails and triggers `rollbackAll` — a regression
  against the ticket's own AC ("[fail-safe] outcome remains correct for genuinely
  unreachable/misconfigured sources ... this ticket does not change that fail-safe path"). Confirmed
  `resolved.fetchError` is *only* ever set by `handleInlineCreated` (the rest_api/sql inline-creation
  path) — never for `static`, never for an existing-`sourceId` reference (grepped all 3
  `ResolvedSource(...)` call sites) — so the new guard is precisely scoped, not overbroad. It is
  disclosed transparently in `files-modified.md` ("fixes a design gap found during test-writing") and
  is directly exercised by a new regression test (`PipelineApplyProposalRollbackSpec`'s "run-time
  fetch fails" case) plus the pre-existing, unmodified schema-fetch-failure tests, all green in my own
  run. `design.md` itself was not updated with a new decision entry for this — a minor documentation
  gap (non-blocking, noted below), not a functional defect.
- **UI / design judgment**: N/A — `git diff main...HEAD --stat -- frontend/` is empty; zero
  `frontend/**` files touched. I still independently started both dev servers
  (`scripts/concertino/start-servers.sh` → both already healthy, reused; `assert-phase.sh servers` →
  `PASS servers`) and drove the pre-existing, unmodified pipeline-detail UI myself against the newly-
  enabled backend behavior (see AC traces above) rather than trusting the evaluator's screenshots.
  Console check: one `404` on `GET /api/pipelines/:id/schedule` on page load — present because "No
  schedule set" is pre-existing, unrelated "no schedule configured" behavior (confirmed by the page
  rendering `Schedule: No schedule set` correctly, not a broken/blank state); not a regression
  introduced by this change (no `frontend/**` or schedule-route code in the diff).
- **Production wiring**: confirmed a single production call site for `new PipelineRunService(...)`
  (`ApiRoutes.scala:206`), correctly threading the pre-existing `connector` instance; confirmed
  `RestApiConnector.scala`/`SqlConnector.scala` are untouched by the diff (matches the stated
  non-goal "no change to connector fetch/auth logic itself").
- **Working tree**: `git status --porcelain` shows only expected process artifacts
  (`workflow-state.md` modified, `evaluation-1.md` untracked) — no stray uncommitted code.

### Verdict: CONFIRM

All six ticket acceptance criteria are traced to real, independently-reproduced evidence (fresh test
run + fresh live UI runs I triggered myself, not reused from the evaluator). The one place the
implementation diverged from what `proposal.md`/`tasks.md` predicted (`PipelineProposalService`'s
guard) is a correct, necessary, narrowly-scoped, and tested fix for a real regression the plan missed
— not scope creep, and transparently disclosed in `files-modified.md`.

### Non-blocking notes

- `design.md` was not updated with a decision entry documenting the `resolved.fetchError.isDefined`
  addition to the `createPipeline` guard (only `files-modified.md`/`evaluation-1.md` mention it). Since
  this change won't be touched again before archive, this is a paper-trail nit, not a functional gap —
  but if this change is ever revisited, a one-line D8 addition to `design.md` would keep the artifact
  accurate.
