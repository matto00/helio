## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `f478fa464c5d13193327c1c5e2387376650500f8` against base `5a53d24b965a18e98729478b47949288cbb374d4`
(resolve-review-base.sh, live). Spawn guard: `READY ambient=/home/matt/Development/helio branch=bug/editor-pipeline-runs-unrecorded/HEL-1492`.

### Phase 1: Spec Review — FAIL (one artifact issue, see CR2)

- All ticket ACs are addressed:
  - Editor real success: row, row_count, assertions, all four `last_run_*` fields.
  - Editor failure, blocked, write-back `Left` and write-back throw: each reaches terminal `failed` in both places.
  - Owner-budget cap: 429 with Retry-After and no execution; the in-flight editor run holds the owner's slot.
  - Editor dry run: `dry_run` row and assertions; `last_run_*` untouched; no cap.
  - Attribution: owner, editor, editor dry, scheduled, unrunnable, and hook token user (HookRoutesSpec).
  - Retention: 11 runs leave 10, for both real and dry.
  - Viewer gets 403 and a non-grantee gets 404, with nothing written.
  - Re-authorization happens in the same transaction as the insert, and lifecycle writes never re-authorize.
  - RLS policies are unchanged (no policy SQL in the diff).
  - CLAUDE.md is updated.
- No AC was silently reinterpreted. Every task is ticked and matches the code. There is no scope creep.
- Constraints:
  - C1–C4 are honored in the diff.
  - C5 is only partly evidenced; see Phase 2 and CR1.
- Owner path:
  - Owner path behaviour is unchanged except for one case: the owner-path `NotOwned` became `NotAuthorized` → Forbidden.
  - That case is reachable only when the pipeline was deleted mid-submit. This is intended (skeptic-design-3 note 1).
- CLAUDE.md edit: accurate.
  - The owner-keyed lock and count are confirmed in `countAndInsertAction`/`insertGranteeRunIfUnderOwnerCap`.
  - The editor run is recorded with the same rows and `last_run_*`.
  - `triggered_by_user_id` is "not exposed in any API response": I grepped `backend/src/main`, `schemas/` and `frontend/src`. The only references are the repository and the migration; `PipelineRunRecord` has no such field.
- Issue (CR2): the MODIFIED `pipeline-assert-evaluation` delta keeps two scenario titles that now state the opposite of their bodies.
  - The titles say "...resolves normally despite no persisted run row".
  - The THEN clauses say the row IS persisted, with the note "(the scenario name is historical...)".
  - At archive this ships a self-contradicting canonical spec.

### Phase 2: Code Review — FAIL (C5 evidence gap, see CR1)

**Gates (my own fresh run):**
- `nice -n 19 sbt -J-Xmx3g testFull` ran in WORKTREE_PATH with MemAvailable at 49.5 GB.
  - Result: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
  - Result: `Tests: succeeded 6985, failed 0, canceled 4`.
  - `PipelineRunEditorPersistenceSpec` ran 22 tests.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1492/evidence/HEL-1492-evaluator-1-testFull.txt`.
  - The sbt server was shut down afterwards (`sbt shutdown`, exit 0).
- Also clean:
  - `npm run check:scala-quality` (no inline FQNs).
  - `check:openspec`.
  - `format:check`.
  - `check:spec-structure`.
  - `check:test-temp-dir-hygiene`.
  - `check:repo-integrity`.
- The backend-only change triggers no frontend gates.

**Skeptic-design-3 notes:**
- *Only `Inserted` admits.* Confirmed. In `PipelineRunExecutor.scala` the `admission.flatMap` arms are:
  - `Inserted` → retention, then `Right`.
  - `CapExceeded` → 429.
  - `NotAuthorized` → `Forbidden`.
  - `NotOwned` no longer exists (grep of main: only a doc mention).
  - The owner path returns `NotAuthorized`, not `Inserted`, when `pipelineOwnedAction` is false.
- *`persistAssertions` recoverWith kept.* Confirmed at `PipelineRunTerminalWrites.scala:122`.
- *Justification comments on new `withSystemContext` sites.* Confirmed. Both new sites carry the inline justification: `PipelineRunRepository.scala:216-218` and `:313-315`. The site at `:320` is the pre-existing `insertDryRunInternal` call, moved one line.
- `DbContext.withSystemContext` is `.transactionally`. So the grantee path's owner read, advisory xact lock, re-auth predicate, count and insert really are one transaction.

**ExistenceNotLeakedRoutesSpec `PipelineRunExecutor.scala -> 1`:** classification accepted.
- The file has exactly one `ServiceError.Forbidden`, the `NotAuthorized` arm.
- It is reachable only after `submit` has resolved the pipeline via `findByIdShared(.., Some(user))` and passed the owner-or-editor gate, so it discloses nothing the caller could not already see.

**V124 / user-reference-inventory:**
- V124 is additive and nullable: FK `users(id) ON DELETE SET NULL`, with no default, no backfill and no UPDATE.
- The inventory gained the `pipeline_runs | triggered_by_user_id | SET NULL` row that `V119OwnerFkMigrationSpec` needs. That spec passes in my run.
- The row is out of alphabetical order (non-blocking, below).

**Commit hygiene:**
- There is no claude.ai session link and no Claude-Session trailer in the commit message.
- There is no PR yet.

**Red-first and mutation-proof audit (as requested):**
- *Red run.* `HEL-1492-red-run.txt` contains 12 tests: 10 FAILED and 2 passed.
  - The 2 passes are behaviour-preservation cases: "dry run not counted against the cap" and "viewer 403 / non-grantee 404 write nothing". Both should pass on main.
- *The 10 tests added after the red run* (they need V124/new API, so they could not compile against main):

  | Test | Proof status |
  | --- | --- |
  | Attribution (owner/editor/dry/scheduled) | Mutation-proven (`attribution-dropped`, `editor-dry-insert-owner-scoped`) |
  | Attribution on unrunnable | **NOT proven.** `attribution-dropped` mutates only `PipelineRunExecutor`; this test passed under it |
  | Admission: admit editor | Positive path; implicitly exercised by every editor-run test |
  | Admission: NotAuthorized for viewer/stranger/revoked | Mutation-proven (`no-reauth`) |
  | Admission: pipeline no longer exists, both paths | **NOT proven** by any mutation |
  | Admission: owner's cap, not submitter's | Mutation-proven (`submitter-keyed-count`) |
  | Admission: owner-keyed advisory lock | Mutation-proven (`submitter-keyed-lock`) |
  | Revoked mid-run real run reaches terminal | Mutation-proven (`editor-terminal-owner-scoped`, `editor-lastrun-owner-scoped`) |
  | Revoked editor's dry run writes nothing and still answers | **NOT proven.** This is the only test of `insertGranteeDryRun`'s in-transaction re-auth (design D2) and of the `persistAssertions` recoverWith (skeptic note 2). The `no-reauth` mutation changed only the real-run admission (`if (false)` in `insertGranteeRunIfUnderOwnerCap`); `insertGranteeDryRun`'s predicate was never mutated |
  | Stale-grant 403 | Mutation-proven (`no-reauth`, `notauthorized-admits`) |

- *"Three early mutation proofs have no diff file."* This is not quite right.
  - `HEL-1492-mutation-{no-reauth,submitter-keyed-count,submitter-keyed-lock}.txt` are full `git diff`-vs-base snapshots of the mutated `PipelineRunRepository.scala`, not mutation-only diffs. The mutation is still recoverable from them.
  - Diffing those snapshots against each other and against the commit isolates:
    - `no-reauth`: `if (!authorized)` → `if (false)`.
    - `submitter-keyed-lock`: `concurrencyLockAction(ownerUuid.toString)` → `concurrencyLockAction(submitter.id.value)`.
    - `submitter-keyed-count`: `countAndInsertAction(ownerUuid, ...)` → `countAndInsertAction(UUID.fromString(submitter.id.value), ...)`.
  - All three are genuine and failed the expected tests, and every mutation run log carries a `[hel1468-guard]` line.
- On reasoning alone, all three unproven tests look failable. C5 nonetheless requires guards to be *shown* failable, and the dry-run re-auth is an authorization guard. Hence CR1.

**Code quality:**
- DRY: `countAndInsertAction`, `submitterMayRunAction` and `dryRunRowAction` are shared by both paths.
- Naming is clear, and the `writeTerminal`/`writeLastRun` helpers keep the owner branch byte-identical.
- No untyped escapes, no dead code, no TODOs, no over-engineering.
- Error handling matches existing patterns: retention and assertions use best-effort `recoverWith`, and a lifecycle write never re-authorizes.

### Phase 3: UI Review — N/A

Backend only: no `frontend/**`, `schemas/**`, `ApiRoutes.scala` or `openspec/specs/**` change. The `openspec/changes/**` deltas are not live specs.

The only UI-observable effect is that the owner's `last_run_*` badge and run history now reflect editor runs. That is data from existing endpoints with unchanged response shapes, and it is covered by the backend tests above.

### Overall: FAIL

### Change Requests

1. **C5: mutation-prove the three later-added guard tests that no mutation run exercised**, using the same `HEL-1492-mutate.sh` harness, and record each run in the evidence dir:
   - (a) `PipelineRunRepository.insertGranteeDryRun`: make the predicate admit unconditionally (e.g. `case false => DBIO.successful(())` → `case false => dryRunRowAction(...)`). The test "write no dry_run row for a revoked editor's dry run..." must fail.
   - (b) `PipelineRunTerminalWrites.persistAssertions` (line 122): drop `.recoverWith { case _ => Future.successful(()) }`. The same test must fail on the `isRight` / await assertion, which proves skeptic note 2's guard is load-bearing.
   - (c) `PipelineRunService.recordUnrunnable` (line 234): `triggeredByUserId = Some(user.id.value)` → `None`. "record the submitting user on a run recorded as unrunnable" must fail.
   - (d) `insertGranteeRunIfUnderOwnerCap` `case None => DBIO.successful(NotAuthorized)` → `CapExceeded`, and separately the owner path `if (!owned) DBIO.successful(NotAuthorized)` → `CapExceeded`. "answer NotAuthorized for a pipeline that no longer exists, on both the grantee and the owner path" must fail for each.

   If any of these does NOT fail, fix the test until it does. No production code change is expected.
2. **`openspec/changes/record-editor-pipeline-runs/specs/pipeline-assert-evaluation/spec.md`: rename the two MODIFIED scenarios** so the titles match their bodies. Use e.g. "Editor-grantee-triggered real run is recorded with its assertion results" and "Editor-grantee-triggered dry run is recorded with its assertion results". Drop the "(the scenario name is historical...)" parentheticals, then re-run `npx openspec validate record-editor-pipeline-runs --strict`.

### Non-blocking Suggestions

- `docs/user-reference-inventory.md`:
  - The new `pipeline_runs` row sits between `panels` and `patch_set_applications`. Move it after `pipeline_run_rate_window`, before `pipelines`, so the table stays alphabetical.
  - The legend under the table defines `NO ACTION` and `CASCADE` but not `SET NULL`. Add one line, e.g. "`SET NULL` keeps the row and clears the column."
- `PipelineRunRepository.scala` is now 628 lines (it was 528, already over the CONTRIBUTING ~400 "propose a split" mark). Per CONTRIBUTING line 24, propose a split in the PR description; the grantee admission/dry-run methods are a natural seam.
- My `persist-evidence.sh` call on an artifact that already lives in the run evidence dir produced a nested copy at `.concertino/runs/HEL-1492/evidence/.concertino/runs/HEL-1492/evidence/HEL-1492-evaluator-1-testFull.txt`. It is harmless, but noted so nobody mistakes it for a separate run. The canonical file is `.concertino/runs/HEL-1492/evidence/HEL-1492-evaluator-1-testFull.txt`.
