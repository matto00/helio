## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all 3 spec deltas
  (`specs/{assistant-conversation-loop,combined-proposal-apply,pipeline-proposal-apply}/spec.md`),
  and `skeptic-design-1.md` (round 1, treated as a claim to re-verify, not fact).
- `openspec validate assistant-service-wiring --strict` → `Change 'assistant-service-wiring' is valid`.
- Re-read the real source for every service/type the revised plan claims about:
  `ProposalPanelSupport.scala`, `PanelCapabilityService.scala`, `DashboardProposalService.scala`,
  `CombinedProposalService.scala`, `PipelineProposalService.scala`,
  `WorkspaceResourceSearchProtocol.scala` (`WorkspaceResourceDetail` + its JSON formatter),
  `WorkspaceContextProtocol.scala` (`WorkspaceContextDataType`), `PanelCapabilityProtocol.scala`
  (`PanelCapabilitiesResponse`/`PanelCapabilityColumnResponse`), `WorkspaceSearchService.scala`,
  `ClaudeClient.scala` (`sendWithTools`'s `Future.traverse` same-hop concurrency), `CombinedProposal`/
  `DashboardProposal` protocol case classes.
- Confirmed each of the 5 round-1 change requests against this ground truth (not the executor's
  changelog prose) — see below. 3 of 5 have a **residual gap**; 2 are cleanly closed.

### Fix-by-fix verification

**CR3 (persistence-gap framing) — CLOSED.** design.md's Context now names `authoring_conversations`
(V77/V78) explicitly and states why HEL-663's GCS-backed shape is preferred over a third extension
(design.md lines 12-19). Accurate and sufficient.

**CR4 (same-hop `propose_*` race) — CLOSED.** Re-confirmed `ClaudeClient.sendWithTools`'s `loop`
really does execute every `tool_use` block in one hop via `Future.traverse(toolUses)(executeTool(...))`
(`ClaudeClient.scala:107-112`) — genuinely concurrent. design.md's "Same-hop concurrency" section
(lines 122-132) now documents this honestly: primary mitigation via system-prompt instruction (task
3.3), explicit fallback behavior ("some one of the successful calls' proposals wins,
non-deterministically"), and test 6.12 asserts *some* proposal is captured. Given every `propose_*`
path is validate/preview-only (never `apply`), this race cannot cause a double-mutation or partial-
apply — it only affects which of two *equally non-mutating, equally human-reviewed* proposals is
surfaced. Acceptable given the Hard Boundary is about apply, not about proposal selection.

**CR1 (`CombinedProposalService.validate` dashboard-portion structural checks) — PARTIALLY CLOSED, one
gap remains.** design.md D3 (lines 71-82) and tasks.md 1.3 now correctly add a per-panel
`ProposalPanelSupport.validatePanel` call — confirmed `validatePanel` is a public `def` on the
`ProposalPanelSupport` object (`ProposalPanelSupport.scala:30`, no `private` modifier) with the exact
signature `(where: String, panel: ProposalPanel): Either[String, Unit]` the design assumes, and
confirmed `DashboardProposalService.validateStructure` already calls it this exact way per-panel
(`DashboardProposalService.scala:76-83`) — a real, buildable precedent to mirror.

But `DashboardProposalService.validateStructure` (the method D3 claims `CombinedProposalService.validate`
now reaches full parity with) is **two checks, not one**:
```
private def validateStructure(proposal: DashboardProposal): Either[String, Unit] =
  if (proposal.dashboardName.trim.isEmpty) Left("dashboardName is required")
  else proposal.panels.zipWithIndex.foldLeft(...) { ProposalPanelSupport.validatePanel(...) }
```
(`DashboardProposalService.scala:76-83`). The revised D3/task 1.3 only adds the second check (per-panel
`validatePanel`) — the first (`dashboardName.trim.isEmpty`) is never mentioned anywhere in design.md,
tasks.md, or the `combined-proposal-apply` spec delta, and `CombinedProposal.dashboard: DashboardProposal`
(`CombinedProposalProtocol.scala:19`) genuinely carries a `dashboardName: String` field that a
`propose_combined` caller could send blank. design.md's own text (lines 79-82) states: "Only the
DB-backed binding check is deferred — every pure structural check `propose_dashboard` would have
caught... is caught here too" — this claim is **not accurate as scoped**: a blank `dashboardName` is a
pure structural check `propose_dashboard`/`DashboardProposalService.validate` would catch (first line
of `validateStructure`) that `CombinedProposalService.validate` as designed still would not. This is
the same category of gap round 1's CR1 flagged (a partial, not full, mirror of
`DashboardProposalService`'s pure structural checks) — narrower now, but not fully closed. Test 6.2
doesn't cover it either (it only exercises "a blank title, or a chart/aggregation conflict" — panel-
level, not the dashboard-name-level check).

**CR2 (AC1 panel-capability parity) — architecture is right, but the merge mechanism has an
unaddressed collision bug.** D3a (lines 84-97) correctly identifies `get_resource`'s `DataType` branch
as the delivery point and correctly cites `panelCapabilityService.getCapabilities(dataTypeId, user):
Future[Either[ServiceError, PanelCapabilitiesResponse]]` — confirmed this signature is real
(`PanelCapabilityService.scala:31`) and is the exact service `DashboardAuthoringService` already
depends on.

However, D3a/task 4.2a describe the delivery mechanism as merging `PanelCapabilitiesResponse`
"**into** the JSON tool_result payload **alongside** the existing `WorkspaceResourceDetail`" — language
consistent with a flat field union (`JsObject(detailJson.fields ++ capsJson.fields)`), and the spec
delta uses the same "alongside the existing DataType detail" phrasing. I traced both wire shapes:
- `WorkspaceResourceDetail.DataTypeDetail`'s JSON write flattens `WorkspaceContextDataType`'s fields
  (including a top-level **`columns: Vector[WorkspaceContextColumn]`**, each `{name, dataType,
  nullable, semanticRole}`) plus `resourceType`
  (`WorkspaceResourceSearchProtocol.scala:66-75`, `WorkspaceContextProtocol.scala:96-107`).
- `PanelCapabilitiesResponse`'s JSON also has a top-level **`columns: Vector[PanelCapabilityColumnResponse]`**,
  each `{name, dataType, nullable}` (no `semanticRole`) (`PanelCapabilityProtocol.scala:55-62,69-74`).

Both wire shapes use the literal key `"columns"` for materially different content. A flat field-union
merge — which is what the design's own wording ("merge ... alongside") most naturally describes, and
what a competent implementer following it literally would write — silently drops one `columns` array
in favor of the other (Scala `Map ++` semantics: the right-hand operand wins). Neither design.md,
tasks.md, nor the spec delta names this collision or specifies which side should win, or that the two
should instead be **nested** under distinct keys (e.g. `{"detail": {...}, "panelCapabilities": {...}}`)
to avoid it. This is exactly the class of implementation-blocking ambiguity a design gate exists to
close — a competent implementer could genuinely read "merge ... alongside" two ways, and the naive
reading silently loses data (either the DataType's own `semanticRole`-bearing columns, undermining
`get_resource`'s pre-existing grounding value, or `PanelCapabilitiesResponse`'s columns, though the
latter is less costly since `capabilities[kind].eligibleColumns` still carries the per-slot column
list). Task 6.11's description ("includes the merged `PanelCapabilitiesResponse` ... alongside the
existing `WorkspaceResourceDetail` fields") doesn't specify checking that both sets of `columns` survive
intact, so this could ship with the collision silently un-caught by its own designated test.

**CR5 (`converse` signature consistency) — PARTIALLY CLOSED, one artifact still stale.** design.md D1
(line 46), tasks.md 5.2, and the `assistant-conversation-loop` spec (`spec.md:4`) all now consistently
show the 3-arg `converse(history: Seq[ClaudeToolMessage], message: String, user: AuthenticatedUser)`.
But `proposal.md`'s "What Changes" section (line 13) still reads: `Add AssistantService.converse(history,
message):` — the stale 2-arg form the round-1 finding flagged, left unfixed in this one artifact.
Minor on its own, but it's the exact artifact-consistency gap CR5 asked to close, and it wasn't fully
closed.

### Buildability re-checks

- `ProposalPanelSupport.validatePanel` — confirmed public, pure, in-memory; confirmed
  `CombinedProposal.dashboard.panels: Vector[ProposalPanel]` (via `DashboardProposal`) is the correct
  type to iterate, matching `DashboardProposalService.validateStructure`'s own iteration shape exactly.
- `CombinedProposalService`'s companion-private `validateOutputRefPositions` being callable from the
  instance-level `validate` method (as `apply` already does today at `CombinedProposalService.scala:47`)
  is proven buildable by the exact same call already compiling in `apply` today.
- `openspec validate assistant-service-wiring --strict` passes cleanly (re-run this round, same result
  as round 1).
- No new artifact-internal contradictions found beyond the ones above.

### Verdict: REFUTE

### Change Requests

1. **`CombinedProposalService.validate` (design.md D3, tasks.md 1.3, `combined-proposal-apply` spec)
   must also check `dashboard.dashboardName.trim.isEmpty`**, not just per-panel `validatePanel`.
   `DashboardProposalService.validateStructure` (`DashboardProposalService.scala:76-83`) is two checks;
   the current fix only restores one of them. Either add the blank-dashboardName check explicitly (a
   one-line addition mirroring `DashboardProposalService`'s own), or narrow design.md's claim ("every
   pure structural check `propose_dashboard` would have caught... is caught here too") to accurately
   scope what's actually covered. Add a scenario/test alongside 6.2 for a blank `dashboardName`.
2. **Specify the exact `get_resource` DataType-capability merge shape (design.md D3a, tasks.md 4.2a,
   `assistant-conversation-loop` spec) to avoid the `columns` key collision** between
   `WorkspaceContextDataType`'s wire shape and `PanelCapabilitiesResponse`'s wire shape — both use the
   literal key `"columns"` for different content (`WorkspaceContextColumn` with `semanticRole` vs.
   `PanelCapabilityColumnResponse` without). State explicitly that the two payloads are nested under
   distinct top-level keys (not flat-field-unioned), and update task 6.11's test description to assert
   both `columns` sets are present/intact in the merged payload, not just that "the merged
   `PanelCapabilitiesResponse`" is present.
3. **Update `proposal.md`'s "What Changes" bullet (line 13) to the corrected 3-arg
   `converse(history, message, user)` signature**, matching design.md/tasks.md/spec.md — the stale
   2-arg form round 1's CR5 flagged is still present in this one artifact.

### Non-blocking notes

- Round 1's CR3 and CR4 are cleanly closed with accurate, verifiable language — no further action
  needed on either.
- The D3a architectural approach itself (deliver capability grounding via `get_resource`'s tool_result
  rather than the static system prompt) is sound and correctly scoped; only the merge mechanics need
  tightening (CR2 above).
