## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket ACs addressed explicitly:
  - REST pipeline run via `POST /api/pipelines/:id/run` — implemented (`InProcessPipelineEngine.loadRows`
    new `RestSource` case) and end-to-end verified live (see Phase 3) against a real reachable REST
    endpoint (jsonplaceholder.typicode.com/users): `200 OK`, `Succeeded`, 10 rows written, output
    DataType populated.
  - SQL pipeline run — implemented (`loadRows` new `SqlSource` case via `SqlConnector.fetch`) and
    verified live: output DataType holds `{"one":1,"two":2}` from a real embedded-Postgres query.
  - `previewStep` supports `rest_api`/`sql` base sources — implemented (rejection blocks removed in
    `PipelineRunService.previewStep`) and verified live: added a "Limit rows" step to the REST pipeline
    and used "Preview data" in the UI, which returned real rows, not the old 422.
  - Proposal-apply now completes a real run for a healthy `rest_api`/`sql` source instead of HEL-755's
    "blocked" outcome — `PipelineApplyProposalRollbackSpec.scala`'s two renamed tests assert this
    directly (`resp.run.blocked shouldBe false`, `latestPipelineRun` status `"succeeded"`, output
    DataType populated via `GET /api/types/:id/rows`), and a new test covers a run-time (not
    schema-inference-time) fetch failure still rolling back as an ordinary run failure.
  - Existing `static`/`csv`/`text`/`pdf`/`image` execution unchanged — full backend suite (3319 tests)
    passes with no regressions (see Phase 2).
  - design.md states the chosen approach (in-process reuse of `RestApiConnector.fetch`/`SqlConnector.fetch`,
    D1) and the reasoning (D1-D7) explicitly, including the corrected `jsRowToRow` design (the doc
    itself documents and corrects an earlier flawed draft that would have thrown `ClassCastException` —
    good process hygiene).
- No AC silently reinterpreted.
- All `tasks.md` items ([x]) match the diff exactly — verified line-by-line against
  `InProcessPipelineEngine.scala`, `PipelineRowJson.scala`, `PipelineRunService.scala`, `ApiRoutes.scala`,
  `PipelineProposalService.scala`, and all 5 touched test files.
- No unnecessary scope creep. One notable in-scope correction: `files-modified.md` and the
  `PipelineProposalService.scala` diff disclose that emptying `SparkUnsupportedKinds` alone would have
  silently broken the *unchanged* base-spec requirement ("a schema-fetch failure at inline-source
  creation time must still report a blocked run, not roll back") because both concerns were previously
  gated by the same single condition. The fix (`SparkUnsupportedKinds.contains(kind) ||
  resolved.fetchError.isDefined`) is transparently documented as "a design gap found during
  test-writing," is directly required to keep this change behavior-preserving for that untouched
  requirement, and is covered by both a new rollback test and the existing schema-fetch-failure tests
  (left unchanged, still passing). This is legitimate scope, not creep.
- No regressions to existing behavior — confirmed by the full green backend suite plus explicit
  before/after inspection of every touched file.
- No API/wire-contract changes — confirmed no `schemas/**` files touched, and `proposal.md` explicitly
  states "No wire/API shape changes."
- Planning artifacts (ticket/proposal/design/tasks/spec deltas) accurately reflect the final
  implementation; no drift found.

### Phase 2: Code Review — PASS

**Gates (fresh run, this evaluator's own):** changed files are backend-only (`git diff --name-only
main...HEAD` — no `frontend/**` paths), so per the gate-selection rule only the backend gate applies.
Ran `cd backend && sbt test` fresh in `WORKTREE_PATH` (`EVALUATOR_CLEAN_WORKTREE=false` / `SPEED=default`
per `workflow-state.md`, so no clean-worktree re-run applies):

```
[info] Total number of tests run: 3319
[info] Suites: completed 210, aborted 0
[info] Tests: succeeded 3319, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 197 s
```

Also ran `npm run check:scala-quality` (the mechanical CONTRIBUTING.md check): "clean" (0 hard
violations). All soft file-size warnings on touched files (`PipelineRunRoutesSpec.scala`,
`InProcessPipelineEngineSpec.scala`, `PipelineRunServiceSpec.scala`) pre-date this change — each file
was already over the 250-line soft budget before this diff (confirmed via `git show main:<path> | wc -l`
vs. current), and CONTRIBUTING.md states these warnings are informational-only, not a commit blocker.

**Canonical code-quality compliance:** no inline fully-qualified names introduced (`git diff` grepped
for `com.helio.`/`spray.json.`/`java.util.`/`org.apache.pekko.` outside `import` lines — none found).
Constructor params/imports follow the file's existing top-of-file import convention throughout.

**DRY:** `jsRowToRow` explicitly mirrors `parseStaticRows`'s existing per-field mapping loop rather than
inventing new conversion logic; both new `loadRows` cases reuse the existing `Connector[Config].fetch`
SPI (`RestApiConnector`/`SqlConnector`) already used elsewhere for schema inference/preview — no
duplicated fetch/parsing logic.

**Readable:** `maxRunRows` is a named, documented constant (not a magic number) with rationale relating
it to `staticMaxRows`/`inferSchema`'s sample cap; error-message strings are specific and diagnostic
(e.g. the null-connector guard names the source and explains why).

**Modular:** changes are cleanly scoped per file/responsibility; `InProcessPipelineEngine` gained two
`loadRows` cases rather than a new abstraction, consistent with the file's existing pattern-match
structure.

**Type safety:** no untyped escape hatches (`Any`/`asInstanceOf` etc.) introduced. Nullable
`connector: RestApiConnector = null` constructor defaults are a deliberate, documented, minimal-
blast-radius choice mirroring the file's own pre-existing `binaryRefRepo`/`alertEvaluationService`
convention — not a new pattern.

**Security:** no new input-handling surface — reuses already-hardened connector `fetch` methods.
`SqlSource.config.query`'s DDL/DML guardrail is validated once at source-creation time
(`SqlConnector.checkQuery`); D5 explicitly documents why `loadRows` doesn't re-validate, consistent
with existing precedent (`SourceService.previewSql` doesn't re-check either) — not a new gap.

**Error handling:** every new failure path (`Left(err)` from either connector, `connector == null`)
converts to `Future.failed(new IllegalArgumentException(...))`, matching every other `loadRows` case's
existing convention, so `executeRun`'s generic `Failure(ex)` handling requires no change. No silent
failures found.

**Tests meaningful:** new coverage spans unit level (`InProcessPipelineEngineSpec`: success, connector
failure, null-connector guard, for both source kinds), service level (`PipelineRunServiceSpec`: full
run + previewStep, success and unreachable-source failure, for both kinds), route level
(`PipelineRunRoutesSpec`: same split at the HTTP layer, plus fixture additions matching design.md D7
precisely), and integration level (`PipelineApplyProposalRollbackSpec`: proposal-apply success +
run-time-failure-rollback). These exercise real new code paths and would catch a real regression (e.g.
reverting the `loadRows` cases would fail ~10 new/updated tests, not just this change's own).

**No dead code:** no leftover TODO/FIXME; `SparkUnsupportedKinds` becoming `Set.empty[String]` is kept
(not deleted) with a documented forward-looking rationale (D4) rather than left as inert dead code —
its use sites (`recordUnrunnable`, `PipelineProposalService`'s guard) remain live and correctly gated.

**No over-engineering:** the nullable-default threading (D3) is explicitly chosen over a heavier DI
refactor to minimize blast radius across 8 existing test-construction call sites; `SparkUnsupportedKinds`
is kept rather than deleted specifically to avoid having to rebuild identical machinery later (documented
rejected-alternative reasoning in design.md D4).

**Behavior-preserving where expected:** `static`/`csv`/`text`/`pdf`/`image` `loadRows` cases are
untouched in the diff; the full existing test suite for those kinds continues to pass unmodified.

**Design-standard mechanical rules:** N/A — no `frontend/**` files in this diff.

### Phase 3: UI Review — PASS

Trigger: `backend/src/main/scala/com/helio/api/ApiRoutes.scala` was modified (threads the existing
`connector` instance into `PipelineRunService`'s constructor call) — Phase 3 required per the trigger
list, even though this is a backend-only wiring change with no wire-shape change.

Dev servers: both already healthy at session start; confirmed via `start-servers.sh` (reused, both
`READY`) and `assert-phase.sh servers` → `PASS servers`.

- **Happy path, rest_api (end-to-end, live):** Used the pre-existing `HEL-758 Eval REST Pipeline` /
  `HEL-758 Eval REST Source` (source config points at `jsonplaceholder.typicode.com/users`, a real
  reachable endpoint). Clicked "Run pipeline" in the UI → `POST /api/pipelines/:id/run` returned `200`;
  page reload showed `Rows written: 10`, status `Succeeded`. Confirmed via `GET
  /api/types/:id/rows` that the output DataType holds 10 real rows from the endpoint.
- **Happy path, sql (live):** `HEL-758 Eval SQL Pipeline`'s output DataType (`GET /api/types/:id/rows`)
  holds `{"rowCount":1,"rows":[{"one":1,"two":2}]}` — a real query result, not a stub.
- **previewStep, rest_api (live):** added a "Limit rows" step to the REST pipeline via "+ Add step" →
  "Limit rows", then clicked "Preview data" — the UI rendered a real preview table (schema +10 data
  rows from the live endpoint), not the old `422 "Unsupported source type"` error.
- **Unhappy path:** the REST pipeline's pre-run state (before this evaluation re-ran it) already showed
  a `Failed` status rendered cleanly in the UI (no blank screen, no unhandled exception) from an earlier
  failed attempt — confirms the failure UI path renders gracefully. Backend route-level coverage
  (`PipelineRunRoutesSpec`: "...returns 422 when the rest_api source is unreachable" / "...when the sql
  connection fails") exercises this exhaustively at the API layer.
- **Console errors:** only one console error observed throughout, on every pipeline-detail page load:
  a `404` on `GET /api/pipelines/:id/schedule` — this is pre-existing "no schedule configured" behavior
  unrelated to this change (occurs identically on unrelated pipelines), not a regression.
- **Breakpoints:** 1440 / 1100 / 768 / 375px all screenshotted on the pipeline-detail page — no layout
  breakage, overflow, or clipping at any width (sidebar collapses to a bottom tab bar at 375px as
  expected of the existing responsive shell).
- **Entry points:** verified both `POST /run` (Run pipeline button) and `previewStep` (step "Preview
  data" control) from their actual UI surfaces; proposal-apply's UI-observable behavior is covered by
  the updated integration tests (Phase 1/2) since proposal-apply has no dedicated interactive UI in this
  app beyond the assistant/authoring flow, which this change does not touch.
- **Accessible names / keyboard support:** all interactive elements exercised (Run pipeline, Dry run,
  + Add step, Limit rows menu item, Preview data) have clear accessible text labels; this UI is
  pre-existing and unmodified by this change.

No frontend code was touched by this change; the UI review above exercises the pre-existing frontend
against the newly-enabled backend behavior and finds no regressions or unhandled states.

### Overall: PASS

### Non-blocking Suggestions

- None.
