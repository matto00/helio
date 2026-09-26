## Context

**Owner ruling (2026-09-25, via an escalation the driver raised directly to the owner —
recorded as `escalation.answered` / `concertino answer HEL-588 action-in-inspect`): "Action in
Inspect."** A chart click keeps HEL-572's behavior exactly (opens Inspect only, sets no
cross-filter). `PanelInspectView` instead gains an explicit "Filter dashboard by {dimension} =
{value}" footer action; activating it sets the cross-filter and closes Inspect. The owner
rejected both "click does both" (this design's own first draft, self-approved before the
escalation) and a dashboard-level mode toggle. Reason recorded for the PR body: explicit,
legible opt-in per the ticket, no surprise dashboard filtering hidden behind a click that also
opens a modal.

Corrected citation (design-gate round 1, non-blocking note): the archived
`openspec/changes/archive/2026-09-25-chart-click-drilldown/design.md` establishes, across two
sentences — D1 itself ("HEL-588 needs to read `interactionState` across panels while any number
of inspect views are open or closed...") and its "Alternative considered" paragraph ("HEL-588
needs to read a panel's selection from outside that panel's own subtree... lifted to Redux now
rather than re-plumbed later") — that `interactionState` was deliberately made readable
independent of Inspect's open/closed state. That remains true and is exactly what the "Action in
Inspect" footer action relies on; it never settled WHICH gesture would trigger the filter — that
gap is what the owner ruling above resolves.

`usePanelData(panel)` is called exactly once, in `PanelCard.tsx` (HEL-579 D1); `PanelCard` also
already calls `useOutputMeta(outputId)` itself (HEL-572 D1/D5, an accepted "second, independent
fetch" precedent), so `output.kind`/`output.config` are already available there with no new
fetch. Each panel's initial fetch is capped at 200 rows; `rowsTruncated` is the existing honest
truncation signal (`LoadedScopeDisclosure`, HEL-448/451).

## Goals / Non-Goals

**Goals:**
- Ship exactly the owner's "Action in Inspect" model: click is unchanged; an explicit,
  keyboard-reachable Inspect-view action sets the cross-filter.
- Filter once, in the shared data layer, so every consumer sees identical filtered rows.
- Match the ticket's literal "field mapping references a column" wording per output kind.
- Honest disclosure when a filtered panel's own rows are truncated.

**Non-Goals:**
- Modifying `chart-drilldown-inspect`'s own requirements (D1) — none change.
- Server-side filtering (HEL-1027) or dashboard variables (HEL-915).
- Filtering non-Output panel kinds — no rows to filter.

## Decisions

**D1 — No modified capability.** `selectDataPoint`/click behavior are byte-for-byte unchanged.
The new footer action is a `panel-cross-filtering`-owned behavior layered onto a component
`chart-drilldown-inspect` already owns; no existing requirement's SHALL text changes.

**D2 — `crossFilter: SelectionDescriptor | null` in `panelsSlice`,** one active filter
dashboard-wide. Reducers: `setCrossFilter(descriptor)`, `clearCrossFilter()`. Cleared on the
existing dashboard-switch reset point (`fetchPanels.pending`), **and** (design-gate round 1, CR3)
in `deletePanel.fulfilled` when `action.payload === state.crossFilter?.panelId` — mirrors
`interactionState`'s own established precedent one field over in the same reducer file.

**D3 — The filter action lives in `PanelInspectView`'s footer, not the click handler.** A new
button, alongside "Clear selection"/"Close", reading the SAME `interactionState[panelId]`
selection already driving the Inspect grid: "Filter dashboard by {dimension} = {value}" (`.mono`
value). Activating it dispatches `setCrossFilter(selection)` then closes Inspect (same call
`onClose` already makes). No click-handler changes at all — `PanelCard.handleDataPointSelect`
stays exactly as HEL-572 shipped it. **Keyboard reachability by construction, not new plumbing:**
`ActionsMenu`'s "Inspect" entry is already a keyboard-navigable `role="menuitem"`
(`ActionsMenu.tsx`, arrow-key navigation, confirmed); it opens `Modal` (native `<dialog>`); the
new footer control is an ordinary `<button>`, natively focusable — verified with an explicit
test that reaches the action via Tab after opening Inspect through the ActionsMenu path (not the
chart-click path). **Re-invoking the same filter action (self-approved call, not the owner's):
idempotent re-set, not a toggle.** Clearing has exactly one path now — the indicator's clear-all
— which is simpler to explain and test than a second, action-triggered clear path layered on
top of the mode change the owner just simplified.

**D4 — Filtering (CORRECTED, cycle 3 — this text was stale from cycle 1 through
evaluation-3.md; see `files-modified.md`'s cycle 3 entries for the full defect history this
correction resolves).** Filtering does NOT happen once at a single `PanelCard`-level call site —
it happens at TWO deliberately different points, because a panel's rendered content and its
Inspect view have different, incompatible needs from the SAME cross-filter:

- **The rendered content (chart/table/metric/collection/timeline)** is filtered INSIDE
  `OutputPanelContent` (`PanelContent.tsx`), which already resolves the panel's `output` for
  kind-dispatch — no new fetch. It reads `crossFilter` from Redux directly (a `panelId` prop
  identifies the origin exemption) and applies `filterRowsByDimension`/
  `filterRecordRowsByDimension` to BOTH `rawRows` (chart/metric/collection/timeline) and
  `paginationRows` (table — a keyed-record shape `rawRows`'s util doesn't cover, hence the
  second function) immediately before dispatching to the per-kind renderer. Every caller
  (`PanelCardBody`, `PanelFullscreenOverlay`, `MobileStackPanelBody`) passes `OutputPanelContent`
  the RAW, unfiltered `rawRows`/`headers`/`paginationRows` — filtering an already-filtered value
  here would be idempotent for the rendered rows but corrupts the D7 truncation disclosure's
  `loadedCount` (`rawRows?.length` would read the wrong length) — this is exactly the defect
  `skeptic-final-1.md` found and fixed in `PanelCard.tsx`'s `PanelFullscreenOverlay` call.
- **Every `PanelInspectView` mount** (there are two: the grid-context one in `PanelCard`, and the
  one nested inside `PanelFullscreenOverlay`) needs the ALREADY-filtered rows instead, because
  Inspect renders its own `DataGrid` directly from its `rawRows`/`headers` props rather than going
  through `OutputPanelContent` at all. `PanelCard` computes this ONE cross-filtered value via
  `useCrossFilteredPanelData` (reusing its own pre-existing `output` fetch — the same one
  `chartInspectConfig` resolves) and threads it to BOTH Inspect mounts: directly as
  `PanelInspectView`'s own `rawRows`/`headers` prop for the grid-context mount, and as
  `PanelFullscreenOverlay`'s SEPARATE `inspectRawRows`/`inspectHeaders` prop pair (deliberately
  distinct from that overlay's own `rawRows`/`headers`, which stay raw for its `<PanelContent>`)
  for the nested mount — `evaluation-3.md`'s fix, after a naive single-prop-pair wiring inside
  `PanelFullscreenOverlay` left its nested Inspect silently ignoring the active cross-filter.

`filterRowsByDimension(rawRows, headers, dimension, value)` is a no-op (`-1` index) if `dimension`
isn't in `headers`, or if `panel.id` equals the filter's originating panel id (origin always
renders full data — "filters the OTHER panels," Scope; design-gate round 1 confirmed this reading
against `spec.md`'s own explicit scenario, no revision needed). **Numeric-safe match (design-gate
round 1, CR1):** a cell matches on exact string equality, OR — mirroring
`chartClickSelection.ts`'s `filterRowsForSelection` scatter-branch precedent, which exists
specifically to avoid a `"3"` vs `"3.0"` mismatch — when both the cell and `value` parse as
finite numbers and are numerically equal. Without this, a scatter-originated filter (whose
`value` is `String(params.value[0])`, the same descriptor shape) could silently zero-match a
sibling column with different numeric string formatting.

**Filterable-panel criterion (design-gate round 1, CR2 — revised to match the ticket's literal
text, replacing the header-only criterion the skeptic correctly flagged as broader than
written).** Reuses the `output`/`output.config` `PanelCard` already fetches (D-Context):
- **table:** `output.config.columnOrder` when present and non-empty (its effective displayed-
  column set, per `TableRenderer`'s own precedent of using `columnOrder` over `fieldMapping` for
  column selection); when absent, all natural (loaded) columns — table's `fieldMapping` is read
  but never actually consumed for column selection anywhere else in the codebase either.
- **every other output kind (chart/metric/markdown/collection/timeline):** `Object.values(
  output.config.fieldMapping ?? {})` includes `dimension` — every `*OutputConfig` interface
  declares an identically-shaped `fieldMapping: Record<string,string>` (values are column
  names), so this one check is uniform across kinds with no per-kind key enumeration needed.
- A panel whose own kind-appropriate check fails is unaffected, satisfying "non-matching panels
  are unchanged" for the *ticket's actual wording*, not just the broader superset the round-1
  design used. This is a deliberate narrowing versus round 1 — a panel with an unrelated,
  unmapped same-named column no longer narrows, closing the "illegible" case round 1 could not
  rule out.

**D5 — Aggregation "recompute" needs no new code.** `chartAggregate` is always `null` on the live
path (confirmed by reading `usePanelData.ts` in full, design-gate round 1); every renderer
derives fresh from `rawRows`/`headers` every render.

**D6 — `CrossFilterIndicator`** mounts in `PanelList.tsx`: "Filtered by {dimension} = {value}"
(`.mono` value, DESIGN.md §3), a clear-all button dispatching `clearCrossFilter()`, wrapped
`role="status"` `aria-live="polite"` (matches `ApiTokensSection`'s PAT-copy toast pattern) so
set/replace/clear are all announced.

**D7 — Truncation disclosure reuses `LoadedScopeDisclosure`'s wording/shape** (HEL-448/451),
wired into `OutputPanelContent` for a cross-filtered, non-origin panel whose own `rowsTruncated`
is true.

## Risks / Trade-offs

- Numeric-safe matching (D4/CR1) is a superset of exact-string matching; it cannot ever
  under-match a genuinely-intended equality, and a coincidental cross-type numeric collision
  (e.g. `"3"` matching `"3"` stored as a different concept) is the same "by column name" trust
  boundary the ticket already accepts for the dimension match itself.
- Field-mapping-based matching (CR2) is more restrictive than round 1's header-only version —
  intentional, since it is what the ticket literally asked for; flagged here with the same
  prominence D4's origin-exemption gets, per the design-gate's own required-revision (b)(ii).
- HEL-1178 (chart panels with no stored `appearance.chart`) remains a known, separate, un-fixed
  defect; cross-filtering must still work on such a panel (verified in Evaluation).
