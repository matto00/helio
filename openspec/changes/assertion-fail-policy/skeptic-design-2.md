## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round 1's fix, itself, is sound and non-lossy:**
- Read `proposal.md`: "Modified Capabilities" now lists `pipeline-run-execution`, `pipeline-run-sse`,
  and `alert-evaluation-engine` with a one-paragraph justification for each, replacing round 1's
  incorrect "(none)".
- Read `design.md`'s new Decision 7 — accurately summarizes why each of the three capabilities needed a
  delta, correctly flags `alert-evaluation-engine` as the debatable case (matching round 1's Change
  Request #3's framing), and resolves it by extending the requirement text rather than leaving it
  implicit.
- Diffed each of the three new `MODIFIED Requirements` delta files
  (`specs/pipeline-run-execution/spec.md`, `specs/pipeline-run-sse/spec.md`,
  `specs/alert-evaluation-engine/spec.md`) line-by-line against the corresponding canonical spec at
  `openspec/specs/<capability>/spec.md` in this worktree. Per the orchestrator's specific ask, I checked
  for lossy/partial copying (openspec's own rule: a `MODIFIED Requirement` must carry the full block from
  `### Requirement:` through every scenario, then be edited) — **all three are complete, non-lossy
  copies**: every pre-existing scenario is present verbatim or minimally edited to note the blocked-run
  exception, and new scenarios are appended, none dropped. Specifically:
  - `pipeline-run-execution`: 3 requirements modified (`POST .../run executes steps...`, `Successful
    non-dry run writes schema snapshot...`, `Non-dry run persists a pipeline_runs record`) — all
    pre-existing scenarios (Run with no steps / multiple steps / invalid step / 404 / 4 schema
    scenarios / 8 persistence+SSE scenarios) present; 3 new scenarios appended for the blocked case.
  - `pipeline-run-sse`: 1 requirement modified (`PipelineRunRegistry publishes status events...`) — all
    5 pre-existing scenarios present; 1 new scenario appended.
  - `alert-evaluation-engine`: 1 requirement modified (`Evaluation never fails the triggering pipeline
    run`) — all 3 pre-existing scenarios present; 1 new scenario appended.
- Cross-checked the new `pipeline-run-execution` claim that a blocked run's HTTP response is still
  `200 OK` with the computed rows against the actual code
  (`backend/src/main/scala/com/helio/services/PipelineRunService.scala:321-332`): `response` is
  constructed from `resultRows`/`jsRows` *before* `onRunSuccess` is invoked, and `followUp.map(_ =>
  Right(response))` returns that fixed value regardless of what `onRunSuccess` does internally —
  confirms the new scenario's claim is accurate, not aspirational.
- Confirmed `onRunSuccess`'s current first line (`publish(pidStr, RunStatusEvent("succeeded", ...))`,
  line 385) is what Decision 3's "branch before any write, `blockingFailures` as the very first line"
  will replace — consistent with the `pipeline-run-sse` delta's modified requirement text.

**The gap that remains — a comprehensive, repo-wide search for the same failure pattern round 1 found:**
Round 1 (correctly) found that two capabilities made *unconditional* "after a successful non-dry run,
the backend SHALL <write X>" claims this design's blocked-run behavior contradicts. Round 2 fixed those
two plus one debatable third. I ran the same check against every other capability spec in
`openspec/specs/` (grepped for `overwriteRows`/`data_type_rows`/`successful non-dry`/`after a
successful`/`completes successfully` across all ~230 spec files, then read each hit in full) to check
whether the round-2 fix's three-capability list was actually exhaustive. It is not — I found two more,
one of them squarely central to the ticket's own AC1.

### Verdict: REFUTE

### Change Requests

1. **`openspec/specs/datatype-row-snapshot/spec.md` needs a MODIFIED delta — this is the missing
   sibling of the already-fixed `pipeline-run-execution` schema requirement, and it governs exactly the
   write path ticket.md's AC1 names.** Its requirement "DataType row snapshot is persisted after a
   successful non-dry run" reads, unconditionally: *"After a successful non-dry pipeline run the backend
   SHALL atomically replace all rows in `data_type_rows` for the output DataType with the new pipeline
   output."* Design.md's Decision 3 skips `rowsUpsert` (`dataTypeRowRepo.overwriteRows` — the exact call
   this requirement governs) together with `schemaUpsert` for a blocked run — the same skip that
   triggered the already-fixed `pipeline-run-execution` "Successful non-dry run writes schema snapshot"
   delta, worded almost identically ("After a successful non-dry run the backend SHALL update the output
   DataType record..."). A blocked run completes execution without exception (i.e. "successful" in
   every sense this spec currently uses the word) yet its rows are explicitly *not* replaced — a direct
   contradiction of this requirement's main scenario ("First run populates snapshot" / the core
   atomic-replace claim), left uncovered by any delta in this change directory. `proposal.md`'s Modified
   Capabilities list needs a 4th entry for `datatype-row-snapshot`, and
   `openspec/changes/assertion-fail-policy/specs/datatype-row-snapshot/spec.md` needs a
   `## MODIFIED Requirements` section — full requirement block copied from the canonical spec, then
   edited to carve out the blocked-run exception (rows are NOT replaced; the prior snapshot remains,
   which is literally ticket.md AC1's own wording: "does NOT overwrite the output DataType rows/schema;
   the prior snapshot is preserved").

2. **`openspec/specs/pipeline-list-api/spec.md`'s "last_run_status is updated to succeeded after a
   successful run" scenario is the same `pipelines.last_run_status` claim already fixed in
   `pipeline-run-execution`, duplicated in a second capability file that was not given a delta.** Its
   requirement "Backend pipelines table exists" states: *"`last_run_status` and `last_run_at` SHALL be
   written ... set to `"succeeded"` ... on success"* with scenario "WHEN a non-dry `POST
   /api/pipelines/:id/run` completes successfully THEN `pipelines.last_run_status` is `"succeeded"`" —
   the identical ambiguity ("completes successfully" = exception-free execution, which is true for a
   blocked run, vs. "ends up `succeeded`", which is false for a blocked run) that motivated the
   already-fixed `pipeline-run-execution` delta for the same column. Required: either fold this into the
   `datatype-row-snapshot`/`pipeline-run-execution` delta pass as a 5th Modified Capability with its own
   `MODIFIED Requirements` section (preferred, for consistency with how the other three were handled), or
   — if the design intends `pipeline-list-api` to be treated as fully subsumed by
   `pipeline-run-execution`'s already-fixed requirement over the same column (a legitimate call, since
   they describe the same field) — say so explicitly in design.md's Decision 7, the way Decision 7
   already explains why `alert-evaluation-engine` was debatable, rather than leaving the second capability
   silently uncovered.

### Non-blocking notes

- The comprehensive spec-grep in this round (searching for `overwriteRows`/`data_type_rows`/`successful
  non-dry`/`after a successful`/`completes successfully` across every capability) did not surface any
  further gaps beyond the two above. In particular, the binary-ref requirements
  (`image-file-connector/spec.md`, `type-registry-content-fields/spec.md`) are already phrased
  conditionally ("whenever it writes ... via `overwriteRows`, also ...", "a pipeline run that replaces a
  DataType's row snapshot ... SHALL call `overwriteForDataType`") — these hold vacuously true for a
  blocked run (no row-snapshot replacement happens, so no binary-ref write is required either), so
  Decision 3's choice to skip `binaryRefsUpsert` alongside `rowsUpsert` is correct and needs no delta of
  its own. `pipeline-last-run-row-count/spec.md` is similarly fine as-is: its "failed non-dry run"
  scenario (`rowCount = NULL`) already matches the blocked-run path exactly, since Decision 1 routes
  blocked runs through the same `"failed"` status/rowCount=None convention.
- Round 1's non-blocking note about the stale Flyway-version guidance in `ticket.md` (V59 vs. actual
  V84+) remains moot under Decision 1 (no migration planned) and is unchanged this round.
