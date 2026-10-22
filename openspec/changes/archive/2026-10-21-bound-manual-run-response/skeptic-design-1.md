## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 77f46a5df981ea34efa10bae0c1fd8a50f1ceb05 (the change dir is untracked planning artifacts only).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/bound-manual-run-response/HEL-1693`.

### What I verified (with evidence)

- **The defect location is real.** `PipelineRunExecutor.scala:315-317` builds `jsRows` from every terminal row,
  `:344` returns `RunResultResponse(jsRows, ...)`. `PipelineRunSubmitRoutes.scala:28-29` completes
  `StatusCodes.OK -> result` through `ServiceResponse.run` (`complete(success(a))`). The response therefore goes
  through the ambient spray marshaller (compact `String`, then a strict UTF-8 entity), as the design says.
- **The surface enumeration is complete.** I grepped every `submit(` caller in `services/` and `api/`:
  - The route (`PipelineRunSubmitRoutes`) returns rows.
  - `PipelineProposalService.scala:535` embeds `run` in `PipelineProposalApplyResponse` (PipelineProposalProtocol.scala:148).
    It reaches HTTP through `PipelineProposalRoutes.scala:39-40` (201), and through `CombinedProposalService` /
    `CombinedProposalRoutes.scala:39-40` (201).
  - Hooks (`HookTriggerService.scala:74-98`) drop rows. So do draft save (`DraftSaveService.scala:152-153`), the
    scheduler (`:237`) and auto-run (`PipelineAutoRunDebounceFirer.scala:121`).
  - `FirstRunDashboardService` calls `apply` but does not put the response on the wire as a run body.

  One more rows-bearing surface exists: `GET /api/pipelines/:id/runs/:runId` (`PipelineRunQueries.scala:71-76`). It is
  populated only by `SparkJobSubmitter.scala:84`, not by the in-process run path. It is outside this ticket, so it is a
  note and not a gap.
- **No response-side middleware defeats streaming.** No `toStrict`, `mapResponse` or `encodeResponse` is applied to
  responses anywhere in `api/`. The only `toStrict` calls act on request bodies or outbound clients. So a chunked
  entity built at the route reaches the wire as chunks.
- **The chunked precedent exists**: `DraftPreviewRoutes.scala:127` (`HttpEntity.Chunked.fromData`).
- **The measurement claim holds.** In `RunPathHeapSpec.scala:93-109` sampling stops in the `finally` right after
  `runner.submit` resolves, so nothing measures the render today. Both reproducers are defined:
  - `fewrows-utf16-200` at `:202`
  - `rowwidth-at-limit` at `:269`, which is 50,000 rows plus one row at `MaxRowRenderChars`.

  The opt-in gates `HELIO_MEASURE`, `HELIO_RUN_HEAP_ONLY` and `HELIO_RUN_HEAP_REPEATS` exist, so D4's plan is
  executable as written.
- **The AC are covered by tasks.**
  - AC1 (red-first measurement, then ≤192 MB): tasks 1.1, 1.2 and 4.3, with an explicit stop-and-escalate in D4 and
    task 1.2 if the red does not reproduce. This is the right premise-drift guard.
  - AC2 (mutation-checked guard): G1, G2 and G3, each with a named mutation.
  - AC3 (consumers unchanged or seam test): byte-identical body by construction, proven by G1 (printer equivalence)
    and G2 (route bytes equal the compact rendering and parse back), and run against e2e and the helio-mcp tests in
    task 4.4.
- **There are no placeholders or TODO/TBD.** The decisions are concrete:
  - piece size about 64 KiB, flushed at value boundaries
  - scalars delegated to spray's `CompactPrinter`
  - explicit marshaller at three named routes
  - statuses kept: 200 for the run, 201 for both apply routes, confirmed in the route files

  The spec delta is consistent with the design.
- **The driver's question (not implementing Fix bullet 1, the row cap) is a sound reading and needs no escalation.**
  - The ticket's Fix bullets are remedies, not AC. The AC require only the ≤192 MB peak, a guard, and unchanged
    consumers or a seam test.
  - The ticket itself offers "Stream the response, or price it" as the mechanism and says "Keep the response contract
    compatible".
  - A cap is the one option that changes what clients receive:
    - `openspec/specs/pipeline-run-execution/spec.md:32` says "all of that root's source rows returned".
    - helio-mcp `apply_*_proposal` returns the body to agents.

    Choosing a cap is exactly the "response-contract change clients would notice" the driver constraints reserve for
    the owner.
  - Choosing the contract-preserving option that meets every AC is not a scope decision that needs a ruling. Taking
    the cap would have been one.
  - The deferral is recorded (proposal Non-goals, D1). It should travel to the PR as a follow-up candidate (see notes).
- **The `Content-Length` to chunked change is transport framing, not a body-contract change.** Body bytes and status
  are identical. axios, fetch (helio-mcp) and httpx all handle chunked. The e2e and MCP suites in 4.4 are the
  empirical check.

### Verdict: CONFIRM

### Non-blocking notes

1. **G3's mutation needs one shared marshaller definition.** D5's G3 mutation ("same route-marshaller revert") only
   turns the heap spec red if `RunPathHeapSpec` gets its marshaller from the same single definition the routes use.
   Two examples: a `RunResponseMarshalling.streaming` value referenced by the routes, or a route-builder hook. A spec
   that picks "streaming vs spray" through its own parameter stays green when a route is reverted.
   - The executor should either make that one definition the mutation point (swap it to the spray default and
     observe red),
   - or state plainly that G3's mutation is "swap the spec's marshaller to the spray default" and that G2 alone
     guards the route wiring.

   Either is fine, but the report must say which one, so the mutation is not claimed for a path it does not exercise.
2. **The design's risk bullet on `jsRows` is inaccurate for dry runs.** It says `jsRows` is "already inside the
   post-walk price", but `refuseOverPostWalkBudget` runs only `if (!isDry)` (`PipelineRunExecutor.scala:259`), so for
   dry runs that is not true. It does not change the plan: dry runs of both reproducers are measured end to end by D4
   and the spec delta. Do not cite the post-walk price as covering the dry-run response tree.
3. **Per-piece sampling could make the measurement slow.** On `fewrows-utf16-200` most cells are about 35k characters,
   so each becomes its own piece, and `usedAfterGc` runs two full GCs plus a 40 ms sleep per sample. That could run
   to thousands of samples per run, times at least 2 repeats, times real and dry. If wall time becomes a problem,
   sampling every k pieces plus the existing 150 ms background sampler is an acceptable fallback, provided it is
   disclosed.
4. **Carry the deferred row cap out of this ticket.** Put it in the PR body as a follow-up candidate needing an owner
   ruling, and file it with the Follow-up label and `relatedTo` HEL-1693, so the ticket's Fix bullet 1 is visibly
   deferred and not silently dropped.
5. **Cosmetic:** tasks.md jumps from section 2 to 4, and the "Standing Constraints" header is empty.
6. **Out of scope, for awareness:** the Spark-path `GET /api/pipelines/:id/runs/:runId` also renders a full rows array
   (`PipelineRunQueries.scala:71-76`). It is not reachable from the in-process run path, so it is not part of this
   ticket.
