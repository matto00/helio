## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: main d8cdfb460f65d130af533770aeadc798dbe30daf (the change dir is untracked, planning only).
Artifacts read: ticket.md (including the Owner rulings), proposal.md, design.md, tasks.md, specs/dashboard-grantee-access/spec.md, workflow-state.md.

### What I verified (with evidence)

- **The palette already drops "New panel" for a viewer: TRUE.** `useCreatePanelAction.tsx:28-34` sets `disabled = selectedDashboardId === null || !canEdit` from `selectCanEditDashboard`. `builtInActions.ts:145` (`if (!panel.cta.disabled)`) omits `create.panel` when it is disabled. The palette registrants are `BuiltInCommandActions` (nav.*, theme.toggle, assistant.open, help.shortcuts) and `CreateCommandActions` (create.dashboard/source/pipeline/panel). Only `create.panel` edits the open dashboard. D3's "no code change expected" holds.
- **A viewer cannot enter layout edit mode: TRUE.** The only writers of `setEditingLayoutDashboardId(<id>)` are `DashboardMetaRow.tsx:118` (the toggle sits behind `canEdit && gridIsMovable`, lines 177-199). The other writers set null (`DesktopPanelGrid.tsx:106`, `useLayoutEditEscape.ts:42`). The state is keyed per dashboard (`selectIsEditingLayout(dashboardId)`), so edit mode on an owned dashboard does not carry over to a shared one. `DesktopPanelGrid.tsx:97` also ANDs it with `canEditPanels`.
- **`useLayoutUndoRedo` has no role check: TRUE** (`features/layout/hooks/useLayoutUndoRedo.ts`, `when: dashboardId !== null` only). It is mounted by `DashboardMetaRow` and `CommandBar`. Layout history is pushed only by `pushLayoutSnapshot` in `useGridLayoutInteraction.ts:67,85` (drag/resize stop, which needs edit mode). So today a viewer normally has empty history, and the thunk returns false without calling `preventDefault`. See CR2.
- **The quick launcher is the assistant: TRUE.** `shortcuts.ts:45` `quick-launcher` is "Open the assistant quick-launcher" (⌘J), and `QuickLauncherOverlay` lives in `features/assistant`.
- **D6 and the tabs files: sound, with no edit to `features/dashboards/tabs/**`.**
  - `hydrateTabs.ts:148,194` pass `state.dashboards.selectedDashboardId` as `autoSelectedId`.
  - `planHydration` (lines 69-83) turns a non-null auto-selection into the only tab when no tabs are saved. Changing `getMostRecentDashboardId` alone therefore makes the shared dashboard the first tab.
  - The selection listener (`dashboardTabsListeners.ts:66-70`) turns `next === null` into `clearActiveTab()`, which keeps the tabs and clears `activeId` (`dashboardTabsSlice.ts:115`). The "Build your own" path works as described.
  - Side effect (acceptable): after a reload, `planHydration`'s "saved tabs survive but none active" branch reopens the shared tab, so the drop-zone state does not survive a reload.
  - Refetch risk: the only `fetchDashboards` dispatches are `App.tsx:166` (mount) and `useResourceIndexing.ts:77` (palette open, only when status is idle or failed). The D6 risk is real only on a failed-then-retried list, and probing it is the right call.
  - Server order: `findAllVisiblePaged` sorts `(lastUpdated.desc, id.asc)` over owned and shared together, so "first item = most recent shared" holds.
- **HEL-1646 fixed slot for the phone line: sound.**
  - `DashboardRefreshLine` mounts whenever `selectedDashboardId` is set (`PanelList.tsx:328`), skeleton included.
  - `accessRole` comes from the list route (`DashboardRoutes.scala:46`) before any panels load.
  - The line has a fixed height (`DashboardMetaRow.css` `.dashboard-refresh-line { height: calc(var(--text-xs) * 1.6) }`), and its text span ellipsis-clips.
  - A viewer line that is always present is therefore constant per dashboard. It also removes the late-appearance shift a viewer on a non-pipeline-fed dashboard could otherwise hit.
- **Desktop tier-3 survival: sound.** `.dashboard-meta-row__facts` is `flex-wrap` with a one-line clip, so it drops facts last-first. A first child always survives `countOnly`.
- **Badge CSS claims: TRUE.** `.dashboard-list__shared-badge` (`DashboardList.css:559`) and `.home-card__shared` (`HomePage.css:196`) are byte-equivalent. `.dashboard-chip__shared` (`DashboardChipRow.css:59`) is plain 0.7-opacity mono. The active chip is inverted ink (`--app-text` background).
- **Onboarding interplay: no conflict.** `useOnboardingHost` auto-activates only for an EMPTY list, so a shared-only user does not get the checklist over their auto-opened shared dashboard.
- **Viewer-reachable panel CTAs: only "Run pipeline" exists, and it is already gated.** "Not run yet" → `onGoToPipeline` is passed only when `canUseOutputRoutes` (`PanelDetailModal.tsx:254`). D4's audit list omits "Not run yet" and the insight "Not yet rendered" refresh action. The executor's re-grep covers this; see the notes.
- **Spec delta vs main spec: consistent.** The MODIFIED "Owner semantics…" requirement keeps the original scenario and adds the shared-only one, as owner ruling 1 directs.
- **Palette scope (driver call): I agree.** The AC says "entries that edit" are absent. New dashboard/source/pipeline create the caller's own resources and edit nothing they view. Hiding them would also work against owner ruling 2, which encourages a shared-only user to build their own.
- **Accent on the "Shared" chip badge: accepted.** D1 calls "View only" status and keeps it neutral, while D5 puts "Shared" (also status) on `--app-accent-dim`. That reads as inconsistent, but the AC requires the chip marker to *match* the sidebar and Home badges, which already use the accent. The precedent is pre-existing and bound by the AC.

### Verdict: REFUTE

The design is substantially sound. Every load-bearing claim I was asked to verify checked out against the tree. Three specific revisions are needed: one visual ambiguity that would otherwise surface as a final-gate REFUTE, and two test specs that as written allow a vacuous red.

### Change Requests

1. **D1: make the "View only" visual recipe specific and self-consistent, on both surfaces.**
   - As written it is a "small text badge" with "the same quiet neutral treatment as the other meta facts", but at "micro size".
   - The other meta facts are `--text-xs` (`.dashboard-meta-row__left` in `DashboardMetaRow.css`), not `--text-micro`. "Badge" does not say whether there is a background or pill.
   - The desktop gets an `Eye` icon and the phone gets plain text.
   - A competent implementer can read this at least two ways: a plain xs fact with an icon, or a micro uppercase pill. Revise D1 to state exactly:
     - (a) font size token, case and tracking;
     - (b) background or border, or explicitly none;
     - (c) whether the icon appears on desktop, on phone, or both, with the reason for any difference;
     - (d) on the phone, that "View only" must NOT sit inside the `aria-hidden` reserved text span (`DashboardRefreshLine.tsx:90`). Today the reserved state hides the whole text slot from assistive tech, and a viewer on a pipeline-fed dashboard before the fact resolves would lose the indicator for screen readers.
2. **D8/D2: specify that the `useLayoutUndoRedo` viewer test seeds layout history for the viewer's dashboard** (dispatch `pushLayoutSnapshot` for that id) before pressing ⌘Z/⌘⇧Z, and asserts both that `defaultPrevented` is false and that the layout is unchanged.
   - Without seeded history, current main already returns false from `applyLayoutUndo` and never calls `preventDefault`. A test of "⌘Z is not prevented" would then pass before the change, which is a vacuous red.
   - The "revert the `when` guard" mutation in D8 would also stay green.
   - Mid-session role downgrade (editor→viewer with history kept) is the real case the guard covers; name it.
3. **D8: name the existing test this change deliberately inverts.**
   - `frontend/src/features/dashboards/state/dashboardsSlice.accessRole.test.ts:46`, "selects nothing when every listed dashboard is shared, yet keeps them listed", asserts the pre-ruling behaviour.
   - State that it is rewritten to the owner-ruling-1 expectation, cited in the test name or comment, rather than edited quietly. Also state that `PanelList.test.tsx:313` ("No dashboard open", whose fixture item has no `accessRole` and counts as owned) is expected to stay green unchanged, as the owner control.

### Non-blocking notes

- D5: the reason "DESIGN.md does not require" a shared class is arguable. DESIGN.md §6 says "do not hand-roll equivalents". These are radius-sm micro badges, not the `StatusChip` pill, though, and two copies already exist. A third copy is acceptable with the equality test. A shared class would be the cleaner follow-up.
- D4's audit list should add the "Not run yet" state (already gated through `canUseOutputRoutes`) and the insight "Not yet rendered" refresh action (owner/editor only per HEL-1743), so the recorded audit is complete.
- D6: the PanelList drop zone needs the same `onStepByStep` wiring as the zero-dashboard branch (`setStepByStep(true)` + `reopenOnboarding()`), and the `!stepByStep` guard, so "step by step" does not render the drop zone and the checklist together.
- D6: the drop-zone state does not survive a reload, because the persisted `{tabs:[shared], activeId:null}` is reopened by `planHydration`. That is consistent with the tabs model and not a defect. Do not "fix" it from the slice.
- C16 will also hit `hel1646-skeleton-refresh-slot`, `hel1583-refresh-line-no-shift`, `hel1786-shared-dashboard-freshness` and `support/hel1583-glass-nav.ts`, not only the two specs named in tasks 5.2.
