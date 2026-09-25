## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **AC bullet 2 / cross-instance correctness (item 1).** Design Decision 4's reasoning is sound:
   `GET /api/pipelines/:id/runs/latest` would read the durable `pipeline_runs` table via the
   shared Postgres database, not the in-memory `PipelineRunRegistry`/`PipelineRunNotifyBus`, so it
   is correct regardless of which backend instance executed the run or which serves the
   reconnecting client. Confirmed `PipelineRunRegistry.subscribe()` (`PipelineRunRegistry.scala:89-113`)
   creates a brand-new `Source.actorRef` with **no backlog/replay** — `broadcastLocal` only reaches
   refs present in the `ConcurrentHashMap` at the moment `publish` runs — and
   `PipelineRunStreamRoutes.scala:44` calls `registry.subscribe(...)` with no antecedent status
   check. This is a real, structural gap that the reconciliation design closes.

2. **Probe-first requirement (item 2) is real and load-bearing, not decorative.** tasks.md §1
   requires reproducing the failure and capturing `pipeline_runs` row state + the
   `pipeline_auto_run_debounce` `fire_at`/`claimed_at` state (task 1.2) before any fix, and task
   1.4 explicitly branches: if candidate (e) is a legitimate guard policy decision → STOP and
   ESCALATE; if it's a plain bug → proceed to §2 but ALSO add a task to fix that specific bug.
   Design.md's Risks section reiterates: "If probe confirms (e)... will not by itself turn the
   e2e green... do not claim the ticket done on the reconciliation change alone." This correctly
   identifies that candidate (e) (the run never being created — verified plausible via
   `PipelineSchedulerService.processAutoRunClaim`, `PipelineSchedulerService.scala:112-119`, which
   skips firing and just releases the claim when `hasActiveRunInternal` is true) would make the
   SSE-layer fix insufficient on its own. This gates real work, not a checkbox.

3. **Cited source facts — verified against the tree, mostly accurate, one real error found:**
   - `pipelineRunFanout.ts`'s reconnect behavior (D3: reconnects immediately after every terminal
     status, no replay of the prior event) — confirmed, `pipelineRunFanout.ts:159-172`.
   - `PipelineRunRegistry.subscribe`'s lack of replay — confirmed as above.
   - `PipelineRunNotifyBus`'s stale doc comment ("a terminal run status is always still observable
     on next reconnect/poll") being aspirational/unimplemented — confirmed, `PipelineRunNotifyBus.scala:212-213`
     is only a comment; no code path anywhere implements a reconnect/poll reconciliation today.
   - `PipelineRunRepository.listByPipelineInternal` (sorted by `startedAt.desc`) and
     `PipelineRunService.history` (`GET /api/pipelines/:id/run-history`, sharing-aware via
     `findByIdShared`) — confirmed, `PipelineRunRepository.scala:309-315`,
     `PipelineRunService.scala:805-816`.
   - HEL-505 guard defaults (`rateLimitPerWindow=10/60s`, `maxConcurrent=3`) — confirmed,
     `PipelineRunGuardConfig.scala:20-22`.
   - HEL-1093 debounce claim/release always releasing in every branch — confirmed,
     `PipelineSchedulerService.scala:107-119`.
   - Migration ledger: V110 is genuinely the highest (`V110__pipeline_auto_run_debounce.sql`; C3
     accurate).
   - **Error found:** design.md Decision 2 and tasks.md task 2.2 both cite `runs/:runId`
     (`PipelineRunStatusRoutes.scala`) as an existing example of the "sharing-aware — owner/editor/
     viewer grantee → 200, no grant → 404" access-control pattern the new `runs/latest` endpoint
     should mirror. This is **factually wrong**: `PipelineRunStatusRoutes.scala:32-46`'s
     `runs/:runId` handler calls `runService.status(runId)`, which is a bare in-memory
     cache lookup (`PipelineRunService.scala:786-795`) with **zero pipeline-ownership or sharing
     check** — `user` is accepted by the class constructor but never consulted for this route (it
     relies solely on the run id being an unguessable string). `run-events` and `run-history` *do*
     genuinely implement the cited ACL pattern (`pipelineExistsShared`/`findByIdShared`), so the
     normative requirement itself is right — but citing `runs/:runId` as a third precedent for that
     pattern is inaccurate and risks an executor "mirroring" the actual (ACL-less) `runs/:runId`
     code for a new endpoint keyed by pipeline id (not an opaque run id), which would ship a
     cross-tenant authorization gap.

4. **New endpoint access-control conventions (item 4).** Setting aside the citation error above,
   the stated requirement (sharing-aware, 404 for no grant) does match the real, existing
   convention used by `run-events` (`PipelineRunStreamRoutes.scala:29-38`, `pipelineExistsShared`)
   and `run-history` (`PipelineRunService.scala:805-816`, `findByIdShared`). Sound as stated.

5. **Scope bounds (item 5).** `usePipelineRunEvents.ts`'s actual code
   (`usePipelineRunEvents.ts:175-179`) closes and returns on a terminal event with no reconnect —
   confirms the Non-Goal's premise that the reconnect race doesn't obviously apply there, and the
   design correctly defers a final call to Execution rather than assuming. Not adding registry
   replay is reasoned (Decision 2's "alternative considered and rejected" section) rather than
   hand-waved.

6. **Standing Constraints (item 6).** tasks.md's C1-C10 match `workflow-state.md`'s
   `CONSTRAINTS` array verbatim in substance (models/lane/migration ledger/artifact location/
   files-modified/commit timeout/budget escalation/CI-green/owner-ruling discipline/follow-up
   metadata). No drift found.

### New finding not in the review brief — route-matching precedence hazard

`PipelineRunStatusRoutes.scala`'s existing `runs/:runId` route uses
`path("runs" / Segment) { runId => ... }` (line 32), a wildcard matcher. It is mounted in
`ApiRoutes.scala:941`, ahead of `PipelineRunHistoryRoutes` (942) and `PipelineRunStreamRoutes`
(943). Neither design.md nor tasks.md's task 2.2 specifies where the new
`GET /api/pipelines/:id/runs/latest` route is added or in what order relative to this existing
`Segment` wildcard. If the natural implementation appends `path("runs" / "latest")` to the same
`concat(...)` **after** the existing `path("runs" / Segment)` branch (the obvious place to add it,
since that file already owns the `runs/...` sub-tree), Pekko HTTP route matching will never reach
it: `Segment` matches the literal `"latest"` first, binding `runId = "latest"`, and the request
falls into `runService.status("latest")` → `None` → `404 "Run not found: latest"` on every call.
The new endpoint would appear implemented (code compiles, route registered) but be permanently
unreachable — a defect that would likely surface only as an unexplained 404 during Task 3
integration, not caught by unit tests of the isolated repository/service method. This needs an
explicit note in the design/tasks: mount `runs/latest` before the `Segment` matcher in the
`concat`, or otherwise resolve the precedence collision.

### Verdict: REFUTE

### Change Requests

1. **Fix the `runs/:runId` citation (design.md Decision 2, tasks.md task 2.2).** Remove or correct
   the claim that `runs/:runId` already implements the sharing-aware ACL pattern the new
   `runs/latest` endpoint should mirror — verified false (`PipelineRunStatusRoutes.scala:32-46`
   has no ACL check at all). Reword to cite only `run-events`/`run-history` as the actual
   precedent, and add an explicit instruction that `runs/latest` must NOT copy `runs/:runId`'s
   no-authorization pattern, since it is keyed by pipeline id (not an opaque run id) and would
   otherwise leak cross-tenant run status.

2. **Address the route-matching precedence hazard.** Add an explicit note to design.md Decision 2
   / tasks.md task 2.2 that the new `path("runs" / "latest")` route must be matched before the
   existing `path("runs" / Segment)` wildcard in `PipelineRunStatusRoutes.scala`'s `concat(...)`
   (or otherwise structured so the literal segment `"latest"` cannot fall through to the
   `Segment` runId matcher) — otherwise the new endpoint is silently unreachable, always
   returning `404 "Run not found: latest"` via the pre-existing handler.

Both are cheap, specific documentation/implementation-note fixes at this stage; neither requires
rethinking the overall approach (Decisions 1/3/4 and the probe plan are sound and well-grounded).
Once these two revisions are made, I'd expect to CONFIRM on re-review.

### Non-blocking notes

- Decision 3's open choice between wire-format option (i) (add `runId` to `RunStatusEvent`) vs.
  option (ii) (rely on the next reconcile call) is appropriately deferred to Execution with a
  clear recommendation and reasoning — not a placeholder violation.
- Confirmed `RunStatusEvent`/`toSseBytes` currently carries no `runId` field
  (`PipelineRunStreamRoutes.scala:22-31`), consistent with the design's framing of this as a real
  wire-format decision to make during Execution, not an oversight.
