## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round-1 CR1 (numeric-safe comparison) is genuinely addressed.**
   Re-read `frontend/src/utils/chartClickSelection.ts` in full again. `filterRowsForSelection`'s
   scatter branch still does `parseFloat(row[xCol] ?? "") !== target` with the exact "3" vs "3.0"
   comment cited in round 1. `design.md` D4 now explicitly specifies "exact string equality, OR
   ... when both the cell and `value` parse as finite numbers and are numerically equal", names
   the same hazard, and cites the same scatter-branch precedent. `spec.md`'s ADDED requirement
   ("Requirement: An active cross-filter narrows sibling panels...") states "comparing numerically
   when both values parse as numbers" directly in the SHALL text, plus its own scenario ("A
   numeric selection matches a differently-formatted sibling column", `"3"` vs `"3.0"`, spec.md
   lines 67–72). `tasks.md` 3.1/6.1 both test this case explicitly. **Confirmed closed.**

2. **Round-1 CR2 (filterable-panel criterion matches literal ticket wording) is genuinely
   addressed.** Re-read `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` in
   full: every `*OutputConfig` (`Chart`, `Table`, `Metric`, `Markdown`, `Collection`, `Timeline`)
   declares `fieldMapping: Record<string, string>`, and `TableOutputConfig` separately declares
   `columnOrder?: string[]`. Design.md's revised criterion (table: `columnOrder` when present else
   all natural columns; every other kind: `Object.values(fieldMapping ?? {})` includes the
   dimension) matches this shape exactly. I independently re-verified the table exception by
   reading `frontend/src/features/panels/ui/PanelContent.tsx` lines 143–161: the `table` branch
   reads `readTableConfig(output.config)` and passes `columnOrder`/`columnSort`/`columnFilters`/
   `columnFormats`/`pinnedColumns` to `TableRenderer` — **`cfg.fieldMapping` is never passed at
   all**, confirming design.md's claim that a table's `fieldMapping` is genuinely unconsumed for
   column selection elsewhere in the codebase. I also confirmed `TableRenderer.tsx`'s
   `orderedColumns` (lines 114–119): empty/absent `columnOrder` → all natural keys; non-empty →
   filtered-and-ordered subset — exactly what design.md's bullet states. `spec.md`'s requirement
   text ("whose field mapping references a column matching the cross-filter's dimension by exact
   name... For a table panel, 'field mapping references a column' means the column is part of the
   table's effective displayed-column set") and its "unmapped, same-named column is unaffected"
   scenario match. `tasks.md` 3.2/6.2 test both directions. **Confirmed closed**, and the
   overclaim/prominence issues from round 1 (b)(i)/(ii)/(iii) are resolved — this is now presented
   as the primary criterion, not a hedged aside.

3. **Round-1 CR3 (crossFilter clears on origin-panel delete) is genuinely addressed.**
   Re-read `frontend/src/features/panels/state/panelsSlice.ts` lines 30–190 in full.
   `interactionState`'s own precedent is exactly as round 1 described: cleared in
   `fetchPanels.pending` (dashboard switch, line 153: `state.interactionState = {}`) and in
   `deletePanel.fulfilled` (line 182: `delete state.interactionState[action.payload]`). Design.md
   D2 now specifies the identical two clear points for `crossFilter`, including
   `action.payload === state.crossFilter?.panelId` in `deletePanel.fulfilled`. `tasks.md` 1.3/1.4
   and 6.3 cover both, and `spec.md`'s "cross-filter is dashboard-scoped view state, never
   persisted" requirement now explicitly states "cleared ... when the panel that originated it is
   deleted" with its own scenario. **Confirmed closed.**

4. **The owner ruling ("Action in Inspect") is faithfully implemented in design.md/spec.md/
   tasks.md.** Read `PanelInspectView.tsx` in full (current shape: a single footer button,
   "Clear selection"/"Close", wired to `onClear`/`onClose`). Design.md D3 correctly describes
   adding a second footer button here, dispatching `setCrossFilter(selection)` from the SAME
   `interactionState[panelId]` selection this component already reads (line 66), then closing via
   the same `onClose` path — no click-handler change. Confirmed `PanelCard.tsx` line 481 wires
   `ActionsMenu`'s "Inspect" entry (`{ label: "Inspect", onClick: handleOpenInspectFromMenu }`),
   and `ActionsMenu.tsx` line 135 confirms `role="menuitem"` with arrow-key navigation (lines
   90–96) — the keyboard-reachability claim in D3 is grounded, not asserted. `tasks.md` 2.1–2.4
   and 6.4 mirror this precisely, including the explicit "test via ActionsMenu path, not chart
   click" instruction. `spec.md`'s first ADDED requirement states the click/no-filter and
   action/sets-filter split in SHALL text with matching scenarios (including "A chart click alone
   does not set a cross-filter"). No mode toggle appears anywhere in design.md, spec.md, or
   tasks.md. **Faithfully implemented.**

5. **Spec deltas and tasks.md are internally consistent with design.md and each other** on every
   decision I traced: D2↔crossFilter reducers/clearing, D3↔Inspect footer action + idempotent
   re-set (spec.md's "Re-activating ... is a no-op" scenario matches D3's "idempotent re-set, not
   a toggle" framing exactly), D4↔filterRowsByDimension numeric/no-op semantics and the
   per-output-kind criterion, D6↔CrossFilterIndicator `role="status"`/`aria-live="polite"`, D7↔
   `LoadedScopeDisclosure` reuse for a cross-filtered, non-origin, truncated panel. Also confirmed
   D5's premise independently is unchanged ground truth by spot-checking `PanelContent.tsx`'s
   metric branch (lines 164–182) still derives `value` fresh from whatever `rawRows`/`headers`
   props it receives.

6. **A genuine problem this revision did NOT catch: `proposal.md` still describes the model the
   owner explicitly rejected, and was left unrevised.** See Change Requests below.

### Verdict: REFUTE

### Change Requests

1. **`proposal.md` was not updated for the "Action in Inspect" owner ruling and now directly
   contradicts `design.md`/`spec.md`/`tasks.md` — both in its "Why" framing and its "What Changes"
   bullets — which is exactly the "design contradicts proposal" internal-contradiction failure
   mode this gate exists to catch.**
   - `proposal.md`'s "Why" section (line 5–6) still frames the feature as: "HEL-588 completes the
     linked-view promise: **the same click** also narrows every sibling panel sharing that
     column" — this is precisely the "click does both" model the owner rejected
     (`design.md`/`tasks.md`'s "Owner Rulings" section: "Rejected alternatives: click sets both
     inspect and filter").
   - "What Changes" (lines 10–13) states: "Add dashboard-scoped cross-filter state ... derived
     from the SAME click that already drives HEL-572's per-panel selection — no new click
     gesture. **Re-clicking the identical element toggles the filter off.**" Both the "click sets
     the filter" premise and the toggle-off-on-re-click behavior are gone from the actual design
     — replaced by an idempotent re-set from an explicit Inspect footer action, per D3 and
     `spec.md`'s "Re-activating the filter action for the identical selection is a no-op" (not a
     toggle, and not click-triggered at all).
   - "Impact" (line 39) says "`PanelCard.tsx`: **toggle-aware dispatch**, single filtering
     application point" — the toggle-aware dispatch half is now false; the mechanism that actually
     sets the filter lives entirely in `PanelInspectView.tsx`'s new footer button (D3), which the
     Impact list does not mention as a touched file at all — a real omission, not just stale
     prose, since a reader using `proposal.md`'s Impact section to scope the diff would miss the
     file that carries the actual owner-ruled trigger mechanism.
   - I confirmed via `grep` that neither `design.md` nor `tasks.md` references `proposal.md` or
     otherwise flags this staleness as a deliberate, acknowledged exemption — it appears to have
     been simply missed while `design.md`/`spec.md`/`tasks.md` were rewritten for the ruling.
   - **Required:** revise `proposal.md`'s "Why", "What Changes", and "Impact" sections to describe
     the actual shipped mechanism (click opens Inspect only per HEL-572, unchanged; an explicit
     Inspect-view footer action sets the cross-filter; idempotent re-set, not a toggle; add
     `PanelInspectView.tsx` to Impact). This is a documentation-only fix with no code implications,
     but it is a load-bearing planning artifact (the "why + what" narrative most likely to be
     skimmed by a future reader, and the ticket itself directs the owner's reasoning be "cite[d]
     in the PR body" — a PR description drawn from a still-contradictory `proposal.md` would ship
     the wrong narrative).

### Non-blocking notes

- Everything else — the three round-1 CRs, the owner-ruling implementation, and the internal
  consistency of `design.md`/`specs/panel-cross-filtering/spec.md`/`tasks.md` with each other — is
  solid and independently re-verified against ground truth (not just re-read prose). Once CR1
  above is fixed, I would expect this design to clear.
