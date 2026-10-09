## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `eda9ed491428c904ab9d486146ed65b47c003ba7`. The branch has no commits yet, and the change dir is untracked. I took owner rulings Q1, Q2 and Q3 as given and did not relitigate them. I re-derived everything below from live code, not from the round-1 report.

### What I verified (with evidence)

**Round-1 CR1 (unbounded retry on undecodable configs): FIXED**
- `PipelineStepRepository.listByPipelineInternal` (l.346-349) maps `rowToDomain`, which throws `IllegalStateException` on a config that does not decode (l.1349-1354). The resulting failed Future is permanent.
- Revised D5 separates the two outcomes:
  - **No submit:** fail-closed.
  - **No retry loop:** a schedule advances via `updateAfterTickInternal(next, Some(now))`; an auto-run claim is released.
- That is exactly today's behaviour for a submit that throws:
  - `fire`'s `transform` Failure branch (scheduler l.231-239) still advances the schedule.
  - `fireAutoRun`'s Failure branch (l.161-163), followed by `releaseClaim` (l.136), releases the claim.
- Both spec deltas' "Fire-time evaluation fails" scenarios now name the decode case and the outcome that is not retried. Task 1.6 asserts that a second tick does not re-attempt.

**Round-1 CR2 (missing run-history trim): FIXED**
- On main, `recordUnrunnable` (PipelineRunService l.218-241) has no retention pass. The executor prunes via `deleteOldRuns(pipelineId, user, keepN = 10)` with a swallow `recoverWith` (PipelineRunExecutor l.153-157).
- D3a adds `pruneOldRuns` to `recordUnrunnable`, using the same call and the same swallow. The scheduled path passes `true`. The only other caller (`PipelineProposalService` l.516) is unchanged.
- `deleteOldRunsInternal` excludes `dry_run` rows and keeps the newest 10 by `startedAt` (RunRepo l.254-266), so the new failed row is kept.
- The spec scenario "Run history stays capped" and task 1.1a cover it.

**Round-1 CR3 (test 1.1 not red on main): FIXED**
- Rate-window assertion:
  - On main, `executeRun` calls `pipelineRunGuardRepo.incrementRateIfUnderLimit` first, unconditionally (PipelineRunExecutor, `rateLimitCheck`). The step-config failure happens later, in the engine.
  - Task 1.1 now requires a real `PipelineRunGuardRepository` in the fixture, so "rate-window count unchanged" is red on main. Round 1 found this assertion vacuous in the current fixture, which wires no guard.
- Audit assertion: `PipelineSchedulerServiceFixture` wires a real `AuditService` (l.94, l.103), and main's owner path calls `auditSubmit` (PipelineRunService l.203). "No submit audit event" is therefore non-vacuous and red on main.
- The `error_log` prefix assertion is also red on main (see non-blocking note 1 on how it compiles).
- 1.2, 1.3 and 1.4 are red on main as written: main submits and executes a run in each case.

**Gap premises, re-confirmed on live code**
- `processAutoRunClaim` → `fireAutoRun` → `submit(AutoRun)` with no re-check (scheduler l.130-165).
- `fire` → `submit(Scheduled)` with no config check (l.208-241).
- A write-time denial never touches an existing debounce row: `evaluateAndSchedule` upserts only on the allowed branch (AutoRunTriggerService l.100-104).

**D1 / HEL-1280: schema-derived errors never gate**
- `stepConfigProblem` = `validateStepConfig(kind, rawConfig)` (PipelineAnalyzeService l.52, l.344+). It reads only the raw config: `validateRawConfig`, `requiredConfigProblems`, and the per-kind enum validators. There is no schema inference.
- D1 reuses the exact expression HEL-1279 already uses at write time (AutoRunTriggerService l.92-96), over enabled steps only.
- Write-time behaviour is unchanged, so the HEL-1279 guard tests should stay green (task 3.1 re-runs them).

**D2: single verdict computation is feasible**
- `evaluateAndSchedule` uses `dataSourceId`/`user` only for logging and `handleDenied`.
- `costInputGathering.gather(pipelineId, enabledSteps, lastRunRowCount, resolveRoot = dataSourceRepo.findByIdInternal)` does not depend on the writer.
- So a private `computeVerdict(pipelineId)` can serve both write time and fire time.
- `releaseClaim` is compare-and-delete on `claimed_at`, so a write that arrives mid-evaluation survives.

**D3/D4 against owner ruling Q1**
- `recordUnrunnable` never calls the guard, so no HEL-505 budget is consumed.
- With the new `triggerSource` parameter it writes `trigger_source = scheduled`. `insertRun` already accepts `triggerSource` (RunRepo l.45-56).
- It sets last-run status `failed`, and the schedule advances. All of this matches Q1.

**D6 wiring**
- `grep "new PipelineSchedulerService"` finds 9 construction sites in 8 files: Main.scala:293, the Fixture:108, MaintenanceHooksSpec:33 and :62, Coalescing:142, BurstProof:151, NoRetryStorm:138, EndToEnd:151, UpsertSourceRlsSpec:115. D6 lists all 8 files.
- `ApiRoutes.autoRunTriggerServiceOpt` (l.263-265) exists and is private today; exposing it is straightforward. The "both or neither" `require` closes the silent-off risk.

**D7 / RLS under prod `helio` (non-BYPASSRLS)**
- `DbContext`: `withSystemContext` runs on the privileged `helio_privileged` BYPASSRLS pool (l.53-64); `withUserContext` sets the user GUC on the app pool (l.50-51).
- Fire-time reads are all system context: `findByIdInternal`, `listByPipelineInternal` (StepRepo l.346), `findLastRunRowCountInternal`, the `gather` root lookups, `dataSourceRepo.findByIdInternal`, `hasActiveRunInternal` (RunRepo l.371).
- Record-failed writes:

  | Call | User context (owner) | System context |
  |---|---|---|
  | `insertRun` | `pipelineOwnedAction` | INSERT (l.53-70) |
  | `updateRunTerminal` | owned-run SELECT | UPDATE (l.189-209) |
  | `updateLastRun` | UPDATE on `pipelines` filtered by `owner_id` (PipelineRepo l.509-526) | — |
  | `deleteOldRuns` | ownership check | delete (l.247-251) |

- The owner principal is the pipeline's real owner (`pipeline.ownerId`), and every one of these is a call the scheduled submit path already makes in prod. The schedule advance uses `updateAfterTickInternal`, in system context.
- No new table or policy is involved. D7's wording now matches this precisely.

### Verdict: CONFIRM

All three round-1 change requests are fixed in the artifacts. I found no new blocking defect. The design is internally consistent, covers all three ticket gaps and every AC, and follows the owner rulings.

### Non-blocking notes

1. **Red-first compile on main.** The 1.1 assertion against `RunConfigGate.ScheduledSkipPrefix` does not compile on main, because the constant does not exist yet. Record the red run with the literal prefix string, or with the rate-window/audit assertions alone, so that the red is an assertion failure, not a compile error.
2. **Section-1 header vs. guards.** The header says every section-1 test "must fail on origin/main", but 1.5 (negative controls) and 1.6 are green on main by construction.
   - 1.6 is green on main because main's submit throws on the undecodable step, after which the schedule advances and the claim is released.
   - 1.1a is already, correctly, labelled red against a mutation.
   - Label 1.5 and 1.6 as guards, and show 1.6 failing against a mutation (evaluation failure propagated without advancing or releasing). That is the D5 hazard the test exists for.
3. **`recordUnrunnable` failure in `fire`.** D5 covers a failed evaluation, but not a `recordUnrunnable` future that fails (for example, a transient error in `updateRunTerminal`/`updateLastRun`). As written, that would skip the advance, and the schedule would retry on the next tick. Wrap it the way today's submit is wrapped (`transform` to success, then advance) so the "never every tick" property holds on this path too.
4. **Brief concurrency-cap overlap.** `recordUnrunnable` inserts a row through plain `insertRun`, which is not cap-checked, and the row is briefly non-terminal before `updateRunTerminal`. A concurrent real submit by the same owner could, in that sub-millisecond window, see it as in flight. This is pre-existing `recordUnrunnable` behaviour and negligible; no action needed.
5. **Deleted pipeline in D2.** If the pipeline is gone, `evaluateAtFire` runs before `fireAutoRun`'s not-found branch and will most likely deny with `no-roots`, which also releases the claim. The outcome is the same (no fire), but the log line differs from what D2 claims. The V110 FK cascade makes this unreachable in practice anyway.
