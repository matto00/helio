## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I reviewed HEAD 1b765f59d0d09d2d60d5c05f31a2e06083e3a105, which equals BASE; the change dir is untracked. This was a read-only review and I did not run sbt.

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-service/hel-1463`.
- **Round-1 CR1 (line ranges)** is resolved by option (b):
  - D2 now gives declaration-line locators only.
  - D6a defines a mechanical member-block rule with a checker assertion.
  - The false "includes its doc comment" sentence is gone.
  - `toFieldResponse` is now 2382-2383, with the closing brace at 2384.
  - I scanned the base class body (52-2383) for comment blocks followed by a blank line, and for annotations. There are no annotations. Exactly one comment block is orphaned: 988-990 (see CR2).
- **Round-1 CR2 (naming)** is resolved:
  - proposal.md says "create writes".
  - D1's example is `createWrites.create(req, user)`.
  - D2 names `PipelineCreateWrites` and warns about the existing `PipelineCreatePreflight.scala`.
- **Round-1 non-blocking notes** are all addressed:
  - The sibling params of `PipelineCreateWrites` are stated in D2.
  - `stepAddress` is listed as dead and as a follow-up candidate.
  - `require` (:84) and the 88-90 block are claimed in D6a.
  - D6d now says a missing spec is recorded as a coverage gap, with no test written.
- **Member inventory against design text**: I enumerated every class-body `def`/`val` at BASE and grepped design.md for each name.
  - Seven unnamed ones are private helpers inside the stated "`analyzeProposal` through `toSchemaFields`" span (1356-1661), which is fine.
  - Five are NOT covered by any decision: `laneTreeGiven` (:1118), `listRootDataSourceIdsInternalBatch` (:1151), `rootIdsOfBatch` (:1158), `listByPipelineInternalBatch` (:1166) and `laneTreeFromRoots` (:1171). All five are `private[services]`. See CR1.
- **The `private[services]` members are an external contract**:
  - `WorkspaceContextService.scala` (package `services.workspace`) calls `pipelineService.listRootDataSourceIdsInternalBatch` (:147), `.rootIdsOfBatch` (:151), `.listByPipelineInternalBatch` (:162) and `.laneTreeFromRoots` (:324).
  - `javap -public` of a compiled `PipelineService.class` (main checkout target) lists all five as `public` methods, because Scala's qualified-private compiles to public. They are therefore inside C5's filtered javap surface.
  - `WorkspaceContextServiceSpec` (:1197-1229) spies on the repos, not on the service. So delegations would not disturb its call-count verifications, provided collaborators receive the same repo instances (which D2 already requires).
- **Call graph spot-checks**:
  - `upsertTargetProblems` (calls at :895, :1051), `parseBaselineSchema` (:965), `toDriftResponse` (:975) and `toCostVerdictResponse` (:976) are called only from analyze/analyzeConcise, consistent with `PipelineAnalyzeReads`.
  - `validateStepKinds` is called only from `analyzeProposal` (:1357).
  - `laneTreeGiven` is called only from `laneTree` (:1098). `laneTreeFromRoots` is called from `laneTreeGiven` (:1129) and from WorkspaceContextService.
- I re-checked the constraints the round-1 report established (Forbidden-producer pin, access-helper scan, logger name, D6b filter soundness). Nothing in the revision weakens them.

### Verdict: REFUTE

### Change Requests

1. **Decide where the five `private[services]` members go and how their entry-point surface is preserved.** Today the design is silent, and a literal reading breaks either the build or C5.
   - **What the design implies.** D2's `PipelineNodeReads` locator range ":1092-:1290" spans `laneTreeGiven`, `listRootDataSourceIdsInternalBatch`, `rootIdsOfBatch`, `listByPipelineInternalBatch` and `laneTreeFromRoots`. So they would move into a `private[pipelines]` class.
   - **Why D1 doesn't save them.** D1 provides one-line delegations only for "every other *public* method". In Scala source these five are not public, so a reasonable executor reads D1 as giving them no delegation.
   - **What breaks.** WorkspaceContextService (outside `pipelines`) calls four of them on a `PipelineService` instance, and all five are public in bytecode, so C5's javap diff would be non-empty.
   - **Required.** State explicitly in D1 and D2 the destination of each of the five members. State that the entry point keeps a `private[services]` one-line delegation with an unchanged signature for each one that moves. Alternatively, justify keeping any of them in the entry point without creating a NodeReads→entry dependency: `laneTree` → `laneTreeGiven` → `laneTreeFromRoots` must stay acyclic. Update D1's "Expected entry size" accordingly. Also state whether the moved members keep `private[services]` (byte-identical, so the D3 modifier rule needs no new category) or need a different modifier.
2. **Claim the orphan comment block at 988-990.**
   - **The block.** It is a `// HEL-1093 ... hasSourceUrl moved to PipelineCostInputGathering ...` comment followed by a blank line (991) before `toWarningResponse` (:992).
   - **Why it is unclaimed.** Under D6a's member-block rule it is not part of any member block, and D6a's list of non-member blocks names only `require` (:84) and 88-90.
   - **What happens without a fix.** Coverage check (iii) will fail on it, and the executor must invent a destination.
   - **Required.** Add it to D6a's non-member block list with an explicit destination. Its text refers to `analyze`, so `PipelineAnalyzeReads` is the natural choice. Also add a general clause: any comment-only block separated from the next declaration by a blank line is a standalone block, which the inventory must assign explicitly.

### Non-blocking notes

- Once CR1 is fixed, D6d's mutation for `PipelineNodeReads` could target `laneTreeFromRoots` via the existing WorkspaceContextServiceSpec lane-tree assertions. That would prove the delegation path is exercised.
- No gate-defect findings: no mtime evidence was relied on.
