## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Reviewed at `HEAD = 0ce987459d101c726a0082ad330b2f5f624fa6d0`; live-resolved base
(`scripts/concertino/resolve-review-base.sh . main origin`) = the same SHA — `git diff --stat
BASE...HEAD` is empty, i.e. planning artifacts only, no code diff, as briefed.
`npx openspec validate gate-ai-steps-tier-limits --type change` → `Change
'gate-ai-steps-tier-limits' is valid`, exit 0.
`scripts/concertino/check-constraints-carryover.sh "$PWD" gate-ai-steps-tier-limits` → `OK`,
exit 0 (my first invocation of this script passed the wrong arguments and printed a usage error;
re-run correctly per the reproduce-before-concluding rule — the `OK` above is the real result).
C10 is present in both `workflow-state.md` (`CONSTRAINTS`, `agreed_at: design-gate`) and
`tasks.md`'s `## Standing Constraints`.

### What I verified (with evidence)

**CR1 — RESOLVED, genuinely.** D8 now decides rather than hedges: the gate is a required,
non-defaulted constructor param, with the convention break stated as deliberate. I verified the
construction-site enumeration against ground truth — `grep -rn "ClaudeAiStepClient(" backend/src`
returns exactly the three test sites D8/3.5a name, at the exact lines named
(`AnalyzeWithAiStepSpec.scala:62`, `GenerateTextStepSpec.scala:65`,
`PipelineRunServiceAiStepClientWiringSpec.scala:131`), plus the production site
`ApiRoutes.scala:328` (covered separately by 3.5b). Task 3.5b is now genuinely falsifiable — a
fixture with no `DbContext` must yield `AiStepClient.Unavailable`, asserted via zero transport
calls, with a stated mutation (build a real client in the fallback) that makes it go red. The
`Option(dbContext)` fallback shape it specifies matches the existing `ApiRoutes` idiom I read at
`:193-202`/`:488`. 3.5c ("`ownerUserId = None` is NOT permitted") is a decision, not a restatement.

**CR2 — RESOLVED, and the signatures check out line-for-line.** The engine is indeed constructed
once: `PipelineRunService.scala:114`, `private val engine = new InProcessPipelineEngine(fileSystem,
connector, urlFetchSeam, resolveHost, isBlocked, aiStepClient)` — so D2's "the owner cannot be an
engine field, it must travel per execution" is correct. All three named signatures exist as
described: the `PipelineExecutionBackend.execute` trait method (ending in the defaulted
`writeBackSink`), `InProcessExecutionBackend.execute` (same defaulted tail), and
`executeTree` at `:354-364` forwarding into `makeContext` at `:686-705` (I read `makeContext`; it
builds the `PipelineExecutionContext` and sets `aiClient = aiStepClient`, so it is the right
insertion point). The defaulted-param rationale is real: `SparkJobSubmitter` implements the trait
and several fixtures construct contexts directly.

**2.2a is substantively correct, with one wording caveat (note N5).** `executeWithStepCounts` has
exactly one main-side caller — the engine's own `execute` at `InProcessPipelineEngine.scala:189` —
and `execute` itself has no production caller: the only production consumer of the engine is
`InProcessExecutionBackend`, which calls `executeTree` (`:60`) and `loadRowsWithStats` (`:53`)
only. The file's own doc at `:205-210` says so ("test-only as of P1.2 ... kept as the tree walk's
parity oracle"). So "stays defaulted `None`" is right.

**CR3 / D10 — the decision is sound, and the ordering concern you flagged does NOT bite.** I
checked this hardest, as asked.
- The hole is real and as described: `submit` (`:210-225`) authorizes owner-or-`findGrantRole ==
  Some("editor")` and 403s everyone else, while `previewAtNode` (`:450-455`) gates on
  `findByIdShared` alone.
- **Implementable without executing first — confirmed.** In the step-targeted arm, the closure is
  computed *before* any execution: `pipelineStepRepo.listByPipelineInternal` →
  `NodeDependencyClosure.closureOf(sortedSteps.toVector, target)` (≈`:540`), and only then
  `backend.execute`. `closureOf` is a pure static helper over the step vector
  (`NodeDependencyClosure.scala:50`, a visited-set fixed-point walk over `parentStepId` + lane
  edges — no execution, no IO). So "does this closure contain an enabled AI step?" is a pure
  predicate over `slicedSteps` available at authorization time. There is no ordering defect, and
  the denial is at authorization time rather than mid-closure, which is what yields the spec's
  required ZERO model calls.
- **The carve-out is coherent too.** The source-level arm (`targetStepId.isEmpty`, `:494`) executes
  with `Vector.empty` steps, so it can never reach an AI step — "no AI step in the closure ⇒
  unchanged" needs no special handling there.
- **Coverage is complete for preview.** `previewAtNode` is the single preview execution choke
  point: its call sites are `previewStep` (`:345`) and both `previewOutputs` arms (`:391`, `:410`).
  So one guard inside `previewAtNode` covers every preview entry, including the `outputId` path.
- **"Owner or editor grantee" is the right line.** An editor can already trigger owner-charged AI
  runs through `submit` (verified above), so extending preview to the same rule transfers no new
  capability and closes only the viewer asymmetry. The rejected alternatives (accept the drain;
  ban AI in preview entirely) are correctly rejected.
- The four new spec scenarios state outcomes, not implementation, and the `enabled` qualifier in
  3b.1 is necessary and correct — `closureOf` deliberately does **not** pre-filter disabled
  ancestors (the engine skips them in place, per the `:530` comment), so the predicate must test
  `.enabled` or a viewer would be over-denied for a disabled AI step.

**CR4 — RESOLVED.** Task 5.4a fixes the document itself, and I confirmed the false sentence is
still there and is load-bearing: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`
≈`:222-224` says `analyzewithai`/`generatetext` "route through the existing `com.helio.ai`
`ClaudeClient`, which already enforces `CLAUDE_MAX_TOKENS`, `CLAUDE_MAX_INPUT_TOKENS` and tier
gating (`HELIO_BETA_DAILY_MESSAGE_LIMIT`)". `ClaudeAiStepClient.scala:14-19` and
`AiStepClient.scala`'s `AiStepRequest` doc both confirm the gate is unimplemented; neither file has
any tier concept. 5.4a's verification (grep that the assertion is gone AND the replacement names
the seam) is falsifiable.

**N1–N4 all landed as stated.** N1 is in D4 as a named known bound plus a Risks entry with
reserve-N as a follow-up; N2 is folded into 3.4 (limit + UTC reset + shared-with-chat); N3 is a
Risks entry plus task 3.2a (inline comment at the `withUserContext(<owner>)` call); N4 is folded
into 1.4 (drop the dangling cross-ticket reference).

**Reuse targets exist as the plan assumes.** `ChatAccessService.checkConverseCap` has exactly the
tier semantics D7 inherits (`Owner` → uncounted `Right`, `Beta` → `incrementIfUnderCap` or
`LimitReached(limit)`, `Free` → `TierForbidden`), and it is built from `(userRepo, usageRepo,
config)` — all three obtainable at the `aiStepClient` construction point (`userRepo` is a
constructor param at `ApiRoutes.scala:78`, `dbContext` at `:149`). D6's premise holds:
`AiStepFailure` is a sealed trait of exactly four case classes, so adding `QuotaExceeded(limit)`
does force both step files at compile time.

**Scope.** No HEL-1109/HEL-1136 absorption (C6 intact): D9's no-forced-frontend-change conclusion
is restated and no frontend task was added. D10 is scope *created by this ticket's own change*
(charging the owner for grantee-triggered calls), not new product work, so it is in scope rather
than creep. No migration is proposed (C5 intact).

### Verdict: REFUTE

**No round-1 change request survives unaddressed.** All four are genuinely and substantively
resolved, and D10 — the decision you flagged for hardest scrutiny — is sound, correctly reasoned,
and implementable exactly as written; the ordering defect you suspected does not exist. This REFUTE
rests on a single new finding that the revisions introduced by adopting fail-closed semantics
(D8/3.5c) without enumerating every execution call site.

### Change Requests

1. **A fourth execution call site — the Output backfill path — is named nowhere, and fail-closed
   turns that omission into a SILENT regression.** `PipelineRunService` has five `backend.execute`
   call sites, not the three the plan reasons about: `:494` (source-level preview, zero steps — no
   AI reachable), `:566` (step preview — covered by 2.4/3b), `:945` (the real run — covered by
   2.2/2.5), and **`:694` / `:710` inside `evaluateNodeRowsForBackfill`**, which is covered by
   nothing. The step-level arm at `:710` executes a real closure —
   `NodeDependencyClosure.closureOf(allSteps.toVector, target)`, the same helper preview uses — so
   an enabled `analyzewithai`/`generatetext` step genuinely runs there. It is reached from
   `backfillOutputNode` (`:661`) and has `pipeline` in scope from its own `findByIdShared`
   (`:679`), so `pipeline.ownerId` is available and threading it is a one-line change per site.
   Left unthreaded, `ownerUserId` is `None`, which D8 and task 3.5c rule "NOT permitted" — so every
   AI-pipeline Output backfill starts failing, **including for `owner`-tier users who are never
   capped**. Worse, it fails invisibly: the `backend.execute` `.recover` arms at `:711-717` and
   `:693-698` only `log.error`, and `backfillOutputNode` itself `.recoverWith`s to
   `Future.successful(())` (`:664-667`). The user-visible result is an Output that silently stops
   getting rows — precisely the "silent no-op" AC2 exists to forbid, introduced by this ticket's
   own fail-closed rule. Required: name this path in D2/D5, thread `pipeline.ownerId` into both
   backfill `backend.execute` calls, and add a task whose verification is falsifiable (a backfill
   over a closure containing an enabled AI step reaches a fake client carrying the owner id — with
   a mutation dropping the threading that makes it go red). Also state explicitly whether a
   quota-denied backfill should stay log-only or surface, since fail-closed makes that reachable
   for the first time; if log-only is the deliberate answer, say so in D4 next to the "no
   half-applied state" argument rather than leaving it to the `.recover`.

### Non-blocking notes

- **N5 (task 2.2a's expected grep result is off by one).** 2.2a says "grep for production callers
  (expect zero)". A literal grep finds one main-side hit,
  `InProcessPipelineEngine.scala:189` — the engine's own `execute` delegating to it. The claim is
  still true at the level that matters (neither method has any caller outside the engine; the only
  production consumer of the engine calls `executeTree`), but reword the expected result so the
  executor neither trips on the hit nor papers over it: "zero callers of either `execute` or
  `executeWithStepCounts` from outside `InProcessPipelineEngine`; the one intra-file delegation at
  `:189` is the equally test-only `execute`."
- **N6 (`ApiRoutes` val-initialization-order trap).** `aiStepClient` is built at `:322-329`, but
  `chatAccessServiceOpt` is built at `:488` — far later. Scala initializes `val`s in declaration
  order, so a gate that reuses the *existing `ChatAccessService` val* would silently capture
  `null`, with no compiler complaint. D3/D8's stated dependencies (`userRepo` + `dbContext`, both
  available at `:322`) are the correct ones and avoid this, and task 3.2 says reuse the machinery,
  not the val — worth calling out where 3.2 is implemented so the reuse instruction isn't read as
  "reference `chatAccessServiceOpt`".
- **N7 (D8 counts three construction sites; there are four).** The fourth is the production one,
  `ApiRoutes.scala:328`, and it *is* handled — by 3.5b rather than 3.5a. Only the word "three" in
  D8's prose is inaccurate; no task is missing.
- **N8 (D10 is a user-visible capability removal, worth one sentence).** Viewer grantees can
  preview AI-step pipelines today and will get a 403 after this change. Correct call, and v0.8.2
  is held so it is effectively unreleased — but it is a behavior removal rather than a pure
  hardening, and saying so in D10 keeps it from reading as a bug later.
