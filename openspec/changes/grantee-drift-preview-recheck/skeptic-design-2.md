## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc. The change dir is untracked, so I read the artifacts from
disk. `openspec validate grantee-drift-preview-recheck --strict` reports "Change 'grantee-drift-preview-recheck' is
valid".

### What I verified (with evidence)

**Prior CR1 (empty-roots existence check): mostly resolved.**
- D3 now puts a privileged `findByIdInternal` existence check in `previewAtNode`'s `roots.isEmpty` branch
  (PipelineRunPreview.scala:141-144). This mirrors PipelineRunExecutor.scala:55-62.
- A3 is recorded as an assumed call, and task 3.2a covers the check.
- S1 and S2 are split, with mutations M4a and M4b.
- Gap: CR1 also required updating `findByIdInternal`'s privileged-caller doc list (PipelineRepository.scala:55-62).
  That list currently names only `ResourceTypeRegistry`, `SparkJobSubmitter` and `PipelineRunExecutor.runPipeline`'s
  empty-roots branch, and says "Do not call from a request-bound service method". Neither the design nor the tasks
  carry this update. See CR1 below.

**Prior CR2 (seam R after the last ACL read): resolved.**
- D4 defines R as firing at `previewAtNode`'s own step-list or root resolution, after its inner `findByIdShared`
  (:135), never after the outer read (:80).
- C1 is promoted as a binding constraint.
- Overriding is feasible:
  - `PipelineRepository`, `PipelineStepRepository` and `OutputRepository` are non-final classes.
  - `resolveAllRootDataSourcesInternal` (PipelineRunSupport.scala:104-109) goes through
    `pipelineRepo.listRootDataSourceIdsInternal` and `dataSourceRepo.findByIdInternal`, both overridable.
  - Hel1503EditorRunGapsSpec.scala:187-200 already uses this subclass-override pattern.

**Prior CR3 (non-AI closure in D4(d)): resolved.**
- D4(d) says "NON-AI closure (an AI closure is already 403 on main)".
- I traced main: with a non-AI closure, `authorizedForAi` short-circuits to `true` (:245) and `backend.execute` (:263)
  runs, so the case is red on main.

**Prior CR4 (task 3.3 comment): resolved.**
- Task 3.3 and D3 now require rewriting the comment at ExistenceNotLeakedRoutesSpec.scala:519-520 as well as the
  count at :534. I confirmed the current comment says "the step-preview AI-closure gate".

**D3 re-check placement: sound.**
- S2 deletes after `listByPipelineInternal` returns. Nothing between that point and `backend.execute` reads the DB
  except the new re-check, so `PipelineGone` is reachable and M4b can go red.
- On main, data sources do not cascade from pipelines, so the spy executes and the case is red.

**Output cascade: checked.**
- `outputs.pipeline_id` is `ON DELETE CASCADE` (V94__outputs_model.sql:208). This matters for S1 on the all-Outputs
  arm. See CR3.

**D1/D2: re-confirmed against the code.**
- PipelineAnalyzeReads.scala:76-90 keeps every root (no `None` dropped), in `listRootDataSourceIdsInternal` position
  order. So "first entry of `listRootDataSourceIdsInternal`" is the same root as `rootSchemas.headOption`.
- The baseline read at :149 is `findLastSourceSchema(pipelineId, user)`, which filters by owner (PipelineRepository.scala:600-609).

**Spec deltas.**
- The MODIFIED analyze requirement keeps all three existing scenarios verbatim (openspec/specs/pipeline-analyze-api/spec.md:150-171).
- The ADDED preview requirement is consistent with D3 and A2.

**`RunAuthorization` ADT** exists at PipelineRunRepository.scala:652-656.

**Premise evidence** (.concertino/runs/HEL-1516/evidence/premise-validation.md) agrees with what I traced
independently.

### Verdict: REFUTE

These are small, specific edits to design.md and tasks.md, plus the C1 wording. No redesign is needed.

### Change Requests

1. **Finish prior CR1: the privileged-caller doc list.**
   - Add a task (with 3.2a or 3.2b) and a sentence in D3: update `findByIdInternal`'s doc
     (PipelineRepository.scala:55-62) to name `PipelineRunPreview.previewAtNode`'s empty-roots branch as a documented
     privileged caller.
   - The entry should be a read-only existence check keyed by the id `findByIdShared` has just authorized, mirroring
     the HEL-1503 bullet.
   - Without it, the change adds a request-bound caller to a method whose doc says "Do not call from a request-bound
     service method", and does not record the exception.

2. **D4's "each case is run red on unchanged main" contradicts its own pins and C1.**
   - Cases that cannot be red on main:
     - **(b)** passes on main: a grantee gets a `None` baseline, so no drift, which is exactly (b)'s expectation.
     - **(c)** is labelled a regression pin.
     - **(g)** is a set of pins.
   - C1 (workflow-state.md CONSTRAINTS) says "every new test case is shown red on unchanged main". An evaluator holding
     C1 literally would fail a correct execution.
   - Revise D4 and C1 as follows:
     - The red-on-main cases are (a), (d), (e) and (f, both seams).
     - (b), (c) and (g) are **guards**, each labelled as such in the spec's test names and in red-run.md.
     - Each guard is shown failable by its named mutation: (b) by M2, (g) by M5, and (c) by M1 or a stated mutation.
       (c) needs a mutation of its own named, or must be explicitly marked as a pin with no mutation.

3. **Pin the arm for S1 "output preview" in D4(f).**
   - Outputs cascade with the pipeline (V94:208). If S1 fires on the all-Outputs arm's OUTER `findByIdShared` (:80),
     `outputRepo.listByPipelineInternal` returns empty and the response is **200 with `outputs: []`**, both on main and
     after the fix. That is neither red nor 404.
   - Say explicitly that S1's output-preview case uses the single-Output arm (whose only `findByIdShared` is the
     inner one at :135), or that S1 is armed on the inner read only, as C1 already demands for R.
   - Likewise, name the arm and seam for S2's output-preview case:
     - Step-bound Output: the `listByPipelineInternal` seam.
     - Source-bound Output: a `listRootDataSourceIdsInternal` override, since that arm never reads the step list.

### Non-blocking notes

- **(e) all-Outputs arm with seam R.**
  - `Future.traverse` (:93) starts every node key's `previewAtNode` eagerly.
  - With more than one distinct node key, a one-shot revoke fired inside node A's resolution can land before node B's
    inner `findByIdShared`. Node B then gets 404 while node A gets 403.
  - `collectFirst` then returns whichever error comes first in key order, which is nondeterministic.
  - Pin the fixture to exactly one distinct node key, or assert "403 or 404, never executed" with that reasoning stated.
- D4's "seam R ... when `resolveAllRootDataSourcesInternal` is read" names a `PipelineRunSupport` method that a test
  cannot override. The real seam is `pipelineRepo.listRootDataSourceIdsInternal` (or `dataSourceRepo.findByIdInternal`).
  This is wording only.
- **S2 assertions.** Assert the 404 message ("Pipeline not found: ..."), not just the `NotFound` type. If the override
  deletes before the step list is read, the response is a 404 "Step not found", which M4b cannot turn red.
- The ExistenceNotLeakedRoutesSpec comment points at a `forbidden-classification.md`. If that file lives in an
  archived change, there is no need to edit it, but the new comment should state the classification inline:
  "reached only after `findByIdShared` returned the pipeline".
- **A1–A3 are well recorded.** The prior round's note still applies: analyze's `sourceSchemas` stays in the grantee's
  view (empty for owner-only sources) while drift is in the owner's view. One sentence in A1 for the owner would help.
