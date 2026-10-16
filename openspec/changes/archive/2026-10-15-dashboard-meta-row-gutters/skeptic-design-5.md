## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD 82c96e7905511fb86a732f7eb32b428473fd9ebf. The revised artifacts are uncommitted working-tree edits (`git status`: design.md, proposal.md, tasks.md and two spec deltas modified; chat-quick-launcher and panel-save-state-indicator deltas untracked), so I read them from the working tree.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/dashboard-meta-row-gutters/HEL-1576`.
- **r4 CR1 (tidy persistence) is resolved in the design and is mechanically sound.**
  - In `layoutHistorySlice.ts`, `undoLayout`/`redoLayout` set `applied` and bump `revision`, and `pushLayoutSnapshot` does neither.
  - `useLayoutSave.ts` computes `isHistoryTraversal = revisionChanged && appliedRef.current !== null && areDashboardLayoutsEqual(layout, appliedRef.current)`.
  - D8's `recordLayoutTidy` (push `before`, clear `future`, `applied = after`, `revision += 1`) followed by `setDashboardLayoutLocally(after)` is the same two-dispatch shape `applyTraversal` uses in `layoutHistoryThunks.ts`, so a tidy lands in class 2 (pending, PATCHed on flush).
  - Task 4.2 requires the PATCH test to go through the real `useLayoutSave`, shown red with `pushLayoutSnapshot` + `setDashboardLayoutLocally`, and requires the classification comment to be updated.
- **r4 CR3 (borderless chrome) is resolved.**
  - `App.css:203-210` strips `border-color` from `.cmd-btn`, `.ui-icon-btn` and `.actions-menu__trigger` (plus their `:hover`) under `.app-command-bar`.
  - `.cmd-btn--primary` exists at `App.css:262` (accent background, `--app-accent-ink`).
  - `IconButton` has a `variant` prop (`shared/ui/IconButton.tsx:26`).
  - D3 now makes every non-primary control borderless and Add panel `.cmd-btn--primary`, and records the departure from the board.
- **r4 non-blocking notes are applied.**
  - D10b covers the `.undo-redo-btn` phone hide list (confirmed at `App.css:468`), the F-186 comment (`App.css:315`), the CommandBar doc comment, and folding `showTabBar` into the one predicate.
  - D4 lists the drag/resize Escape guard.
  - C3 no longer has the duplicated sentence.
- **r4 CR2 (which layout tidy runs on) is resolved in design.md D8 and tasks 4.1/4.2, but NOT in the spec delta.**
  - `specs/dashboard-layout-edit-toggle/spec.md:39` still says tidy "SHALL move every panel of the dashboard upward, at every breakpoint" and "SHALL be disabled when no breakpoint has a gap".
  - Its scenario "Nothing to tidy" ties disabled to "every breakpoint is already compact".
  - D8 deliberately does something narrower:
    - An unauthored breakpoint is left byte-identical.
    - In a partial breakpoint only the stored entries move. The derived panels are placed by `resolveDashboardLayout`'s `placeAround(anchors, derived)` at the first free row at or below their own scaled y (`breakpointLayout.ts:74-89`), so they are never compacted.
    - "Nothing to tidy" means "no authored entry would move".
  - So on a partial breakpoint with a gap above a derived panel, D8 disables Tidy, while the spec's scenario says a non-compact breakpoint enables it and every panel moves. The design and the binding spec contradict each other on the exact point CR2 was about. See CR1.
- **Stale layout entries are not a live hazard for the "authored layout" choice.**
  - `resolveDashboardLayout`'s `liveEntries` ignores entries whose panel is not live, so I checked whether the store can carry such entries.
  - Migrations `V122__strip_deleted_panel_layout_items.sql` and `V123__strip_existing_ghost_layout_items.sql` exist.
  - A read-only dev DB query over all 2726 dashboards found 0 with an `lg` entry naming a panel not on that dashboard.
  - The only transient case left is items for panels this tab has not loaded yet (HEL-1457). See note 2.
- **AC4 demo target.** "Helio Roadmap (copy)" (`e44e7c57-…`): 5 live panels, 5 `lg` items, 0 stale. So the gap there is authored and a complete-breakpoint tidy will close it. Both "Workouts" dashboards in the dev DB have 0 panels, so D8's plan to build a form-panel-above-a-gap dashboard is the right call.
- **AC coverage.**
  - AC1: D1, D3, D9.
  - AC2: D5, tasks 3.2/3.3.
  - AC3: D7, tasks 1.x (done).
  - AC4: D8, tasks 4.x, C1.
  - No uncovered AC, and no scope beyond the ACs and the owner answers (D0).

### Verdict: REFUTE

The three round-4 change requests are addressed in design.md and tasks.md, and the mechanisms they name are real in the code. One contradiction remains: the binding spec delta for tidy still describes the pre-CR2 behaviour. An executor building to D8 would fail the spec's own scenario. An executor building to the spec would write derived positions into partial breakpoints, which is what CR2 forbade. Neither reading is safe, so the artifacts must agree before execution.

### Change Requests

1. **Align `specs/dashboard-layout-edit-toggle/spec.md:39` and its "Nothing to tidy" scenario with D8.**
   - Restate the requirement so tidy moves upward each panel that has a stored position at an authored breakpoint. It leaves an unauthored breakpoint unchanged, and in a partial breakpoint it moves only the stored entries and adds none.
   - Restate the disabled condition as "no stored entry would move" instead of "no breakpoint has a gap".
   - Add scenarios for an unauthored breakpoint (byte-identical after tidy) and a partial breakpoint (stored entries compacted, no entry added for an unanchored panel).
   - Keep the ⌘Z, open-without-write and C1 scenarios as they are.
   - If the lane would rather have the spec's broader "every panel at every breakpoint" behaviour, change D8 and tasks 4.1/4.2 instead. In that case it must say how a partial breakpoint is handled without materializing derived positions. Either way, the spec, D8 and task 4.1's unit cases must describe one behaviour.

### Non-blocking notes

1. **Reuse `compactLayout` rather than writing a second compactor.**
   - `features/dashboards/state/breakpointLayout.ts:115` `compactLayout(items, cols)` already does what D8's `tidyLayout` describes: x/w/h kept, smallest non-colliding y, reading order, run to a fixpoint, with a property test for idempotence in `breakpointLayout.test.ts`.
   - `tidyLayout` should be a thin per-breakpoint wrapper that adds the authored/partial/unauthored rule and "would anything move", delegating the geometry to `compactLayout`.
   - Task 4.1's red-first should then mutate the wrapper's rule (for example, compact an unauthored breakpoint), not re-prove the geometry.
   - D8's phrase "relative order is preserved" is only true up to equal-y ties, which `compactLayout` orders by x. The spec's "top-to-bottom order" wording is accurate; don't over-claim in tests.
2. **Items for panels this tab has not loaded.**
   - The drag path (`useGridLayoutInteraction.ts:104-108`, HEL-1457) keeps stored items of non-loaded panels verbatim and excludes them from the rebuilt breakpoint.
   - Tidy should do the same: compact the live/loaded entries, append non-loaded ones unchanged, and use the same live-entry basis the resolver uses (`liveEntries`) when deciding unauthored/partial and "would anything move".
   - Otherwise an invisible item can block a visible gap from closing, or enable a click that changes nothing visible.
3. **"The chrome's pressed wash" (D3) is not an existing named recipe.**
   - No `[aria-pressed]` rule exists in `App.css`.
   - The precedents are `DashboardList.css:508` (accent-dim, which D3 rules out because it is accent) and the accent-text toggles.
   - Name the neutral token used for Done's pressed state (for example `--app-surface-soft`, the ghost hover wash in DESIGN.md §5) in ui-decisions.md so the executor does not invent one.
4. Task 5.4's list of ui-decisions entries should explicitly include D8's authored-layout rule and D3's borderless-Share departure. Both are promised "recorded in ui-decisions.md" in the design but are missing from the task's enumeration.
