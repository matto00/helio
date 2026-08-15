## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all 3 spec deltas
  (`specs/{assistant-conversation-loop,combined-proposal-apply,pipeline-proposal-apply}/spec.md`),
  and the canonical epic spec `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`.
- `openspec validate assistant-service-wiring --strict` → `Change 'assistant-service-wiring' is valid`.
- Pulled HEL-662 and HEL-663 from Linear directly (not from the plan's paraphrase) to check the
  delivery-order/persistence-deferral claim independently.
- Read the real source for every service/type the plan claims about:
  `PipelineProposalService.scala`, `CombinedProposalService.scala`, `DashboardProposalService.scala`,
  `ProposalPanelSupport.scala`, `PatchSetPreviewService.scala`, `DataSourceRepository.scala`,
  `ClaudeClient.scala`, `ClaudeModels.scala`, `WorkspaceSearchService.scala`,
  `WorkspaceAssistantTools.scala`, `WorkspaceContextProtocol.scala`, `DashboardAuthoringPrompt.scala`,
  `DashboardAuthoringService.scala`, `AuthoringConversationRepository.scala`, and the
  `V77__authoring_conversations.sql` / `V78__refinement_conversations.sql` migrations.
- Confirmed `WorkspaceSearchService` (HEL-661) has zero references in `Main.scala`/`ApiRoutes.scala`,
  substantiating the plan's claimed "zero-route" precedent it's mirroring for D7/D8.

### Departure 1 — `converse(history, message)` instead of `converse(conversationId, message)`

**Verdict: defensible, but the design.md Context claim is not fully accurate.**

- `assistant_conversations` genuinely does not exist (grep across `.sql`/`.scala` confirms it).
- HEL-663 ("Assistant conversation persistence (Postgres metadata + GCS transcript body)") is a
  real, separately-filed Linear ticket, created at epic-decomposition time (2026-08-14, same day as
  HEL-662), already `parentId: HEL-659`, already has its own ACs covering create/append/list/pin +
  RLS. This is not an ad hoc deferral invented mid-ticket — it was decided at epic-planning time and
  is consistent with the established 662→663 delivery order.
- However, an **existing, directly analogous table does exist**: `authoring_conversations` (V77,
  `DashboardAuthoringService`/`RefinementService`), which already stores `api_history`
  (`Vector[ClaudeMessage]`), `display_turns`, and a structured outcome (`latest_proposal` /
  `latest_patch_set`, the latter added by V78 specifically by **extending** V77 for a second
  conversation kind rather than standing up a parallel table). This is the exact "nothing is wasted"
  precedent the epic's own canonical spec invokes elsewhere. design.md's Context section says "No
  `assistant_conversations` table **or equivalent** exists" — that overstates the gap; a working,
  once-already-generalized equivalent exists in this same codebase.
- The canonical epic spec (`2026-08-14-top-level-assistant-design.md`, "Data model & persistence")
  independently specifies a *different* physical shape for `assistant_conversations` (GCS-backed
  transcript body + slim Postgres metadata row) vs. `authoring_conversations`' full-JSONB-in-Postgres
  shape — so reusing `authoring_conversations` a third time is not simply "free," and the call not to
  is plausibly correct. But that comparison and rationale is absent from design.md entirely.

**Required revision**: design.md's Context/D1 section should name `authoring_conversations` and state
*why* HEL-663's separately-shaped table is being built instead of extending it a third time (even one
sentence), rather than implying no precedent exists. This doesn't block HEL-662 (no AC needs
persistence, HEL-663 is properly pre-scoped) — it's a planning-transparency fix, not a scope fix.

### Departure 2 — new non-mutating `validate` on `PipelineProposalService`/`CombinedProposalService`

**Verdict: the core premise is true and the mechanism is genuinely side-effect-free; but the
`CombinedProposalService.validate` scope (D3) is narrower than necessary and creates a real quality
gap.**

- Confirmed by direct read: `PipelineProposalService` today exposes only `apply`/`rollback`
  (mutating); `CombinedProposalService` exposes only `apply` (mutating, composes the other two
  services' `apply`s). Neither has a non-mutating entry point today — the ticket's premise is correct.
- Traced the planned call graphs: `PipelineProposalService.validate` → `validateStructure` (pure,
  in-memory) + `dataSourceRepo.findByIdOwned` (confirmed a plain read-only `SELECT`, no side effects,
  `DataSourceRepository.scala:116-121`). `CombinedProposalService.validate` → delegates to the above
  + the existing `validateOutputRefPositions` (pure, in-memory, no I/O). Both are genuinely
  side-effect-free as designed.
- **Real gap**: D3 states `CombinedProposalService.validate` "deliberately does **not** attempt full
  `DashboardProposalService`-style binding validation against the dashboard panels" and limits the
  dashboard-portion check to `validateOutputRefPositions` alone. But `DashboardProposalService`'s
  structural check is **two separable pieces**: `validateStructure`/`ProposalPanelSupport.validatePanel`
  (pure, in-memory — panel type validity, non-blank title, chart-type/divider-orientation/
  timeline-sort validity, chart/aggregation conflict; only checks `dataTypeId.isEmpty`, never its
  *value*) vs. `preValidateBindings` (DB-backed — resolves the real dataTypeId, genuinely can't run
  against the `"$pipelineOutput"` sentinel). The design conflates these and skips **both**, when only
  the second genuinely requires deferral. A combined proposal with a blank panel title, an invalid
  `chartType`, or a chart panel with a conflicting `aggregation` — none of which touch the sentinel —
  would incorrectly pass `CombinedProposalService.validate` today as scoped, only failing later at
  real `apply` time (after the human has already seen it "validated" in the Proposal Review UI), and
  never gets fed back to Claude for self-correction within the hop budget the way an equivalent
  `propose_dashboard` call's failure would.
- **Required revision**: `CombinedProposalService.validate` should also run the pure structural check
  (`ProposalPanelSupport.validatePanel` per panel, or an equivalent) on the dashboard portion,
  deferring *only* the DB-backed binding resolution — not deferring structural validation wholesale.

### New finding — AC1 parity gap: panel-capability grounding has no path into the tool loop

Not one of the two flagged departures, but a concrete, independently-discovered gap directly
threatening AC1 ("same quality of `DashboardProposal` `DashboardAuthoringService` would have, via the
tool loop"):

- `DashboardAuthoringService` depends on a dedicated `PanelCapabilityService`, fetches a per-DataType
  `PanelCapabilitiesResponse` (bindable panel kinds + required/optional slots) for every grounding
  DataType, and folds it directly into `DashboardAuthoringPrompt.userMessage`'s
  `groundingSection`/`capabilityMenuFor`, with an explicit prompt rule: "Only use a panel kind for a
  DataType when its panel-capability entry below marks that kind bindable."
  (`DashboardAuthoringService.scala:57,265-278`, `DashboardAuthoringPrompt.scala:43-53,70-75`.)
- `WorkspaceContextDataType` (the type `get_resource(id, type=dataType)` returns, per
  `WorkspaceSearchService.getResource` → `workspaceContextService.toDataTypeEntry`) carries `columns`,
  `sampleRows`, `columnStats` — but **no capability/bindable-kind field at all**
  (`WorkspaceContextProtocol.scala:96-107`). Neither `DashboardProposalService.validate` nor
  `preValidateBindings` backend-enforces panel-kind/column eligibility either (confirmed by reading
  `ProposalPanelSupport.scala` — it checks dataTypeId existence/ownership/pipeline-output-ness, never
  column-level or capability-level fit), so this is purely a prompt-time steering signal today, and it
  has no equivalent anywhere in the planned `find`/`get_resource`/`AssistantSystemPrompt` surface.
  `AssistantSystemPrompt` is explicitly *static* text (task 3.1), so it structurally cannot carry
  per-DataType capability menus the way the dynamic authoring prompt does.
- None of tasks.md's 10 subtasks, and no test in the Tests section, address this — the scripted
  fake-transport tests (6.3-6.7) only verify plumbing/wiring, not whether the actual context Claude
  receives is sufficient to reproduce `DashboardAuthoringService`'s proposal quality. This is exactly
  the kind of gap that would silently ship and only surface against a real Claude call in production.
- **Required revision**: the design needs to state how (or explicitly decide not to, with rationale)
  panel-capability grounding reaches Claude in the new architecture — e.g. extend `get_resource`'s
  DataType detail with capability info, or fold the eligibility rules generically into
  `AssistantSystemPrompt`/`proposeDashboardTool`'s description — so AC1's parity claim is actually
  achievable, not just structurally plausible.

### Buildability checks (D5, D6, D7/D8, Non-Goals)

- **D5 (tool-input parsing)**: confirmed `ClaudeToolExecutor.execute(name: String, input: JsValue)`
  (`ClaudeModels.scala:131-133`) — `input` is genuinely already-structured `JsValue`, and all four
  proposal types (`PipelineProposal`, `CombinedProposal`, `DashboardProposal`, `PatchSet`) have
  existing `RootJsonFormat`s to `.convertTo[T]` against (confirmed in their respective `*Protocol.scala`
  files). Buildable as designed; `DeserializationException`-catch → `Left` → `isError` tool_result is
  spray-json's standard failure mode.
- **D6 (structured-proposal side channel)**: buildable, but the "overwritten only on success, later
  wins" reasoning is sound **across hops** (sequential — `ClaudeClient.sendWithTools`'s `loop` only
  recurses after the prior hop's tool executions all complete) but **not within a single hop**:
  `sendWithTools` executes every `tool_use` block in one hop via `Future.traverse` (`ClaudeClient.scala:107-112`,
  genuinely concurrent). Nothing in the plan (tool schema, system prompt task 3.1/3.2) constrains
  Claude to at most one `propose_*` call per turn, so two concurrent `propose_*` successes in the same
  hop would race on the `AtomicReference`, making "the eventual success wins" not well-defined for that
  case. Narrow, low-likelihood, but a real correctness gap in a mechanism the design explicitly reasons
  about in ordering terms. Should be closed by either constraining the system prompt or explicitly
  documenting/testing the same-hop-multiple-`propose_*` behavior.
- **D7/D8 (no live route/DI wiring)**: verified `WorkspaceSearchService` (HEL-661, shipped as the
  precedent being mirrored) has zero references in `Main.scala`/`ApiRoutes.scala` today — confirms the
  precedent is real, not just asserted. tasks.md's 10 subtasks never touch `ApiRoutes.scala`/DI wiring
  files. Confirmed: this plan does not accidentally give `AssistantService` live route/DI wiring beyond
  what the stated Non-Goals allow.
- `openspec validate assistant-service-wiring --strict` passes cleanly.

### Minor / non-blocking

- design.md's D1 prose and the `assistant-conversation-loop` spec scenarios write `converse(history,
  message)` (2 params), while tasks.md 5.2 specifies `converse(history, message, user)` (3 params,
  clearly required since `AssistantToolExecutor` needs `user`). Reconcile the signature across
  artifacts — almost certainly a documentation-brevity omission in design.md/spec.md, not a real
  disagreement, but worth a one-line fix for internal consistency.
- Task 1.1 widens `PipelineProposalService.validateStructure` from `private` to `private[services]`;
  if `validate` is added within the same class file (as planned), default Scala `private` already
  grants companion-object/same-class access, so this widening may be unnecessary unless it's
  specifically for test-file access from the same package. Harmless either way — not a defect.
- Task 4.2 covers parsing `get_resource`'s `type` field via `WorkspaceResourceType.fromString` but
  doesn't explicitly call out that `find`'s optional `resourceTypes` array needs the same parsing.
  Low risk of being missed (required for the code to compile against `WorkspaceSearchService.find`'s
  signature) but worth adding explicitly for completeness.

### Verdict: REFUTE

### Change Requests

1. **`CombinedProposalService.validate` (design.md D3, tasks.md 1.3) must also run the pure structural
   panel check** (`ProposalPanelSupport.validatePanel`-equivalent: type validity, non-blank title,
   chart/divider/timeline field validity, aggregation conflicts) on the dashboard portion — not just
   `validateOutputRefPositions`. Only the DB-backed binding resolution (`preValidateBindings`)
   genuinely needs deferral to real apply time; skipping *all* structural validation is broader than
   the stated justification supports and creates a self-correction gap for `propose_combined` that
   `propose_dashboard` doesn't have.
2. **Specify how panel-capability/bindable-kind grounding reaches Claude in the new tool-loop
   architecture**, or explicitly accept and document the quality reduction against AC1. Today
   `DashboardAuthoringService` grounds every proposal in a per-DataType `PanelCapabilitiesResponse`
   menu; nothing in `find`/`get_resource`/`AssistantSystemPrompt` as planned carries equivalent
   information, and no task/test in the plan addresses this. This directly bears on AC1's "same
   quality... via the tool loop" claim and should be resolved before implementation, not discovered
   after a real-Claude run in production.
3. **Correct design.md's Context/D1 framing of conversation persistence.** Replace "No
   `assistant_conversations` table or equivalent exists yet" with an accurate acknowledgment that
   `authoring_conversations` (V77/V78) is a directly analogous, already-once-extended precedent, and
   state briefly why HEL-663's separately-shaped (GCS-backed) table is preferred over a third
   extension of it. Non-blocking for HEL-662's own ACs, but the current phrasing overstates the gap
   this ticket is filling and should be planning-transparent about the alternative it's not taking.
4. **Close the same-hop concurrent-`propose_*` race in D6's side channel** — either have
   `AssistantSystemPrompt` explicitly instruct at most one `propose_*` call per turn, or explicitly
   document/test the behavior when a single hop contains multiple successful `propose_*` calls (the
   `AtomicReference`'s "later wins" reasoning is only well-defined across hops, not within one, given
   `ClaudeClient.sendWithTools`'s actual `Future.traverse`-based concurrent execution of same-hop tool
   calls).
5. **Reconcile the `converse` signature across artifacts** — design.md/spec.md show `converse(history,
   message)`; tasks.md 5.2 shows `converse(history, message, user)`. Make these consistent (tasks.md's
   3-arg version is almost certainly correct/complete).

### Non-blocking notes

- Task 1.1's `private` → `private[services]` visibility widening on `validateStructure` may be
  unnecessary if `validate` lives in the same class file — verify at implementation time, harmless
  either way.
- Task 4.2 should explicitly note `find`'s optional `resourceTypes` array also needs
  `WorkspaceResourceType.fromString` parsing, alongside `get_resource`'s `type` field.
