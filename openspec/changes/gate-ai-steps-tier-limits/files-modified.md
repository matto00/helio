# Files modified — HEL-1108

## AC1 (tasks 1.1–1.5): needed NO production change

Re-verified on the branch before touching anything: `PipelineCostEstimator.AiOps` already
contains `analyzewithai`/`generatetext`, is checked BEFORE `CheapOps`, and emits the `ai-step`
reason code with the offending step id. All 23 pre-existing tests in `PipelineCostEstimatorSpec`,
`PipelineAnalyzeAnalyzeWithAiSpec`, and `PipelineAnalyzeGenerateTextSpec` passed **untouched**.

Mutation evidence (C1/C2) for the deny arm: temporarily removed `"analyzewithai"` from `AiOps` —
3 tests went red (`Vector("unclassified-op") did not contain element "ai-step"`, the
multi-reason test, and the partition-completeness test), confirming the deny arm is genuinely
failable. Reverted; re-ran green (18/18, `PipelineCostEstimatorSpec` alone).

The only changes for this half were the two now-false comments (task 1.4):
- `PipelineCostEstimator.scala:20-23` — corrected "Neither op is implemented/registered" (both
  ARE, `PipelineStep.Registry:243-244`) and dropped the dangling "tasks.md C3" reference.
- `PipelineCostEstimatorSpec.scala:145-148` — corrected the same false claim in the partition
  test's comment.

## AC2 (tasks 2–5): the delivered work

### Production code

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — added
  `ownerUserId: Option[String] = None` to `PipelineExecutionContext` (task 2.1).
- `backend/src/main/scala/com/helio/domain/engine/PipelineExecutionBackend.scala` — added the
  same defaulted param to the `execute` trait method (task 2.2).
- `backend/src/main/scala/com/helio/domain/engine/InProcessExecutionBackend.scala` — forwards
  `ownerUserId` into `executeTree` (task 2.2).
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — `executeTree`
  gains the param and forwards it into `makeContext` at the real call site (`:418`); the
  test-only flat path's `makeContext` call (`:218`, inside `executeWithStepCounts`) is left
  defaulted `None` deliberately (task 2.2/2.2a — confirmed by grep: zero external callers of
  `execute`/`executeWithStepCounts`, the one intra-file delegation at `:189` is itself test-only).
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — added the same defaulted,
  never-read param to satisfy the trait (build would not compile otherwise).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — all FIVE
  `backend.execute` call sites now thread `ownerUserId`, confirmed by grep (`:495`, `:584`,
  `:716`, `:733`, `:969` after edits — task 2.4b):
  - `:495` (source-level preview, `Vector.empty` steps) — threaded for uniformity only.
  - `:584` (step-targeted preview) — AI-reachable; **also gated** by the new D10/C10 authorization
    check (below) before this call is ever reached.
  - `:716` (Output backfill, source/root arm, `Vector.empty` steps) — threaded for uniformity
    only; task 2.4a-i verified by inspection that no AI step can evaluate here (no failable test
    fabricated).
  - `:733` (Output backfill, step/node arm) — the mandatory AI-reachable site (task 2.4a);
    falsifiable test + mutation evidence below.
  - `:969` (the real run) — AI-reachable.
  - Added the D10/C10 preview-authorization gate: a step-preview whose target closure contains an
    enabled AI step now requires the pipeline owner or an editor grantee (`findGrantRole ==
    Some("editor")`), computed via `PipelineCostEstimator.AiOps` and `PipelineStep.enabled`
    BEFORE `backend.execute` is ever called — zero model calls on denial.
- `backend/src/main/scala/com/helio/domain/steps/AnalyzeWithAiStep.scala` /
  `GenerateTextStep.scala` — populate `AiStepRequest.ownerUserId = ctx.ownerUserId`; added the
  `QuotaExceeded` match arm mapping to `fail("ai-quota-exceeded", AiQuotaMessage(limit))`; fixed
  `GenerateTextStep`'s stale "tier/quota gating is deliberately NOT implemented here" comment
  (task 3.6b) and dropped its dangling "tasks.md C1" reference.
- `backend/src/main/scala/com/helio/domain/ai/AiStepClient.scala` — added
  `AiStepFailure.QuotaExceeded(limit: Int)` to the closed failure set; added the shared
  `AiQuotaMessage` object (limit + UTC reset + "shared with chat" wording, task 3.4/design-gate
  N2); fixed the stale "not implemented here" doc comment (task 3.6c).
- `backend/src/main/scala/com/helio/services/auth/AiPipelineQuotaGate.scala` — **new**. A trait
  (so `ClaudeAiStepClient`'s own tests can inject a fake with no DB) plus `Live`, the production
  implementation reusing `UserRepository`/`AssistantDailyUsageRepository`/`UserTierConfig` exactly
  as `ChatAccessService` does (owner uncounted, beta increments/denies, free/unresolvable denied).
  The inline comment at the `incrementIfUnderCap` call site explains the intentional
  cross-identity `ctx.withUserContext(ownerUserId)` (task 3.2a).
- `backend/src/main/scala/com/helio/ai/ClaudeAiStepClient.scala` — `quotaGate:
  AiPipelineQuotaGate` is now a REQUIRED, non-defaulted constructor parameter (D8/task 3.5); a
  `None` owner is denied (`Unavailable`) WITHOUT consulting the gate (task 3.5c); a present owner
  is checked via `quotaGate.checkAndIncrement` BEFORE `sendToModel` (task 3.3); fixed the stale
  "not implemented by this ticket" scaladoc + inline comment (task 3.6a).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `aiStepClient` now built from
  `(ClaudeConfig.fromEnv(), Option(dbContext))`; a missing `DbContext` degrades to
  `AiStepClient.Unavailable` exactly like a missing API key (task 3.5b), built from `userRepo`
  (`:78`) and `dbContext`, deliberately NOT from `chatAccessServiceOpt` (declared later,
  design-gate N6).

### Docs

- `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` — removed the FALSE
  claim that `ClaudeClient` "already enforces ... tier gating"; replaced with an accurate
  description of the `AiPipelineQuotaGate` seam this ticket built (task 5.4a).

### OpenSpec

- `openspec/changes/gate-ai-steps-tier-limits/tasks.md` — all 39 tasks marked complete.
- Spec deltas (`specs/pipeline-ai-tier-gating/spec.md`, `specs/pipeline-analyzewithai-op/spec.md`,
  `specs/tier-gated-assistant-access/spec.md`) were already authored during Planning/design-gate
  and match the shipped behavior; no changes needed here beyond re-verifying them against the
  final implementation.

### Tests (new)

- `backend/src/test/scala/com/helio/ai/ClaudeAiStepClientSpec.scala` — **new**. Gate enforcement
  at the seam: deny-with-zero-transport-calls, permit-and-reach-transport, no-owner-denied-without
  -consulting-the-gate, and QuotaExceeded distinguishability (tasks 3.3/3.5c/4.2/4.3).
- `backend/src/test/scala/com/helio/services/auth/AiPipelineQuotaGateSpec.scala` — **new**. Tier
  semantics against a real Postgres (owner uncounted, beta increments/denies at cap, free denied,
  limit-below-1 "always capped" — task 3.2b).
- `backend/src/test/scala/com/helio/domain/steps/AnalyzeWithAiStepSpec.scala` /
  `GenerateTextStepSpec.scala` — added the `QuotaExceeded` mapping test (naming limit/UTC
  reset/shared budget) and the verbatim-message engine test (task 3.1a/3.4); every existing
  `contextWithTransport` fixture now sets `ownerUserId` and uses an always-permit fake gate
  (expected per design-gate N16 — these specs are about response enforcement, not quota gating).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceAiStepClientWiringSpec.scala`
  — added: the AI request carries the pipeline owner's id (task 2.3); a scheduled run triggered by
  an editor grantee still charges the owner, not the grantee (task 2.5, adapted from "an arbitrary
  triggering user" to "an editor grantee" since `submit` only permits owner/editor callers — a
  third-party non-grantee triggering user is not a reachable production case).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — added:
  the backfill step/node arm (`:733`) threads the owner into an AI step, with mutation evidence
  (task 2.4a); the D10/C10 preview-authorization suite (viewer denied with zero model calls,
  owner/editor still permitted and charged to the owner, viewer-of-non-AI-closure unaffected —
  tasks 3b.1-3b.3) with mutation evidence for the authorization check.
- `backend/src/test/scala/com/helio/domain/engine/PipelineCostEstimatorSpec.scala` — comment
  fix only (task 1.4), no behavioral change.

## Migration (task 5.1)

None. `ls backend/src/main/resources/db/migration/ | sort -V | tail -1` → `V107__add_writeback_ops.sql`,
unchanged and still the highest migration. No new migration needed — this ticket adds no schema.

## Mutation evidence log (C2, per failure arm)

| Arm | Mutation | Observed RED | Reverted? |
| --- | --- | --- | --- |
| AC1 deny arm | Removed `analyzewithai` from `AiOps` | 3 tests failed (`ai-step` missing from reasons, multi-reason test, partition-completeness test) | Yes |
| `ClaudeAiStepClient` deny-issues-zero-calls | Gate `Left` branch changed to still call `sendToModel` | 2 tests failed (`Right("ok")` instead of `Left(QuotaExceeded)`; distinguishability test threw `NoSuchElementException`) | Yes |
| `ClaudeAiStepClient` no-owner-denied-without-gate | `case None` replaced with falling through to the gate | 1 test failed (`Right("ok")` instead of `Left`) | Yes |
| `AnalyzeWithAiStep` QuotaExceeded verbatim message | Dropped the `QuotaExceeded` match arm | 2 tests failed: `scala.MatchError` instead of `IllegalArgumentException`, and the engine test's message degraded to the generic "step execution failed" | Yes |
| `GenerateTextStep` QuotaExceeded verbatim message | Dropped the `QuotaExceeded` match arm | Same 2-test failure shape as above | Yes |
| `AiPipelineQuotaGate.Live` tier semantics | Changed the `Owner` guard to `if (true)` (permit everyone) | 4 tests failed (beta-cap, free-tier, limit-below-1 all wrongly permitted) | Yes |
| Backfill `:733` owner threading | Removed `ownerUserId = Some(pipeline.ownerId.value)` from the `:733` call | 1 test failed (`None` instead of the owner id reaching the fake AI client) | Yes |
| Preview D10/C10 authorization | Changed `if (!closureHasEnabledAiStep)` to `if (true)` (always permit) | 1 test failed (viewer grantee was wrongly permitted) | Yes |

Task 2.4a-i (`:716`, the backfill source/root arm) deliberately has **no** mutation evidence — it
executes with `Vector.empty` steps, so no AI step can ever evaluate there; verified by inspection
only, per the ticket's own explicit instruction not to fabricate red evidence for this site.

## Root cause / probe (systematic-debugging.md, where applicable)

This ticket is new-feature work, not a bug fix — most tasks required no debugging. The one
genuine "surprising failure, traced to root cause" moment: after wiring `ownerUserId`, the two
pre-existing step specs (`AnalyzeWithAiStepSpec`, `GenerateTextStepSpec`) initially failed on the
new "no-owner-denied" behavior (root cause: their `contextWithTransport` fixtures construct
`PipelineExecutionContext` directly, defaulting `ownerUserId = None`, which the new gate treats as
NOT PERMITTED). This was the exact, EXPECTED failure design-gate round 5's N16 called out in
advance — the fix (task 3.5a) was to set an owner and an always-permit fake gate in both fixtures,
not to weaken the gate.

## Declaration fix (orchestrator, Delivery)

`squash-branch.sh` refused the squash because three paths above sit in positions its parser does
not treat as declarations, even though all three ARE declared in the prose and ARE genuinely part
of this change (verified against `git log --name-only` before this edit). Restating exactly those
three — and only those three — as full paths in accepted declaration position. No file is added to
the declared set that was not already declared above, and `--allow-empty-declaration` was NOT used.

- `backend/src/main/scala/com/helio/domain/engine/PipelineCostEstimator.scala` — declared at line 16
  as the bare basename `PipelineCostEstimator.scala:20-23`, which the parser resolved to a
  different same-basename path (task 1.4 comment fix).
- `backend/src/main/scala/com/helio/domain/steps/GenerateTextStep.scala` — declared at line 55 on a
  slash-joined continuation line, where the chain breaks because the prior line does not end in a
  comma.
- `backend/src/test/scala/com/helio/domain/steps/GenerateTextStepSpec.scala` — declared at line 103
  in the same slash-joined shape.
