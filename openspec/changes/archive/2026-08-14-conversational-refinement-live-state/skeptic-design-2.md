## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, the full current `design.md`, `tasks.md`, all four spec deltas
  (`specs/{authoring-conversation-state,conversational-refinement,mcp-patch-set-tools,refinement-chat-surface}/spec.md`),
  and round 1's `skeptic-design-1.md` fresh from this worktree — treating the round-1 report and the
  prompt's "4 fixes" summary as claims to re-verify, not facts.
- Independently re-verified each of the 4 claimed round-1 fixes against real source:
  1. **CHECK constraint.** Confirmed `V77__authoring_conversations.sql` has no `latest_patch_set`
     column/CHECK yet (pre-change baseline), no `V78` file exists yet, and design.md D3 / tasks.md 1.1
     / `specs/authoring-conversation-state/spec.md`'s new "never populate both columns" requirement now
     all specify `CHECK (latest_proposal IS NULL OR latest_patch_set IS NULL)`. Confirmed the codebase's
     precedent shape via `V23__pipeline_steps.sql:5` (`CHECK (op IN (...))`), `V62__pipeline_schedules.sql:26`
     (`CHECK (kind IN (...))`), `V73__add_resource_tag.sql:17-19` (`CHECK (length(tag) <= 200)`). **Fixed,
     accurate.**
  2. **D1's grounding collaborators.** Confirmed `DashboardRepository.findById(id: DashboardId, callerOpt:
     Option[AuthenticatedUser])` (`DashboardRepository.scala:65`) is real and matches D1's citation
     exactly, and that it's the same collaborator `PatchSetApplyResolvers.resolveDashboardUpdate`
     (`PatchSetApplyResolvers.scala:373`, `ctx.dashboardRepo.findById(dashboardId, Some(user))`) and
     `AutoLayoutService.applyAutoLayout` (`AutoLayoutService.scala:108`, own doc comment: "sharing-aware
     existence/ACL check") already use. Confirmed the "viewer-sufficient" access-tier statement is new and
     present. **However**, found the `PanelRepository.findAllByDashboardId` call cited in D1 and tasks.md
     2.2 has the wrong argument order/type — see Change Request 2 below.
  3. **Workspace/capability grounding.** Confirmed `specs/conversational-refinement/spec.md` now has an
     ADDED "Grounding SHALL include workspace context and panel capabilities..." requirement (AC5), and
     tasks.md 2.2 explicitly names `WorkspaceContextService.assemble` + `PanelCapabilityService.getCapabilities`
     as task-2.2-owned. Confirmed both signatures for real:
     `WorkspaceContextService.assemble(user: AuthenticatedUser, budgetBytes: Int = ...): Future[WorkspaceContextResponse]`
     (`WorkspaceContextService.scala:144-147`) and
     `PanelCapabilityService.getCapabilities(id: DataTypeId, user: AuthenticatedUser): Future[Either[ServiceError, PanelCapabilitiesResponse]]`
     (`PanelCapabilityService.scala:29`). Confirmed `DashboardAuthoringService.assembleGroundedContext`
     (`DashboardAuthoringService.scala:232-249`) really does call exactly these two methods (`workspaceContextService.assemble(user, budgetBytes)`
     then `panelCapabilityService.getCapabilities(DataTypeId(dataTypeId), user)` per pipeline-output DataType), substantiating D1's "the same two calls...already makes" claim. **Fixed, accurate.**
  4. **D2a prompting strategy.** Confirmed `DashboardAuthoringPrompt.ProposalShapeDescription`
     (`DashboardAuthoringPrompt.scala:19-41`) is exactly as characterized — one hand-maintained worked
     JSON example (not per-`target.kind`, since `DashboardProposal` has one flat shape). Confirmed
     `PatchSetProtocol.editFormat` (`PatchSetProtocol.scala:66-144`) really is a discriminated union
     dispatched by `target.kind` into one of six `Update*Request`/`createPatch` fields collapsed onto a
     shared `"patch"` wire key, and `UpdatePanelRequest.config`/`appearance`
     (`PanelProtocol.scala:70-75`) really are raw `Option[JsValue]`. D2a's decision to require a
     hand-maintained, per-`target.kind` worked-example shape description is a real, substantive addition
     over round 1's vague "mirrors DashboardAuthoringPrompt" language. **Directionally fixed, but see
     Change Request 1 below — the panel-kind sub-scope inside this same decision is incomplete.**
- Independent fresh pass over the rest of the design (not just the 4 named fixes):
  - Confirmed `PatchSetPreviewService.preview(patchSet: PatchSet, user: AuthenticatedUser)`
    (`PatchSetPreviewService.scala:47`) and `PipelineService.findSummaryById`/`.listSteps`
    (`PipelineService.scala:127`, `:421`, both `Some(user)`-gated via `findSummaryByIdShared`/`findByIdShared`) match D1/D2/D5's citations.
  - Confirmed `POST /api/patch-sets/apply` and `POST /api/patch-sets/preview` (`PatchSetRoutes.scala:37-50`),
    `HelioApi.updatePanel` (`helio-mcp/src/helioApi.ts:653`, HEL-627 precedent), and the `apply_proposal`/`propose_dashboard`
    naming + description conventions (`helio-mcp/src/tools/proposal.ts`) match D7/mcp-patch-set-tools spec.
  - Confirmed `App.tsx` lives at `frontend/src/app/App.tsx` and tracks `selectedDashboardId`
    (used at lines 89/98/152/256-294+), `AuthoringChatDrawer` is mounted in `DashboardList.tsx:374`, and
    `PatchSetReviewPage.tsx` really reads `location.state as { patchSet?: PatchSet }` — all matching D6.
  - Confirmed `AuthoringConversationRepository.create`/`appendTurn`/`findDisplayById`
    (`AuthoringConversationRepository.scala:54-99`) and `GET /api/authoring/conversations/:id`
    (`DashboardAuthoringRoutes.scala:92-95` → `DashboardAuthoringService.getConversation` →
    `conversationRepo.findDisplayById`) match D3/D4's claims about what needs generalizing.
  - Confirmed `ApiRoutes.scala:276-277`'s `dashboardAuthoringServiceOpt` gate
    (`ClaudeConfig.fromEnv()` + `authoringConversationRepoOpt`) matches D5/task 2.7's "same gate" claim.
  - Found two additional, real problems the revision introduces/leaves in place — detailed below.

### Verdict: REFUTE

All 4 round-1 fixes are genuinely present and, for 3 of the 4, accurate against real source. Fix 2 (D1/
task 2.2) has a minor citation defect. Fix 4 (D2a/task 2.3) — the decision explicitly billed as "the
ticket's central technical bet" — has a real scope gap in the very sub-clause it added. A fresh
independent pass also surfaced a real, unaddressed cross-flow data-integrity gap in D3's generalized
persistence path. None of these are as severe as round 1's findings, but they are concrete, source-grounded,
and actionable, so this round cannot CONFIRM yet.

### Change Requests

1. **D2a / task 2.3's "panel `config` example per rendered panel kind (chart/table/metric)" undercounts
   the real set of data-bindable panel kinds by 2 of 5, and is internally inconsistent with what the
   design's own grounding will actually put in front of the model.** `PanelBindingSpec.DataBindable`
   (`backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala:104`) is
   `Vector(Metric, Chart, Table, Collection, Timeline)` — five kinds, not three. `PanelCapabilityService.getCapabilities`
   (called once per pipeline-output DataType by the very grounding step D1/task 2.2 now correctly assigns
   to task 2.2) unconditionally computes a capability entry for **all five** `DataBindable` kinds
   (`PanelCapabilityService.scala:41-44`, `PanelBindingSpec.DataBindable.map { spec => ... }`) — so
   Collection and Timeline capability info genuinely will appear in "the grounding" whenever a pipeline-output
   DataType supports them, exactly as much as chart/table/metric. Both are first-class, non-trivial panel
   kinds with their own dedicated frontend editors (`frontend/src/features/panels/ui/editors/CollectionEditor.tsx`,
   `TimelineEditor.tsx`) and their own distinct `config` shape branches in `schemas/create-panel-request.schema.json:59-70`
   (separate `if`/`then` blocks for `"collection"` and `"timeline"`, each with a materially different shape
   from chart/table/metric's). D2a's own stated rationale for requiring worked examples at all —
   "`UpdatePanelRequest.config`... [is] raw `JsValue` whose real shape depends on the panel's *stored*
   kind... Claude must also produce a validly-shaped nested chart/table/metric config" — applies with
   equal force to a Collection or Timeline panel edit; there is no reason given why those two are exempt,
   and none is apparent from the source. As written, an implementer following task 2.3 literally would
   ship a `RefinementPrompt` that advertises Collection/Timeline as bindable (via the capability menu) but
   gives Claude zero worked JSON example for either's `config` — the exact "unstated implementation
   detail for what is actually the ticket's central technical bet" class of gap round 1's CR4 was raised
   to close, just now narrower. **Required fix:** widen D2a's/task 2.3's panel-kind scope to all five
   `PanelBindingSpec.DataBindable` kinds (metric/chart/table/collection/timeline), or — if a deliberate v1
   scope cut to 3 kinds is actually intended — state that explicitly as a Non-Goal with the same kind of
   concrete justification the design already gives for its other two scope cuts (buffered-only,
   dashboard-only trigger), rather than leaving it as an unexplained narrower parenthetical inside a "MUST"
   sentence.

2. **D3's generalized conversation-continuation path has no guard against a caller continuing the wrong
   flow's `conversationId`, and the current `appendTurn` precedent suggests this would silently corrupt
   data rather than cleanly reject.** `specs/authoring-conversation-state/spec.md`'s MODIFIED "second turn"
   scenario is carefully scoped to "a `conversationId` from a prior successful call on **that SAME
   endpoint**" — implying the spec author is aware cross-endpoint reuse is a distinct case — but no
   requirement/scenario defines what happens when it isn't the same endpoint (contrast with the adjacent
   "A conversationId owned by another user is rejected" scenario, which *does* cover its analogous edge
   case explicitly). Neither design.md nor tasks.md mentions a flow check anywhere (grepped design.md for
   `loadForContinuation`/`latestPatchSet`/`latestProposal`/`flow` — the only hits are D4's unrelated
   read-route generalization and a Risks-section mention of `preview`'s trust boundary). Today's
   `DashboardAuthoringService.loadForContinuation` (`DashboardAuthoringService.scala:212+`) only checks
   existence/ownership via `AuthoringConversationRepository.findById`, never which flow the record belongs
   to — safe today because only one flow exists. Once generalized, if `RefinementService`'s continuation
   path reuses this same load-by-id-and-owner pattern with no additional check, a caller who passes an
   *authoring* `conversationId` to `POST /api/refinements` would load successfully (found, owned) and then
   — per the existing `appendTurn`/`persistContinuation` precedent, which does an **unconditional column
   overwrite** (`AuthoringConversationRepository.scala:92-96`: `.update((apiHistory, displayTurns,
   Some(latestProposal), totalTokensUsed, updatedAt))`, not a coalesce) — a generalized
   `RefinementConversationTurns.persistContinuation` would write `latest_proposal = NULL` /
   `latest_patch_set = Some(newPatchSet)` on that row. This satisfies the new CHECK constraint (only one
   populated) but **silently reassigns an authoring conversation into a refinement conversation, destroying
   its prior `latest_proposal`** — never rejected, never even logged as anomalous, and in direct tension
   with the spec's own new "An authoring conversation never has a patch set... after every turn, including
   turn 1" scenario (a conversation that *was* authoring-only now isn't, via a path outside the "first
   turn" the scenario describes). **Required fix:** add an explicit design decision (and a corresponding
   spec requirement/scenario, and a tasks.md item — e.g. under 2.5's `RefinementService` bullet and 5.1's
   `RefinementServiceSpec`) that the continuation-load path for each flow rejects (same "not found" shape
   as an owner mismatch) a `conversationId` whose loaded record belongs to the *other* flow (i.e.
   `RefinementService` requires `latestPatchSet.isDefined` — or the turn-1 case — before continuing;
   `DashboardAuthoringService` symmetrically requires `latestProposal.isDefined`), rather than relying on
   the CHECK constraint (which this exact path wouldn't even trip) or an unconditional-overwrite as the de
   facto behavior.

3. **(Minor) D1's and task 2.2's citation of `PanelRepository.findAllByDashboardId(id, Page(0,
   Page.MaxLimit), user)` has the wrong argument order and type.** The real signature is
   `findAllByDashboardId(dashboardId: DashboardId, callerOpt: Option[AuthenticatedUser], page: Page)`
   (`PanelRepository.scala:43-47`) — `callerOpt` (an `Option`) comes second, `page` third. Both real
   call sites pass it that way: `AutoLayoutService.scala:66`
   (`panelRepo.findAllByDashboardId(dashboardId, Some(user), Page(offset = 0, limit = Page.MaxLimit))`)
   and `PatchSetPreviewImpact.scala:71` (`ctx.panelRepo.findAllByDashboardId(id, Some(user), Page(0, 1))`).
   Design.md D1 and tasks.md 2.2 both write it as `(id, Page(0, Page.MaxLimit), user)` — page and
   caller swapped, and `user` given as a bare value rather than `Some(user)`. Low severity on its own (a
   Scala compiler would reject the wrong shape immediately, and the substantive point — reuse this method
   with the `AutoLayoutService` "get effectively all panels" `Page` precedent — is correct) but still a
   factual inaccuracy in a load-bearing design citation; fix the argument order/type in both places while
   addressing CR1/CR2.

### Non-blocking notes

- D5's reuse of `AuthoringErrorKind.InvalidProposal`'s wire string for a rejected `PatchSet` is unchanged
  from round 1's non-blocking note (still fine, still worth a one-line implementation comment, not
  worth a new kind).
- The GET `/api/authoring/conversations/:id` route staying inside `DashboardAuthoringRoutes`/gated on
  `Option[DashboardAuthoringService]` (D4) is unchanged from round 1 — still a naming/ownership nit, not
  blocking, and orthogonal to CR2 above (CR2 is about the *write*-continuation path, not this read route).
- D3's "keeps both turn-glue classes under CONTRIBUTING's ~250-line soft budget" framing slightly overstates
  the case — `AuthoringConversationTurns.scala` is only 73 lines today (`wc -l`), comfortably under budget
  even before considering a split — but the underlying single-responsibility rationale (sibling files per
  flow, matching the `AuthoringConversationTurns`/`RefinementConversationTurns` split named elsewhere in
  D3) stands on its own regardless of the line-count justification's precision. Not worth blocking on.
- Everything else independently re-checked (grounding collaborators' access tiers, `PatchSetProtocol`'s
  discriminated-union shape, MCP tool/route wiring, frontend mount points, `ApiRoutes` gating) matches
  real source cleanly.

### Environment note

This worktree's `scripts/concertino/` is missing `next-report-number.sh`/`persist-evidence.sh`/
`emit-event.sh` (present only in the main `helio` checkout's `scripts/concertino/`, likely because this
worktree was set up before those scripts existed). `next-report-number.sh` is a pure path-argument utility
with no branch-specific state, so I invoked the main checkout's copy against this worktree's change
directory to get a collision-safe filename; I'll do the same for `persist-evidence.sh` next. Flagging this
gap for the orchestrator in case other automation in this worktree depends on these scripts being present
locally.
