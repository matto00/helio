## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Change request 1 (ACL citation) — corrected and accurate.** design.md Decision 2 now contains
   a "Correction (design-gate round 1, skeptic-design-1.md, change request 1)" block stating
   `runs/:runId` "is **not** a valid ACL precedent," performs "a bare in-memory cache lookup
   (`runService.status(runId)`) with **no pipeline-ownership or sharing check at all**," and that
   `runs/latest` "MUST perform the same `pipelineExistsShared`/`findByIdShared`-style check ...
   and MUST NOT be implemented by extending or reusing `runs/:runId`'s handler code." I re-read
   `PipelineRunStatusRoutes.scala:32-46` fresh (not trusting round 1's citation): the `runs/:runId`
   handler discards `pipelineId` (`val _ = pipelineId`) and calls `runService.status(runId)`
   directly with no `user` argument at all — confirmed no ACL check. `PipelineRunService.scala:786`
   confirms `def status(runId: String): Option[CachedRunStatus]` takes no user param. By contrast
   `run-events` (`PipelineRunStreamRoutes.scala:29`, `pipelineExistsShared`) and `run-history`
   (`PipelineRunHistoryRoutes.scala:21` → `PipelineRunService.scala:808`, `findByIdShared`) both do
   check. `PipelineRunService.scala:916-917` confirms `pipelineExistsShared` itself delegates to
   `findByIdShared`. The correction text matches ground truth exactly.
   - `grep`'d both design.md and tasks.md for every remaining mention of `runs/:runId` /
     `Segment` / "precedent" / "ACL" (see output above) — no stray uncorrected reference to
     `runs/:runId` as a precedent remains anywhere in either file.

2. **Change request 2 (route-matching precedence) — corrected and accurate.** design.md Decision 2
   now has a "Route-matching precedence hazard" block explaining the actual mechanism: "Pekko HTTP
   tries routes in the order they appear inside a `concat(...)`," and instructs the new
   `path("runs" / "latest")` branch MUST be placed before the existing `path("runs" / Segment)`
   branch "in whatever `concat(...)` ultimately serves both (or otherwise structured, e.g. as a
   sibling route mounted earlier in `ApiRoutes.scala` ...)". I independently re-verified this is
   the actual risk: `PipelineRunStatusRoutes.scala:32` uses `path("runs" / Segment) { runId => ...
   get { ... } }`, mounted via `ApiRoutes.scala:941` inside the same outer route list/`concat` as
   `PipelineRunHistoryRoutes` (942) and `PipelineRunStreamRoutes` (943) — confirmed this file
   already uses "outer `concat`" terminology elsewhere (`ApiRoutes.scala` comment at the
   HEL-955/HEL-1136 mount-order notes a few lines above, e.g. line 907-909, 918-920), so the
   precedent for documenting mount-order hazards inline is itself consistent with existing
   practice in this codebase. A GET to `.../runs/latest` would indeed match `Segment` first
   (binding `runId = "latest"`) if the new route is appended after it in the same `concat`,
   falling into `runService.status("latest")` → `None` → 404 — exactly as design.md now states.
   The design's phrasing correctly covers both the "same file, same concat" and "new sibling route
   class mounted earlier" implementation shapes, so it doesn't over-constrain the executor's
   actual code structure while still closing the hazard.

3. **tasks.md task 2.2 carries both corrections through.** Re-read task 2.2 fresh: it explicitly
   states "**Do NOT model this on `runs/:runId`** ... that route has no ownership/sharing check at
   all ... copying it for a pipeline-id-keyed endpoint would leak cross-tenant run data (design-gate
   round 1 change request 1)" and "**Route-matching order:** the new `path("runs" / "latest")`
   branch MUST be placed before `PipelineRunStatusRoutes.scala`'s existing `path("runs" / Segment)`
   wildcard ... or the literal `"latest"` segment will be silently swallowed ... (design-gate round
   1 change request 2 — verify via an actual backend request test, not just a compile check)." Both
   fixes are present and match design.md's wording in substance, not just cross-referenced by
   number.

4. **Nothing else regressed — independently re-verified, not just trusted from round 1:**
   - Decision 4 (cross-instance correctness): confirmed fresh by reading
     `PipelineRunRegistry.scala:88-113` — `subscribe()` creates a brand-new
     `Source.actorRef[...].preMaterialize()` per call with no backlog/replay mechanism; a run's
     terminal outcome only reaches refs present in the `ConcurrentHashMap` at the moment
     `broadcastLocal` runs. This supports Decision 2's premise that reading `pipeline_runs` (a
     shared Postgres table) is correct regardless of originating/serving backend instance.
   - `RunStatusEvent` (`PipelineRunRegistry.scala:23-30`) confirmed to have no `runId` field today
     (`status`, `rowCount`, `errorLog`, `nodeId`, `nodeKind` only) — matches Decision 3's framing of
     the wire-format choice as a real, undecided question for Execution, not an oversight.
   - The spec delta (`openspec/changes/sse-reconnect-missed-run/specs/pipeline-run-sse/spec.md`)
     is unchanged in substance from what round 1 implicitly accepted (it never mentioned
     `runs/:runId` or route ordering at all, so it was not implicated by either change request) and
     remains internally consistent with Decision 2/3's reconciliation behavior.
   - Probe-first plan (Decision 1 / tasks §1), Goals/Non-Goals, Standing Constraints (tasks.md
     C1-C10, matching `workflow-state.md`'s CONSTRAINTS in substance), and the escalate-on-(e)
     branch (task 1.4) are all textually identical to what round 1 reviewed and confirmed sound —
     no drift found.
   - No new placeholders, TODOs, or hand-waving introduced by the revision; both corrections are
     fully specified engineering instructions, not deferred decisions.

### Verdict: CONFIRM

Both change requests from round 1 are addressed accurately and completely, verified against the
actual `PipelineRunStatusRoutes.scala`, `PipelineRunService.scala`, `PipelineRunStreamRoutes.scala`,
`PipelineRunHistoryRoutes.scala`, `PipelineRunRegistry.scala`, and `ApiRoutes.scala` route-mounting
code (not merely the prior report's narrative). The rest of the design (Decisions 1/3/4, probe
plan, scope bounds, standing constraints) is unchanged and remains sound on independent re-read.
Ready to proceed to Execution.

### Non-blocking notes

- Decision 2's "or otherwise structured, e.g. as a sibling route mounted earlier in
  `ApiRoutes.scala`" phrasing leaves the executor a real implementation choice (same-file concat
  reorder vs. new route class) — appropriately left open since either resolves the hazard; the
  design correctly requires verification "via an actual request in a backend test, not just a
  compile check" either way, which is the right level of rigor for a defect class that compiles
  fine and fails only at request-routing time.
