## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Head reviewed: `e296e2fd83c2df5438d4318acbb7a3a05e09bd4a` (tree clean at start and finish).
Diff base resolved LIVE via `resolve-review-base.sh` with exit status checked:
`0ce987459d101c726a0082ad330b2f5f624fa6d0`. Diff: **36 files, +2619 −66** (matches the briefed
expectation; 13 production files under `backend/src/main`, 7 tests, remainder planning/report
artifacts).

### What I verified (with evidence)

**Gates, all re-run by me (not inherited):**

| Gate | My result |
| --- | --- |
| `openspec validate gate-ai-steps-tier-limits --type change` | `Change 'gate-ai-steps-tier-limits' is valid` |
| `npm run check:scala-quality` | `clean (172 soft warning(s))`, zero hard violations |
| `cd backend && sbt test` (timeout 600000) | **Suites: completed 303, aborted 0; Tests: succeeded 4541, failed 0; All tests passed; EXIT=0** |

**AC1 — enabled AI step denied by the auto-run verdict, keyed on the `ai-step` reason code.**
Satisfied on the base branch, and **the executor's restraint (C9) was correct.** `AiOps` is checked
before the cheap allowlist and emits `ai-step` with the offending step id; the pre-existing probes
assert the **reason code**, not `autoRunnable` alone (C1 honored) — `PipelineCostEstimatorSpec:26-27`
(code + stepId), `:43` (`generatetext`), plus the explicit `fail(...)`-on-absent-reason probes in
`PipelineAnalyzeAnalyzeWithAiSpec:115-116` / `PipelineAnalyzeGenerateTextSpec:110`. Manufacturing a
production change here would have been pure churn; not doing so was right. The two now-false
comments were corrected and no stale HEL-1108 "not implemented"/dangling `tasks.md C*` claim
survives (`grep` → 0 hits).

**AC2 — clear error, never a silent no-op.** Traced end to end at the seam
(`ClaudeAiStepClient.scala:22-34`):
- Denial happens **before any model call** — `sendToModel` is reachable only on `Right(())`.
- A `None` owner is denied **without consulting the gate at all** (the `case None` arm returns
  `Unavailable` before `quotaGate` is touched) — D8/3.5c.
- `quotaGate` is a **required, non-defaulted** constructor parameter, so an ungated client is not
  constructible at the type level.
- The message reaches the caller **verbatim**: both step files carry the `QuotaExceeded` arm at
  `:72` → `fail("ai-quota-exceeded", AiQuotaMessage(limit))`; `AiQuotaMessage`
  (`AiStepClient.scala:41-45`) names the limit, "resets at midnight UTC", and "shared with the
  assistant chat". `StepExecutionException.from` allowlists only `IllegalArgumentException`, with
  `case other` → "step execution failed", so the degradation risk is real — and both specs assert
  `ex.reason should not include "step execution failed"` (`AnalyzeWithAiStepSpec:250`,
  `GenerateTextStepSpec:258`). The no-compiler-guarantee gap is genuinely closed by test.
- `ApiRoutes.scala:328-339` degrades to `AiStepClient.Unavailable` when `Option(dbContext)` is
  `None`, and the N6 val-init trap is avoided — `chatAccessServiceOpt` (declared later, at `:497`)
  appears in the gate only inside an explanatory **comment**, never as a reference.

**C11 — all FIVE `backend.execute` sites, verified by my own grep.** I hit the briefed
methodological trap deliberately: `grep -c "backend\.execute"` returns **7**, matching only
comments, because the real invocations split as `backend\n  .execute(`. Grepping `\.execute(`
gives **495 / 584 / 716 / 733 / 969**, and `ownerUserId = Some(pipeline.ownerId.value)` appears on
the line immediately following each (496/585/717/734/970). `:716` carrying no mutation evidence is
**correct** per 2.4a-i — I read the arm and confirmed it executes with `Vector.empty` steps, so no
AI step can evaluate there; that is not a gap.

**My own mutation spot-check — row 7, which the evaluator did NOT verify** (it did rows 2 and 4).
Mutated `PipelineRunService.scala:734` to `ownerUserId = None` and ran the targeted test:

```
- should backfill's step/node arm threads the pipeline owner into an AI step's evaluation (HEL-1108 C11) *** FAILED ***
  None was not equal to Some("00000000-0000-0000-0000-000000000001") (PipelineRunServiceSpec.scala:2477)
  Tests: succeeded 0, failed 1
```

Reverted; re-ran the same test green (`succeeded 1, failed 0`) and confirmed `git status` clean at
`e296e2fd`. The row is honest and the assertion is genuinely failable.

**D10/C10 preview fix.** Read `PipelineRunService.scala:556-570`: the check
`slicedSteps.exists(s => s.enabled && PipelineCostEstimator.AiOps.contains(s.kind))` is computed
**before** `backend.execute` at `:583`, permitting owner or `findGrantRole.contains("editor")`, else
`Forbidden`. The `.enabled` conjunct is present and matters — `closureOf` deliberately does not
pre-filter disabled ancestors, so without it a disabled AI step would over-deny a viewer previewing
an otherwise AI-free closure. Zero model calls on the denied path (the gate precedes the engine
call structurally, not merely by assertion).

**Owner-charging (D5), C5, C6, D9.** Quota keys on `pipeline.ownerId` at every site including the
scheduled/grantee paths. No migration: `V107__add_writeback_ops.sql` is still highest and the
migration directory has **zero** diff lines. No HEL-1109/HEL-1136/HEL-1135 scope absorbed
(`grep -cE` over the production diff → 0). **Zero `frontend/` churn**, so D9 holds and Phase 3 UI
review is genuinely N/A — no browser pass was warranted or run.

### Verdict: CONFIRM

Both acceptance criteria trace to real evidence, all three gates are green on my own fresh runs, and
the one mutation row I re-derived by hand reproduces exactly. On the two weak points I was asked to
rule on, my judgment is that **neither blocks this release**:

**1. Task 3b.4's non-failable assertion — real evidence defect, not a blocker.** I confirmed the
evaluator's finding rather than inheriting it: the assertion is `rows shouldBe empty`
(`PipelineRunServiceSpec:2489`), and a denial that *did* write an empty row set through
`overwriteRows` would leave `rows` equally empty, so the task's own stated mutation cannot turn it
red. It is also the only task absent from the 8-row mutation table. **But the shipped behavior is
correct, and I derived that independently from source structure:** `persistBackfilledRows` is
reached only inside `evaluateNodeRowsForBackfill`'s success `.flatMap` (`:735-741`), never the
`.recover` (`:742-744`), so a denial cannot reach `overwriteRows` at all. Three things make this
non-blocking rather than a REFUTE: the correctness is structurally guaranteed and independently
verifiable; the in-code comment **discloses** the limitation instead of concealing it (the opposite
of the confidently-false-comment failure that caused this ticket); and backfill is deliberately
off both ACs' critical path — D4 rules it best-effort/log-only, whereas AC2 governs the run path's
loud 422. Sending this back would buy a better *proof* of behavior already proven by construction,
at the cost of a held Urgent release. It should be fixed, but as a follow-up (note 1).

**2. The untested "satisfies V88 RLS without a bypass" claim — safe to ship.** I confirmed the
masking is real: `AiPipelineQuotaGateSpec` runs Flyway and Slick as the `postgres` superuser and
builds `new DbContext(db, db)`, so per `MISTAKES.md` the `user_id = current_setting(...)` policy
never executes there. Given this repo's v0.7.x production incident, I treated that seriously rather
than waving it through — but the decisive fact is that **this gate introduces no new RLS shape.**
`AssistantDailyUsageRepository.incrementIfUnderCap` ends in
`ctx.withUserContext(userId.value)(action)`, i.e. the DB user context is always set to *the very
`user_id` the row is keyed on*. `ChatAccessService.scala:44` calls that identical method the
identical way, and that path already runs in production under the non-BYPASSRLS `helio` role. The
novelty here is only *which* user id is selected (pipeline owner vs. request caller) — a choice made
in application code above the DB, invisible to the policy. So the policy sees a shape already proven
in production, and no non-superuser probe is required before merge. A dedicated non-superuser spec
(alongside `RlsPolicyGuardSpec` et al.) remains a reasonable hardening follow-up (note 2).

No gate defect to record: no report I drilled into rests on mtime ordering or positional evidence,
and every finding above is grounded in cited file:line content, command output, or a reproduced
mutation.

### Non-blocking notes

1. **Make 3b.4 genuinely failable** (follow-up): spy on `nodeSnapshotRepo.overwriteRows` and assert
   it is never invoked on the quota-denied backfill path. That assertion *can* be turned red by the
   mutation the task specifies, and would retire the only piece of evidence-shaped non-evidence in
   this change. Worth filing so the disclosure comment does not outlive the gap.
2. **Add a non-superuser RLS probe for the cross-identity usage write**, in the style of
   `V100ZeroRootGuardNonSuperuserSpec`, so the V88 policy claim is measured rather than argued from
   the chat path's production track record.
3. **Preview-gate indentation** (`PipelineRunService.scala:569-615`): the new
   `authorizedForAi.flatMap { case true =>` arm leaves ~45 lines at their prior indentation with a
   lone closing brace at `:617`. It compiles and behaves correctly and the shape minimizes diff
   noise, but the block reads as though it sits outside the match arm. Re-indenting, or extracting
   the permitted path into a private method, would help the next reader.
