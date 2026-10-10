## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I reviewed HEAD 1b765f59d0d09d2d60d5c05f31a2e06083e3a105, which is BASE; the change dir is untracked. This was a read-only review and I did not run sbt. The base file was extracted with `git show 1b765f59d:backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` (2571 lines).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-service/hel-1463`.
- **Round-2 CR1 (the five `private[services]` members) is resolved.**
  - D1 now states that the five members move, that the entry keeps a `private[services]` one-line delegation for each with an unchanged signature, and why (WorkspaceContextService :147/:151/:162/:324, plus public bytecode under C5).
  - D2 places them in `PipelineNodeReads` with their modifier kept verbatim.
  - D2 also states that the `laneTree` -> `laneTreeGiven` -> `laneTreeFromRoots` chain stays inside that one class.
  - I checked their signatures (:1118-:1176): none has a default, type parameter or by-name parameter, so the delegations are trivially signature-identical.
- **Round-2 CR2 (the orphan block at 988-990) is resolved.**
  - D2 and D6a assign 988-990 to `PipelineAnalyzeReads`.
  - D6a adds the general rule for standalone comment blocks, and the checker fails on any unassigned non-blank line.
- **Sweep for missed blocks.**
  - Standalone blocks: an awk scan of class-body lines 52-2383 found exactly one comment block followed by a blank line (ending at 990), now claimed.
  - Annotations and modifiers: there are no annotations and no `override`/`implicit`/`lazy`/`var` members in the class body.
  - `this`: every hit is in prose. The only `getClass` is the `log` line.
- **Inventory completeness.**
  - I wrote a script assigning every class-body `def`/`val` declaration (regex over 51-2384) to D1/D2's destinations. Result: `unassigned decls: []`.
  - Non-member statements (`require` :84, 88-90, 988-990) are claimed in D6a.
- **Dependency graph.**
  - Method: a cross-reference over declaration spans, with comments and strings stripped and `PipelineService.x` excluded.
  - The only edges between collaborators, other than into Support, are CreateWrites->CreateTransaction and CreateWrites->RootWrites.
  - Every collaborator->entry edge is either `requireEditorAccess` (D2a function param), `log` (D5, own logger per class) or `costInputGathering` (passed in, D4).
  - The entry->Support edges are `audit` and `toSummaryResponse` (D3 collaborator imports), and entry->StepCreate is `addStep`->`addStepReporting` (D1 delegation).
  - Support depends on nothing else. The graph is acyclic, and D4's declaration order satisfies every edge.
- **Companion access.** The class body references only companion members that are `private[pipelines]`/`private[services]` (`classifyDbError`, `validateLaneReference`, `resolveRootTrunkAnchor`, `ancestorChainOf`, `descendantStepIds`, address helpers). The plain-`private` `classifyPsqlException` (:2561) is not referenced from the class, so sibling classes compile. The `PipelineService.addStep`/`.toAnalyzeStepResponse` hits are a comment (:426) and string literals (:1700/:1726/:1732), which are byte-moved unchanged.
- **ExistenceNotLeakedRoutesSpec** (I re-read :317-:335 and :476-:493):
  - Row `sites` feed only the coverage-superset check.
  - `forbiddenProducerCounts` counts files with n>0 only. `ServiceError.Forbidden(` occurs once at BASE (:2364, `requireEditorAccess`, kept), so the pin holds.
  - `helperCall` does not match `requireEditorAccess(`, and the base file calls no helper.
- **Test seams.** No test spies on, mocks or subclasses `PipelineService` (the class is `final`). `WorkspaceContextServiceSpec` :1197-:1229 spies only the repos, which collaborators receive as the same instances. So delegation cannot change any Mockito verify count.
- **Logger.** The log sites :323/:325/:1316/:1789/:2139/:2316 all fall in moved bodies, and D5 pins `classOf[PipelineService]`.
- **javap.**
  - Scala is 2.13.15 (build.sbt:4), with no `scalacOptions`.
  - Classes land in `backend/target/scala-2.13/classes`.
  - The collaborator `private val`s and the eta-expanded `requireEditorAccess` lambda add only private fields and `$anonfun$` members, which the declared D6b filter drops. No moved public method has defaults.
- **Other pins.**
  - `check-scala-quality.mjs`: file size is a soft warning only, and the FQN rule is enforced on pre-commit.
  - No script, husky hook or sbt file names `PipelineService`.
  - The only path-based references are comments: PatchSetApplyResolvers.scala:178, PatchSetPreviewProjection.scala:286, PipelineStepRepository.scala:1092, PipelineCreateTransactionalSpec.scala:95/:170.
- **Other artifacts.**
  - `.openspec.yaml` has `skip_specs: true`.
  - The HEL-1371 move-check precedent exists (`check.py`, `javap.sh`, `spec.json`), as does `await-sentinel.sh`.
  - Every ticket AC (1-6) maps to a task (2.x, 3.1, 3.2, 3.5, 3.6).

### Verdict: CONFIRM

### Non-blocking notes

- **Forward-check rule vs comment edits.** D6a(i) allows only `private` -> `private[pipelines]` substitutions, but D3 permits positional comment edits inside member blocks, such as ":89 `analyze` below", ":335 `create` above" and ":934 elsewhere in this file". If the executor makes any such edit, the checker should carry it as an explicit declared substitution (spec.json-style) rather than loosen the comparison. The simplest path is to make no comment edits and record them as follow-ups instead.
- **More stale citations.** Task 3.6 lists stale test comments only. Main-file comments also cite `PipelineService.scala` line numbers (PatchSetApplyResolvers.scala:178, PatchSetPreviewProjection.scala:286, PipelineStepRepository.scala:1092). Record them as follow-up candidates too; D3 correctly forbids editing them here.
- **Dead `log` in the entry.** No kept entry member logs, so the entry's verbatim `log` val (:86) becomes unused after the move. That is harmless with no `-Wunused`; note it as a follow-up candidate instead of deleting it.
- **Soft size budget.** Several collaborators (ProposalAnalyze ~330, StepCreate ~300, StepWrites ~270) will exceed the 250-line soft budget. That is a soft warning only, but say so in move-evidence so the evaluator does not read it as a new regression.
- **No gate defects.** No mtime-ordered evidence was relied on.
