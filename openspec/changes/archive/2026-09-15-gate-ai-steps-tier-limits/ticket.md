# HEL-1108: Mark AI steps as never-auto-runnable and enforce tier gating

## Description

The cost estimator must classify these three steps as deny. Enforce tier gating
(`HELIO_BETA_DAILY_MESSAGE_LIMIT`) on pipeline-triggered AI calls, not only on chat.

## Acceptance Criteria

1. A pipeline containing any of these steps is denied by the auto-run verdict, **proven by a
   failable probe**.
2. A beta-tier user over their daily limit gets a **clear error** rather than a silent no-op.

## Owner rulings (binding)

- **Sequencing (2026-09-15):** deliver after HEL-1106 and HEL-1107 (both merged). Tier gating
  should be tested against real AI calls, not a stub.
- **Scope (2026-09-15):** "these three steps" means the AI steps ONLY — `analyzewithai` and
  `generatetext`. HEL-1105 ruled `convertformat` a deterministic local converter, so it is
  OUTSIDE this ticket's tier gating.
- **Key on the `ai-step` reason code, NOT on `autoRunnable`** (HEL-1092, PR #661). Another deny
  reason can make the flag false on its own, so a probe asserting only the flag would pass even
  if the AI arm were broken.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627).

## Verified premise notes (orchestrator, against 0ce987459d101c726a0082ad330b2f5f624fa6d0)

These were verified in the live tree before Planning. Full record:
`.concertino/runs/HEL-1108/evidence/premise-validation.md`. Treat each as a checked fact, but
re-verify anything you intend to rely on.

**AC1 appears ALREADY SATISFIED on the base branch.** Failable probes keyed on the `ai-step`
reason code already exist at two levels:
- `backend/src/test/scala/com/helio/domain/engine/PipelineCostEstimatorSpec.scala:26-27` (asserts
  the reason code AND the offending `stepId`) and `:43` (`generatetext`).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeAnalyzeWithAiSpec.scala:115-116`
  (explicit `fail(...)` when the reason is absent) and `PipelineAnalyzeGenerateTextSpec.scala:110`.
- `ai-step` is already in `schemas/pipelines/pipeline-analyze-response.schema.json:128`.
- `PipelineCostEstimator.AiOps = Set("analyzewithai","generatetext")`, checked BEFORE the general
  allowlist, carrying its own `ai-step` code.
- `PipelineService.analyze` builds `CostInput` from `enabledSteps.map(s => StepInput(s.id.value,
  s.kind))`, so registered AI steps genuinely reach the verdict.

**Do NOT manufacture a change for AC1.** If it is already satisfied, say so. Two genuine, small
residual items for that half:
- `PipelineCostEstimator.scala:21-23` still claims "Neither op is implemented/registered
  (HEL-1106/1107)" — now FALSE.
- `PipelineCostEstimatorSpec.scala:147-148` still claims "AiOps is deliberately allowed to name
  ops that are NOT registered -- analyzewithai/generatetext" — now FALSE.
  Both ops ARE registered (`PipelineStep.Registry` lines 243-244), which also means the partition
  test now passes NON-vacuously. Judge whether an additional end-to-end route-level probe adds
  real coverage over the existing `PipelineAnalyze*Spec` cases, or is duplicate.

**AC2 is the substantive deliverable.** The single gating call point is
`ClaudeAiStepClient.complete` (`backend/src/main/scala/com/helio/ai/ClaudeAiStepClient.scala:14-20`,
which carries an explicit HEL-1108 comment). `AiStepRequest.ownerUserId` is ALWAYS `None` — only
the case-class default exists; both `AnalyzeWithAiStep.scala:66` and `GenerateTextStep.scala:65`
construct with `instruction`/`content` only.

**Ownership threading is LESS work than previously briefed (verify this).** `pipeline.ownerId` is
already in scope at the engine invocation and already threaded for exactly this class of problem
by HEL-1100: `onRunSuccess(..., writeBackSink, pipeline.ownerId)` →
`applyPendingWriteBacks(writeBackSink, pipelineOwnerId, triggeringUser)`, which builds
`AuthenticatedUser(pipelineOwnerId, ...)`. HEL-1100 **D5 already ruled the governing semantics**:
"writes always run AS the owner, never the triggering caller — a grantee-triggered or
scheduler-fired run still writes under the owner's identity/RLS context." Reuse that precedent
rather than inventing new semantics.

**There is no trigger path lacking an owner identity.** Ownership derives from the pipeline row,
not the request: `PipelineSchedulerService.scala:110` already constructs
`AuthenticatedUser(pipeline.ownerId, source = AuditSource.System, tokenId = None)` and submits as
the owner. Manual, scheduled, hook-triggered and preview runs all pass through the same
`pipelineRunService`.

**Chat-side precedent to REUSE, not reimplement** (share the counter semantics deliberately):
- `ChatAccessService.checkConverseCap` — `Owner` always uncounted; `Beta` → `incrementIfUnderCap`;
  `Free` → `TierForbidden`.
- `AssistantDailyUsageRepository.incrementIfUnderCap` — ONE atomic statement
  (`INSERT ... ON CONFLICT DO UPDATE ... WHERE message_count < :limit RETURNING`), UTC day,
  race-safe with no explicit transaction. A `limit < 1` short-circuits to denied BEFORE touching
  the DB (deliberate: the `ON CONFLICT ... WHERE` guard does not gate a user's first INSERT of the
  day, so otherwise `limit = 0` would allow exactly one call).
- Table `assistant_daily_usage` (V88), RLS'd, PK `(user_id, usage_date)`, accessed via
  `ctx.withUserContext`.
- Wire shape: `429 Too Many Requests` + `TierErrorResponse("CHAT_LIMIT_REACHED", message,
  Some(limit))`; `TierErrorResponse` currently lives in the assistant protocol package. The
  frontend already maps `CHAT_LIMIT_REACHED` in
  `frontend/src/features/assistant/ui/MessageComposer.tsx:33`.

## Open design questions for Planning / the design gate

1. **Counter sharing.** Do pipeline AI calls share the chat day-counter (`assistant_daily_usage`,
   whose V88 comment scopes it to "converse-endpoint sends") or get their own counter? Decide and
   DOCUMENT it either way.
2. **Per-row multiplication (important).** Both AI steps fold ONE model call PER ROW. A 500-row
   pipeline is 500 calls. A naive per-call increment lets a single run exhaust a 50/day cap
   mid-run and fail partway through, after earlier rows already succeeded. Settle per-call
   increment vs. per-run reservation, and what a partial mid-run denial does to the run.
3. **What a scheduled run counts against.** Recommended: the pipeline owner, by exact analogy to
   HEL-1100 D5. Confirm and document.
4. **Failure-variant contract.** `AiStepFailure` is a CLOSED sealed set of four variants
   (`Unavailable`/`Guardrail`/`Api`/`Transport`), matched EXHAUSTIVELY in both step files. A quota
   denial needs a deliberate decision: new variant (both step files must map it) vs. reusing an
   existing one. A new variant is the honest choice for "clear error, never a silent no-op".
5. **How the error reaches the user.** A step's `fail(code, detail)` throws
   `IllegalArgumentException` → `StepExecutionException.from`'s allowlist surfaces the message
   verbatim → `errMsg` → `ServiceError.UnprocessableEntity` (422) + SSE
   `RunStatusEvent("failed", errorLog = ...)` + persisted `pipeline_runs.error_log`. Judge
   deliberately whether a frontend change is FORCED, and state the conclusion. The step-card UI is
   HEL-1109 and the op-menu rework is HEL-1136 — do not absorb their scope.

## Constraints

- **No migration should be needed.** V107 (HEL-1104) already admits all four ops in the
  `pipeline_steps` op CHECK; V107 is the highest migration present. If one IS needed it is V108 —
  justify it explicitly.
- Tests use a fake `AiStepClient`/transport with **no network**. **Every failure arm needs
  mutation evidence** — a green assertion that cannot be made to fail proves nothing.
- Include an **openspec spec** delta.
- Known wire hazards hit repeatedly this batch: spray-json **drops `None` fields on the wire**
  (normalize at the boundary and test with the field ABSENT); spray-json **sorts `JsObject` keys**;
  Jackson `readTree` **ignores trailing content**.
