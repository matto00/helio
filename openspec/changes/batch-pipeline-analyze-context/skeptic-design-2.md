## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 73b32e562428aab46e98c4c378bdd13869219ac6 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Round-1 CR1 (two resolver scopes): RESOLVED.** I re-read `PipelineAnalyzeReads.analyze`
  (backend/.../PipelineAnalyzeReads.scala:31-36, 78, 81-82). Roots resolve through `findByIdOwned(dsId, user)` (the
  caller). Upsert targets resolve through `UpsertTargetAnalysis.problems(..., AuthenticatedUser(pipelineOwnerId),
  dataSourceRepo)` (the pipeline owner). Secondaries resolve through `findByIdInternal`. design.md D3 now names
  separate `rootSourceAsCaller`, `upsertTargetAsOwner` and `secondarySource` resolvers, says which repo call
  `analyze` passes for each, and says they are never merged inside the shared projection. The batch may back both
  owned resolvers with one map only because of D5 (caller == owner), and the design says so. Task 4.3b adds the
  grantee guard I asked for: an `upsertsource` step on an owner-owned dataset, checked by editor and viewer
  `/analyze`. It is written before 1.1, labelled a guard (it passes before the change), and has a named mutation
  (upsert resolver wired to the caller) that turns it red.
- **Round-1 CR2 (false 55-pipeline scenario): RESOLVED, and the arithmetic checks out.**
  contextRequestBudget.test.ts:47-51 pins 8 fixed + 1 context-details + 55 analyze + 19 placements + 1 dashboard =
  84. The rewritten scenario gives 8 + 2 + 19 + 1 + A. A = 1 in serve mode, because the fake batch omits
  `ANALYZE_FAILS_INDEX` (D7), so the total is 31. In batch-404 mode it is 8 + 2 + 55 + 19 + 1 = 85, which is 84 + 1.
  Both numbers are correct. The 200-pipeline "pre-change sends more than 120" claim holds: at least 210 + Op + D.
- **Round-1 non-blocking notes were all taken up.** design.md Risks now covers: failure modes the batch does not
  share, statement count depending on whether each id kind is present rather than on P, ties in root-level
  position, and raw-id map keys. D7 lists the expected stderr for each fixture mode.
- **D3 extraction scope.** The projection inputs listed in D3 (`nodeInputs` from all steps, `analyzeNodes`,
  `UpsertTargetAnalysis.overlay`, `AnalyzeSchemaWarnings.compute`, the enabled-step filter) match lines 104-127. The
  reads D3 leaves out of the batch (`primaryOwnerViewF` drift, cost inputs, `ownerRootSchemas`) only feed fields the
  batch does not return (Non-goals). `ownerRootSchemas` is an input option, and the batch passes None under D5.
- **MCP call site.** context.ts:572 (`fetchContextDetails` promise started before the fail-fast `Promise.all`) and
  :613 (per-pipeline `analyzePipeline`) match D7's "mirror fetchContextDetails" plan.
- **Coverage of the acceptance criteria.** The constant-in-P bound and the 200-pipeline fixture under 120 are
  covered by the spec scenarios and task 4.5. The golden, the seam schema and the `TwoUserRlsApiFixture` isolation
  test are covered by D8 and tasks 4.1, 4.3 and 4.5. The bounded server cost at 200 pipelines is covered by D4 and
  tasks 4.4 and 4.6. "No migration" and "no deploy" are in the Migration Plan. I found no placeholders or TBDs, and
  no contradictions between the proposal, design, tasks and specs.

### Verdict: CONFIRM

### Non-blocking notes

- Task numbering lists 4.3b before 4.3. This is cosmetic, but because 4.3b has to land before 1.1, the executor
  should treat it as the first test commit.
- In serve mode, a real backend emits one "omitted" stderr line on every call when any pipeline's projection fails
  (D6 + D7). The behavior is correct. The PR should mention it so operators do not read it as a regression.
- The "Live seam: zero `/analyze` requests" scenario assumes every seeded live pipeline analyzes cleanly. The
  200-pipeline seed for 4.6 should avoid deliberately failing pipelines, or the assertion should be "zero for
  pipelines the batch returned".
