## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD e0443c24d0c02b41cdda105a410cea0b6bdf2b33 (branch feature/draft-outputs-and-shapes/HEL-1733). Every claim
below was checked against live source. Owner rulings Q1 (`inline-confirm-then-save-dialog`) and Q2 (`one-pr`) are
fixed. I do not judge one PR infeasible: the one remaining item is a specification gap of a few lines, not a size
problem.

### What I verified (with evidence)

Round-4 change requests:

- **CR-1 (D15 trigger): answered.** D15 (design.md:298-309) now places the judgement before the `droppedNow === 0`
  early return of the drop/prune effect (`usePipelineDraft.ts:97-102`) and adds `outputsStatus` and `restoredTick` to its
  dependencies. I traced both orders against the live hook:
  - Steps first: the restore effect (`usePipelineDraft.ts:59-74`) runs, increments `restoredTick`, and the next commit
    re-runs the drop effect with `restoredFor.current === pipelineId`. Outputs not loaded yet means no judgement. When the
    page-local `outputsStatus` flips to "loaded", the effect re-runs and judges.
  - Outputs first (`usePipelinePageLoad.ts:64-72` dispatches both together): the `restoredTick` change re-runs the effect
    after the restore, with Outputs already loaded, so it judges.
  - Tests (7) and (8) are in D15 (design.md:320-321) and task 4.2.
- **CR-2 (D5 request): answered.**
  - `pipelineName` is in the request shape (design.md:155-157). It is required by the reader
    (`PipelineProposalProtocol.scala:253-256`). `outputs` is optional, so `outputs: []` is fine (`:262-265`).
  - Every step carries `enabled`. `analyzeProposal` passes it through as `enabled.getOrElse(true)`
    (`PipelineProposalAnalyze.scala:73-82`). A disabled node is transparent: `(inputSchema, None)`
    (`PipelineAnalyzeService.scala`, `processNode`). Disabled steps are left out of the response (`:85-86`). So the
    "nearest enabled ancestor's `outputSchema`, else the root's `sourceSchemas` entry" rule (design.md:163-165) is exact.
    `sourceSchemas` is keyed by the root's `clientId` (`:93-95`), which D5 sets to `root.id`.
  - The "every step node uses analyze-proposal; the root uses saved capabilities" rule removes the "changed node"
    computation, and with it round-4 CR-2(c): a node below a saved-disabled step no longer goes to `capabilities`.
  - 404 and 500 fall back to "unavailable" (design.md:170-175). Jest cases (e) and (g) cover them.
- **CR-3 (proposal.md): answered.** The "What Changes" bullet now says the server's projection of the draft through
  `analyze-proposal`, "never inferred from rows". It matches D5 and the spec.
- **Notes folded in:** task 4.2 lists tests (1)-(8) and the either-order trigger. Task 7.2 cites the verified 404 and
  the every-step rule.
- **Kept outputsBase signature scope:** `fetchOutputs({pipelineId})` is scoped to the pipeline
  (`usePipelinePageLoad.ts:72`). `normalizeOutputForCompare` (`pipelineDraft.ts:255-264`) leaves out `panelCount`, so
  binding a panel elsewhere does not mark the draft stale.

### Verdict: REFUTE

### Change Requests

1. **D15/D11: the kept draft's `outputsBase` is lost or overwritten before it is judged, so a stale kept draft can
   later restore as not stale and save over a concurrent Output change.**
   - D15 sets `keptOutputsBaseRef` only at the stale judgement ("records `keptOutputsBaseRef`", design.md:306). The
     failed-list writer rule reads that ref "when the current Outputs are unknown" (design.md:311). D11 says the writer
     otherwise writes "a signature of the base Outputs" (design.md:270-271). Steps work differently: the restore sets
     `keptBaseRef` synchronously, and the writer always prefers it (`usePipelineDraft.ts:68-71, 80`).
   - The writer effect is declared before the drop/prune effect (`usePipelineDraft.ts:75` vs `:97`), so in the commit
     after the restore the writer runs (the overlay changed) BEFORE the judgement. The concrete failures:
     - (a) **Outputs list failed.** The judgement never runs because it needs "loaded", so `keptOutputsBaseRef` is never
       set. The writer then has no `outputsBase` to write: it must not write one from an empty list, and the ref is
       null. A tab reload with a successful fetch then compares steps only, so the draft is NOT stale. Its kept
       `outputEdits` overwrite a concurrent rename, which breaks the spec's "never saved over the change". The rule D15
       states for the failed case contradicts itself: it reads a ref that, as specified, is always null in that case.
     - (b) **Back while Outputs are still loading.** Same result: the restore-time write has no `outputsBase`.
     - (c) **Outputs before steps, base differs.** The writer in the post-restore commit writes the CURRENT Outputs'
       signature, then the judgement flips stale in memory. An immediate Back leaves a kept draft whose `outputsBase`
       equals the server's, and the next restore is not stale.
   - Test (3) and test (7) assert only the in-memory flag and the save refusal. None of them would catch this.
   - Required:
     - The restore effect sets `keptOutputsBaseRef.current = kept.outputsBase ?? null` synchronously, next to
       `keptBaseRef`.
     - The writer writes `outputsBase = keptOutputsBaseRef.current ?? (outputsStatus === "loaded" ?
       signature(baseOutputs) : <omit>)`, exactly mirroring `keptBaseRef ?? baseSignature(...)`.
     - The judgement compares against that ref.
     - `rebase` and `discard` clear it, as they clear `keptBaseRef`.
     - Extend tests (3) and (7) to assert that the sessionStorage entry still holds the ORIGINAL kept `outputsBase`
       after the restore, and that a second restore from it is stale. (7): Outputs first, base differs. (3): the list
       failed, then a reload with a successful fetch.

### Non-blocking notes

- **D5a is stale against D5's new rule.** design.md:197-198 still lists "saved-node capabilities for an unchanged node,
  analyze-proposal for a changed node". Spec line 63 also says "for a node the draft does not change, the saved
  pipeline's". Both are still true in substance, because the projection of an unchanged node equals the saved one, and
  D5 says plainly that no "changed" computation exists. Reword them to "analyze-proposal for every step node; saved
  capabilities for the root" so the executor does not build a changed/unchanged split.
- **A real step under a temp (`step-N`) parent.** Local state can parent a real step under a temp step: the trunk walk
  hops through temp children (`draftOps.ts:268-279`). Leaving temp steps out of the request leaves such a step
  unreachable (`isReady` fails), so it falls to "unavailable". That is safe, but it may be better to re-point the step's
  `parentStepId` to the temp step's own parent in the request.
- **`restoredTick` costs one extra render.** Incrementing it on every restore adds a render even when nothing was kept.
  On main, the "nothing kept" branch avoids a state change for exactly that reason (`usePipelineDraft.ts:63`).
  Incrementing only when a kept draft is restored is enough for the judgement.
- **Rate budget.** One analyze-proposal per sheet interaction, coalesced, is well inside the 120/window general limiter.

Verdict category: spec-divergence.
