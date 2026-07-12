## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **Round-1 finding #1 (false debounce-mirroring claim) — fixed.**
   design.md's "Persistence timing" decision now correctly states there is **no** debounce on
   `PanelGrid`'s layout persistence, only a 30s auto-save interval. Re-verified directly:
   `frontend/src/features/panels/.../usePanelGridSave.ts:24` — `const AUTO_SAVE_INTERVAL_MS =
   30_000;`, used via `setInterval(flushAll, AUTO_SAVE_INTERVAL_MS)` (lines 140/145/166). No
   debounce anywhere in that file. proposal.md and tasks.md are consistent with this corrected
   understanding.

2. **ComputedFieldForm.tsx debounce-pattern citation — accurate.**
   Read `frontend/src/features/pipelines/ui/ComputedFieldForm.tsx:26,28-42`: a
   `useRef<ReturnType<typeof setTimeout> | null>(null)` cleared/reset inside a `useEffect`, firing
   after `setTimeout(..., 400)`. This is exactly the ref+setTimeout, 400ms idiom design.md/tasks.md
   cite as precedent for `TableRenderer`'s new debounce. Claim is accurate, not fabricated.

3. **"Existing precedent for direct config-field PATCH" claim — accurate.**
   Read `frontend/src/features/panels/services/panelService.ts` in full.
   `updatePanelBinding` (line 94), `updatePanelContent` (113), `updatePanelImage` (119),
   `updatePanelDivider` (129) each call `httpClient.patch(\`/api/panels/${panelId}\`, { config })`
   directly and immediately — no debounce, no batching, no routing through `usePanelGridSave`'s
   flush pipeline. This supports the design's claim that a new `updatePanelColumnWidths` following
   the same immediate-PATCH shape (just wrapped in a *local* debounce in the caller) is consistent
   with existing precedent, not a novel mechanism.

4. **Round-1 finding #2 (TableRendererProps/PanelContent gap) — now correctly scoped and still
   accurate against current code.**
   Read `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:4-21` — `TableRendererProps`
   today has `rawRows`/`headers`/`paginationRows`/`paginationHasMore`/`paginationIsLoadingMore`/
   `onLoadMore` only; no `panel`/`panelId`/`config`, confirming design.md's characterization.
   Read `PanelContent.tsx:93-104` — the `isTablePanel(panel)` branch passes none of `panel.id` or
   `panel.config.columnWidths`. Tasks 3.4/3.5 (extend `TableRendererProps` with `panelId` +
   `columnWidths`, update the call site, wire `onColumnResize` with the debounce) are directly
   actionable against this exact code — no further gap.

5. **Backend `fieldMapping` pattern — re-confirmed exact.**
   Read `backend/src/main/scala/com/helio/domain/panels/TablePanel.scala` in full.
   `TablePanelConfig(dataTypeId, fieldMapping)`, `Empty` default, `decode`/`Patch.decode` with
   `Option[Option[X]]` absent-vs-null convention, `applyPatch` folding via `.fold(...)(_.getOrElse(...))`
   — the new `columnWidths: Map[String, Int]` field described in design.md/tasks 1.1-1.3 would
   slot into this pattern exactly as claimed.

6. **`schemas/panel.schema.json` `TableConfig` — re-confirmed.**
   `TableConfig` def (lines 75-82) has `additionalProperties: false` and only `dataTypeId`/
   `fieldMapping` today — task 1.4's planned `columnWidths` addition is accurate and necessary.

7. **`DataGrid` consumers/variant gating — re-confirmed, six consumers.**
   `grep` for `DataGrid` usage: `TypeDetailPanel.tsx` (preview), `StepCard.tsx` (preview),
   `SourceDetailPanel.tsx` (preview), `SqlTab.tsx` (preview), `PipelinePreviewModal.tsx` (preview),
   `TableRenderer.tsx` (full, ×2 render paths). `grep` for `resize|columnWidth|colWidth` in
   `DataGrid.tsx`/`.css` returns nothing — column resize is genuinely net-new, matching the
   proposal's characterization.

8. **`PanelGrid` handle isolation — re-confirmed.**
   `PanelGrid.tsx:226` — `dragConfig={{ handle: ".panel-grid-card__handle" }}` (a `handle`
   selector, not `cancel`), and `.react-resizable-handle` used for corner-resize (line 154,
   `import "react-resizable/css/styles.css"`). A distinct `.ui-data-grid__resize-handle` inside
   `DataGrid`'s `<thead>` plus `stopPropagation` (per design.md's "defense-in-depth" decision) is
   structurally isolated from both, as claimed.

9. **HEL-255 scope boundary text** — unchanged from round 1 (still records the human-decision
   override of HEL-252's earlier note); no regression introduced by the edits.

10. **Frontend `TablePanelConfig`/`emptyTableConfig`/`buildBindingPatch`** — read
    `panel.ts:103-106` and `panelPayloads.ts:106-155`. Current frontend type/patch-builder shapes
    match what tasks 3.1-3.2 describe extending; the "separate `buildTableWidthsPatch`, not folded
    into `buildBindingPatch`" decision is consistent with the existing one-builder-per-concern
    pattern already used for content/image/divider patches.

11. **Specs (`data-grid/spec.md`, `table-panel-column-widths/spec.md`)** — read in full. Scenarios
    map 1:1 onto the Goals/Non-Goals and DoD in ticket.md (drag-resize full-variant-only, 60px min,
    independent-column resize, debounce+persist, no dataTypeId/fieldMapping clobber, reload
    persistence). No contradictions with design.md/tasks.md found.

12. **Tasks 4.1-4.5** — cover the DataGrid unit behaviors, TableRenderer load/debounce behavior, a
    propagation-isolation test, backend Patch cases, and an explicit live-verification step for the
    drag/persist/reload loop — appropriately mapped to the spec scenarios and to the ticket's
    explicit propagation-isolation callout.

No placeholders, TBDs, or deferred decisions found in any artifact. No scope drift — Non-Goals and
Impact list stay within ticket.md's DoD plus the explicitly-recorded HEL-255 boundary. No AC left
uncovered by tasks.

### Verdict: CONFIRM

Both round-1 change requests are fully and accurately resolved, verified against fresh reads of the
actual source files (not the prior report's narrative). No new issues surfaced on a full artifact
re-read.

### Non-blocking notes

- `TablePanelConfig.Patch.isEmpty` (`TablePanel.scala:39`) will need `columnWidths.isEmpty` added
  when task 1.2 lands, or a patch containing only `columnWidths` could be mis-treated as "empty" by
  any caller relying on `isEmpty` — worth a one-line check during implementation/review even though
  tasks.md doesn't call it out by line number. Not blocking the design gate since task 1.2/1.3 already
  cover "fold the same way fieldMapping is folded," which implies updating `isEmpty` too, but flagging
  for the executor's attention.
