## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at `HEAD = 0ce987459d101c726a0082ad330b2f5f624fa6d0`; live-resolved review base
(`scripts/concertino/resolve-review-base.sh . main origin`) = the same SHA, i.e. the branch
carries only planning artifacts, no code diff. `openspec validate gate-ai-steps-tier-limits
--type change` → `Change 'gate-ai-steps-tier-limits' is valid`, exit 0.

### What I verified (with evidence)

**Orchestrator claim 1 — AC1 already satisfied: CONFIRMED, and the design's restraint is correct.**
- `backend/.../domain/engine/PipelineCostEstimator.scala:24` — `AiOps = Set("analyzewithai",
  "generatetext")`; `classifyStep` tests `AiOps` FIRST, before `WriteBackOps`/
  `ContentConversionOps`/`CheapOps`, and emits `CostReason("ai-step", ..., Some(step.stepId))`.
  `CostVerdict.of` derives `autoRunnable = reasons.isEmpty` through a private constructor, so an
  allow carrying an `ai-step` reason is unconstructible.
- Four probes keyed on the REASON CODE (C1-compliant), read in full:
  `PipelineCostEstimatorSpec` ("deny with ai-step ... analyzewithai" asserts
  `reasons.map(_.code) should contain("ai-step")` AND `.stepId shouldBe Some("s2")`; "deny with
  generatetext as ai-step too"), `PipelineAnalyzeAnalyzeWithAiSpec`
  (`.getOrElse(fail("expected an ai-step cost reason ..."))` + `aiReason.stepId shouldBe
  Some(aiStep.id)`), `PipelineAnalyzeGenerateTextSpec` (`reasons.exists(_.code == "ai-step")`).
- Spec/schema level: `schemas/pipelines/pipeline-analyze-response.schema.json:128` enumerates
  `ai-step`.
- Both ops ARE registered: `PipelineStep.scala:243-244` (`AnalyzeWithAiStep.Kind ->`,
  `GenerateTextStep.Kind ->`), so `PipelineCostEstimatorSpec`'s partition block passes
  non-vacuously and the two stale comments the plan corrects (tasks 1.4) are genuinely false today.
- Judgment: nothing real is skipped. AC1 is met at code, test and schema level; C9's instruction
  to report rather than manufacture is the right call, and tasks 1.1–1.5 (re-verify, prove failable
  by mutation, fix the two false comments) is the appropriate residual.

**Orchestrator claim 2 — spec asymmetry real: CONFIRMED.**
`openspec/specs/pipeline-generatetext-op/spec.md:108` has "Requirement: generatetext is never
auto-runnable" keyed on `ai-step`; `openspec/specs/pipeline-analyzewithai-op/spec.md`'s four
requirements (lines 9/22/31/56) contain no auto-run/`ai-step`/deny requirement at all (grep for
`auto-runnable|autoRunnable|ai-step|deny` returns zero hits). The delta closes a real contract gap
for already-shipped behavior — in scope, not busywork.

**Orchestrator claim 3 — the writeback design spec's tier-gating claim is FALSE: CONFIRMED.**
`grep -rn "tier|Tier|userId|ownerUserId|BETA_DAILY" backend/src/main/scala/com/helio/ai/` returns
exactly three hits, all inside `ClaudeAiStepClient.scala:14-19`'s own "not implemented by this
ticket" comment. Neither `ClaudeClient.scala` nor `ClaudeConfig.scala` has any tier/user concept.
`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (~line 225) asserts
`ClaudeClient` "already enforces `CLAUDE_MAX_TOKENS`, `CLAUDE_MAX_INPUT_TOKENS` and tier gating
(`HELIO_BETA_DAILY_MESSAGE_LIMIT`)" — the first two are real, the third is not. AC2's shape as the
substantive deliverable stands (see CR4 for the residual).

**D3 (shared counter) — sound.** `AssistantDailyUsageRepository.incrementIfUnderCap` is a single
atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE message_count < :limit RETURNING` with an
explicit `if (limit < 1) false` short-circuit before any DB touch, routed through
`ctx.withUserContext`. `ChatAccessService.checkConverseCap` gives exactly the tier semantics D7
inherits (`Owner` uncounted, `Beta` increments-or-denies, `Free` forbidden).
`UserTierConfig.betaDailyMessageLimit` is env-backed and floored at 0. One combined budget is the
right call: a second counter would double the model spend the limit exists to bound, for no
product benefit. **V88's "converse-endpoint sends" wording is a comment, not an obstacle** — the
table is `(user_id, usage_date, message_count)` with a PK and a `user_id = current_setting(...)`
RLS policy; nothing in the schema, the index, or the statement is converse-specific. The plan
correctly handles the semantic widening as a `tier-gated-assistant-access` MODIFIED delta whose
requirement header matches the live spec text verbatim (verified line-for-line against
`openspec/specs/tier-gated-assistant-access/spec.md:24`).

**D4 (per-call increment, fail fast) — the load-bearing snapshot claim is TRUE.** Verified
independently in `PipelineRunService.scala`: the `runFuture.transformWith` `Failure(ex)` branch
(≈lines 949-988) does `publish(RunStatusEvent("failed", errorLog = Some(errMsg)))`,
`updateRunTerminal(..., "failed", ..., errorLog = Some(errMsg))`, `updateLastRun`,
`persistAssertions` — and nothing else. Every `nodeSnapshotRepo.overwriteRows` call is on a success
path (`:1249` inside `onRunSuccess`'s `materializedWrites`, and `:731`'s separate backfill helper);
`writeBackSink` is likewise only drained from `onRunSuccess` (`:1011-1013`, passing
`pipeline.ownerId`). So a mid-run quota denial leaves no snapshot and no write-back — "no
half-applied state" holds. The per-row seam is real: both `AnalyzeWithAiStep.apply` and
`GenerateTextStep.apply` `foldLeft` over rows with one `ctx.aiClient.complete` per row, and `fail`
throws inside the fold so row N+1 is never attempted. `InProcessPipelineEngine.scala:50` maps
`IllegalArgumentException` → `StepExecutionException(stepId, stepKind, iae.getMessage, ...)`, so a
`fail("ai-quota-exceeded", ...)` message reaches `errMsg` verbatim. Rejecting reserve-N as scope is
defensible for a held release; see note N1 for the consequence I want stated, not fixed.

**D5 (owner keying) — no trigger path lacks an owner identity.** `PipelineRunService.submit`
resolves `pipeline` via `findByIdShared` and has `pipeline.ownerId` in scope on both the owner arm
and the editor-grantee arm; `previewAtNode` likewise (`findByIdShared` → `Some(pipeline)`);
`PipelineSchedulerService.scala:110` constructs `AuthenticatedUser(pipeline.ownerId, source =
AuditSource.System, tokenId = None)` and calls the same `submit`; hook triggers enter through
`submit`'s `triggeredByTokenId` parameter, same path. Reusing HEL-1100 D5 (already threading
`pipeline.ownerId` into `applyPendingWriteBacks`) is correct and consistent. The grantee scenario
in the new spec delta is genuinely reachable (the editor-grantee arm exists), so it is testable
rather than aspirational. But see **CR3** for the preview path, which D5 covers by assertion and
which I do not think has been thought through.

**D6/D7 — sound.** `AiStepFailure` is a sealed trait with exactly four case classes, matched
exhaustively at `AnalyzeWithAiStep.scala:67-71` and `GenerateTextStep.scala:66-70`; the only
other files referencing it are `AiStepClient.scala` and `ClaudeAiStepClient.scala`. Adding
`QuotaExceeded(limit)` therefore does force both step files via the compiler, exactly as claimed,
and a distinct variant keeps a quota denial distinguishable from a model guardrail.

**D9 (no forced frontend change) — I accept the conclusion.** A step failure reaches the client as
`ServiceError.UnprocessableEntity(errMsg)` plus SSE `RunStatusEvent("failed", errorLog = ...)` plus
persisted `pipeline_runs.error_log`, and the existing UI renders that text verbatim:
`frontend/src/features/pipelines/ui/RunHistoryModal.tsx:152` (`<pre>{run.errorLog}</pre>`, gated by
`canExpand` at `:120`), `PipelineDetailFooter.tsx:193` (`sseData.errorLog ?? runError`), and
`usePipelineRunEvents` parses `errorLog` off the failed event (test at
`usePipelineRunEvents.test.ts:146-151`). No new wire code crosses on the pipeline path, so a beta
user does get a visible, readable failure provided the message text is good — which task 3.4
specifies (limit + UTC reset). C6 is respected; no HEL-1109/HEL-1136 scope is absorbed.

**C5 (no migration) — holds.** `ls | sort -V` gives V107 as the highest present, and
`V107__add_writeback_ops.sql` re-adds `pipeline_steps_op_check` including all four ops
(`'upsertsource', 'convertformat', 'analyzewithai', 'generatetext'`). The gate reuses
`assistant_daily_usage` (V88) unchanged — no column, no policy, no constraint change. Nothing in
the plan needs DDL.

**Spec deltas are behavior contracts, not implementation plans.** The `pipeline-ai-tier-gating`
delta states outcomes ("SHALL pass a tier/quota check BEFORE the model request is issued", "no
model request SHALL be sent", "SHALL degrade to its unavailable state", "SHALL NOT write a partial
output snapshot") and never names a class, method, table or env var. Good.

**tasks.md verification statements are mostly real and failable**, not intent: 1.3 (remove
`analyzewithai` from `AiOps`, observe red, revert), 3.3 (fake-transport call-count = 0), 4.1–4.3
(per-arm mutation, pasted red output), 2.3/2.5 (assert the request reaching a fake client carries
the owner id; scheduled-run wiring extends the existing
`PipelineRunServiceAiStepClientWiringSpec`, which I read and which is a genuine
default-vs-wired discrimination test, not a compile check). Two exceptions are CR1 and CR2 below.

### Verdict: REFUTE

All four revisions are plan/artifact-level and cheap; none expands scope or touches
HEL-1109/HEL-1136. I found no defect in D3, D4's safety argument, D6, D7 or the AC1 restraint.

### Change Requests

1. **D8 is stated as an invariant the plan cannot deliver as written, and three existing
   construction sites are unaccounted for.** D8 says the fallback exists so nothing "construct[s]
   an ungated client", and task 3.5 asks to "verify by a test/inspection that no ungated
   `ClaudeAiStepClient` can be constructed". Whether that is achievable depends on a decision the
   design never makes: if the gate dependency is a REQUIRED constructor parameter, then
   `backend/src/test/scala/com/helio/domain/steps/AnalyzeWithAiStepSpec.scala:62`,
   `.../GenerateTextStepSpec.scala:65` and
   `.../services/pipelines/PipelineRunServiceAiStepClientWiringSpec.scala:131` each call
   `new ClaudeAiStepClient(client)` today and must all be updated — none is named in tasks.md, and
   the third is the very spec task 2.5 builds on. If instead the dependency is defaulted/optional
   (the file's prevailing convention), an ungated client remains constructible and 3.5's
   verification is false as phrased. Decide explicitly in D8, say which, enumerate the three test
   sites if required-param, and restate 3.5's verification in terms that can actually go red
   (e.g. "the production `ApiRoutes` construction site yields `AiStepClient.Unavailable` when
   `dbContext` is null, proven by a fixture without a `DbContext`").

2. **The owner-threading path in D2/task 2.2 skips the signatures it must actually change.**
   `PipelineRunService.scala:114` constructs the engine ONCE
   (`new InProcessPipelineEngine(fileSystem, connector, urlFetchSeam, resolveHost, isBlocked,
   aiStepClient)`), so the owner cannot be an engine field; it has to travel per-execution through
   `PipelineExecutionBackend.execute` (`PipelineExecutionBackend.scala:34-54`),
   `InProcessExecutionBackend.execute` (`:28-37`) and `InProcessPipelineEngine.executeTree`
   (`:354-364`) before reaching `makeContext` (`:686-705`). Neither D2, task 2.2, nor proposal.md's
   Impact list names any of those three signatures. Name them (and state the defaulted-param
   convention that keeps `SparkJobSubmitter` and every fixture compiling). Relatedly, task 2.2's
   instruction to thread the owner through "the flat `executeWithStepCounts`" path is wrong as
   written: that method is test-only (its own doc comment says "test-only as of P1.2", no
   production caller) and has no pipeline, hence no owner, in scope — say it stays defaulted
   `None` rather than asking for a value that does not exist there.

3. **A VIEWER grantee can drain the pipeline owner's combined daily AI budget through preview, and
   nothing in the design or the spec delta addresses it.** `previewAtNode`
   (`PipelineRunService.scala:~455`) gates on `pipelineRepo.findByIdShared(pipelineId,
   Some(user))` only — unlike `submit`, which additionally requires `findGrantRole == Some("editor")`
   before running. `previewStep`'s own doc says "sharing-aware — owner and grantees can preview",
   and the step-targeted arm executes the target's full dependency closure via `backend.execute`,
   so an AI step in that closure issues real model calls. Combined with D5 (charge the owner) and
   D3 (one shared chat+pipeline budget), a read-only grantee can repeatedly hit
   `GET /api/pipelines/:id/steps/:stepId/preview` and exhaust the owner's entire
   `HELIO_BETA_DAILY_MESSAGE_LIMIT`, incidentally locking the owner out of chat. The
   `pipeline-ai-tier-gating` delta asserts preview is in the owner-keyed set but adds no scenario
   for it and no viewer-abuse consideration. Make an explicit ruling and record it: either accept
   and document it as a known bound (with a scenario stating preview charges the owner), or deny AI
   steps in preview / restrict preview-triggered AI calls, or escalate it as out of scope with a
   named follow-up ticket. Do not leave it decided by omission.

4. **Correct the false claim in the writeback design spec as part of this change.** Task 5.5 only
   commits to stating in `files-modified.md` that the claim is false. That leaves
   `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (~line 225) on `main`
   asserting a security property (`ClaudeClient` "already enforces ... tier gating
   (`HELIO_BETA_DAILY_MESSAGE_LIMIT`)") that was never true, in the document every subsequent v0.8
   ticket reads — and it is exactly the claim that let these two steps ship ungated. Add a task to
   fix that sentence to describe what this ticket actually implements (gating at the
   `AiStepClient` seam, keyed on the pipeline owner). One-line edit, no scope risk.

### Non-blocking notes

- **N1 (D3/D4 consequence worth stating in the artifacts).** With per-call increments and a shared
  cap, any AI pipeline with more enabled-step rows than the remaining daily budget can NEVER
  complete for a beta user: it will fail at the first row past the cap, every attempt, having
  already spent the remainder of that day's budget. The design's "Trade-off accepted" text covers
  "can consume a user's chat allowance" but not "a >limit-row AI pipeline is structurally
  unrunnable on beta". Worth one sentence in D4's caveat so it is a known bound rather than a bug
  report later. (A pre-flight reserve-N would actually improve this by denying before spend — a
  reasonable follow-up ticket, still correctly out of scope here.)
- **N2.** The denial message (task 3.4) would be more actionable if it also named that the budget is
  shared with chat; otherwise a user who never opened chat sees a limit they cannot account for.
- **N3.** The gate will call `incrementIfUnderCap` under `ctx.withUserContext(<owner id>)` for
  grantee-triggered and scheduler-fired runs. That satisfies V88's RLS policy
  (`user_id = current_setting('app.current_user_id')::uuid`) on the app pool with no bypass needed
  — worth a one-line note where the gate is implemented, since setting the DB user context to
  someone other than the request's caller is unusual enough to attract review attention later.
- **N4.** `PipelineCostEstimator.scala:21-23`'s stale comment also cites "tasks.md C3" of a prior
  ticket; while fixing it (task 1.4), drop the dangling cross-ticket constraint reference rather
  than carrying it forward.
