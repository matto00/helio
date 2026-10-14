## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `b979cdb80ac42ca2b1be0e3b8d4ee48e4adc7d51`. Base is `e982754f55987b29f9e20b74c468701f2e464a7d`, resolved live with
`resolve-review-base.sh`. Spawn-cwd guard: READY. The cycle-2 delta (`095ae7c68..b979cdb80`) touches 3 files:
- `services/pipelines/README.md`
- `evidence/claims.md`
- `evaluation-1.md` (my cycle-1 report, committed by the executor)

There is no Scala, test or build change in it.

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 is resolved.** The README no longer counts `StepReferenceChecks` under "(all `private[pipelines]`)". It now
  says "a `private[pipelines]` class plus a public companion object whose `private[services]`
  `secondarySourceOwnershipF` is shared with `patchsets`". I checked each part against the code:
  - `StepReferenceChecks.scala:43` is `private[pipelines] final class StepReferenceChecks`.
  - `:80` is an unqualified `object StepReferenceChecks`.
  - That object's only member is `private[services] def secondarySourceOwnershipF` at `:88`.
  - The member is called from `services/patchsets/PatchSetPipelineStepResolvers.scala:259`.
- **Cycle-1 CR2 is resolved.** `claims.md` now has three inverse probes (C4b, C4c, C4d), and I re-ran them:
  - C4b (unqualified top-level declarations across the 25 files the README marks `private[pipelines]`): exactly one hit,
    `StepReferenceChecks.scala:80`, which the README now documents.
  - C4c: no `private[services]` top-level declaration in those 25 files.
  - C4d: matches the code.
  - Unlike C4, these probes could actually fail.
- **I re-checked every other sentence of the whole README against the tree:**
  - File list: the re-derive command gives 52 names. All 52 are in the README, and every backticked identifier in it is an
    existing file (both re-verified in cycle 1; the cycle-2 edit only reworded the `StepReferenceChecks` note).
  - The 9 `PipelineService` collaborators named are each constructed once in `PipelineService.scala` (`new X`), and each
    is `private[pipelines]`.
  - The 7 `PipelineRunService` collaborators are each constructed once in `PipelineRunService.scala`, and each is
    `private[pipelines]`.
  - `OutputRowReads` and `OutputRootResolution` are each constructed once in `OutputService.scala`, and both are
    `private[pipelines]`.
  - The other visibility notes match: `PipelineCreatePreflight` is `private[services]` (`:19`). `PipelineRunDeletedRecovery`,
    `PipelineAutoRunDebounceFirer`, `OrphanedRunReaper`, `StepPlacement`, `UpsertTargetAnalysis` and
    `InlineSourceCompensation` are all `private[pipelines]`. Every file listed without a qualifier is unqualified.
  - "`PipelineCostInputGathering` (shared with `PipelineService.analyze`)": `PipelineService.scala:75` constructs it and
    passes it to `PipelineAnalyzeReads` (`:78`), which serves `analyze`. `AutoRunTriggerService.scala:44` constructs its
    own instance.
  - "never `db.run` directly": no `db.run` in the directory. `.transactionally` appears only inside comments
    (`PipelineCreateWrites.scala:37,47`).
  - "Snapshot ... not a completeness claim" plus the re-derive command satisfies the HEL-1156 standard.
- **AC1, AC2, AC4, AC5 and AC6 are unchanged since cycle 1, where each passed.** The delta does not touch them.
- **CONSTRAINTS:** `[]`.

### Phase 2: Code Review — PASS

- **Gates:**
  - `npm run check:scala-quality`: clean (soft warnings only, pre-existing).
  - `npm run check:openspec`: clean.
  - `npm run check:no-credential-leak`: OK, 0 violations.
  - `npx prettier --check` on the README and the change dir: clean.
- **Why I did not re-run `sbt testFull` this cycle:** my own cycle-1 run at `095ae7c68` passed all 4 shards with 0
  failures. The cycle-2 delta changes no `.scala`, test resource or build file. `grep -rln README backend/src/test`
  shows that only sources specs use the string `README.md`, as an upload filename, and none of them reads this
  directory's README. So the README edit cannot change any test outcome.
- **Stray processes:** none. No `java` process is running at all, and nothing is listening on 6883 or 9790.
- **Minor, non-blocking:** in `claims.md`, the C4b-C4d section has its `###` headings and output inside a single code
  fence, so it renders as one block. The content is correct.

### Phase 3: UI Review — N/A

No UI-trigger files changed.

### Overall: PASS

### Non-blocking Suggestions
- `evidence/claims.md`: close the code fence before each `### C4c`/`### C4d` heading so the headings render.
