## Evaluation Report — HEL-265 CS2 (Cycle 3) — Pipeline ACL enforcement

Sub-PR 2 of 5. Closes HEL-271 (P0 — pipelines have no ACL). Evaluated against
the orchestrator brief, the design.md Q1/Q4 contracts, and the live two-user
smoke required to certify P0 closure.

### Phase 1: Spec Review — PASS

Issues:

- none

Notes:

- All 24 Cycle 3 task checkboxes in `tasks.md` are ticked and correspond
  one-to-one with code changes.
- Scope discipline is tight: no DataType / DataTypeService / DataTypeRoutes,
  no DashboardRepository / PanelRepository / Dashboard/Panel services or
  routes, and no `requireOwnerOnly` removals. The only authorized CS3 seed
  (`DataSourceRepository.findByIdOwned`) is present and used solely by
  `PipelineRepository.create`.
- The JoinStep `rightDataSourceId` cross-user read is preserved and
  documented in code as a known spinoff (per design.md Q1 §DataSource and
  the executor report). Not absorbed into CS2 — correct.
- Owner read paths preserved: existing `PipelineRoutesSpec` /
  `PipelineRunRoutesSpec` / `PipelineStepRoutesSpec` continue to assert
  owner success without semantic change (now threading `dummyUser`).
- All HEL-271 ACs match the route-level matrix tested in `PipelineAclSpec`
  and the live smoke below.

### Phase 2: Code Review — PASS

Issues:

- none

Layered diff sanity check:

**Repos** — `PipelineRepository`, `PipelineStepRepository`,
`PipelineRunRepository`. Every public read takes `user: AuthenticatedUser`
and emits either `WHERE id = ? AND owner_id = ?` (Pipeline) or a JOIN to
`pipelines.owner_id` (Step / Run). `*Internal` escape hatches exist exactly
where the brief specified: `pipelineRepo.findByIdInternal`,
`pipelineRepo.updateLastRunInternal`, and the five `pipelineRunRepo.*Internal`
variants. `DataSourceRepository.findByIdOwned` is the documented CS3 seed.

**Services** — `PipelineService` and `PipelineRunService` thread `user`
through every public method. The privileged cross-user source lookup in
`PipelineRunService.submit/previewStep` is still `dataSourceRepo.findById`
(unscoped) with an inline rationale referencing design.md Q1 §DataSource —
intentional and consistent with the executor's stated nuance #1.
`requireOwnerOnly` calls are NOT removed (CS5 territory).

**Routes** — All seven `Pipeline*Routes` constructors take
`authenticatedUser`. `ApiRoutes.scala` constructs each within the
`authDirectives.authenticate { authenticatedUser => ... }` scope so the
auth directive runs above each route. `runService.status` remains
user-agnostic (cache-only, runId-keyed); correct per the design.

**Spark driver** — `SparkJobSubmitter` switched to `insertRunInternal`,
`deleteOldRunsInternal`, `updateRunTerminalInternal`, and
`updateLastRunInternal`. The privileged path uses `findByIdInternal` for
the spec readback. The `JoinStep` right-source still calls
`dataSourceRepo.findById` — the documented out-of-scope spinoff.

**Tests** — New `PipelineAclSpec` (386L; under 400 hard cap) seeds two
distinct users in `users`, owns the pipeline by userA, then drives the
entire route surface (`GET /pipelines`, `GET / PATCH / DELETE
/pipelines/:id`, `GET /analyze`, `GET / POST /pipelines/:id/steps`,
`PATCH / DELETE /pipeline-steps/:id`, `POST /pipelines/:id/run`,
`GET /steps/:id/preview`, `GET /run-history`, `GET /run-events` SSE, and
`POST /pipelines` source-binding) for both A and B. Coverage matches the
brief's expected ~14 tests across 9 `should` blocks.

Code-quality checklist:

- CONTRIBUTING.md compliance: no inline FQNs; all `*Internal` variants
  carry single-line scaladoc justifying the privileged use.
- DRY: pipeline-owned predicate factored into
  `PipelineRunRepository.pipelineOwnedAction` and reused across the
  owner-scoped writes; each owner write delegates to its `*Internal` peer.
- Type safety: no `any`; `AuthenticatedUser` is a typed wrapper.
- Error handling: silent no-op on mismatched owner for writes (matches
  nuance #3 in the executor report; route-level `pipelineRepo.findById`
  is the authoritative 404 gate before the write fires).
- No dead code, no leftover TODOs.

File-size check (hard cap 400):

| File | Lines | Status |
|------|-------|--------|
| `PipelineRepository.scala` | 275 | over soft (250), pre-existing trajectory; under hard |
| `PipelineStepRepository.scala` | 175 | under soft |
| `PipelineRunRepository.scala` | 204 | under soft |
| `DataSourceRepository.scala` | 187 | under soft |
| `PipelineService.scala` | 296 | over soft, pre-existing |
| `PipelineRunService.scala` | 340 | over soft, pre-existing |
| `SparkJobSubmitter.scala` | 243 | under soft |
| `PipelineAclSpec.scala` | 386 | over soft, single new test file, justified |
| `PipelineRepositorySpec.scala` | 302 | over soft, pre-existing |
| `PipelineRunRepositorySpec.scala` | 289 | over soft, pre-existing |

No file crossed the 400-line hard cap. The lone new
`check:scala-quality` warning (`PipelineAclSpec`) is acceptable per the
brief and design intent.

Static gates (re-run independently in the worktree):

| Gate | Result |
|------|--------|
| `sbt test` | **650/650 pass**, 40 suites, 0 aborted, 0 canceled, 0 ignored |
| `npm test` | **674/674 pass**, 59 suites |
| `npm run lint` | clean (max-warnings 0) |
| `npm run format:check` | clean |
| `npm run build` | clean |
| `npm run check:schemas` | clean |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean (23 soft warnings; +1 new — `PipelineAclSpec` 386L) |

### Phase 3: UI Review — N/A

No frontend files were modified. CS2 is a pure backend-shape change (route
constructors gain a `user` param, but request/response wire shapes are
identical for owners). Frontend integration of these endpoints is unchanged.

Live API-layer smoke (substituting for browser-driven Phase 3, since the
ticket scope is server-side ACL enforcement):

Setup: backend started on `BACKEND_PORT=8322` from the worktree;
`CORS_ALLOWED_ORIGINS=http://localhost:5415`; `/health` green within ~30s.

Two distinct users created via the live API:
- `matt@helio.dev` (existing dev account, id `9532cfcf-…-00113`)
- `acl-bob@helio.test` (registered fresh via `POST /api/auth/register`,
  id `d2b1540b-…-5a4e`)

Matt seeded `acl-smoke-static` data source and `acl-smoke-pipeline`
(id `75e045f0-…-df668`) with one `rename` step
(id `75c4ec7a-…-9ad1`).

**Cross-user scenarios (Bob's bearer token against Matt's pipeline):**

| # | Endpoint | Expected | Actual |
|---|----------|----------|--------|
| 1 | Matt: `GET /api/pipelines/:id` | 200 | **200** |
| 2 | Bob: `GET /api/pipelines` | `[]` (no Matt rows) | `[]` |
| 3 | Bob: `GET /api/pipelines/:matt-id` | 404 | **404** |
| 4 | Bob: `PATCH /api/pipelines/:matt-id` `{name: hijack}` | 404 | **404** |
| 5 | Bob: `DELETE /api/pipelines/:matt-id` | 404 | **404** |
| 6 | Bob: `POST /api/pipelines/:matt-id/run` | 404 | **404** |
| 7 | Bob: `GET /api/pipelines/:matt-id/steps` | 404 | **404** |
| 8 | Bob: `POST /api/pipelines/:matt-id/steps` | 404 | **404** |
| 9 | Bob: `GET /api/pipelines/:matt-id/run-history` | 404 | **404** |
| 10 | Bob: `GET /api/pipelines/:matt-id/run-events` (SSE) | 404 | **404** |
| 11 | Bob: `PATCH /api/pipeline-steps/:matt-step-id` | 404 | **404** |
| 12 | Bob: `DELETE /api/pipeline-steps/:matt-step-id` | 404 | **404** |
| 13 | Bob: `GET /api/pipelines/:matt-id/analyze` | 404 | **404** |
| 14 | Bob: `GET /api/pipelines/:matt-id/steps/:step/preview` | 404 | **404** |
| 15 | Bob: `POST /api/pipelines` binding Matt's data source | 404 | **404** (`Data source not found`) |

Post-attack inspection: Matt's pipeline name still `acl-smoke-pipeline`
(Bob's PATCH did not land); Matt's pipeline still exists (Bob's DELETE
did not land); Matt's `/steps` list still empty (Bob's `POST /steps` did
not add).

**Owner regression sweep (Matt against his own pipeline, post-Bob):**

| Endpoint | Result |
|----------|--------|
| `PATCH /api/pipelines/:id` `{name: renamed-by-owner}` | 200 |
| `GET /api/pipelines/:id` | 200 + correct name |
| `GET /api/pipelines/:id/steps` | 200 |
| `GET /api/pipelines/:id/run-history` | 200 |
| `POST /api/pipelines/:id/run` | 200 |
| `POST /api/pipelines/:id/run?dry=true` | 200 |
| `GET /api/pipelines/:id/analyze` | 200 |
| `DELETE /api/pipelines/:id` | 204 |

The live `POST /run` succeeded for Matt, exercising the privileged Spark
driver path (`insertRunInternal`, `updateLastRunInternal`,
`updateRunTerminalInternal`) end-to-end. Behavior preservation confirmed.

### Overall: PASS

CS2 closes HEL-271 cleanly. The pipeline surface is owner-scoped at the
repository / SQL layer; cross-user requests return 404 across every
endpoint enumerated in the P0 brief; owner request paths are
behavior-preserving; all 650 backend tests pass (+40 new); all static
gates clean. No scope drift.

### Non-blocking observations / nudges for CS3

1. The `DataSourceRepository.findByIdOwned` seed is in place and ready
   for CS3 to broaden across `DataSourceService` / `SourceService`. The
   existing unscoped `findById` is still consumed by
   `PipelineRunService.submit` / `previewStep` and `SparkJobSubmitter`'s
   `JoinStep`; CS3 should NOT remove the unscoped variant without
   first introducing `findByIdInternal` for those documented callers
   (the rename is on the CS3 task list — just calling out so the executor
   sees the import surface they'll be touching).
2. `PipelineRunService.upsertFieldsFromRows` still calls
   `dataTypeRepo.findById(dataTypeId)` (no user). CS3 will need to keep
   this as `findByIdInternal` per design.md Q1 §DataType. Already in
   that table; flagging so the executor doesn't accidentally route it
   through the new owner-scoped path and break the privileged
   schema-write window.
3. The DataType+DataSource conversion in CS3 will collide with
   `PipelineRepository.create`, which currently calls
   `dataTypeRepo.insert(newDataType)` with `ownerId = user.id` already
   threaded in — that's correctly owner-bound and should not need a
   change in CS3.
4. The owner-scoped write helpers in `PipelineRunRepository` are silent
   no-ops on mismatch (nuance #3 in executor report); this is the right
   resilience policy for the "pipeline deleted mid-run" window, but it
   does mean a misuse from a future caller could silently lose a write.
   The route-level `pipelineRepo.findById(pid, user)` gate in
   `PipelineRunService` is the authoritative 404; CS5's audit pass
   should re-confirm no service method writes to these without first
   gating ownership.
5. Spinoffs still open (re-iterated from cycle 1, NOT regressions):
   cross-user `JoinStep.evaluate` right-source read; pipeline sharing
   (analogous to dashboard sharing); PostgreSQL RLS as
   belt-and-suspenders. All documented; none owed in CS3.

### Recommendation

**Ready to open the PR.** Static gates green, behavior preservation
confirmed for owners, P0 closure verified end-to-end via two-user live
smoke (15/15 scenarios pass). Proceed to CS3 (DataType + DataSource).
