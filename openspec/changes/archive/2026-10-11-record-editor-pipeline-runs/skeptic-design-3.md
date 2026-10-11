## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 5a53d24b965a18e98729478b47949288cbb374d4, which equals origin/main after a fresh `git fetch`. The planning artifacts and `Hel1492ReproSpec.scala` are uncommitted.

### What I verified (with evidence)

- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=bug/editor-pipeline-runs-unrecorded/HEL-1492`.
- **Round-2 CR1 (retention) is fixed:**
  - Task 3.1 now names `deleteOldRunsInternal` at the preExec site. That site is live at `PipelineRunExecutor.scala:153-156`.
  - Task 3.2 names `deleteOldDryRunsInternal` at `PipelineRunTerminalWrites.scala:127`.
  - Test 5.3c covers both, at 11 runs leaving 10 rows, each failable by the owner-scoped mutation.
  - D5 repeats the same.
- **Every owner-scoped write site an editor run reaches is covered by a task.** I enumerated the user-scoped `updateRunTerminal`/`updateLastRun`/`insertDryRun`/`deleteOld*` calls by grep:
  - TerminalWrites :78/:81 (`executeRunFailure`), :126/:127 (dry), :157/:160, and :189/:192.
  - SucceededWrites :229/:232.
  - Executor :147/:154.
  - Each one sits inside 3.1 or 3.2 and is exercised by one of the 5.3a branches.
  - `updateLastSourceSchema` (SucceededWrites :252) is an explicit Non-goal.
  - `recordUnrunnable` (PipelineRunService :219) is reached only from proposal create and the scheduler, both owner-only, so no editor path reaches it.
- **The privileged siblings carry every field D4's ordering invariants need:**
  - `updateRunTerminalInternal` (:199) takes `truncatedReadsJson`.
  - `updateLastRunInternal` (PipelineRepository :527) takes `rowCount` and `truncated` in the same statement, with no default.
  - `insertDryRunInternal` (:228) takes `truncatedReadsJson`.
  - "Use the existing `*Internal`" is therefore implementable without loss.
- **D2's re-auth predicate:**
  - `findGrantRole` (PipelineRepository :180-191) is a plain `resource_permissions` lookup by type, resource id and grantee. "Same predicate" is unambiguous.
  - The current owner-keyed cap method (`PipelineRunRepository.scala:129-159`) shows the lock/count/insert composition D2 mirrors under `withSystemContext`.
- **Owner-side visibility:** the owner's count runs under the owner's RLS context. Editor rows inserted via system context on the owner's pipelines satisfy V35's owner `EXISTS` and are counted, so "editor in flight → owner 429" needs no owner-path change. This agrees with round 2.
- **Cited test ranges re-read at HEAD and accurate:**
  - GuardIntegrationSpec :370-385.
  - RepositorySpec :626-638 (`NotOwned`).
  - ServiceSpec :521-545 (two editor tests).
- **Migration number:** `origin/main` ends at V123. No sibling worktree has a V124-V129 file, so V124 is free.
- **Spec deltas:**
  - Both MODIFIED headers match the live specs exactly: `pipeline-run-guard/spec.md:34` and `pipeline-assert-evaluation/spec.md:85`.
  - The guard delta keeps all five live scenarios (:42-59) and adds two.
  - `npx openspec validate record-editor-pipeline-runs --strict` → `Change 'record-editor-pipeline-runs' is valid`.
- **AC coverage:** I mapped each ticket AC to a task or test:
  - success/fail/blocked/write-back → 5.3a
  - cap → 5.3
  - dry → 5.3a
  - attribution incl. hook → 5.4
  - retention → 5.3c
  - viewer/non-grantee/revoked → 5.4/5.3b
  - CLAUDE.md → 4.1
  - red-first NOBYPASSRLS → 5.1/C5
- **Round-2 non-blocking notes are folded in:**
  - In-flight fixture and stale comments → D5.
  - Hook attribution → 5.4.
  - SparkJobSubmitter NULL → Planner Notes.
  - Scheduler/hook visibility → Planner Notes.

### Verdict: CONFIRM

The design is sound enough to implement. I found no placeholders, contradictions or uncovered ACs, and the round-2 change request is resolved in both the tasks and the tests.

### Non-blocking notes (for the executor and evaluator)

- **Task 2.3 and the owner path.** After `NotOwned` is retired, the owner path's `insertRunIfUnderConcurrencyCap` can still find `pipelineOwnedAction == false`, for example when the pipeline is deleted mid-submit. That method must then return the non-admitting case (`NotAuthorized` → `Forbidden`) too, never `Inserted`, and never fall through to `Right`. The evaluator should grep the final `match` in `executeRun` for any arm that admits a non-`Inserted` result.
- **Editor dry run with a grant revoked mid-run.** The re-authorizing dry-run insert (2.2) will write nothing. The subsequent `insertAssertions` then has no parent row and relies on the existing `recoverWith` in `persistAssertions`. Keep that guard; the response shape must not change.
- **New `withSystemContext` call sites.** Each new site needs the required inline justification comment, or the code-quality hook will flag it.
