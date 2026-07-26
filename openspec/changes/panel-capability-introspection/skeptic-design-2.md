## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **Round-1 item 2 (V41 "literal" claim) is now fixed.** `backend/src/main/scala/com/helio/services/PanelService.scala:305-306`
   (`rejectCompanionBinding`) emits `ServiceError.BadRequest("Panels can only bind to pipeline-output data
   types")` — design.md D3 now quotes this exact string verbatim and cites the correct line (306). Confirmed
   fixed.

2. **Round-1 item 1, chart/timeline sub-claims — now correct.**
   - `frontend/src/features/panels/state/panelSlots.ts:13-17`: `chart: [xAxis, yAxis, series]` — no
     `annotation` key, matches design.md D2's claim.
   - `frontend/src/features/panels/ui/editors/BindingEditor.tsx:8,331,358-359` really does
     `PANEL_SLOTS[panel.type]` → `<FieldMappingSlots slots={slots} .../>`, generic for chart (and table);
     the `annotation` merge is a separate block at `BindingEditor.tsx:245-257` (`merged.annotation = ...` /
     `delete merged.annotation`) — outside the generic slot loop, exactly as D2 describes. The "chart minus
     annotation = {xAxis,yAxis,series}" comparison is accurate.
   - `frontend/src/features/panels/ui/editors/TimelineEditor.tsx:7,113`: `const slots = PANEL_SLOTS.timeline;`
     = `[time, event]`, both required — the "timeline = {time,event}" comparison is accurate.

3. **Round-1 item 1, collection sub-claim — still wrong, in a new way.** Design.md D2 (line 57-58) and
   spec.md's Requirement ("Slot definitions share one source of truth", line 48-50) now both assert:
   "[metric's] only live consumer is `CollectionEditor.tsx`, which derives a collection's per-item slots
   from `PANEL_SLOTS[baseType]` (`CollectionEditor.tsx:35`)." I read
   `frontend/src/features/panels/ui/editors/CollectionEditor.tsx` in full and grepped it for `PANEL_SLOTS`:
   the only hit is line 35, which is inside a **doc comment** ("shared metric item slots derived from
   `PANEL_SLOTS.metric`"). The component **never imports `PANEL_SLOTS`** (`grep -rn "PANEL_SLOTS"
   frontend/src` shows no import in `CollectionEditor.tsx`, unlike `BindingEditor.tsx:8` and
   `TimelineEditor.tsx:7` which do). The actual `value`/`label`/`unit` fields are hardcoded directly:
   `valueField` state (`CollectionEditor.tsx:62,113-114,220-229`) and `labelState`/`unitState`
   (`:67-76,115-116,231-252`) — none of it reads `PANEL_SLOTS` at runtime. So the design's evidentiary basis
   for cross-check (c) is false: `panelSlots.ts`'s `metric` entry is **not** live-consumed by
   `CollectionEditor.tsx`; it's a second, independently hardcoded copy of the same three field names that
   happens to currently agree by convention, not by derivation. This directly undercuts the design's own
   "no drift" premise for the collection column — a future edit to `PANEL_SLOTS.metric` would silently NOT
   propagate to `CollectionEditor.tsx` (they aren't wired together), which is exactly the drift risk this
   ticket exists to prevent, and the design's Risks section only anticipates drift on the *Scala* side of
   the comparison, not this frontend-side comment/code mismatch.

4. **Internal contradiction: proposal.md vs. design.md/tasks.md on route placement.** design.md's D6 and
   "Planner Notes" (lines 93-97, 112-116) explicitly self-approve adding the endpoint as a new path segment
   inside the *existing* `DataTypeRoutes.scala`, not a new router file — and `tasks.md` 2.2 correctly
   implements that ("Add `GET :id/panel-capabilities` under the existing `pathPrefix("types")` block in
   `DataTypeRoutes.scala`"). But `proposal.md`'s Impact section (line 40) still says: "Backend: new
   `PanelCapabilityService` + **`PanelCapabilityRoutes`** (mirrors `DataTypeRoutes`)..." — asserting a new
   router file design.md explicitly decided against. proposal.md was not updated to match design.md's
   self-approved deviation from the ticket's original "mirror DataTypeRoutes.scala" suggestion (which the
   ticket meant as "new file mirroring the pattern," and design.md reinterpreted as "add to the existing
   file"). tasks.md is internally consistent with design.md; proposal.md is the stale one.

5. **Spot-checks with no new problems found:** D3's HEL-292 no-row-count-gate claim, D4's HEL-624
   handled-by-omission claim, D1's HEL-399/`panelShapes.ts` reconciliation, D5's 404-not-403 multi-tenancy
   reuse (`DataTypeService.listRows` at `DataTypeService.scala:31` is also owner-scoped, consistent), and
   scope discipline (HEL-364/370/366/367/368 only referenced as out-of-scope in proposal.md/ticket.md, never
   absorbed into tasks.md) are all unchanged from round 1 and still hold up against the current file
   contents. `DataFieldType` (`model.scala:445-458`) is a real sealed trait matching D2's
   `columnEligibility: SlotKey => DataFieldType => Boolean` signature. `bind_panel`'s MCP description
   (`helio-mcp/src/tools/write.ts:436-444`) still matches the slot vocabulary design.md cites.

### Verdict: REFUTE

### Change Requests

1. **Fix the false `CollectionEditor.tsx:35` "live consumer" claim in design.md D2 and spec.md's "Slot
   definitions share one source of truth" requirement.** `CollectionEditor.tsx` does not import or read
   `PANEL_SLOTS` anywhere — line 35 is a doc comment, not code; the component hardcodes `value`/`label`/`unit`
   fields itself. Required: either (a) drop the "derives... from `PANEL_SLOTS[baseType]`" framing and instead
   ground cross-check (c) directly in `CollectionEditor.tsx`'s hardcoded field names (`value`,`label`,`unit`
   — cite the actual state/handlers at `:62,67-76,113-116,220-252`, not a false runtime-derivation claim), or
   (b) if the intent really is a live derivation, note that as a **gap** (CollectionEditor.tsx should read
   `PANEL_SLOTS[baseType]` but currently doesn't) rather than asserting it as already-true supporting
   evidence. Either way, spec.md's requirement text ("collection... per `CollectionEditor`'s
   base-type-derivation") needs the same correction since it currently asserts a runtime behavior that
   doesn't exist in the code.

2. **Sync proposal.md's Impact section with design.md D6 / tasks.md 2.2.** `proposal.md:40` still says a new
   `PanelCapabilityRoutes` file will be added; design.md explicitly decided (and tasks.md correctly
   implements) adding the route inside the existing `DataTypeRoutes.scala` instead. Update proposal.md to
   match — this is a documentation-sync fix, not a functional design flaw (design.md and tasks.md already
   agree with each other), but it's a live artifact contradiction as instructed to check for.

### Non-blocking notes

- Round 1's two items (V41 literal string, chart/timeline slot comparisons) are genuinely fixed this round —
  not re-litigated above beyond confirming them.
- The round-1 non-blocking note about `DataType.computedFields` (`model.scala:513`) still isn't addressed in
  design.md's column-eligibility discussion; still worth a one-line clarification but not blocking.
