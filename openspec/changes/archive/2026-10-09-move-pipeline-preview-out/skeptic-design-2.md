## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD ecaa1a532dcbf10b8d7f3664335bff392fd59554 (= origin/main; the change dir is untracked).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipelinerunservice-preview-split-tidy/HEL-1393`.
- **Ranges and size:** `wc -l PipelineRunService.scala` = 652. `previewStep`'s doc opens at :261 and `previewAtNode`
  closes at :534. 652 - 274 = 378. The two delegations and the `preview` val add roughly 9 lines, so the file lands at
  about 387, which is under 400. Task 6/D9(iv) records the measured value.
- **The moved code has no hidden dependency on the entry point.** I read :261-534. The bodies reference
  `pipelineRepo`, `pipelineStepRepo`, `dataSourceRepo`, `outputRepo`, `backend` and the four `support` members. They
  do not reference the `PipelineRunService` companion (`EmptyTruncationJson`/`SparkUnsupportedKinds`), `log`, or
  `getClass`. D1's constructor list and `import support.{...}` are therefore sufficient. The rest are type imports,
  and D4's scaffold allow-list covers those.
- **Forbidden producers:** grep shows `PipelineRunService.scala:199` (`submit`) and `:487` (AI gate). D1 now records
  :487 instead of the premise's :486, which closes the round-1 note.
- **Pin mechanics:** `forbiddenProducerCounts()` (spec ~:488) uses code lines only, across every main `.scala` file,
  and is compared by exact map equality. D2 splits `2` into `1 + 1` and leaves the comparison unchanged. Its two red
  checks fail for different reasons (a count changes; a new key appears). Rows :455/:457 (`submit`, dry run) still
  point at `PipelineRunService.scala` correctly. Row :456 (run status) moves to `PipelineRunQueries.scala`, where
  `runStatus` lives (`PipelineRunQueries.scala:64`). D2 now states that this re-site is cosmetic and that a green spec
  does not verify it, which closes the round-1 note.
- **CR1 (item-4 scope), closed.** D7 picks option (a): fix everything. The proposal says "made false by #847 and by
  this move", so the two artifacts now agree. Describe/it name strings are explicitly excluded, with a reason (test
  identity, C4, and the by-name baseline in D9), and are routed to a follow-up.
- **CR2 (refs made false by this move), closed.** D7 names all four as must-fix: OutputRoutesSpec:1981,
  PipelineRunService.scala:141-142, PipelineExecutionBackend.scala:68 (confirmed: "`PipelineRunService`'s two
  execution call sites (`executeRun`, `previewStep`)"), and the moved docs' "sibling" / "only reachable from
  `executeRun`" wording. "sibling" is added to the wording sweep, and the sweep covers all nine PipelineRun*.scala
  files, including the new one.
- **CR3 (the closing grep can fail), closed.** I ran D7's exact closing grep on ecaa1a53. It returns **33 hits**, so
  it can fail. Two of those hits are the describe strings D7 lists as exceptions (PipelineRunServiceSpec:447 and :547).
  Every other hit is a comment and is in D7's scope. So the "after" count has a concrete expected value of 2, and the
  grep cannot pass by construction.
- **Round-1 non-blocking notes, all addressed:**
  - `findPrimaryDataSourceIdInternal` has a follow-up. Grep confirms that after D5 it has no code caller outside its
    own repository docs.
  - ExistenceNotLeakedRoutesSpec:49's stale classification path is in D7.
  - Task 3.0 captures both classes at commit (a).
  - `wc -l` is recorded.
- **D5:** `resolvePrimaryDataSourceInternal` appears only at PipelineRunSupport.scala:105 (definition) and in the doc
  refs at :113/:117. It has zero callers in main or test.
- **D6:** `executeRunFailure`'s body is indented 8 extra spaces (PipelineRunTerminalWrites.scala:52 onward).
  `previewAtNode` has under-indented blocks after `case _ =>` (:411 on) and `case true =>` (:489 on). Re-indenting
  keeps line counts the same, so a `javap -c -p -l` equality check across commit (a) and commit (b) is a valid proof.
- **Template present:** `openspec/changes/archive/2026-10-08-split-pipeline-run-service/move-check/{check.py,javap.sh,spec.json}`
  exist, as D4/D9 assume.

### Verdict: CONFIRM

All three round-1 change requests are closed, and I checked each fix against the source rather than the revision
notes. The structural plan (D1-D6, D8, D9) was already sound in round 1, and I re-checked it here.

### Non-blocking notes

1. **Closing-grep blind spot: file-level citations without a line number.** D7's grep matches
   `PipelineRunService.scala:[0-9]` only. Three must-fix citations carry no line number, so the grep cannot fail on
   them:
   - PipelineStepRepository.scala:1092
   - PipelineRunRoutesSpec.scala:636
   - V94OutputsMigrationSpec.scala:592

   D7 enumerates all three, so they will still be fixed. Recommend that stale-refs-evidence.md also run
   `grep -rnE 'PipelineRunService\.scala\b' backend/src/main/scala backend/src/test` and classify every hit before and
   after the change. Expected survivors: spec rows :455/:457 and the pin entry.
2. **Another describe-name exception the grep cannot see.** PipelineRunServiceSpec.scala:749 is
   `"PipelineRunService onRunSuccess (HEL-462 ...)" should`. It uses a space rather than a dot, so the closing grep
   misses it. Add it to the describe-name follow-up list. Separately, :2144 is a *comment* quoting a describe name, so
   it falls under the in-scope fixes, not the exceptions.
3. **Visibility convention.** D1 turns `previewStep`/`previewOutputs` into `private[pipelines] def`. #847's siblings
   (`PipelineRunQueries.latestRun`/`runStatus`/`history`, `PipelineRunBackfill.backfillOutputNode`) use a plain `def`
   inside a `private[pipelines]` class. Plain `def` would match the convention and make the move a zero-substitution
   byte copy for those two lines. Either choice is harmless; this is a consistency preference only.
4. **Bare backtick refs inside the entry point are outside D7's scope.** Examples are the constructor-param comments
   "rate-limit check in `executeRun`" (:~95) and "skip the post-run evaluation hook in onRunSuccess" (:~41). They
   describe behaviour that is still true and make no location claim, so leaving them is defensible. The wording sweep
   should record them as TRUE rather than skip them silently.
