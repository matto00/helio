## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and the spec delta at
  `specs/pipeline-proposal-apply/spec.md`, plus the current (pre-change)
  `openspec/specs/pipeline-proposal-apply/spec.md`.
- `openspec validate proposal-apply-fail-safely --strict` → `Change 'proposal-apply-fail-safely' is
  valid` (structural schema check passes).
- Read `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` in full. Confirmed
  design.md's line-cited claims against the real file:
  - `handleInlineCreated` (actual lines 250-264) does delete the just-created source and return
    `Left(ServiceError.BadGateway(err))` on `fetchError`, exactly as design.md's "candidate 1" trace
    states.
  - `createPipeline` (lines 306-348) unconditionally calls `pipelineRunService.submit` after
    `addSteps` succeeds, with no branch on source kind — confirms design's claim that fixing only
    `handleInlineCreated` would still hit a second, DNS-independent rollback via the Spark-submission
    rejection.
- Read `backend/src/main/scala/com/helio/services/PipelineRunService.scala` in full. Confirmed
  `runPipeline` (actual lines 118-150, `RestSource`/`SqlSource` match at 134-139) and `previewStep`
  (155-211, match at 167-172) both unconditionally reject `RestSource`/`SqlSource` regardless of
  connectivity — matches design.md's claim. Confirmed **no existing `object PipelineRunService`
  companion object** (`grep -n "^object PipelineRunService"` → no match) — design.md/tasks.md 1.2 say
  "add ... to `PipelineRunService`'s companion object" as if one exists; a competent implementer must
  actually create it. Minor imprecision, not blocking.
- Read `backend/src/main/scala/com/helio/services/CreateSourceEnvelope.scala` and
  `RestApiConnector.scala` (lines 85-131) — confirmed the `Either`-safe fetch/`.recover` chain and the
  exact cited line numbers (100-105, 125-130) for the ticket's own root-cause claims.
  `ServiceError.BadGateway` → `StatusCodes.BadGateway` (502) with a JSON `ErrorResponse` body,
  confirmed in `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:69-86` — supports
  design's framing that the incident's "bare 502" was actually a typed-but-destructive response.
- Read `backend/src/test/scala/com/helio/api/PipelineApplyProposalRollbackSpec.scala` and
  `PipelineApplyProposalSpecBase.scala` — the two tests tasks.md 2.1/2.2 target for rewrite exist
  verbatim as described (including the `RestSuccessUrl`-based "healthy fetch still rolls back" case).
- Read `CombinedProposalService.scala` in full — confirmed it only branches on `Left`/`Right` from
  `pipelineProposalService.apply`, never inspects `run.blocked`; task 1.5 ("verification only, no
  code change") is accurate.
- Confirmed `DataSourceKind` constants, `RunResultResponse`/`PipelineProposalApplyResponse` wire
  shapes, and `ConnectionTest`/`SourceService.testRest`/`testSql` all match design.md's citations.
- **Verified against Linear** (`mcp__linear__get_issue`) whether the "real pipeline execution for
  rest_api/sql" follow-up ticket design.md's Planner Notes and Risks sections both assert was
  "filed alongside this change, not blocking it" actually exists: checked HEL-756 (assistant
  connection-verification, unrelated), HEL-757 (assistant web-search research, unrelated), and
  HEL-758/759/760 (do not exist — `"Could not find referenced Issue"`). **No such ticket exists.**
  This is a false claim of completed work in the design artifact, not a hedge ("should be filed") —
  see Change Request 1.
- Traced what actually happens to `run.blocked`/`blockedReason` end-to-end on the frontend for the
  exact scenario this ticket is about (D2's "skip `pipelineRunService.submit` entirely" branch):
  - `PipelineRunService`'s only writes to `pipeline_runs` (`insertRun`/`updateRunTerminal`) live
    inside `executeRun`, reached only via `submit` → `runPipeline` — exactly what D2 bypasses. So no
    run row is ever persisted for this case.
  - `frontend/src/features/pipelines/ui/RunHistoryModal.tsx:171-175` renders a generic `EmptyState`
    ("No runs recorded yet") when `runs.length === 0` — indistinguishable from any brand-new, healthy,
    not-yet-run pipeline.
  - `frontend/src/features/pipelines/ui/PipelineProposalReviewPage.tsx:51-52` (`handleAccept`) and
    `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx:52-56` (`handleAccept`) both
    only branch on reject (`.catch`) — a successful (`Right`) response's `run.blocked`/`blockedReason`
    is read nowhere; no banner/toast renders it. `PipelineDetailPage.tsx` never reads
    `location.state` either, so nothing carries the reason across the post-accept redirect.
  - Net effect: the curated `fetchError`/`blockedReason` message this design computes and threads
    through the whole call chain is visible **nowhere** a user would ever see it — not in today's UI,
    not after a page reload. See Change Request 2.

### Verdict: REFUTE

The core mechanical fix (D1 + D2, stop deleting on `fetchError`, skip the eager run for an
execution-unsupported kind) is sound, well-traced against real code, and the two rollback tests it
targets for rewrite are correctly identified. But the design artifact contains one false factual claim
and one Non-Goal whose justification I traced and found to be incorrect — both need to be resolved
before execution, per this gate's purpose of catching design flaws before they're expensive to fix.

### Change Requests

1. **False "follow-up ticket filed" claim.** `design.md`'s Risks section ("Tracked as a follow-up
   ticket (real execution support), filed alongside this change, not blocking it.") and Planner Notes
   ("filing a follow-up ticket ... it's a substantial, pre-existing feature gap") both assert, in
   completed-past-tense, that a Linear ticket for "implement real pipeline execution for `rest_api`/
   `sql` sources" already exists. It does not — verified via `mcp__linear__get_issue` against
   HEL-756/757 (both unrelated: assistant connection-test tool and assistant web-search, not execution
   support) and HEL-758/759/760 (do not exist). Either actually file the ticket and cite its real ID
   in `design.md`, or reword both passages to stop claiming a completed action (e.g. "should be filed
   as a follow-up, not fixed here" instead of "filed alongside this change").

2. **"Visibly needs-attention" Non-Goal rests on a factually incorrect claim.** `design.md`'s Goals
   section says the blocked state is "reported honestly via the existing `blocked`/`blockedReason`
   fields ... the pipeline detail page's existing Run History UI already understands," and the
   Non-Goals section explicitly declines to persist a durable "needs attention" signal because
   "the blocked run's `blockedReason`, already returned in the apply response and visible via
   existing Run History UI ... satisfies 'visibly needs attention'." I traced this end-to-end (see
   evidence above) and it is false for exactly the case D2 introduces: `createPipeline`'s skip branch
   never calls `pipelineRunService.submit`, so no `pipeline_runs` row is ever written, so Run History
   shows a generic "No runs recorded yet" — not a blocked run with a reason — and neither
   `PipelineProposalReviewPage.tsx` nor `CombinedProposalReviewPage.tsx` renders `run.blocked`/
   `blockedReason` on a successful response today. In the shipped behavior, the curated
   `fetchError`/`blockedReason` message is visible nowhere durable — only transiently in the raw HTTP
   response object, which current frontend code discards. This directly undercuts the ticket's own
   explicit framing ("fail safely, **not silently**") and the literal AC ("the source left in a
   visibly misconfigured/needs-attention state"). Required: either (a) correct the Goals/Non-Goals
   language to honestly state this limitation and get explicit self-approval (or product sign-off) that
   "doesn't destroy created resources, but the specific reason is not persisted or shown anywhere" is
   an acceptable scope for this ticket, or (b) expand scope minimally so the reason actually persists
   and surfaces somewhere a user will see it on a later visit (e.g. still write a lightweight
   non-Spark "blocked" `pipeline_runs` row for this skip case so it appears in Run History as the
   design currently (incorrectly) claims it already would, and/or have the two `handleAccept` call
   sites surface `run.blocked`/`blockedReason` via a banner immediately after redirect). Whichever
   path is chosen, the artifacts must stop asserting a UI behavior that a straightforward trace shows
   does not exist.

### Non-blocking notes

- `tasks.md` 1.2 / `design.md` D2 say "add `SparkUnsupportedKinds` ... to `PipelineRunService`'s
  companion object" — no such companion object currently exists (only `object TriggerSource` at the
  bottom of the file); the executor will need to create `object PipelineRunService { ... }` from
  scratch. Not ambiguous enough to block, just worth a heads-up so it isn't mistaken for a missed
  file search.
- The spec delta renames the modified requirement's title ("Source-fetch failure is a structured,
  rolled-back error" → "...creates a needs-attention pipeline, not a rollback") inside a single
  `## MODIFIED Requirements` block rather than a REMOVED+ADDED pair. `openspec validate --strict`
  accepts this, and the archive skill's sync step is agent-driven ("determine what changes would be
  applied ... renames"), so this should reconcile fine at archive time — flagging only so the archive
  step doesn't skip verifying the rename actually replaces (not duplicates) the old requirement.
