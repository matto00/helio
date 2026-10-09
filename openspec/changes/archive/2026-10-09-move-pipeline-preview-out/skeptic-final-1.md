## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed: `ecaa1a532dcbf10b8d7f3664335bff392fd59554...cff162cbf039bf008ef5fff364e622edbc8a5e61`. The base was resolved live with
`resolve-review-base.sh` (exit 0). It equals the parent of commit (a). HEAD was cff162cb when I finished reading the diff.
The worktree is clean apart from the untracked evaluation-1.md.

All compiles and test runs happened in scratch copies made with `git archive <commit> backend` under the session scratchpad.
That kept the worktree untouched and did not register a new git worktree. Every command used `nice -n 19` and ran one at a time.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/pipelinerunservice-preview-split-tidy/HEL-1393`.

**AC item 1, the move (C3).** I extracted base `PipelineRunService.scala:261-534` and cfe71266 `PipelineRunPreview.scala:24-297`, then ran `diff`.
- Result: `MOVE-IDENTICAL`, so the moved block is byte-identical.
- The other 24 lines are scaffold: package, imports, class header, the `import support.{...}` line, and the closing brace.
- At cfe71266 the entry-point diff has only these hunks: 3 import lines narrowed, `import support` removed, `private val preview = new PipelineRunPreview(...)` added after `backend`/`support`/`executor`, and :261-534 replaced by the two one-line delegations with their docs.
- I also checked symbol resolution in compiled bytecode. Every Method, Field, InterfaceMethod and class reference made by the preview methods and their lambdas is the same in base `PipelineRunService` and cfe71266 `PipelineRunPreview`, once owner names are normalised. The only differences are constructor `<init>` lines and field-vs-accessor access for constructor params. So the moved code did not silently bind to a different symbol.
- Entry point is now 386 lines (`wc -l`), below the 400 target.

**AC item 1, the pin (C2): updated, not weakened, and fails when it should.**
- `expectedForbiddenProducers` changed from `PipelineRunService.scala -> 2` to `PipelineRunPreview.scala -> 1` plus `PipelineRunService.scala -> 1`. The scanner (`forbiddenProducerCounts`, `codeLines`) and the exact-equality assertion (`actual shouldBe expectedForbiddenProducers`) did not change.
- A live grep finds `PipelineRunService.scala:200` (`submit`) and `PipelineRunPreview.scala:250` (the AI-closure gate).
- Red check 1: I added a third producer `Left(ServiceError.Forbidden("red"))` to `PipelineRunPreview.scala` in a scratch copy of 79c27f7b. Result: `pin the per-file count ... *** FAILED ***`, actual map shows `"PipelineRunPreview.scala" -> 2`, `Tests: succeeded 60, failed 1`.
- Red check 2: I added a producer in a brand-new file `RedProbe.scala`. Result: `*** FAILED ***`, actual map gains `"RedProbe.scala" -> 1`, `Tests: succeeded 60, failed 1`.
- Both runs failed only the pin test.
- The run-status row now names `PipelineRunQueries.scala` as its site. That is correct: `PipelineRunQueries.runStatus` (:64) holds the `findByIdShared` lookup.

**AC item 2, dead member, behaviour-preserving.**
- `grep -rn resolvePrimaryDataSourceInternal backend/src frontend/src` finds 0 hits.
- Compiled bytecode at cba79b0a vs 6fb2a57e (`javap -c -p` over all 3132 classes, constant-pool indices normalised): the only differences are the removed private method and its `$anonfun$resolvePrimaryDataSourceInternal$1`. Raw diff hunks are confined to `PipelineRunSupport`'s disassembly.

**AC item 3:** dropped with a recorded reason (`log` is used by `recordUnrunnable`). The ticket premise states this and I accept it.

**AC items 5 and 6, behaviour-preserving.**
- Whitespace commit: `javap -c -p -l` over all 3132 classes at cfe71266 vs cba79b0a is byte-identical (`cmp`, 2,453,508 lines each). This includes line-number tables. `git diff -w --ignore-blank-lines cfe71266 cba79b0a -- backend` gives 0 lines.
- Comment commit (d): `javap -c -p` over all classes at 6fb2a57e vs 79c27f7b is byte-identical (`cmp`). It omits `-l` on purpose, because two files gain a comment line and that shifts line tables.
- Textually, the only non-comment backend line changed in (d) is the package README collaborator bullet.
- cff162cb touches no backend file.
- Item 5's new wording "Required (no default)" is true: `backfillOutputNode`'s `explicitRootId` has no default at either site. Callers are OutputService:77 and four test sites.

**C5, public API.**
- I ran unfiltered `javap -public` on `PipelineRunService`, `PipelineRunService$`, `CachedRunStatus(+$)` and `TriggerSource(+$)`, comparing base against 79c27f7b.
- Every removed line is synthetic: `$anonfun$previewOutputs*`/`$anonfun$previewAtNode*`/`*$adapted`, plus the mangled accessor `com$helio$services$pipelines$PipelineRunService$$support()`.
- No source-visible public member changed. `previewStep`/`previewOutputs` keep their signatures.

**C4, test-source diff.** I listed every changed line under `git diff ecaa1a53 HEAD -- backend/src/test`.
- The only non-comment lines are the run-status row site and the pin map split, 5 lines in total.
- Everything else is comment or doc lines.
- No describe or it string changed.

**AC item 4, stale-refs grep.**
- I ran the design's closing regex: 33 hits at ecaa1a53, 3 at HEAD.
- The 3 are the describe strings `PipelineRunServiceSpec:447` and `:547`, plus a comment at `:2144` quoting a deleted describe title. Design D7 and C4 exclude them, and stale-refs-evidence.md lists them as a follow-up.
- `[[runPipeline]]`, "`onBlockedRun`'s persistence pattern below" and the archived `forbidden-classification.md` path are all fixed. The archive path exists.
- I spot-checked the retargeted symbols against their definitions and all of them resolve:
  - `PipelineRunExecutor.runPipeline`, `executeRun` and `onRunSuccess`
  - `PipelineRunTerminalWrites.onDryRunSuccess` and `onBlockedRun`
  - `PipelineRunSucceededWrites.onUnblockedRunSuccess`
  - `PipelineStepRepository.trunkOf`
- Bare `PipelineRunService.scala:` citations remain only in V94 migration SQL. Applied migrations cannot change, so the exclusion is recorded.

**Gates (fresh).**
- I compiled the backend at all five relevant commits from archives. `sbt compile` exited 0 for ecaa1a53, cfe71266, cba79b0a, 6fb2a57e and 79c27f7b.
- I then ran `testOnly ExistenceNotLeakedRoutesSpec PipelineRunServiceSpec OutputRoutesSpec` at 79c27f7b: `Total number of tests run: 249`, `Suites: completed 3, aborted 0`, `Tests: succeeded 249, failed 0`. 249 = 61 + 87 + 101, which matches the baseline per-suite counts, so the run was not a cache no-op.
- I did not re-run full `testFull`. Commits (b), (c) and (d) are proven bytecode-identical, or differ only by the removed private dead method. So (a) is the only commit that can change behaviour, and the preview-exercising suites I ran cover it. The executor's full-suite before/after equality (462 suites, 6436 each) is consistent with this, and I accept it as corroborating.
- AutoRunGuardBurstProofSpec was not in my run, so the flake was not observed.

**UI review:** N/A. No `frontend/**` change, so I did not start servers.

**Evidence-ordering:** none of my conclusions depend on mtimes. Every claim rests on content diffs, `cmp`, or test output.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineRunService.scala:278-280` and `PipelineRunBackfill.scala:68-70` (the evaluator noted this too): "`None` ... for the single-root case" describes what `None` means, not what any production caller does. OutputService passes `output.node.rootId`. The wording is not false, but it is imprecise.
- `PipelineRunSucceededWrites.scala:~154` rewrites a quoted design.md decision title ("...wired into PipelineRunExecutor.onRunSuccess"). The quote no longer matches the archived design doc's literal title. This is cosmetic.
- The `withClue` at `ExistenceNotLeakedRoutesSpec:335` says to update forbidden-classification.md "together". The archived copy still says `PipelineRunService.scala -> 2`, and it is deliberately unedited. Mention this in the PR body.
- Follow-ups to file, already listed in stale-refs-evidence.md:
  - describe-name strings at `PipelineRunServiceSpec:447/:547/:749/:2167`
  - the now caller-less `PipelineRepository.findPrimaryDataSourceIdInternal`
- The phrase "Defaulted to `None`" also appears on other parameters (OutputProtocol:27, model.scala:860, DataSource:56, NodeSnapshotRepository:170, OutputRepository:197, PipelineStepRepository:434). These are outside the ticket's item 5. Whether each is still true was not checked; a future sweep could check them.
