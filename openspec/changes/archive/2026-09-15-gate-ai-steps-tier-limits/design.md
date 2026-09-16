## Context

See proposal.md — Why. Current state verified against `0ce987459d101c726a0082ad330b2f5f624fa6d0`:

- `ClaudeAiStepClient.complete` is the single call point every pipeline AI model call passes
  through, and already carries a HEL-1108 marker comment naming this exact gate.
- `AiStepRequest.ownerUserId` exists but is **always `None`** — only the case-class default is ever
  used; neither `AnalyzeWithAiStep` nor `GenerateTextStep` populates it. The gate is unreachable
  today.
- `com.helio.ai` has **no** tier/user awareness whatsoever. The writeback design spec's claim that
  `ClaudeClient` "already enforces ... tier gating" is false. **This false claim is plausibly why
  both AI steps shipped ungated**: it is the document every v0.8 ticket reads, and it asserted as
  already-solved the exact property this ticket exists to build. Correcting the document (task
  5.4a) is therefore part of the fix, not a courtesy — leaving it would invite the same omission
  for HEL-1135's AI-backed conversion.
- HEL-1100 already solved the identical ownership problem for write-back: `pipeline.ownerId` is in
  scope at the engine invocation and is threaded through `onRunSuccess` →
  `applyPendingWriteBacks`, whose **D5** rules that work runs AS the owner, never the triggering
  caller.
- `PipelineSchedulerService` already submits scheduled runs as
  `AuthenticatedUser(pipeline.ownerId, source = AuditSource.System)`.
- `userRepo` is an `ApiRoutes` constructor param and `dbContext` is available at the point
  `aiStepClient` is constructed, so the gate's dependencies need no wiring reorder.

## Goals / Non-Goals

Beyond proposal.md's scope: this design commits to reusing the chat counter rather than adding a
parallel one, and to denying **before** any model request is issued. It does not redesign the
per-row call model of either step.

## Decisions

### D1 — Enforce at `ClaudeAiStepClient.complete`, not in the step files
One chokepoint, already marked for it. Alternative (gate inside each step) rejected: two call
sites to keep in sync, and it would sit above the seam where a future third AI step would silently
miss the gate.

### D2 — Thread the owner per-execution, as a defaulted parameter
Add `ownerUserId: Option[String] = None` to `PipelineExecutionContext`, defaulted per the file's
existing convention (`assertionSink`, `resolveLane`, `writeBackSink`, `aiClient` all use it), so
every existing direct context construction keeps compiling.

The engine is constructed **once** (`PipelineRunService.scala:114`,
`new InProcessPipelineEngine(fileSystem, connector, urlFetchSeam, resolveHost, isBlocked,
aiStepClient)`), so the owner CANNOT be an engine field — it must travel **per execution**. The
value originates as `pipeline.ownerId` in `PipelineRunService` and passes through these three
signatures, each gaining a defaulted `ownerUserId: Option[String] = None` parameter so
`SparkJobSubmitter` and every existing fixture keep compiling:

1. `PipelineExecutionBackend.execute` (`PipelineExecutionBackend.scala:34-54`) — the trait.
2. `InProcessExecutionBackend.execute` (`:28-37`) — the in-process implementation.
3. `InProcessPipelineEngine.executeTree` (`:354-364`) — which forwards it into `makeContext`.
   The CALL to change is at `InProcessPipelineEngine.scala:418`; `:686-705` is `makeContext`'s
   definition (design-gate N9). The other call, `:218`, is the test-only flat path left defaulted.

**All FIVE `backend.execute` call sites in `PipelineRunService` must thread the owner** (design-gate
rounds 2-3). Of the five, **three are genuinely AI-reachable** (`:566`, `:710`, `:945`) and two run
with `Vector.empty` steps so no step — and therefore no AI step — can evaluate there (`:494`,
`:694`); those two are threaded for uniformity and future-proofing only, and admit NO behavioural
AI-client test. Fail-closed semantics turn an omission at an AI-reachable site into a silent
regression rather than a compile error. This enumeration is standing constraint C11:

| Site | Path | AI reachable? | Owner source |
| --- | --- | --- | --- |
| `:494` | source-level preview (executes with `Vector.empty` steps) | No | n/a — no steps |
| `:566` | step-targeted preview | Yes | `pipeline.ownerId` (also gated by D10) |
| `:945` | the real run | Yes | `pipeline.ownerId` |
| `:694` | Output backfill, **source/root-level** arm (`case allRoots if targetStepId.isEmpty`, `:684`) — executes with `Vector.empty` steps (`:695`) | No — n/a, no steps | threaded for uniformity only |
| `:710` | Output backfill, **step/node** arm (`case Some(target)`, `:707-711`) — real closure via `NodeDependencyClosure.closureOf` | **Yes** | `pipeline.ownerId`, in scope from `findByIdShared` (`:679`) |

Both backfill sites sit inside `evaluateNodeRowsForBackfill`, reached from `backfillOutputNode`
(`:661`). **`:710` was the real gap** (design-gate round 3 corrected the round-2 fix here: `:694`
passes `Vector.empty`, so it was never AI-reachable): left unthreaded at `:710`, `ownerUserId` is
`None`, which D8/3.5c rule NOT permitted, so **every AI-pipeline step-bound Output backfill would
fail — including for `owner`-tier users who are never capped** — and fail INVISIBLY, because the
`.recover` arms at `:697-699`/`:719-721` only `log.error` and `backfillOutputNode` itself
`.recoverWith`s to `Future.successful(())` (`:664-667`). That is exactly the silent no-op AC2
forbids, so threading `:710` is mandatory and is the site that carries falsifiable evidence.

`InProcessPipelineEngine.executeWithStepCounts` is **test-only** (its own doc comment says so as of
P1.2; it has no production caller) and has no pipeline — hence no owner — in scope. Its context
stays defaulted `None` and is deliberately NOT threaded. An AI step exercised through that path
therefore sees no owner; see D8 for why that denies rather than permits.

### D3 — Share the existing chat counter and limit
Pipeline AI calls count against `assistant_daily_usage` (V88) under the SAME
`HELIO_BETA_DAILY_MESSAGE_LIMIT`, via the existing
`AssistantDailyUsageRepository.incrementIfUnderCap`. Rationale: a beta user should have ONE daily
AI budget, not two — a separate counter would silently double the model spend the limit exists to
bound. It also needs no migration (V107 is highest; nothing new is required) and inherits the
existing atomic, race-safe, RLS-scoped statement.

Alternative (own table/counter) rejected: doubles effective spend, adds a migration, and
duplicates a non-trivial atomic upsert. Trade-off accepted and documented: a large AI pipeline can
consume a user's chat allowance for the day.

### D4 — Increment once per model call, deny fast, fail the run
Both steps issue one call per row, so the gate runs per row. On denial the step fails immediately
and no further calls are issued (the steps' existing sequential contract already guarantees row
N+1 is not attempted after row N fails). This is safe because a step failure already fails the
WHOLE run: `StepExecutionException` → `422` + `RunStatusEvent("failed")` + persisted `error_log`,
and no node snapshot is written — so a mid-run denial leaves **no half-applied state**.

Alternative (pre-flight reserve-N-for-N-rows) rejected as scope: it needs a new increment-by-N
repository method and a release is held. Documented caveat: rows processed before the denial have
already incurred spend; a retry at cap fails on row 1 having spent nothing further.

**A quota-denied BACKFILL stays best-effort/log-only (explicit ruling, design-gate round 2 CR1).**
Backfill is already a best-effort path by existing contract (`backfillOutputNode` recovers to
`Future.successful(())`), and it is deliberately off the request path. A denial there therefore
logs and leaves the Output's PREVIOUS rows intact — it SHALL NOT overwrite them with empty or
partial rows, and SHALL NOT fail the triggering request. This is a conscious divergence from the
run path's loud 422: a backfill has no caller to tell. It is safe only because the owner is now
threaded (above), so a denial there means the owner genuinely is over cap rather than merely
unidentified.

Known bound (design-gate N1), stated so it is not filed as a bug later: with per-call increments
and a shared cap, an AI pipeline whose row count exceeds the user's REMAINING daily budget can
never complete for a `beta` user — it fails at the first row past the cap on every attempt, having
spent the remainder of that day's budget. A pre-flight reserve-N would strictly improve this by
denying before any spend; it is a named follow-up, deliberately out of scope for a held release.

### D5 — Key on the pipeline owner on every trigger path
Manual, scheduled, hook-triggered and preview runs all resolve ownership from the pipeline row,
not the request, reusing HEL-1100 D5 verbatim. A scheduled run therefore counts against the
pipeline **owner** — the only identity that exists on that path, and the one already used for
write-back and audit.

### D6 — New closed-set failure variant, enforced by TESTS (not by the compiler)
Add `AiStepFailure.QuotaExceeded(limit: Int)` to the sealed set; each step file maps it to
`fail("ai-quota-exceeded", <message naming the limit, the UTC reset, and that the budget is shared
with chat>)`, surfacing verbatim through `StepExecutionException.from`'s
`IllegalArgumentException` allowlist.

**Correction (design-gate round 4).** An earlier version of this decision claimed "the compiler
forces both step files to handle it". **That is false for this build**, and the claim had been
repeated unverified in the ticket's own premise notes and three prior gate rounds. Ground truth:
`backend/build.sbt` declares **no `scalacOptions` at all** (`sbt "print Compile/scalacOptions"`
returns an empty sequence), CI runs plain `sbt compile test`
(`.github/workflows/ci.yml:149`), and `scripts/check-scala-quality.mjs` has no exhaustivity rule
(its own header says its extra rules warn rather than fail). On Scala 2.13 without
`-Xfatal-warnings`/`-Werror`, `match may not be exhaustive` is a **warning**, so adding the variant
compiles and tests green with both step files untouched.

Why that matters rather than being pedantic: a missed arm throws `scala.MatchError` at runtime.
`StepExecutionException.from` (`InProcessPipelineEngine.scala:48-52`) allowlists only
`IllegalArgumentException` for verbatim message pass-through, so a `MatchError` falls to the
`case other` arm at `:51` and becomes the generic **"step execution failed"** — losing exactly the
limit and UTC reset that AC2, task 3.4 and the `pipeline-ai-tier-gating` scenario "Denial names the
limit and the reset" all require. A silent-ish generic failure is precisely what AC2 forbids.

Enforcement is therefore **by test, explicitly**: the per-step `QuotaExceeded` mapping tests
(task 3.4), the distinguishability assertion (task 4.3), and a dedicated assertion that a denial
surfaces the quota message VERBATIM rather than "step execution failed" — whose mutation is
"drop one step file's `QuotaExceeded` arm", which must make it go red. A scoped
`-Xfatal-warnings`/`-Wconf` build change was considered and rejected for a held release: it risks
failing on pre-existing warnings elsewhere, which is unbounded work outside this ticket.

Alternative (reuse `Guardrail`) rejected: conflates a model-side refusal with an account quota,
and would make the two indistinguishable to any future consumer.

### D7 — Inherit tier semantics; do not reimplement them
`owner` is never counted; `free` is denied; a configured limit below 1 is "always capped" (the
repository short-circuits before touching the DB). These come from the existing
`ChatAccessService`/`AssistantDailyUsageRepository` behavior and are reused, not re-derived.

### D8 — The gate is a REQUIRED constructor parameter of `ClaudeAiStepClient` (fails CLOSED)
Decided explicitly (the design gate was right that this was previously left ambiguous, making the
"no ungated client" claim unverifiable): the gate dependency is a **required, non-defaulted**
constructor parameter of `ClaudeAiStepClient`. It is NOT optional and NOT defaulted — the
prevailing defaulted-param convention is deliberately not followed here, because a defaulted gate
is exactly how an ungated client stays constructible.

Consequence, accepted: there are FOUR construction sites — three test sites that must be updated
(named below) plus the production site `ApiRoutes.scala:328`, which is covered separately by task
3.5b rather than 3.5a (design-gate N7). The three test sites, named so none is discovered late —
- `backend/src/test/scala/com/helio/domain/steps/AnalyzeWithAiStepSpec.scala:62`
- `backend/src/test/scala/com/helio/domain/steps/GenerateTextStepSpec.scala:65`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceAiStepClientWiringSpec.scala:131`

**Val-initialization-order trap (design-gate N6):** `aiStepClient` is built at `ApiRoutes:322-329`
but `chatAccessServiceOpt` at `:488`. Scala initializes `val`s in declaration order, so a gate that
referenced the existing `ChatAccessService` val would silently capture `null` with no compiler
complaint. The gate therefore reuses the underlying machinery (`userRepo`, available as a
constructor param at `:78`, and `dbContext` at `:149`) — NOT the later val. "Reuse the chat
machinery" must never be read as "reference `chatAccessServiceOpt`".

In `ApiRoutes`, the gate is built from `Option(dbContext)`; when absent, `aiStepClient` resolves to
the EXISTING, already-named `AiStepClient.Unavailable` rather than an ungated `ClaudeAiStepClient`.
So the invariant is structural (the type system forbids an ungated instance) plus behavioural (no
`DbContext` ⇒ `Unavailable`). A request carrying no owner (`ownerUserId = None`, e.g. the test-only
`executeWithStepCounts` path in D2) is treated as **not permitted** rather than exempt.

### D9 — No frontend change is forced (deliberate conclusion)
A pipeline AI denial surfaces as an ordinary run failure (422 + `error_log` + SSE `failed`), which
the existing pipeline run-failure UI already renders verbatim; no new error code crosses the wire
on the pipeline path. The chat `429`/`CHAT_LIMIT_REACHED` surface is untouched. Clarity is carried
by the message text, not a new UI state. Step-card UI is HEL-1109; op-menu is HEL-1136.

### D10 — Preview-triggered AI calls are authorized like `submit` (closes a viewer-drain hole)
The design gate found a real hole that D3+D5 together create and that nothing previously addressed:
`previewAtNode` (`PipelineRunService.scala:450-454`) authorizes on `pipelineRepo.findByIdShared` ALONE,
whereas `submit` additionally requires `findGrantRole == Some("editor")`. Since preview executes the
target node's full dependency closure, a **read-only viewer grantee** could repeatedly call
`GET /api/pipelines/:id/steps/:stepId/preview`, issue real model calls charged to the OWNER (D5),
and drain the owner's combined chat+pipeline budget (D3) — incidentally locking the owner out of
chat.

Ruling: a preview that would issue a pipeline AI model call SHALL be authorized by the same rule
`submit` uses — the pipeline **owner or an editor grantee** only. A viewer grantee previewing a
closure containing an enabled AI step is denied with a clear error and **zero** model calls. This
is the minimal, consistent fix: it changes nothing for the owner, nothing for editors (who can
already trigger owner-charged AI runs via `submit`), and closes only the viewer asymmetry. It is
recorded as standing constraint C10.

Stated plainly (design-gate N8): this is a user-visible **capability removal**, not pure hardening
— viewer grantees can preview AI-step pipelines today and will receive a 403 afterwards. It is the
right call and v0.8.2 is held (so effectively unreleased), but recording it here keeps it from
being filed as a regression later.

Alternatives rejected: (a) accept and document the drain — an unauthenticated-adjacent cost-transfer
to another account is not an acceptable known bound; (b) ban AI steps in preview entirely — removes
legitimate owner/editor capability for no security gain.

## Risks / Trade-offs

- [A large AI pipeline consumes a beta user's chat allowance] → accepted and documented (D3); one
  shared budget is the intended cost bound.
- [Spend already incurred before a mid-run denial] → bounded by fail-fast (D4); no half-applied
  state because the run fails atomically.
- [Gate silently bypassed if a future AI step skips the seam] → mitigated by enforcing below the
  seam (D1). NOT mitigated by any compiler guarantee: exhaustivity is only a warning in this build
  (D6), so the real mitigation is the per-step mapping tests plus the verbatim-message assertion.
- [A missed match arm degrades a quota denial to the generic "step execution failed"] → covered by
  the verbatim-message assertion in D6, whose mutation is dropping a step file's arm.
- [Shared-counter change alters chat spec meaning] → declared as a `tier-gated-assistant-access`
  delta rather than left implicit.
- [A >remaining-budget AI pipeline is structurally unrunnable on beta] → stated as a known bound in
  D4; reserve-N follow-up named.
- [An unthreaded `backend.execute` site silently breaks AI backfills under fail-closed] → all five
  sites enumerated in D2 and pinned as standing constraint C11, with a falsifiable per-site test.
- [The gate sets the DB user context to someone other than the request's caller] → intended:
  `incrementIfUnderCap` runs under `ctx.withUserContext(<pipeline owner id>)` for grantee-triggered
  and scheduler-fired runs, which is what satisfies V88's `user_id = current_setting(...)` RLS
  policy on the app pool with no bypass. Unusual enough to warrant an inline comment where the gate
  is implemented (design-gate N3).

## Migration Plan

None. No schema change; V107 already admits all four ops and remains the highest migration.
Rollback is a code revert — no data shape changes.
