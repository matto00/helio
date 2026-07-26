## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Schema validates real, out-of-band-tool-checked responses (AC1).**
   Started servers (`scripts/concertino/start-servers.sh` — reused an already-healthy
   instance; `assert-phase.sh servers` → `PASS servers`), logged in as `matt@helio.dev`,
   called `GET /api/workspace/context`. Rather than trusting ajv (used by both
   evaluators) or the repo's Scala-side networknt validator, I used a **third,
   independent tool** — Python's `jsonschema` 4.26.0 (`Draft202012Validator`,
   installed fresh into the scratchpad, not present anywhere in the repo) — against
   the raw HTTP response:
   - Baseline live response (34 sources, 90 types, 21 pipelines, 34 dashboards, all
     untagged, no pipeline ever failed analyze): **VALID**.
   - Created a tagged static data source (`POST /api/data-sources`, `tag:
     "skeptic-tag"`) and a tagged pipeline over it (`POST /api/pipelines`, `tag:
     "skeptic-pipe-tag"`) to force the present-branch for `DataSourceEntry.tag`,
     `DataTypeEntry.sourceId`/`.tag` (source-companion type), and
     `PipelineEntry.tag`. Re-fetched `GET /api/workspace/context`: **VALID**, and I
     inspected the raw JSON myself — the tagged source/companion-type/pipeline
     entries carry the expected keys, the 33 untagged sources and 53
     pipeline-output types correctly omit `tag`/`sourceId` entirely (not `null`).
   - **Control**: re-validated the identical live JSON against the pre-fix (cycle-1)
     schema (`git show 9c31b8c3~1:schemas/workspace-context.schema.json`) with the
     same tool: **INVALID, 282 errors**, all `'tag' is a required property` /
     `'sourceId' is a required property` — reproducing exactly the class of failure
     evaluation-1.md and evaluation-2.md both reported. This confirms the fix is
     real, not an artifact of the validation tool the executor/evaluator happened
     to use.
   - Cleaned up the two created resources plus the orphaned pipeline-output
     DataType left behind after pipeline deletion (`DELETE /api/pipelines/:id`,
     `/api/data-sources/:id`, `/api/types/:id`, all `204`); re-fetched afterward —
     still `VALID` (92→90 types after cleanup, 21 pipelines, response still schema-
     conformant).
   - Diffed the schema's `$defs` field lists against `WorkspaceContextProtocol.scala`'s
     case class fields by hand: field-for-field match in both directions (no schema
     field missing a protocol field or vice versa); every `Option[T]` protocol field
     (`tag`, `sourceId`, `validationError`, `lastRunStatus`, `lastRunAt`,
     `lastRunRowCount`, `stepsError`) is absent from every affected `$defs`
     `required` array and present in `properties` as `["T","null"]`, matching
     spray-json's omit-on-`None` behavior exactly.

2. **RLS/ACL scoping is real, read from the actual composed methods, not
   assumed.** `WorkspaceContextService.assemble` (`WorkspaceContextService.scala:44-47`)
   calls `dataSourceService.findAll(user, Page.Default)`,
   `dataTypeRepo.findAll(user.id, Page.Default)`,
   `dashboardService.findAll(user, Page.Default)`, `pipelineService.listSummaries(user)`
   — all four take the caller's identity, and per design.md D1 the service makes no
   direct DB calls of its own, so it inherits whatever owner-scoping those four
   pre-existing, independently-tested methods already provide. Test 4.2 in
   `WorkspaceContextServiceSpec.scala:225-...` creates resources for both `userA` and
   `userB` against a real embedded Postgres and asserts full non-leakage in both
   directions plus correct per-caller `counts` — read the test body, not just its
   name; it is a real DB-backed assertion, not a stub.
   Read `AuthDirectives.scala:133-155` (`confineScopedToken`) directly: for a scoped
   PAT with no session cookie, it resolves the token, then checks
   `extractUnmatchedPath`'s first segment — only `"hooks"` passes; anything else
   (including `"workspace"`) hits `complete(StatusCodes.Forbidden, ...)`. This
   directive wraps the *entire* `pathPrefix("api")` branch split in `ApiRoutes.scala:244`
   (confirmed by reading the surrounding code — it sits between
   `requireCsrfHeader` and the `auth`/`optionalAuthenticate`/`authenticate` three-way
   `concat`), so `/api/workspace/context` is denied before `WorkspaceRoutes` is ever
   reached, independent of the D2 wiring change. `ApiTokenAuthSpec.scala:543-559`
   pins this with a real full-`ApiRoutes`-tree test (`403` for scoped, `200` for
   unscoped) — read the test body directly, confirmed genuine.

3. **`pipelineOutput` classification and per-pipeline analyze-degrade, read from
   the actual service code.** `WorkspaceContextService.scala:129-139`:
   `pipelineOutput = dt.sourceId.isEmpty`, read directly off the domain
   `DataType.sourceId: Option[DataSourceId]`, no wire round-trip (matches design.md
   D7). Confirmed live: a source-companion DataType's JSON entry carries `sourceId`
   + `pipelineOutput: false`; a pipeline-output entry omits `sourceId` entirely and
   has `pipelineOutput: true`.
   `buildPipeline` (`WorkspaceContextService.scala:83-94`) calls
   `pipelineService.analyze(...)`, maps `Right` to a populated `steps` list with
   `stepsError = None`, `Left(err)` to `steps = Vector.empty` +
   `stepsError = Some(err.message)`, and wraps the whole thing in `.recover` for
   unexpected exceptions too — so a per-pipeline failure never propagates to
   `Future.traverse` and fail the whole `assemble` call. Test 4.5
   (`WorkspaceContextServiceSpec.scala`) exercises this via the `private[services]`
   `buildPipeline` seam against a summary whose pipeline was deleted after
   `listSummaries` captured it (a real race, not a mock) — this was run as part of
   the fresh `sbt test` below, not just trusted by name.

4. **D2 route-wiring deviation — traced myself, both directions.** Read
   `WorkspaceRoutes.scala` in full: constructor is now
   `(Option[WorkspaceTeardownService], WorkspaceContextService, AuthenticatedUser)`;
   `path("teardown")` internally folds `workspaceTeardownServiceOpt` to `reject: Route`
   when `None`; `path("context")` is unconditional. `ApiRoutes.scala:212` constructs
   `workspaceContextService` unconditionally from already-unconditional dependencies,
   and line 365 mounts `new WorkspaceRoutes(workspaceTeardownServiceOpt,
   workspaceContextService, authenticatedUser).routes` with no outer `.fold(reject)`
   gate any more (grep confirmed no other reference to the old gate pattern for this
   router). No custom `RejectionHandler` exists anywhere in `ApiRoutes.scala` (grep
   confirmed), so `reject()` resolves via Pekko's default handling — the dedicated
   test at `WorkspaceContextServiceSpec.scala:405-429` builds `new
   WorkspaceRoutes(None, service, userA).routes`, seals it, and asserts `POST
   /workspace/teardown` → `404`, while `GET /workspace/context` on the *same* routes
   instance → `200` — a real, sealed-route assertion, not an inference. Behavior-
   preserving for teardown, additive for context, both confirmed by test and by my
   own reading of the code.

5. **Full gate suite, fresh, my own run (all green):**
   - `sbt test`: **2217/2217 passing** (fresh run, ~88s, from a clean embedded-Postgres
     migration through v74).
   - `npm run lint`: clean (`eslint . --max-warnings=0`).
   - `npm run format:check`: clean.
   - `npm run check:schemas`: `schemas in sync with JsonProtocols (32 checked across
     28 protocol files)`.
   - `npm run check:scala-quality`: clean (74 informational soft-budget warnings,
     none new/blocking — `WorkspaceContextServiceSpec.scala` at 431 lines is flagged
     informationally, consistent with both evaluation reports; script's own
     classification is non-blocking).

6. **No inline fully-qualified names.** Grepped every touched Scala file
   (`WorkspaceContextProtocol.scala`, `WorkspaceContextService.scala`,
   `WorkspaceRoutes.scala`, `ApiRoutes.scala`, `WorkspaceContextServiceSpec.scala`,
   `ApiTokenAuthSpec.scala`) for inline `com.helio.*.Method(` patterns outside
   `import` blocks: none found. Consistent with `check:scala-quality` passing (it
   enforces this mechanically).

7. **Every ticket AC traced to real evidence:**
   - AC1 (200 + schema-valid) — item 1 above, independently re-verified with a
     third tool.
   - AC2 (RLS-scoped, verified by test) — item 2 above.
   - AC3 (`pipelineOutput === sourceId==null`) — item 3 above.
   - AC4 (`steps[].outputColumns` from analyze; per-pipeline degrade) — item 3
     above; test 4.4 (step order) and 4.5 (degrade) both ran green in the fresh
     `sbt test`.
   - AC5 (structural parity documented in schema description) — read
     `schemas/workspace-context.schema.json:5`: documents both deltas from
     `context.ts` (no `pipelineShapes`; full per-step field set) explicitly.
   - AC6 (`sbt test` green) — item 5 above.
   - AC7 (purely additive, no existing wire-shape change) — `git diff main...HEAD
     --stat` shows only new files plus additive changes to `ApiRoutes.scala`,
     `JsonProtocols.scala`, `package.scala`, `WorkspaceRoutes.scala` (constructor
     signature change is internal-only — no other call site outside tests/`ApiRoutes`
     constructs `WorkspaceRoutes` directly, confirmed by the `ResourceTaggingSpec`
     fixture update being the only other caller); no existing endpoint's response
     shape changed.

8. **Git history coherent, tree clean.** `git status --short` → empty. `git log
   main..HEAD` shows a clean, legible progression: planning → cycle-1 execution →
   cycle-1 evaluator FAIL → cycle-2 fix → cycle-2 evaluator PASS → final-gate prep.
   No uncommitted files, no stray artifacts.

### Note on workflow-state.md's out-of-band-message log

Read it. It documents an unverified channel making authority claims the
orchestrator correctly declined per the standing rule that only the permission
system or the user's own direct messages constitute consent. It made no request of
me and required no action here; treated as informational only, per the task brief.

### Verdict: CONFIRM

### Non-blocking notes
- `WorkspaceContextServiceSpec.scala` (431 lines) is past `check:scala-quality`'s
  informational soft-budget (~250 lines/file) — already flagged by both prior
  evaluations as a good future-spinoff candidate (e.g. extract the schema-
  validation harness into a shared test helper). Not blocking.
- The change is complete but not yet archived (`npm run check:openspec` still flags
  it) — expected at this point in the workflow; archiving is a later phase.
- Deleting a pipeline currently leaves its pipeline-output `DataType` orphaned
  (observed directly while cleaning up my own test data: `skeptic-pipe-out`
  persisted with `pipelineOutput: true` after `DELETE /api/pipelines/:id`). This is
  pre-existing behavior unrelated to this ticket's scope (no lifecycle-cascade
  change was requested or made here) — noting only for awareness, not a defect of
  this change.
