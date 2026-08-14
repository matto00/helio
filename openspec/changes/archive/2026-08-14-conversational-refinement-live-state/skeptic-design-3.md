## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, the full current `design.md`, `tasks.md`, all four spec deltas
  (`specs/{authoring-conversation-state,conversational-refinement,mcp-patch-set-tools,refinement-chat-surface}/spec.md`),
  and both `skeptic-design-1.md`/`skeptic-design-2.md` fresh from this worktree — treated prior reports'
  claims (including the prompt's own "3 fixes" summary) as claims to re-verify, not facts.

- **Round-2 fix 1 (D1/task 2.2 `PanelRepository.findAllByDashboardId` argument order).** Real signature:
  `findAllByDashboardId(dashboardId: DashboardId, callerOpt: Option[AuthenticatedUser], page: Page)`
  (`backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala:43-47`). Design.md D1 and
  tasks.md 2.2 now both cite it as `PanelRepository.findAllByDashboardId(id, Some(user), Page(0,
  Page.MaxLimit))` — correct order and type. **Fixed, accurate.**

- **Round-2 fix 2 (D2a/task 2.3, all 5 `PanelBindingSpec.DataBindable` kinds).** Confirmed
  `PanelBindingSpec.DataBindable: Vector[PanelBindingSpec] = Vector(Metric, Chart, Table, Collection,
  Timeline)` (`backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala:104`) — five kinds.
  Design.md D2a now reads "...a worked JSON example for EACH `target.kind`... including one panel `config`
  example for EVERY kind in `PanelBindingSpec.DataBindable` (metric/chart/table/collection/timeline — all
  five, not a subset..." and tasks.md 2.3 matches ("a panel `config` example for EVERY
  `PanelBindingSpec.DataBindable` kind (metric/chart/table/collection/timeline, all five)"). **Fixed,
  accurate.**

- **Round-2 fix 3 (D3a + task 1.6 + new spec scenario, the cross-flow-conversationId finding) — scrutinized
  in depth per the prompt's specific request:**
  - Confirmed `AuthoringConversationRepository.appendTurn` (lines 76-99, the unconditional-overwrite
    `.update((apiHistory, displayTurns, Some(latestProposal), totalTokensUsed, updatedAt))` at lines
    92-96) is exactly as D3a cites it — line numbers match precisely.
  - Confirmed `DashboardAuthoringService.loadForContinuation`'s doc comment starts at line 212, method
    signature at line 216 (`DashboardAuthoringService.scala:212-224`) — matches D3a's "`:212+`" citation.
    Confirmed it currently only checks existence/ownership (`conversationRepo.findById` → `None` maps to
    `Left(AuthoringError.plain(ServiceError.NotFound()))`) plus a token-budget check — never which flow a
    record belongs to, exactly as D3a describes.
  - Confirmed `AuthoringError.plain(serviceError: ServiceError): AuthoringError = AuthoringError(None,
    serviceError, NoTokens)` (`backend/src/main/scala/com/helio/services/AuthoringError.scala:64-65`) is
    the SAME wrapper `loadForContinuation` already uses for a missing/foreign-owned id — so D3a's claim
    that a cross-flow rejection can reuse "the same 'not found' shape an owner mismatch already gets" is
    not asserted, it's grounded in a real, already-existing code path (not a new error shape the
    implementer has to invent).
  - **Symmetry check (both directions).** Design.md D3a states the check applies to both services
    (`RefinementService: latestPatchSet.isDefined`; `DashboardAuthoringService`, symmetrically
    generalized: `latestProposal.isDefined`), task 1.6 says "Generalize `loadForContinuation` (both
    flows)," and the new spec scenario in `specs/authoring-conversation-state/spec.md` covers both
    directions explicitly in one WHEN clause ("`POST /api/refinements` is called with a conversationId...
    [belonging to] an authoring conversation... — or, symmetrically, `POST /api/authoring/dashboard` is
    called with a refinement conversation's id"). The design/spec are genuinely symmetric.
  - **Turn-1 check (does the guard risk rejecting a legitimate first continuation before either column is
    populated?).** Traced `AuthoringConversationTurns.persistNew` (`backend/src/main/scala/com/helio/services/AuthoringConversationTurns.scala:28-49`):
    a conversation row is created ONLY via `persistNew`/`repo.create`, which unconditionally sets
    `latestProposal = Some(proposal)` — confirmed by the existing V77 migration comment ("A row is only
    ever created once a turn SUCCEEDS... `latest_proposal` is nullable but always populated in practice by
    the time a row exists"). Critically, **turn 1 never goes through `loadForContinuation` at all** —
    `DashboardAuthoringService.author`/`authorStreaming` dispatch on `request.conversationId`: `None` →
    `startBuffered`/`startStreaming` (which calls `persistNew`, no `loadForContinuation` involved); only
    `Some(rawId)` → `continueBuffered`/`continueStreaming`, which is the only path that calls
    `loadForContinuation`. A caller can only ever HAVE a `conversationId` to pass in the first place once a
    row already exists with its own column populated (that's precisely what turn 1's response returns). So
    the D3a guard cannot reject a legitimate continuation of an already-successful conversation — there is
    no "both columns still empty, but this is a real continuation" state reachable through the public API.
    This is the specific "miss a case" risk the orchestrator asked me to check for, and I found no such
    case.
  - Confirmed `PatchSetPreviewService.preview` at `backend/src/main/scala/com/helio/services/PatchSetPreviewService.scala:47`,
    `WorkspaceContextService.assemble` at `WorkspaceContextService.scala:144-147`,
    `PanelCapabilityService.getCapabilities` at `PanelCapabilityService.scala:31`, and
    `PipelineService.findSummaryById`/`.listSteps` at `PipelineService.scala:127`/`421` (both
    `Some(user)`-gated) still match D1/D2/D5's citations unchanged from round 2. `ApiRoutes.scala:276-277`'s
    `dashboardAuthoringServiceOpt` gate is unchanged and still matches D5/task 2.7's claim.
  - Confirmed `PatchSetProtocol.editFormat` (`PatchSetProtocol.scala:66-86+`, dispatch onto a shared
    `"patch"` wire key) and `UpdatePanelRequest.config`/`appearance` as raw `Option[JsValue]`
    (`PanelProtocol.scala:69-73`) — D2a's underlying technical claims are unchanged and still accurate.

- **One real, narrow gap found on the fresh independent pass — test-task asymmetry, not a design defect.**
  `tasks.md` 5.1 ("`RefinementServiceSpec`... an authoring `conversationId` passed to refinement
  continuation is rejected (not silently reassigned)") only enumerates a test for ONE of the two directions
  D3a/the spec scenario require. No task item anywhere in `tasks.md` (grepped for
  `DashboardAuthoringServiceSpec`, `symmetric`, `other flow`, `OTHER flow` — only task 1.6 itself matches,
  and only in its implementation-level "both flows" phrasing) requires adding the mirror-image regression
  test — "a refinement `conversationId` passed to authoring continuation is rejected" — to
  `backend/src/test/scala/com/helio/services/DashboardAuthoringServiceSpec.scala`, which is the natural
  home for it: that file already has the exact analogous existing test this new one should sit beside
  ("a conversationId owned by a different user is rejected as NotFound, never continued",
  `DashboardAuthoringServiceSpec.scala:641-654`). The underlying *behavior* is not at risk — D3a's decision
  text and task 1.6 both explicitly require the check on both services, so a competent implementer
  following the tasks as written would very plausibly add the check to both `loadForContinuation`
  implementations regardless — but the *verification* task list, as written, would let `sbt test` go green
  without a regression test proving the authoring-side direction of this cross-flow guard actually works,
  which is exactly the class of thing CONTRIBUTING/the Iron Laws' verification-before-completion doctrine
  cares about catching before it ships unverified.

### Verdict: CONFIRM

All 3 round-2 fixes are genuinely present and accurate against real source. D3a — this round's specifically
flagged area of concern — was traced end-to-end against the real `loadForContinuation`/`appendTurn`/
`persistNew`/`AuthoringError` code paths and found to be soundly grounded, correctly symmetric in its
stated design, and correctly non-disruptive to a conversation's legitimate first continuation (no reachable
state where the guard would wrongly reject a real caller). The one gap I found — asymmetric test-task
enumeration in tasks.md 5.1 — is a small, mechanical completeness gap in the verification checklist, not a
soundness issue in the design or a case D3a's mechanism actually misses; it doesn't rise to blocking
severity and does not warrant spending another design round or the human's attention. Fresh re-pass over
every other decision in design.md (D1/D2/D4/D5/D6/D7, Risks, Planner Notes) against real source turned up
no new issues beyond this one.

### Non-blocking notes

1. **Add the mirror-image regression test.** Under tasks.md's Tests section (either as an addition to 5.1
   or a new item), require: `DashboardAuthoringServiceSpec` gets a test asserting "a refinement
   `conversationId` passed to `POST /api/authoring/dashboard` continuation is rejected the same way a
   missing/foreign-owned conversationId is (not silently reassigned)" — mirroring the existing "owned by a
   different user" test at `DashboardAuthoringServiceSpec.scala:641-654`. This is a one-line tasks.md
   addition, not a design change; safe to have the executor pick it up directly during task 5.1/1.6's
   implementation rather than spending another design-gate round on it.
2. All non-blocking notes from round 1 and round 2 (the `AuthoringErrorKind.InvalidProposal` wire-name
   reuse for rejected `PatchSet`s; the GET hydration route staying gated on
   `Option[DashboardAuthoringService]`; the CONTRIBUTING line-count framing in D3) remain accurate and
   still non-blocking — no new information changes that assessment.

### Environment note

This worktree's `scripts/concertino/` is still missing `next-report-number.sh`/`persist-evidence.sh`/
`emit-event.sh` (same gap round 2 flagged — present only in the main `helio` checkout). Used the main
checkout's copies against this worktree's change directory again, as round 2 did.
