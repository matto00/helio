## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Root-cause claim (hook split by width).** Read `frontend/src/features/panels/hooks/usePanelGridSave.ts` in
   full: the 30s interval (lines 147-155), `flushPanelUpdates`/`flushAll` (117-135), `registerFlush` wiring
   (172-177), and the layout refs/`persistLayout` (54-115, 182-194) are all one hook. Confirmed it is called
   exactly once, only from `DesktopPanelGrid.tsx:94-98`. Confirmed `PanelGrid.tsx` branches on
   `width < panelGridConfig.breakpoints.sm` (line 59) and mounts either `MobilePanelStack` or `DesktopPanelGrid` —
   never both — so the flush hook genuinely never mounts below 768px. Matches design.md's root-cause paragraph.

2. **Producer is width-independent (the actual bug mechanism).** `MobilePanelStack.tsx` imports and renders
   `PanelDetailModal` (lines 22, 124), and `PanelDetailModal.tsx:handleEditSubmit` (lines 205-233) always dispatches
   `accumulatePanelUpdate` for appearance/title regardless of panel kind. Since the modal mounts in both shells but
   the flush lives only in `DesktopPanelGrid`, an edit staged below 768px genuinely has no flush path. This is the
   literal repro and it is grounded, not asserted.

3. **Unmount-strand claim (consequence 3 / resize mid-edit).** Re-read the interval effect cleanup in
   `usePanelGridSave.ts:146-155`: on unmount it only `clearInterval`s — it never calls `flushPanelUpdates`. So an
   edit staged at desktop width that is still pending when the container crosses below 768px (unmounting
   `DesktopPanelGrid`) is stranded with no owner. This directly substantiates the design's argument that remedy (b)
   alone (affordance removal only) **cannot** close the bug, because this strand occurs entirely on the desktop
   side of the boundary — removing mobile edit affordances does nothing for it. The (a)-over-(b) decision is
   evidence-backed, not hand-waved.

4. **SaveStateIndicator visible-but-dead claim.** `App.tsx:327-329` renders `<SaveStateIndicator onSaveNow={flush}/>`
   unconditionally for any dashboard view; `App.css`'s `@media (max-width: 768px)` block (lines 366-405) hides
   `.app-command-bar__breadcrumb`, `.undo-redo-btn`, `.dashboard-appearance-editor`, and the sidebar, but not the
   save-state indicator. Confirms design.md's claim #2 exactly.

5. **HEL-301 test that becomes obsolete.** `PanelGrid.test.tsx:462-474` ("does not register a save-flush handle...")
   asserts `flushAndReset()` is a no-op at phone width — this assumption breaks under remedy (a) and the design/
   tasks explicitly plan to rewrite it (design "Risks", task 3.4). Confirmed the test exists as described.

6. **Mutation-path audit — spot-checked every row against code, not just trusted the table:**
   - Row 1 (appearance, all kinds incl. collection) — confirmed via `PanelDetailModal.tsx:212-224`, unconditional
     on panel type.
   - Row 2 (inline title edit) — confirmed desktop-only (`DesktopPanelGrid.tsx` `handleStartEdit`/`commitTitleEdit`,
     lines 102-153); `MobilePanelStack.tsx` has no such affordance.
   - Row 5 (column widths) — `TableRenderer.tsx:118` dispatches `updatePanelColumnWidths` (immediate thunk,
     `panelThunks.ts:261`), independent of the accumulator; renders inside `PanelCardBody`, reachable from both
     shells. Correctly marked "unchanged."
   - Row 6 (subtype editors incl. collection) — spot-checked `CollectionEditor.tsx:108-152`
     (`updatePanelCollection` immediate thunk, backed by `V57__panel_collection_options.sql`, confirmed present),
     plus `ImageEditor.tsx:90`, `MarkdownEditor.tsx:81`, `DividerEditor.tsx:56`, `TextContentEditor.tsx:86` — all
     dispatch immediate typed thunks via the editor's `save()` ref, not `accumulatePanelUpdate`. The audit is
     internally consistent (appearance staged/batched vs. subtype-data immediate) — not contradictory.
   - Row 8 (mobile browsing zero-layout-PATCH / HEL-301) — `MobilePanelStack.tsx` header comment and imports
     confirm it never imports `usePanelGridSave` or dispatches `updateDashboardLayout`/`setLayoutPending`.

7. **Hazard doc / decision-4 grep claim.** `notes/mobile-pwa-handoff.md` §4.1 exists and describes exactly the
   layout-PATCH hazard the design preserves. Grepped `PanelGridHandle` repo-wide — only 3 files reference it
   (`DesktopPanelGrid.tsx`, `PanelGrid.tsx`, `PanelGrid.test.tsx`), confirming decision 4's "no external consumers"
   claim.

8. **Breakpoints / ports.** `panelGridConfig.ts:29` confirms `sm: 768`. `DESIGN.md:152` confirms canonical
   breakpoints `1440 / 1100 / 768 / 430`, matching the plan's stated bar. `workflow-state.md` ports (5477/8384)
   match design.md's stated ports.

9. **Scope discipline.** Proposal/design explicitly carve out affordance removal and styling polish as HEL-303's
   non-goal; ticket's own text agrees ("(b) overlaps with HEL-303's intent" / directive 1). No scope drift observed.

10. **Iron Law gating.** Tasks section 1 (four probe tasks) is sequenced strictly before section 2
    (implementation), and design Decision 3 explicitly makes the layout-mid-edit-resize fix conditional on live
    probe evidence (not asserted in advance) — this is genuine probe-then-fix sequencing, not a rubber-stamped
    root cause.

11. **No placeholders/TBDs.** Grepped all planning artifacts and specs for `TODO|TBD|figure out|placeholder` —
    zero hits.

### Verdict: CONFIRM

### Non-blocking notes
- Design.md's Decision 3 leaves a real branch point (guarded unmount-flush vs. document-the-edge) to be resolved
  by live probe evidence during execution — this is appropriate given the Iron Law, but the evaluator/skeptic at
  the final gate should confirm the executor's probe evidence (network log / test) actually drove whichever branch
  was taken, rather than accepting an assertion.
- Task 2.6's "trivial style debt... ONLY in files already edited" scope is a reasonable guardrail; final-gate
  review should confirm no drive-by files were touched beyond `usePanelGridSave.ts`'s successors, `PanelGrid.tsx`,
  `DesktopPanelGrid.tsx`, `MobilePanelStack.tsx`, and their tests.
