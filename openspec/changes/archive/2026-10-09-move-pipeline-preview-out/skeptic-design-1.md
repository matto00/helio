## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD ecaa1a532dcbf10b8d7f3664335bff392fd59554 (= origin/main; change dir untracked).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/pipelinerunservice-preview-split-tidy/HEL-1393`.
- **File size / ranges:** `wc -l PipelineRunService.scala` = 652. :261 opens `previewStep`'s doc and :534 is
  `previewAtNode`'s closing `}`, so 261-534 (274 lines) is correct. After the move the file is about 652-274+~10 = ~388,
  so it should land under 400.
- **Forbidden producers:** `submit` at :199 is correct. The AI-gate producer is at **:487**, not :486 as the ticket
  says. This is a one-line slip and does not block anything. The pin is at ExistenceNotLeakedRoutesSpec.scala:528
  (`"PipelineRunService.scala" -> 2`).
- **Item 3 stale:** confirmed. `log` is declared at :111 and used at :234 (`recordUnrunnable`'s `recoverWith`).
  Dropping it is correct.
- **Item 5:** `explicitRootId: Option[PipelineRootId]` has no default at either site (PipelineRunService.scala:545,
  PipelineRunBackfill.scala:71), and both say "Defaulted to `None`" (:544 / :68). All callers pass it explicitly
  (OutputService.scala:77 passes `output.node.rootId`; four test calls pass `None`). D8 is sound.
- **Item 2:** `resolvePrimaryDataSourceInternal` appears only at its definition (PipelineRunSupport.scala:105) and in
  two doc refs (:113, :117). It has zero callers in main or test. D5 is sound.
- **Item 6:** `executeRunFailure`'s body is indented 8 spaces too deep (PipelineRunTerminalWrites.scala:52 onward).
  `previewAtNode` has two under-indented blocks (after `case _ =>` at :~443 and `case true =>` at :~489). Both
  confirmed. The build is Scala 2.13.15, with no `scalacOptions` / fatal-warnings in build.sbt. Whitespace can't
  change bytecode here, and `javap -c -p -l` is a valid proof because no lines move, so the line tables stay equal.
- **Pin update is not a weakening:** `forbiddenProducerCounts()` (spec :488-492) counts code lines across all of
  `src/main/scala`, and the test compares with exact `shouldBe` map equality. Splitting `2` into `1 + 1` keeps the
  total and keeps exact matching. Both proposed red checks really fail: a third producer in PipelineRunPreview.scala
  changes a count, and a new file adds a key. The classification doc
  (archive/2026-10-02-collapse-owner-only-existence-leak/forbidden-classification.md:52) names producers by symbol
  ("step-preview `authorizedForAi`"), not by file, so it stays true after the move. D2 is sound.
- **Run-status row site:** `grep -E '\b(requireOwnerOnly|requireAccess|authorizeResource(WithSharing)?)\('` over
  `PipelineRun*.scala` returns zero hits. So no check reads the `sites` of the three pipeline-run rows, and the
  `PipelineRunQueries.scala` re-site is cosmetic. That is harmless, but "verify with the spec green" proves nothing
  about it (see notes).
- **Eager-val order:** confirmed. Class vals initialise in declaration order. `backend` is :143 and `support` is :147,
  so a `preview` val after :147 sees both as non-null. Declaring it before them would NPE every preview test, so that
  mistake would be caught. The moved bodies reference only `pipelineRepo`, `pipelineStepRepo`, `dataSourceRepo`,
  `outputRepo`, `backend` and the four `support` members. That matches D1's parameter list. Nothing in the moved code
  touches `log`/`getClass`. `logExecutionFailure` already logs through `getLogger(classOf[PipelineRunService])`
  (PipelineRunSupport.scala:20), so the logger-capturing specs are unaffected.
- **Move evidence:** the template `move-check/check.py` (forward byte-compare, positional reverse walk, coverage of
  base lines) and `javap.sh` (synthetic-filtered `-public`) exist in the #847 archive and do what D4/D9 claim. Adapted
  as described, with both red runs, they would catch an altered moved line, a stray inserted line and an unclaimed
  base line.
- **Stale refs (item 4), ground truth:**
  `grep -rnoE 'PipelineRunService[.#]\w+' backend/src` finds references to members that **no longer exist on
  `PipelineRunService`** (moved by #847), outside the eight files D7 sweeps:
  - `executeRun` x13: AssertionResult.scala:32, InProcessExecutionBackend.scala:25,
    PipelineExecutionBackend.scala:23/49, PipelineRunRepository.scala:41/101, SparkJobSubmitter.scala:99,
    Main.scala:142, HookTriggerService.scala:84, PipelineRunGuardIntegrationSpec:141/205, PipelineRunServiceSpec:42/447
  - `onRunSuccess` x7
  - `runPipeline` x3
  - `onUnblockedRunSuccess` x3
  - `trunkOf` x2
  - `upsertFieldsFromRows`, `resolveAllRootDataSourcesInternal` (PipelineCostInputGathering.scala:23)
  - file-level citations that are no longer true: PipelineStepRepository.scala:1092, PipelineRunRoutesSpec:636,
    V94OutputsMigrationSpec:592

  **This move itself makes more refs false:**
  - OutputRoutesSpec.scala:1981 — "MUTATION PROOF: reverting `PipelineRunService.previewAtNode`'s `selectedRoot`
    resolution" is a mutation instruction that would point at the wrong file.
  - PipelineRunService.scala:141-142 — "the two execution call sites (`executeRun`, `previewStep`) depend on this
    trait reference"; neither call site will be in this file.
  - PipelineExecutionBackend.scala:68.
  - The moved `previewOutputs` doc's "`executeRun`, this method's sibling".

  D7's closing grep (`PipelineRunService.parseTruncationRecord`, `PipelineRunService.scala:[0-9]`, ...) hits none of
  these. Its "this file/class/above/below" sweep is limited to the PipelineRun*.scala files and does not include
  "sibling".

### Verdict: REFUTE

The structural plan (D1-D6, D8, D9) is sound. I checked it against the source and would CONFIRM it on its own. The
blocker is that the item-4 plan contradicts the proposal and the AC, and its evidence was chosen in a way that cannot
show the gap.

- proposal.md says "Fix stale doc refs ... made false by #847 and by this move". The AC says "a grep shows no
  remaining stale refs".
- D7 fixes an enumerated subset, then proves it with a grep built from that same subset. The grep passes by
  construction while ~30 references to members `PipelineRunService` no longer has remain. Several of those are
  introduced by this very change, including a mutation-proof comment that would send a future reader to the wrong
  file.

### Change Requests

1. **Reconcile item-4 scope between proposal.md and design.md D7, explicitly.** Pick one:
   - (a) **Fix all of them.** In scope: every comment-line reference to a member or site that `PipelineRunService` no
     longer holds, across `backend/src/main/scala` and `backend/src/test`. That means `executeRun`, `onRunSuccess`,
     `onUnblockedRunSuccess`, `runPipeline`, `trunkOf`, `upsertFieldsFromRows`,
     `resolveAllRootDataSourcesInternal`, `parseTruncationRecord`, `previewAtNode`, plus the three file-level
     `PipelineRunService.scala` citations above. Migration SQL and archived changes stay excluded, as planned.
   - (b) **Narrow it.** Change the proposal wording to the ticket's enumerated list and file a follow-up that lists
     the remaining sites by file:line.

   Either way, state how test **describe-name strings** are handled (PipelineRunServiceSpec:447 "PipelineRunService.executeRun ...", :547 "PipelineRunService.onRunSuccess ..."). They are not comment lines, so C4 currently forbids editing them. Keep them with a recorded reason, or widen C4 deliberately. Test counts don't change, but the names do.
2. **Refs made false by THIS move must be fixed under either option** (they are not #847 leftovers):
   - OutputRoutesSpec.scala:1981 (`PipelineRunService.previewAtNode` -> `PipelineRunPreview.previewAtNode`)
   - PipelineRunService.scala:141-142 (the `executeRun`/`previewStep` call-site comment on `backend`)
   - PipelineExecutionBackend.scala:68 (`(executeRun, previewStep)`)
   - the moved `previewOutputs` doc's "`executeRun`, this method's sibling" and "both only reachable from
     `executeRun`" wording

   Add "sibling" to the D7 wording sweep, and run that sweep on the moved doc comments as well as the eight files.
3. **Make the closing grep able to fail on what it claims.** Use a member-name pattern for whichever scope (1)
   chooses, for example `PipelineRunService[.#](executeRun|onRunSuccess|onUnblockedRunSuccess|runPipeline|trunkOf|upsertFieldsFromRows|resolveAllRootDataSourcesInternal|parseTruncationRecord|previewAtNode)\b`
   over `backend/src/main/scala` and `backend/src/test`. Record its **non-zero hit count on ecaa1a53** next to the
   zero (or exactly the recorded-exception) count after the change. A grep that is only ever shown returning zero
   proves nothing.

### Non-blocking notes

- Ticket premise says the AI-gate producer is at :486; it is at :487. Correct it in the evidence.
- D5 cascade: after the deletion, `PipelineRepository.findPrimaryDataSourceIdInternal` (:117) has no code callers in
  main or test, only comment mentions. Leave it alone, consistent with this ticket's scope, and name it in a
  follow-up.
- ExistenceNotLeakedRoutesSpec's class doc (:49) links
  `openspec/changes/collapse-owner-only-existence-leak/forbidden-classification.md`. That path is stale; the file is
  under `archive/2026-10-02-...`. This is comment-only, so it can be fixed in the same D2 doc edit.
- The run-status row re-site: write in the evidence that no `PipelineRun*.scala` file calls an access helper, so the
  `sites` change is cosmetic. Don't cite "spec green" as verification of it.
- D6/task 3.1: the bytecode-identity proof for commit (b) has to compare commit (a) against commit (b), covering both
  `PipelineRunPreview` (where the `previewAtNode` reindent lands) and `PipelineRunTerminalWrites`. Task 1.2 captures
  only TerminalWrites at baseline. Capture both classes at (a) before starting (b).
- Measure the "<400" goal (`wc -l`) and record it in the evidence. My ~388 estimate leaves little margin if the
  delegations carry multi-line docs.
