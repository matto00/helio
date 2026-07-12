## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **`DataGrid.tsx`/`.css`** (read in full): no resize/columnWidth code exists today (matches
  design.md's grep claim). Confirmed the `variant`-gated `DEFAULT_DENSITY` precedent
  (`preview`→`"condensed"`, `full`→`"normal"`) that the design's "gate resize on `variant` alone"
  decision claims to follow — this is a real, applicable precedent.
- **Six `DataGrid` consumers**: `grep -rn "DataGrid"` across `frontend/src` confirms exactly
  `TableRenderer.tsx` (`variant="full"`) plus `TypeDetailPanel.tsx`, `SourceDetailPanel.tsx`,
  `PipelinePreviewModal.tsx`, `StepCard.tsx`, `SqlTab.tsx` — all five verified `variant="preview"`
  by direct grep. The variant-gate is sufficient to keep resize out of every non-Table surface as
  claimed.
- **`TablePanel.scala`** (read in full): `fieldMapping`'s decode/`Patch`/`applyPatch`
  absent-vs-null pattern is exactly as design.md describes; `columnWidths` mirroring it is
  structurally sound (Map[String,Int] is a valid spray-json `Map` format; `jsonFormat2`→`jsonFormat3`
  is an obvious mechanical follow-on not requiring separate documentation).
- **`schemas/panel.schema.json`**: `TableConfig` def confirmed (`dataTypeId`/`fieldMapping` only,
  `additionalProperties: false`) — the planned `columnWidths` addition is consistent with sibling
  defs.
- **`PanelGrid.tsx`**: confirmed `dragConfig={{ handle: ".panel-grid-card__handle" }}` (not a
  `cancel` selector) and the separate `.react-resizable-handle` corner-resize class — a
  `<span>` inside `DataGrid`'s `<th>` with neither class name is structurally isolated as claimed.
- **`panelPayloads.ts`**: `buildBindingPatch` pattern confirmed; a parallel
  `buildTableWidthsPatch` following the same shape is a reasonable, grounded addition.
- **HEL-255 scope boundary**: clearly recorded in design.md's "Scope boundary vs. HEL-255" section,
  consistent with the ticket's orchestrator-context note, and traced through to tasks.md (backend
  storage + frontend load/save wiring only, no config-UI task present) — coherent, no drift.
- **Local main state**: `git log --oneline -3` confirms HEAD at `00e8284` (HEL-252, HEL-254 merged),
  matching design.md's stated branch-cut point.

### Two grounding failures found on inspection

**1. The "250ms debounce mirrors PanelGrid's layout persistence" claim is factually wrong.**

design.md's Decisions section, proposal.md's "What Changes," and tasks.md task 3.4 all justify the
column-width persistence timing as "250ms, mirroring the layout-persistence debounce already used
by `PanelGrid`'s `handleLayoutChange`." I checked this directly:

- `grep -rln "debounce" frontend/src` (excluding tests) returns exactly one file
  (`ComputedFieldForm.tsx`, unrelated to panels/layout) — there is no debounce anywhere near
  `PanelGrid` or layout persistence.
- `frontend/src/features/panels/hooks/usePanelGridSave.ts` (read in full) shows the actual
  mechanism: `markLayoutChanged` just marks a ref/flag; persistence happens via a
  **30-second auto-save interval** (`AUTO_SAVE_INTERVAL_MS = 30_000`) plus explicit flush points
  (dashboard switch, a `registerFlush`/`SaveStateContext` hook that `SaveStateIndicator.tsx` exposes
  to the UI, presumably a "Save now" affordance). There is no 250ms anything.

This isn't a cosmetic mislabeling — it leaves an unresolved architectural question the design
never actually answers: should column-width edits flow through the *existing*
`pendingPanelUpdates`/30s-interval/explicit-flush pipeline every other panel-field edit uses (in
which case a user who resizes a column and reloads within 30s, before hitting a flush trigger,
loses the resize — directly contradicting the DoD "widths persist across reload"), or should this
ticket introduce a genuinely novel, independent, immediately-firing debounced PATCH that bypasses
`pendingPanelUpdates`/`SaveStateIndicator` entirely (a real architectural divergence from how every
other panel-config field is persisted, undocumented and unjustified against the actual precedent)?
The design should pick one explicitly and ground it in what the codebase actually does, not in a
debounce pattern that doesn't exist.

**2. `TableRenderer.tsx` has no path to the panel/panelId/columnWidths it needs — and no task
accounts for wiring it in.**

`frontend/src/features/panels/ui/renderers/TableRenderer.tsx` (read in full) takes only
`rawRows`/`headers`/`paginationRows`/pagination flags — no `panel`, no `panelId`, no `config`. Its
sole call site, `PanelContent.tsx` line 93-104, does not pass any of these either. Compare to
sibling renderers on the same dispatcher (`DividerRenderer`, `MarkdownRenderer`, `ImageRenderer`),
which all receive the full typed `panel` object from `PanelContent.tsx` — establishing that the
natural fix is to extend `TableRendererProps` with `panel`/`panelId`+`config.columnWidths` and
update the `PanelContent.tsx` call site to pass it through.

Neither proposal.md's Impact list, design.md's Decisions, nor tasks.md's task list mentions
`PanelContent.tsx` at all, or that `TableRendererProps` needs a new prop for the panel id/config.
Task 3.4 ("In `TableRenderer.tsx`, pass the panel's `config.columnWidths` into `DataGrid`...")
reads as though `TableRenderer` already has access to this data — it does not. An implementer
following the task list literally will hit this gap mid-implementation with no guidance on the
correct approach (prop vs. Redux lookup vs. context), risking an ad hoc solution that diverges from
the established sibling-renderer pattern.

### Verdict: REFUTE

### Change Requests

1. **Fix the persistence-timing grounding.** Revise design.md's Decisions (and proposal.md/tasks.md
   accordingly) to stop claiming column-width persistence "mirrors" an existing 250ms debounce on
   `PanelGrid`'s layout persistence — no such debounce exists (`usePanelGridSave.ts` uses a 30s
   auto-save interval + explicit flush points, not a debounce). Explicitly decide and document one
   of: (a) route column-width edits through the existing `pendingPanelUpdates`/auto-save-interval/
   `SaveStateIndicator` pipeline (and then explain how "widths persist across reload" is satisfied
   given up to a 30s window before a flush trigger fires), or (b) introduce a genuinely new,
   independent debounced PATCH for widths and justify why bypassing the existing save-state
   pipeline (and its "unsaved changes" UI indicator) is acceptable here when no other panel-field
   edit does this.
2. **Add the missing `TableRenderer`/`PanelContent` plumbing task.** Add an explicit task (and list
   `frontend/src/features/panels/ui/PanelContent.tsx` in proposal.md's Impact section) covering:
   extending `TableRendererProps` with the panel id and `config.columnWidths` (or the full `panel`
   object, matching the `DividerRenderer`/`MarkdownRenderer`/`ImageRenderer` precedent), and updating
   `PanelContent.tsx`'s `<TableRenderer>` call site (currently line 95-102) to pass it through.
   Without this, task 3.4 as written is not actually actionable against current code.

### Non-blocking notes

- `TablePanelConfig.Patch.isEmpty` (`dataTypeId.isEmpty && fieldMapping.isEmpty`) is currently
  unused anywhere in the backend (`grep` for call sites found none) — dead code today, so not
  extending it to include `columnWidths` is functionally inert, but for consistency with "follow
  the exact `fieldMapping` pattern," task 1.2 should still fold `columnWidths` into `isEmpty`.
- `PanelCreationPreview.tsx` renders a placeholder `table`-type panel (`id: "preview"`) through the
  same `PanelContent`→`TableRenderer` path with no rows, which currently falls through to the
  aria-hidden skeleton branch (no `DataGrid`, no resize handles) — so the "preview panel with a
  fake id" edge case is naturally inert today, but worth a one-line confirmation in design.md/tasks
  that this path is not expected to call `updatePanelColumnWidths` with `panelId: "preview"`.
