## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: f4fe8920 on branch feature/atomic-pipeline-proposal-apply/HEL-383 (backend-only:
new `PipelineProposalService.scala` + `PipelineProposalRoutes.scala`, `ApiRoutes.scala` wiring,
`PipelineProposalApplyResponse` protocol addition, three new ScalaTest spec files).

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly:
  - Atomic create source(if inline)+pipeline+steps+run, returns output DataType id + run summary
    (`PipelineProposalService.apply`/`createPipeline`, `PipelineProposalApplyResponse`).
  - "No partially-created resources on failure" verified by a DB-count-based test in both directions
    (`PipelineApplyProposalRollbackSpec`'s three rollback cases assert `allCounts()` unchanged).
  - Composes existing `SourceService`/`DataSourceService`/`PipelineService`/`PipelineRunService`/
    `DataTypeService` only — verified no `*Repository.insert/delete` calls anywhere in the new service
    except read-only `findByIdOwned`/`findBySourceId`.
  - SQL non-SELECT rejected up front creating nothing (`validateInlineSource`'s `SqlConnector.checkQuery`
    call, live-verified via curl: `DROP TABLE users` → 400 with the guardrail message verbatim, no rows
    created); source-fetch failure returns `BadGateway` with the connector's message, not 500
    (`handleInlineCreated`, live-verified: unreachable REST URL → 502 with
    `"connector: endpoint unreachable"`).
  - Output DataType has `sourceId` unset — verified both by test (`PipelineApplyProposalSpec`'s happy
    path fetches `GET /api/types/:id` and asserts `sourceId` absent) and live curl.
  - `sbt test` green — see Phase 2 (2489/2489 passed, including 13 new tests).
  - Backward-compat: purely additive (new files + one new route registration + one new response case
    class); `git diff --name-only main...HEAD` touches no existing endpoint's behavior.
- [x] No AC silently reinterpreted.
- [x] All `tasks.md` items (1.1–4.10) marked done and match what's implemented — spot-verified 2.1–2.8,
  2.2's exact validation order, 2.3's capture-at-create-time id plumbing, and 2.7's rollback order
  directly against the code; all match.
- [x] No scope creep — diff is exactly the files `proposal.md`'s Impact section and `files-modified.md`
  declare; no MCP/frontend/combined-proposal work leaked in (all explicitly out of scope).
- [x] No regressions — full `sbt test` run (2489 tests) green, no other suite touched or broken.
- [x] API contracts: no new JSON Schema needed (response envelopes generally aren't schema'd in this
  repo — e.g. `DashboardProposalService`'s own `DuplicateDashboardResponse` has no schema file either);
  `npm run check:schemas` passes clean (37 protocol/schema pairs checked, no drift reported for the new
  case class since it isn't tracked, consistent with precedent).
- [x] Planning artifacts reflect the final implemented behavior — `design.md` D1–D7 all directly
  traceable to code (see Phase 2 for the D5 rollback-ordering and D2 inline-source-presence
  verification specifically called out in the task brief).

### Phase 2: Code Review — PASS

**Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE`, backend-only diff):**
- `cd backend && sbt test` → **2489/2489 passed**, 147 suites, 0 failed/canceled (includes the 3 new
  spec files: `PipelineApplyProposalSpecBase`, `PipelineApplyProposalSpec` (9 tests),
  `PipelineApplyProposalRollbackSpec` (4 tests) — reran the two new specs in isolation too, 13/13 green).
- Also ran the repo's other mechanical gates for completeness (not strictly required by the backend-only
  trigger list, but cheap and directly relevant to CONTRIBUTING.md's binding rules):
  - `npm run check:scala-quality` → clean (no inline-FQN violations in any new file; new
    `PipelineProposalService.scala` flagged only as a informational 340-line soft-budget warning, same
    category as 60+ pre-existing files, not a hard failure).
  - `npm run check:schemas` → clean, no drift.
  - `npm run check:openspec` → only flags "complete but not archived," expected pre-archive at cycle 1.

**Design.md D5 (rollback ordering) — verified directly against the code, not just re-read:**
`rollbackAll` in `PipelineProposalService.scala` calls, in order: `pipelineService.delete(pipelineId,
user)` → `dataTypeService.delete(DataTypeId(outputDataTypeId), user)` → `rollbackSourceOnly`, which
itself does `dataSourceService.delete(resolved.id, user)` **then** deletes the captured
`companionDataTypeIds` via `dataTypeService.delete`. This matches D5's required order (pipeline → output
DataType → source → companion DataType) exactly, and independently confirmed the underlying FK facts
the order depends on: `DataTypeService.delete`'s `checkSourceLink` no-ops on `sourceId = None`
(`DataTypeService.scala:127-171`), `DataSourceService.delete` ends in a single
`dataSourceRepo.delete` after best-effort file cleanup (`DataSourceService.scala:499-516`), and
`CreateSourceEnvelope.build`'s `Left` branch (schema-fetch failure) never calls `dataTypeRepo.insert`
(`CreateSourceEnvelope.scala:38-44`) — confirming D4's premise that a fetch-failed source has no
companion DataType to also delete. Companion-id capture-at-create-time (`resolveStaticSource`'s
`dataTypeRepo.findBySourceId` immediately after `createStatic`, `handleInlineCreated`'s
`csr.dataType.map(...)` for `rest_api`/`sql`) is correctly threaded through `ResolvedSource` and never
re-derived post-delete, exactly as D5 requires. `PipelineApplyProposalRollbackSpec`'s static-branch test
(4.10) exercises the one path 4.4 alone couldn't reach, and it passes.

**Design.md D2 (inline-source name/config pre-validation) — the specific round-3/4 skeptic gap —
verified implemented correctly:** `validateInlineSource` checks kind validity, then
`source.name.forall(_.trim.isEmpty)` (correctly rejects both `None` and blank — `Option.forall` on
`None` vacuously returns `true`), then the type-matched config field's presence, all **before** the
`sql` branch inspects `sqlConfig.query` — matching the stated ordering rationale exactly. Both new edge
cases have passing tests (`PipelineApplyProposalSpec`: "reject an inline source missing name" and
"reject an inline sql/rest_api source missing its config"), and live-verified via curl (both-set → 400).

**Other checks:**
- **DRY** — reuses `ProposalPanelSupport`'s established raw-String-until-repo-call pattern for
  body-sourced ids (`resolveExistingSource(sourceId: String, ...)` wraps into `DataSourceId` immediately
  before the repo call, mirroring `ProposalPanelSupport.validateDataTypeBinding`'s `DataTypeId(id)`
  pattern exactly — not a CONTRIBUTING violation; that rule targets path-extracted ids specifically).
  Rollback's discard-the-Either-and-return-the-original-error pattern mirrors
  `DashboardProposalService.createAll`'s own `dashboardService.delete(...).map(_ => Left(err))` verbatim.
- **Readable / Type safety / Security / Error handling** — clear naming, no magic values (guardrail
  messages match the ticket/design verbatim), all inputs validated before any write, `SqlConnector
  .checkQuery` reused unmodified, curated connector error messages passed through unmodified (HEL-311
  convention, cited correctly).
- **Tests meaningful** — happy path (both source branches), full guardrail matrix (7 cases), 3 distinct
  rollback scenarios (run failure, fetch failure, static-branch addStep failure) plus RLS — all asserting
  DB row counts, not just HTTP status; would catch a real regression in any of the rollback paths.
- **No dead code** — no unused imports (spot-checked every import in the new service file against usage;
  compiler also raised zero warnings), no TODO/FIXME.
- **No over-engineering** — service is a thin, direct composition; no premature abstraction.
- **Additive/behavior-preserving** — confirmed via full-suite green run; no existing route or service
  signature changed.

**One documentation-accuracy issue (non-blocking, not a functional defect):**
`backend/src/main/scala/com/helio/api/JsonProtocols.scala:20` still documents `PipelineProposalProtocol`
as `extends DataSourceProtocol with PipelineStepProtocol` in the aggregator's "Inter-trait dependencies"
comment block, but the diff changed the trait itself
(`PipelineProposalProtocol.scala`) to also `extends ... with PipelineProtocol` (needed for
`PipelineSummaryResponse`/`RunResultResponse`). The trait definition itself is correct and compiles;
only the top-of-file doc comment in the aggregator — which every other entry in that list keeps
in sync with a "why" — is now stale. See Non-blocking Suggestions.

### Phase 3: UI Review — N/A

Triggers technically include `ApiRoutes.scala` (changed here), but this ticket is backend-only by
design (ticket's own Out of Scope: MCP tool wiring, combined-proposal, and no frontend consumer is
part of this ticket). Confirmed via `grep -rn "apply-proposal" frontend/src helio-mcp/src` that only the
pre-existing `/api/dashboards/apply-proposal` is referenced anywhere in the frontend or MCP server —
nothing calls `/api/pipelines/apply-proposal` yet, so there is no UI flow to click through.

Ran the canonical setup anyway rather than skip outright:
- `scripts/concertino/start-servers.sh` → `READY backend=... READY frontend=...`
- `scripts/concertino/assert-phase.sh servers ...` → `PASS servers`
- Directly exercised the new endpoint against the live dev backend (login, then
  `POST /api/pipelines/apply-proposal` with session cookie + CSRF header):
  - Inline-static happy path → `201` with `source`/`pipeline`/`outputDataTypeId`/`run` all populated
    as expected.
  - Non-SELECT SQL → `400` with the guardrail message verbatim, nothing created.
  - Both `sourceId` and inline `type` set → `400` with D1's exact message.
- Browser-level check (console errors / breakpoints / accessible names) was skipped: no UI surface
  exists for this endpoint to exercise, and the shared Playwright MCP session was in use by another
  concurrent worktree run at eval time (known parallel-worktree hazard) — not forced, since there was
  nothing UI-side to verify regardless.

### Overall: PASS

### Non-blocking Suggestions

1. `backend/src/main/scala/com/helio/api/JsonProtocols.scala:20` — update the "Inter-trait dependencies"
   doc comment for `PipelineProposalProtocol` to read `extends DataSourceProtocol with
   PipelineStepProtocol with PipelineProtocol (... PipelineProposalApplyResponse uses
   PipelineSummaryResponse/RunResultResponse — HEL-383)`, matching the pattern every other entry in that
   list already follows.
2. `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` is 340 lines, over the
   ~250-line soft budget (informational only, not a gate failure) — a natural future split point is the
   pre-validation section (`validateStructure`/`validateSourceSelector`/`validateInlineSource`/
   `requireConfig`/`validateSteps`/`validateStep`) into its own object, mirroring how
   `ProposalPanelSupport` was already split out of `DashboardProposalService`.
