## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 5a53d24b965a18e98729478b47949288cbb374d4 (planning artifacts and the repro spec are uncommitted).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/editor-pipeline-runs-unrecorded/HEL-1492`.
- **The root cause claims hold.** `PipelineRunRepository.scala:129-159` (`insertRunIfUnderConcurrencyCap`) keys the lock on `user.id.value` (:149, :167-168), counts over pipelines the caller owns (:143) and returns `NotOwned` for a non-owner (:151). `PipelineRunExecutor.scala:153` admits `Inserted | NotOwned`. `insertRun`, `updateRunTerminal`, `insertDryRun`, `deleteOldRuns` and `deleteOldDryRuns` are owner-filtered no-ops (:45-56, :172-193, :221-225, :247-277), and so is `PipelineRepository.updateLastRun` (:492-510). The `*Internal` siblings exist and use `withSystemContext`, the privileged BYPASSRLS pool (`DbContext.scala:53-64`). The repro evidence (`.concertino/runs/HEL-1492/evidence/repro.md`) matches.
- **D1 premise holds.** `runPipeline` has exactly two callers, both in `submit` (`PipelineRunService.scala:199` and `:205`). The editor branch is gated on `findGrantRole == Some("editor")` (:196-200).
- **Write-site enumeration.** I grepped every caller of the run, last-run and assertion write methods in `backend/src/main/scala`. The design's list is complete for the editor-reachable path: executor :147/:155; TerminalWrites :78/:81, :103, :126-127, :157/:160, :189/:192; SucceededWrites :229/:232. Out of scope: :252 `updateLastSourceSchema` (a declared non-goal), `recordUnrunnable` (its callers, the scheduler and `PipelineProposalService.createPipeline`, always run as the owner) and `SparkJobSubmitter` (dormant, no user).
- **Lock correctness.** The editor path takes the same `hashtext('pipeline-run-concurrency:' || ownerId)` key as the owner path. Advisory locks are database-wide, so keying matters but the connection pool does not. Only one lock is taken per submit, so there is no lock-ordering deadlock. There is no ownership-transfer path (grep found no `owner_id` update), so `pipeline.ownerId` is stable. Under V35's `pipeline_runs_owner` policy (EXISTS on `pipelines.owner_id`), the owner's RLS-scoped count includes rows inserted by an editor on the owner's pipelines. So "an in-flight editor run → the owner gets 429" works with the owner path unchanged.
- **Migration.** On `origin/main` (fetched) the latest migration is V123, and no local or remote branch carries V124-V129, so V124 is free right now. The DDL in D3 matches the V74 precedent, which did the same ALTER on this FORCE-RLS table with `ON DELETE SET NULL`. `users.id` is UUID (V6). The migration is DDL only with no data UPDATE, which avoids the v0.7.x incident class. Privileges are granted per table, so the new column needs no extra GRANT.
- **Spec delta.** I diffed the MODIFIED `pipeline-run-guard` requirement against `openspec/specs/pipeline-run-guard/spec.md`. The header is identical and the only changes are the owner-budget wording plus 2 new scenarios. That is well-formed.
- **Owner rulings Q1-Q5.** All five are reflected in D1-D3 (owner budget, attribution column, editor dry-run row, privileged writes after the ACL check, RLS unchanged).

### Verdict: REFUTE

The design direction is sound and faithful to the rulings. These five revisions are required before execution.

### Change Requests

1. **AC/spec contradict D2 on when authorization is checked.** ticket.md's AC says "A privileged write never happens for a user who is neither owner nor editor **at write time**", and the ADDED requirement in `specs/pipeline-run-execution/spec.md` says the same. D2, however, re-authorizes only at admission (the queued-row insert and the dry-run insert). The later terminal, last-run, retention and assertion writes go through `*Internal` with no re-check. If a grant is revoked mid-run, those privileged writes still happen, so the literal AC is violated. D2's behaviour is the correct one: re-authorizing at terminal time and skipping the write would leave a permanently non-terminal `queued` row that holds one of the owner's cap slots forever. Fix the AC and spec wording to say "authorized when the run is admitted (re-verified in the admitting transaction). Lifecycle-completion writes for an admitted run id always complete." Also state in D2 why this is required (the stuck-slot problem).

2. **A live spec still requires the old behaviour and has no delta.** `openspec/specs/pipeline-assert-evaluation/spec.md:85-100+`, "Persisting assertion results never turns a silent no-op run into an unhandled failure", describes insertRun/insertDryRun silently no-op'ing for an editor grantee. Its scenarios are "Editor-grantee-triggered real/dry run resolves normally despite no persisted run row". Add a MODIFIED (or REMOVED-and-replaced) delta for `pipeline-assert-evaluation`, and list the capability under "Modified Capabilities" in proposal.md.

3. **The list of tests that pin the old behaviour is incomplete.** Task 5.2 names only the two `PipelineRunServiceSpec` tests (:521-545). Two more tests encode the opposite of the new ACs:
   - `PipelineRunGuardIntegrationSpec.scala:370-385`, "a non-owner (editor grantee) real run still resolves normally, NEVER as a 429 (regression guard)". The owner fills the cap, then the editor submit is asserted `Right`.
   - `PipelineRunRepositorySpec.scala:626-638`, "insertRunIfUnderConcurrencyCap returns NotOwned ...".

   Add a task that inverts these, rather than deleting them. The first becomes the "owner at cap → editor 429, never executed" scenario. The second becomes a repository-level test of the new grantee method with a non-grantee or revoked grant (`NotAuthorized`). Also update the NotOwned rationale in the doc comments at `PipelineRunRepository.scala:124-128` and `:443-447` and `PipelineRunExecutor.scala:149-152`.

4. **D5 promises a mutation proof that the listed tests cannot deliver.** D5 says "lock keyed by submitter id" must be shown failable. Every cap test in 5.3 is serial (owner at cap → editor; editor in flight → owner). Serial tests pass whatever the lock is keyed on, because the count, not the lock, decides them. Specify a deterministic lock test, for example:
   - On a separate JDBC session, take `pg_advisory_lock(hashtext('pipeline-run-concurrency:' || <ownerId>))`.
   - Call the editor grantee cap-insert, assert it has not completed within a bounded wait, release the lock, then assert it completes.

   Under the submitter-key mutation the insert completes immediately, so the test goes red. Without such a test, the most security-relevant line of this change (C1's "owner-keyed lock") has no guard.

5. **Not every editor terminal branch is in the test plan, and this change makes a missed one costly.** Editor rows now count toward the owner's cap. Any editor terminal branch left on the owner-scoped `updateRunTerminal` would silently leave a permanently non-terminal row, which permanently consumes one of the owner's slots. That is a new failure mode this change introduces. D5 and tasks 5.x cover success, failure, blocked and dry. Add both write-back failure branches: `onWriteBackFailure` reached via a `Left` (`PipelineRunExecutor.scala:306-308`) and via an exception (`:301-304`). Every editor-branch test must assert the row reaches a terminal status and `last_run_*` is updated. State this stuck-slot risk in Risks.

### Non-blocking notes

- **`SparkJobSubmitter` attribution.** It is dormant, and its `insertRunInternal` call (`SparkJobSubmitter.scala:69`) will write a NULL `triggered_by_user_id`. Either note it as the explicit exception to the AC "every newly written row records triggered_by_user_id", or thread `None` with a comment saying so.
- **Inline comments on privileged calls.** `DbContext.withSystemContext` requires an inline comment explaining why the bypass is correct at every call site. That applies to the new grantee methods and to each new `*Internal` branch.
- **Revoke race window.** The in-transaction re-auth runs under READ COMMITTED and takes no row lock on `resource_permissions`. A revoke committing concurrently can therefore still miss the check. This is acceptable (the window is a single transaction), but D2 could say so.
- **Lock-key format.** The owner path keys on `user.id.value` and the editor path on `pipeline.ownerId.value` (`UUID.toString`, lowercase). These are identical only while user ids are canonical lowercase UUID strings. `submit`'s own owner comparison already assumes this, so it is fine, but D2 could pin the editor key to `pipeline.ownerId.value` explicitly.
- **HEL-505 Decision 4.** Its "no new privileged/system-context bypass is introduced" for the cap check is superseded for the editor path by owner ruling Q5. D2 could cite this so a future reader does not see it as a regression.
