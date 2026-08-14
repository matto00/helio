## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all four spec deltas
  (`specs/{authoring-conversation-state,conversational-refinement,mcp-patch-set-tools,refinement-chat-surface}/spec.md`)
  from this worktree.
- Read the real current source for every collaborator design.md names as a reuse target:
  `DashboardAuthoringService.scala`, `DashboardAuthoringParsing.scala`, `DashboardAuthoringPrompt.scala`,
  `AuthoringConversationTurns.scala`, `AuthoringConversationRepository.scala`, `AuthoringConversationProtocol.scala`,
  `V77__authoring_conversations.sql`, `PatchSetPreviewService.scala`, `PatchSetApplyResolvers.scala`,
  `PatchSetApplyTypes.scala`, `PatchSetProtocol.scala`, `PanelProtocol.scala` (`UpdatePanelRequest`),
  `DashboardAuthoringRoutes.scala`, `DashboardService.scala`, `DashboardRepository.scala`, `AutoLayoutService.scala`,
  `PanelRepository.scala` (`findAllByDashboardId`), `PipelineService.scala` (`findSummaryById`/`listSteps`),
  `pagination.scala` (`Page`), `PatchSetRoutes.scala`, `ApiRoutes.scala` (existing `dashboardAuthoringServiceOpt`/
  `patchSetPreviewService` wiring), `AuthoringError.scala`, `AuthoringChatDrawer.tsx`, `DashboardList.tsx`,
  `PatchSetReviewPage.tsx`, `App.tsx`, `helio-mcp/src/tools/proposal.ts`, `helio-mcp/src/helioApi.ts`.
- Read the archived HEL-403 `design.md` (`openspec/changes/archive/2026-08-14-patch-set-schema-protocol/design.md`)
  to establish that `PatchSet`'s wire shape was designed purely as an apply-path contract, never previously
  exercised by an LLM.
- Confirmed `PatchSetPreviewService.preview`/`PatchSetApplyResolvers.resolveAll` do real target-existence,
  ACL, and cross-reference content validation (panel binding refs, metric refs, embedded step config refs,
  create-patch shape decode) — substantiating that D2's "reuse preview as validation" is structurally sound,
  provided a preceding parse step (mirroring `DashboardAuthoringParsing`, planned as task 2.4) absorbs
  parse-level (non-JSON / malformed) failures the same way `DashboardAuthoringService.parseAndValidate`
  already does for `DashboardProposal`.
- Grepped `backend/src/main/resources/db/migration/*.sql` for `CHECK` — confirmed the codebase has an
  established, heavily-used convention of DB-level `CHECK` constraints for exactly this class of invariant
  (status/kind enums: V22/V23/V24/V28/V60/V61/V62/V63/V65-V72; length checks: V73), which design.md's D3
  does not follow for the new mutual-exclusivity invariant.

### Verdict: REFUTE

### Change Requests

1. **D3's mutual-exclusivity invariant needs a real DB `CHECK` constraint, not just "only one class writes
   to it" + a unit test.** Design.md D3 / spec.md's new "never populate both columns" requirement rely
   entirely on application-level discipline (`RefinementConversationTurns` vs. `AuthoringConversationTurns`
   each only ever populating its own column) plus a single regression test (tasks.md 5.2) as the sole guard
   against an inconsistent row. This is weaker than the codebase's own established pattern for this exact
   class of invariant — `backend/src/main/resources/db/migration/` has ~20 migrations adding `CHECK`
   constraints for enum/shape invariants (e.g. `V23__pipeline_steps.sql`'s `op` enum, `V62__pipeline_schedules.sql`'s
   `kind` enum, `V73__add_resource_tag.sql`'s length check). Given this is user-facing persisted data and a
   test only proves *today's* code paths behave (it can't stop a future bug, an ad hoc backfill script, or a
   manual `UPDATE` from producing a row with both columns populated), `V78__refinement_conversations.sql`
   should add `CHECK (latest_proposal IS NULL OR latest_patch_set IS NULL)` (or equivalent) alongside the new
   nullable column. Update tasks.md 1.1 to include it.

2. **D1 misnames the dashboard-record grounding collaborator — `DashboardService` has no such method.**
   Design.md D1 says: *"dashboard: `DashboardService` (the dashboard record) + `PanelRepository.findAllByDashboardId`..."*.
   But `backend/src/main/scala/com/helio/services/DashboardService.scala`'s entire public surface is
   `findAll`/`create`/`delete`/`duplicate`/`update`/`exportSnapshot`/`importSnapshot`/`validateSnapshotPayload`
   — there is no single-dashboard-by-id read. The actual sharing-aware, ACL-checked read is
   `DashboardRepository.findById(id, callerOpt)` (`backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala:65`),
   which is exactly the collaborator `PatchSetApplyResolvers.resolveDashboardUpdate` (`PatchSetApplyResolvers.scala:373`)
   and `AutoLayoutService` (own doc comment: *"`dashboardRepo.findById` for the sharing-aware existence/ACL
   check"*) already use for this identical need. Fix D1 to name `DashboardRepository.findById`, and — since
   this is load-bearing for the spec's "A missing or inaccessible target SHALL be rejected... before any
   Claude call" requirement — explicitly state what access tier grounding requires (viewer-sufficient, since
   the endpoint never writes and `apply` re-checks editor access at write time; or editor-required, to avoid
   proposing edits a caller could never apply). Right now this is undefined. (Minor, same finding: also state
   the `Page` argument `findAllByDashboardId` needs — `AutoLayoutService.applyAutoLayout` and
   `PatchSetPreviewImpact` both pass an explicit `Page`, e.g. `Page(0, Page.MaxLimit)` per `AutoLayoutService`'s
   own "get effectively all panels" precedent; D1's phrasing implies a bare "get all panels" call that doesn't
   exist.)

3. **AC5 ("Grounding uses HEL-345 context + HEL-365 capabilities") is not covered by any spec requirement,
   and tasks.md doesn't clearly own it.** `specs/conversational-refinement/spec.md`'s four ADDED Requirements
   (live-state grounding, preview-validation, no-write, target ACL) never mention `WorkspaceContextService`
   (HEL-345) or `PanelCapabilityService` (HEL-365) at all — there is no scenario asserting refinement grounds
   in workspace-wide DataTypes or panel capabilities. tasks.md's task 2.2 ("New `RefinementGrounding`:
   dashboard target → `DashboardService` + `PanelRepository.findAllByDashboardId`; pipeline target →
   `PipelineService.findSummaryById` + `.listSteps`") also omits them entirely; task 2.3 ("New
   `RefinementPrompt`... mirrors `DashboardAuthoringPrompt`") is too vague to confirm this is in scope. This
   is a real, not cosmetic, gap: without workspace-wide type/capability grounding, Claude has no way to
   satisfy a refinement like "add a table of top customers" (a `create`-op edit binding to a DataType not
   yet used anywhere on the current dashboard) — it would only ever see the dashboard's *already-bound*
   types via its existing panels. D1's own prose claims this is included ("mirroring
   `DashboardAuthoringPrompt.userMessage`'s shape (workspace types + capabilities)") but neither the task
   breakdown nor the spec deltas commit to it as a testable requirement, so an implementation could satisfy
   every current spec scenario while silently dropping AC5. Add an explicit spec requirement/scenario for
   workspace-context + capability grounding, and make task 2.2/2.3's ownership of `WorkspaceContextService.assemble`/
   `PanelCapabilityService.getCapabilities` explicit.

4. **D2/D3 give no prompt-engineering strategy for the two extra layers of JSON-shape complexity a
   `PatchSet` requires versus `DashboardProposal` — the single hardest part of making AC1 actually work.**
   `PatchSet`'s `Edit.patch` (`PatchSetProtocol.editFormat`, `backend/src/main/scala/com/helio/api/protocols/PatchSetProtocol.scala:66-144`)
   is a discriminated union collapsed onto ONE shared `"patch"` wire key, dispatched by the sibling
   `target.kind` field into one of six `Update*Request` shapes — a materially different, harder-to-describe-
   unambiguously-in-prose shape than `DashboardProposal`'s flat, `jsonFormat2`-derived shape, which
   `DashboardAuthoringPrompt.ProposalShapeDescription` (`DashboardAuthoringPrompt.scala:19-41`) already
   hand-maintains in full as a worked JSON example specifically because the model needs it spelled out. On
   top of that, for a `panel` edit, `UpdatePanelRequest.config`/`appearance` are themselves raw
   `Option[JsValue]` (`PanelProtocol.scala:70-75`) — their real required shape is resolved only downstream by
   the panel's *stored* kind, so Claude must also produce a validly-shaped nested chart/table/metric config,
   not merely reference one. I confirmed via the archived HEL-403 design.md
   (`openspec/changes/archive/2026-08-14-patch-set-schema-protocol/design.md`) that `PatchSet` was designed
   purely as an apply-path/wire contract and has never been exercised by an LLM anywhere in this codebase —
   there is no existing precedent to lean on. Design.md D1/D3 and tasks.md 2.3 gloss over this ("assembles the
   grounding block + parse instructions... mirrors `DashboardAuthoringPrompt`") without calling for a
   hand-maintained shape description (the `Edit`/`Update*Request` analogue of `ProposalShapeDescription`) or
   worked per-`target.kind` JSON examples (including at least one panel `config` example) in the prompt. Add
   an explicit decision to design.md naming this as a real risk and describing the prompting strategy —
   otherwise this ships as an unstated implementation detail for what is actually the ticket's central
   technical bet.

### Non-blocking notes

- D5 reuses `AuthoringErrorKind.InvalidProposal`'s wire string verbatim for a rejected `PatchSet` (the kind
  is explicitly named `InvalidProposal`, `AuthoringError.scala:18`). Functionally fine (avoids kind
  explosion, as D5 argues), but the wire-visible name will say "Proposal" for a flow that never produces one
  — worth a one-line comment in the eventual `RefinementService`/`RefinementRoutes` explaining the reuse so a
  future reader isn't confused, but not worth a new kind.
- The GET `/api/authoring/conversations/:id` hydration route (D4) stays mounted inside `DashboardAuthoringRoutes`,
  gated on `Option[DashboardAuthoringService]` rather than `Option[RefinementService]`. Since both are derived
  from the same `ClaudeConfig.fromEnv()` gate (confirmed in `ApiRoutes.scala:276-277`), this doesn't create a
  real availability mismatch, just a slightly odd naming/ownership coupling — not worth blocking on.
- Scope cuts (buffered-only, no in-app pipeline-refinement trigger) are honestly justified with concrete,
  checkable reasoning (HEL-397's own streaming-retrofit precedent; no pipeline "live view" surface exists to
  anchor a drawer to) — no objection there.
