## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Fresh read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all 3 spec deltas
  (`specs/{assistant-conversation-loop,combined-proposal-apply,pipeline-proposal-apply}/spec.md`),
  and `skeptic-design-2.md` (round 2, treated as a claim to re-verify, not fact — not read until
  after I'd independently derived the same three gaps from ground truth).
- `openspec validate assistant-service-wiring --strict` → `Change 'assistant-service-wiring' is
  valid` (re-ran myself).
- `git status --short` in the worktree → only `openspec/changes/assistant-service-wiring/` is
  untracked; no code changed yet (correct for a design gate).

**Fix 1 — `CombinedProposalService.validate`'s dashboard-portion checks (round 2's CR1).** Re-read
`DashboardProposalService.validateStructure` directly
(`backend/src/main/scala/com/helio/services/DashboardProposalService.scala:76-83`):
```
private def validateStructure(proposal: DashboardProposal): Either[String, Unit] =
  if (proposal.dashboardName.trim.isEmpty) Left("dashboardName is required")
  else proposal.panels.zipWithIndex.foldLeft(...) { ProposalPanelSupport.validatePanel(...) }
```
— confirmed it is genuinely two checks: blank-name, then per-panel `validatePanel`. design.md D3
(lines 74-77) now names both explicitly (`combined.dashboard.dashboardName.trim.isEmpty` **and**
`ProposalPanelSupport.validatePanel`), tasks.md 1.3 mirrors this, and the `combined-proposal-apply`
spec delta gained a new "A blank dashboard name fails validation without creating anything" scenario
(lines 29-32) plus the requirement text now lists "checking the dashboard's own name is non-blank"
alongside the per-panel check. Test 6.2 was updated to add the blank-name case. Confirmed
`CombinedProposal.dashboard: DashboardProposal` really carries `dashboardName: String`
(`CombinedProposalProtocol.scala:19`, `DashboardProposalService.scala:77`), so this is a real,
reachable field, not a hypothetical. **Gap closed.**

**Fix 2 — `get_resource`'s panel-capability merge collision (round 2's CR2).** Re-read the real wire
shapes: `WorkspaceContextDataType.columns: Vector[WorkspaceContextColumn]` (`semanticRole`-bearing,
`WorkspaceContextProtocol.scala:96-107`) is flattened directly into `WorkspaceResourceDetail`'s
`DataTypeDetail` JSON by `workspaceResourceDetailFormat.write`
(`WorkspaceResourceSearchProtocol.scala:66-75`, `JsObject(inner.fields + ("resourceType" -> ...))`
— a flat object, `columns` at the top level). `PanelCapabilitiesResponse.columns:
Vector[PanelCapabilityColumnResponse]` (no `semanticRole`, `PanelCapabilityProtocol.scala:55-62`) is
also top-level `columns`. A flat field-union of the two would genuinely collide via Scala `Map ++`
right-wins semantics — the bug was real. design.md D3a (lines 88-107) now specifies the fix
explicitly as **nested, distinct** top-level keys — `{"detail": <WorkspaceResourceDetail JSON>,
"panelCapabilities": <PanelCapabilitiesResponse JSON>}` — never a flat union, and states the
collision reason by name. tasks.md 4.2a repeats the identical JSON shape verbatim ("DISTINCT NESTED
top-level key... never a flat field union"). The `assistant-conversation-loop` spec delta's new
"get_resource on a DataType includes panel-capability grounding" requirement (lines 45-57) states
"distinct nested key alongside (never flat-field-unioned with)" and its scenario asserts "both
payloads' own `columns` fields are present and intact" — consistent with design.md/tasks.md, though
(unlike the other two) it doesn't spell out the literal `"detail"`/`"panelCapabilities"` key names —
acceptable, since spec deltas describe behavior, not wire-level literals, and design.md/tasks.md
(which an implementer actually builds from) do carry the literal keys. Also confirmed
`panelCapabilityService.getCapabilities(id: DataTypeId, user: AuthenticatedUser):
Future[Either[ServiceError, PanelCapabilitiesResponse]]` is real and matches the design's call shape
(`PanelCapabilityService.scala:31`). Test 6.11 was updated to assert both `columns` sets survive
intact, not just that `panelCapabilities` is present. **Gap closed** — the nesting fix is technically
correct and eliminates the collision.

**Fix 3 — stale 2-arg `converse` signature in `proposal.md` (round 2's CR5).** `grep -rn
"converse(" .` across the whole change dir shows `proposal.md:13` now reads `Add
AssistantService.converse(history, message, user)`, matching design.md D1 (line 46: `converse(history:
Seq[ClaudeToolMessage], message: String, user: AuthenticatedUser): Future[AssistantTurnResult]`),
tasks.md 5.2, and the `assistant-conversation-loop` spec (`spec.md:4`) — all four now consistently
3-arg. `ticket.md:18` still shows the ticket's original literal `converse(conversationId, message)` —
this is the immutable source ticket text, not a design artifact, and design.md D1 explicitly names
and justifies the departure ("The ticket's literal text names `conversationId`, but no persistence
exists yet... Self-approved scope narrowing") both in the Decisions section and again in Planner
Notes. This is intentional, prominent, and was never the actual complaint (round 1/2's CR5 was about
inconsistency *among the design artifacts themselves*, specifically `proposal.md` lagging behind the
other three after they were fixed in round 1). **Gap closed.**

### Cross-checks against real code (not just internal artifact consistency)

To avoid rubber-stamping restated claims, I independently verified every concrete interface
design.md/tasks.md assumes actually exists with the claimed shape:
- `PipelineProposalService.validateStructure` is currently `private`
  (`PipelineProposalService.scala:69`) — task 1.1's widening to `private[services]` is a real,
  needed change; `dataSourceRepo.findByIdOwned` is a real method already used at line 166.
- `ProposalPanelSupport.validatePanel(where: String, panel: ProposalPanel): Either[String, Unit]` is
  public (`ProposalPanelSupport.scala:30`), exact signature design.md assumes.
- `CombinedProposalService`'s private `validateOutputRefPositions` (line 118) is called from within
  the same class, so `validate` (added to the same class) can reuse it without a visibility change —
  design.md's claim it's reusable as-is holds.
- `ClaudeClient.sendWithTools`, `ClaudeToolRequest`, `ClaudeToolMessage`/`.text(role, text)`,
  `ClaudeToolExecutor.execute(name, input)(implicit ec): Future[Either[String, String]]`,
  `ClaudeToolOutcome.{FinalResponse, HopBudgetExhausted, Failed}` — all confirmed real in
  `backend/src/main/scala/com/helio/ai/ClaudeModels.scala` / `ClaudeClient.scala`, exact shapes
  tasks.md 4.1/5.2 assume.
- `WorkspaceAssistantTools.{findTool, getResourceTool}`, `WorkspaceSearchService.{find,
  getResource}`, `PatchSetPreviewService.preview(patchSet, user)`, `WorkspaceResourceType.fromString`
  — all confirmed real with matching signatures.

No placeholders/TODO/TBD anywhere in the change dir (`grep -rniE "TODO|TBD|figure out later|
placeholder"` → no hits). No new internal contradictions found. All 4 ACs trace to a spec
requirement + scenario + task/test (AC1→scenario 1/task 6.3, AC2→scenario 2/task 6.4,
AC3→"No apply-shaped tool" requirement/task 6.8, AC4→task 6.10 + general `sbt test` expectation).

### Verdict: CONFIRM

All three round-2 change requests are genuinely closed against ground truth, not just restated more
confidently. `openspec validate --strict` passes. I found no new blocking issues in a broad pass over
the revised artifacts. This design is sound enough to implement.

### Non-blocking notes

- The `get_resource` tool_result shape is now asymmetric by design: DataType results get wrapped as
  `{"detail": ..., "panelCapabilities": ...}` while the other 4 resource types (dataSource, pipeline,
  dashboard, metric) keep HEL-661's original flat `WorkspaceResourceDetail` JSON (no `"detail"`
  wrapper). This is a legitimate, minimal fix and neither design.md D3a nor tasks.md 4.2a explicitly
  says "non-DataType payloads are unchanged," but it's the only reading consistent with "specifically
  when `resourceType == DataType`" and doesn't block a competent implementer. Worth a one-line
  explicit callout in `AssistantToolExecutor`'s implementation comment, not worth another design
  round.
