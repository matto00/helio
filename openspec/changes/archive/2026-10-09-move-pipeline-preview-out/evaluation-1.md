## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `ecaa1a532dcbf10b8d7f3664335bff392fd59554...cff162cbf039bf008ef5fff364e622edbc8a5e61` (base resolved live via
`resolve-review-base.sh`; HEAD at the end of the diff read = `cff162cbf039bf008ef5fff364e622edbc8a5e61`, worktree clean).
Commits: cfe71266 (a: move + pin), cba79b0a (b: reindent), 6fb2a57e (c: dead member), 79c27f7b (d: comments), cff162cb (evidence).

### Phase 1: Spec Review — PASS
Issues: none.

- Item 1 (move preview + pin): `previewStep`/`previewOutputs`/`previewAtNode` now live in `private[pipelines] final class
  PipelineRunPreview`. The entry point keeps both public signatures as one-line delegations. `preview` is declared after
  `backend`/`support` (PipelineRunService.scala:155). Entry point is 652 -> 386 lines (< 400).
- Item 2: `resolvePrimaryDataSourceInternal` deleted; `git grep` across `backend/src` at HEAD: 0 hits (3 at base).
- Item 3: dropped with a recorded reason (premise stale: `log` is used by `recordUnrunnable` since HEL-1384). Correct call.
- Item 4: closing grep re-run by me: 33 hits at ecaa1a53, 3 at HEAD. All 3 are the recorded exceptions: describe-name
  strings at PipelineRunServiceSpec:447/:547, and a comment quoting a deleted describe title at :2144. The exclusion
  follows design D7/C4, and the follow-up list in stale-refs-evidence.md names them.
- Item 5: "Defaulted to `None`" is gone from both sites. Callers checked: OutputService.scala:77 passes `output.node.rootId`,
  and PipelineRunServiceOutputHistorySpec:187 plus PipelineRunServiceSpec:2398/2447/2481 pass `None`. The parameter has
  no default, so the new "Required (no default)" wording is true.
- Item 6: whitespace-only. `git diff -w --ignore-blank-lines cfe71266 cba79b0a` touches only openspec md files and no
  backend file. Scala 2.13.15 (build.sbt:4), so indentation is not significant.
- Tasks: every box is checked and matches the commits. HEL-1429 scope is not absorbed. No spec/schema/API change.
- CONSTRAINTS C1-C5: all honored (see Phase 2 evidence).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in WORKTREE_PATH. Backend only: no `frontend/**` change, so the npm gates do not apply.
- The targeted suites passed in one sbt run (`nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly ..."`). Both
  project-path lines name this worktree's `backend/`. Result: `Total number of tests run: 353`,
  `Suites: completed 10, aborted 0`, `failed 0`. The suites were PipelineRunServiceSpec, OutputRoutesSpec,
  ExistenceNotLeakedRoutesSpec, StepConfigInvalidRoutesSpec, UpsertTargetWritableRoutesSpec, PipelineRunRoutesSpec,
  PipelineRunServiceTerminalOrderingSpec, AutoRunGuardBurstProofSpec, AutoRunGuardNoRetryStormSpec and
  PipelineRunGuardIntegrationSpec. 353 equals the sum of the per-suite baseline counts in test-count-evidence.md
  (87+101+61+12+16+52+10+3+1+10), so this was a real run and not an sbt cache no-op. Embedded-Postgres activity is
  timestamped in the log. The AutoRunGuardBurstProofSpec flake (HEL-1439) did not occur, so no re-run was needed.
- Full `testFull` was not re-run (the orchestrator made it optional). C1's full-suite equality rests on the executor's
  base/after per-suite JSON (462 suites, 6436 succeeded on both sides). My targeted run independently agrees on every
  highlighted suite.
- `node scripts/check-scala-quality.mjs`: clean (soft warnings only; PipelineRunPreview.scala at 298 lines is above the
  250 soft budget, so it gets a soft warning only).

Constraint checks I re-ran independently:
- **C3 (move byte-identity):** base PipelineRunService.scala:261-534 against PipelineRunPreview.scala at cfe71266 lines
  24-297: `diff` is empty, and the remaining 24 lines are the D1 scaffold (package, imports, class header, `import support`,
  closing brace). The base vs cfe71266 entry-point diff has exactly these hunks: 3 import lines, `import support` removed
  (:153), the `preview` val added, and :261-534 replaced by the two delegations plus their docs. Nothing else.
- **C3 (whitespace commit):** `git diff -w --ignore-blank-lines` of commit (b) shows no backend file. I did not re-run
  the executor's `javap -c -p -l` equality. The text-level proof is self-authenticating for Scala 2.13.
- **C2 / pin red check:** I re-ran it myself in a throwaway detached worktree at cff162cb, outside WORKTREE_PATH, and
  removed it afterwards. I injected a third `ServiceError.Forbidden("red")` into PipelineRunPreview.scala and ran
  `testOnly ExistenceNotLeakedRoutesSpec`. Result: `*** FAILED ***` on "pin the per-file count...", with
  `"PipelineRunPreview.scala" -> 2 ... was not equal to ... "PipelineRunPreview.scala" -> 1` and `Tests: succeeded 60,
  failed 1`. The scanner (`forbiddenProducerCounts`, keyed by file name over every main `.scala` file, exact map
  equality) is unchanged. Only the map values changed, so a producer in a brand-new file necessarily fails too: the map
  gains a key. A live grep at HEAD finds exactly 1 producer in PipelineRunService.scala (`submit`) and 1 in
  PipelineRunPreview.scala (AI gate).
- **C4:** `git diff -U0 ecaa1a53 HEAD -- backend/src/test`, filtered to non-comment lines, shows exactly 5 lines: the
  run-status row site moved to `PipelineRunQueries.scala`, and the pin map split from 2 into 1+1. Every other test change
  is a comment line. No describe/it string changed.
- **C5:** the source diff shows the public surface unchanged: both delegation signatures are byte-identical to base, and
  no other public member was touched. I did not re-run the executor's javap -public evidence (diff empty, with a red run
  adding a defaulted param that shows non-empty). The source-level reading agrees with it.
- **Commit (d) is comment-only:** the only non-comment changed line across `backend/` is the README collaborator bullet.
  Retargeted symbols were spot-checked against their definitions: `PipelineRunExecutor.{runPipeline,executeRun,
  executeRunSuccess,onRunSuccess}`, `PipelineRunSucceededWrites.onUnblockedRunSuccess`, `PipelineRunTerminalWrites.
  {executeRunFailure,onDryRunSuccess,onBlockedRun}`, `PipelineRunQueries.parseTruncationRecord`,
  `PipelineRunBackfill.{evaluateNodeRowsForBackfill,persistBackfilledRows}` (defined below its referrer, so "below" is
  right), `PipelineStepRepository.trunkOf`, `PipelineRunSupport.resolveAllRootDataSourcesInternal`. All resolve.

Checklist: canonical code-quality (imports, no inline FQNs, budgets) PASS. DRY: delegation, no duplication; PASS.
Readable PASS. Modular PASS. Type safety unchanged. Security: the existence-not-leaked guard is preserved (red-checked).
Error handling unchanged. Tests unchanged and still exercise every preview arm through the public API. No dead code
added: the dead member was removed and unused imports were dropped. No over-engineering. Behavior-preserving
refactor: verified as above.

### Phase 3: UI Review — N/A
No changed file matches `frontend/**`, `schemas/**`, `openspec/specs/**` or `ApiRoutes.scala` (0 matches in
`git diff --name-only`).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- PipelineRunService.scala:278-280 and PipelineRunBackfill.scala:68-70: "`None` ... for the single-root case" describes
  what `None` means, not an actual caller. At write time `OutputRepository` (:229-234) always resolves a root-bound
  Output's `rootId` to `Some(...)`, so the only production caller (OutputService:77) never passes `None` for a
  root-bound Output. Only tests pass `None`, and always with a step-bound node. Consider "`None` means the
  lowest-positioned root, which is only correct for a single-root pipeline" if this is touched again.
- ExistenceNotLeakedRoutesSpec:335's `withClue` says to update `forbidden-classification.md` "together". That archived
  file still records `PipelineRunService.scala -> 2`, and it is deliberately not edited (archived history). The new doc
  line at :517-519 explains the move, which is enough. Worth a one-line mention in the PR body so a reader
  cross-checking the archived classification is not surprised.
- Follow-ups already listed in stale-refs-evidence.md should be filed as planned: describe-name strings naming moved
  members (PipelineRunServiceSpec:447/:547/:749/:2167) and the now caller-less
  `PipelineRepository.findPrimaryDataSourceIdInternal`.
