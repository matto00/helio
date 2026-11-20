## Context

See proposal.md for the motivation. HEL-1773 put the role plumbing in place:
- `features/dashboards/state/dashboardAccess.ts`: `selectCanEditDashboard`, `selectIsDashboardOwner`, `selectOwnedDashboards`, `isSharedDashboard`.
- The gating that already exists (verified against main d8cdfb460):
  - The meta row hides layout edit, Add panel, appearance and Share from a viewer (`DashboardMetaRow.tsx`).
  - `useCreatePanelAction` reports `disabled` for a viewer, so `buildCreateActions` (`commandPalette/model/builtInActions.ts`) already drops "Add panel" from the palette.
  - PanelList's zero-panel empty state has a viewer branch with no CTA.
  - The phone sheet hides Share on non-owned rows (`MobileShell.tsx`).
  - The quick launcher (⌘J) is the assistant, which HEL-1785 made read-only for viewers.

What remains open:
- `useLayoutUndoRedo` has no role check. It is mounted by `DashboardMetaRow` (desktop rail shell) and `CommandBar` (phone shell).
- There is no "View only" indicator.
- The phone chip's "Shared" marker is plain 0.7-opacity mono text (`DashboardChipRow.css` `.dashboard-chip__shared`). The sidebar badge (`.dashboard-list__shared-badge`) and the Home badge (`.home-card__shared`) are the same accent-dim pill as each other.
- A shared-only user lands on "No dashboard open". Auto-open (`getMostRecentDashboardId`) only picks owned dashboards, and Home's drop zone needs an empty list.

Owner rulings (ticket.md, "Owner rulings"):
1. Auto-open the most recent shared dashboard when the user owns none.
2. Offer the drop zone on Home and on /dashboards. On /dashboards it is reached through a "Build your own dashboard" row in the sidebar and the phone sheet.

## Goals / Non-Goals

**Goals:** every AC in ticket.md, frontend only, each behaviour locked by a test that fails without the change.

**Non-Goals:**
- No backend change and no new server role semantics.
- No change to the tab bar, the tabs hydration/listener files, the warm cache or `usePanelData` (sibling HEL-1783), or to the CI workflows and shard weights (HEL-1778).
- No new copy for the drop zone itself. It is reused unchanged ("Build your first dashboard").
- No change to the help overlay's shortcut list. It is a reference of bindings, not an action.

## Decisions

### D1. "View only" indicator

- **One recipe, both surfaces.** "View only" is a plain meta fact, not a pill:
  - (a) Type: inherits the meta text it sits in. `--font-mono`, `--text-xs`, `--app-text-muted`, sentence case "View only", no letter-spacing change, no uppercase. These are the existing values of `.dashboard-meta-row__left` and `.dashboard-refresh-line__text`, so no new token or size is introduced.
  - (b) No background, no border, no radius. It is status, and DESIGN.md §0 accent discipline keeps the accent for interactive and active elements. A pill would also compete with the "Shared" badge.
  - (c) Icon: a lucide `Eye` at `ICON_SIZE.sm` (14px) before the text on BOTH surfaces, `aria-hidden="true"`, with `gap: var(--space-1)`. The phone line's fixed height is `calc(var(--text-xs) * 1.6)`, at least 19px, so a 14px icon fits without changing it. The executor confirms on the running app that the line height is unchanged.
  - (d) Accessibility: the text is real, visible and NOT inside any `aria-hidden` element.
- **Desktop:** the first child of `DashboardMetaFacts`'s left group (`.dashboard-meta-row__facts`), rendered when `selectDashboardAccessRole(state, id) === "viewer"`. Because it is the first child, the facts row's last-first clipping keeps it at every tier, including tier 3 `countOnly`.
- **Phone:** in `DashboardRefreshLine`, for a viewer, the line always renders from first paint. Its text slot holds a `View only` element followed by the refresh fact when there is one, separated by " · ".
  - Today's reserved state (`DashboardRefreshLine.tsx:90`) puts `aria-hidden="true"` on the whole text span. For a viewer the `aria-hidden` moves to an inner empty placeholder, never the "View only" element, so assistive tech reads "View only" even before the fact resolves.
  - Owner and editor lines are unchanged.
  - HEL-1646's fixed-slot rule: the line must not appear, vanish or change height after first paint. The role arrives with the dashboards list before panels load, and the line has a fixed height, so a viewer's line is constant for the life of the view.
- **Alternative rejected:** a banner above the grid. It costs vertical space on every visit, and the meta row already carries per-dashboard status.

### D2. Edit shortcuts inert

- `useLayoutUndoRedo` reads `selectCanEditDashboard(state, dashboardId)` and passes `when: dashboardId !== null && canEdit` to both `useShortcut` calls. With the shortcut off, the handler never runs and `preventDefault` is never called, so the browser keeps its default.
- **The case the guard covers.** Layout history is pushed only by a drag or resize stop in edit mode (`useGridLayoutInteraction.ts`), which a viewer cannot reach. A viewer therefore normally has empty history, and `applyLayoutUndo` already returns false. The real exposure is a caller who HAS history for the dashboard and is not allowed to edit it: an editor downgraded to viewer mid-session (the dashboards list refetches with `accessRole: "viewer"`) whose layout history for that id is still in the store. Without the guard, ⌘Z would apply a layout change locally and stage a save that the server refuses.
- **The test must seed history** (see D8), or it passes before the change.
- `useLayoutEditEscape` needs no change: a viewer cannot enter edit mode, because the edit toggle is hidden and `selectIsEditingLayout` is never set for them. A test asserts this for the viewer.
- **Alternative rejected:** gate inside the thunk. That leaves the shortcut "claimed", so a keystroke would be swallowed.

### D3. Palette

- No code change is expected. A component test registers the real `CreateCommandActions` with a viewer dashboard selected (asserts "Add panel" absent and "New dashboard" present) and with an editor dashboard selected (asserts "Add panel" present).
- The executor greps every `useCommandActions(` registrant for any other entry that edits the open dashboard. If one exists it is gated on `selectCanEditDashboard`.
- Global create entries stay, because they create the caller's own resources (driver-accepted call, judged by the gates).

### D4. Empty states and CTAs

- **Audit list** (the executor re-greps and records the result in `.concertino/scratch/HEL-1782/cta-audit.md`):
  - PanelList zero-panel: already gated.
  - Panel body states ("No data", "No data available", "Form not configured", "Only editors can submit this form"): neutral.
  - Meta row and kebab: gated.
  - Phone stack.
  - OutputPicker and DatasetStep CTAs: these live only in editors, which a viewer cannot open.
- Also on the list:
  - "Not run yet" → Run pipeline: already gated, because `onGoToPipeline` is passed only when `canUseOutputRoutes` (`PanelDetailModal.tsx:254`).
  - The insight "Not yet rendered" refresh action: owner/editor only (HEL-1743).
- Any CTA found that invites editing gets a viewer branch. The existing zero-panel viewer branch is locked by a test.

### D5. Phone sheet, chips, pull-to-refresh

- **Chip badge:** `.dashboard-chip__shared` takes the sidebar/Home badge treatment: `padding: 2px var(--space-2)`, `border-radius: var(--app-radius-sm)`, `background: var(--app-accent-dim)`, `color: var(--app-accent-text)`, mono, micro, medium weight, `0.08em`, uppercase, with no opacity.
  - The three rules are not merged into one shared class. That would be a cross-feature refactor, and DESIGN.md does not require it.
  - Each rule carries a comment naming the other two, and a CSS test asserts the three declarations are equal.
  - On the active chip (inverted ink background `--app-text`), accent-dim may lose contrast. `.dashboard-chip--active .dashboard-chip__shared` uses `background: var(--app-surface)` and `color: var(--app-text)`, the inverse pill, so it stays a badge of the same shape.
  - The evaluator checks contrast in both themes against the running app.
- **Sheet:**
  - The "Shared" subtitle stays as it is. It is a list-row secondary line, the same pattern as the palette recents, not a badge.
  - Share stays owner-only.
  - The editor case gets a test.
- **Pull-to-refresh:**
  - The executor verifies on the running app, as a viewer and as an editor on the phone shell, that a pull and the Refresh dashboard button refresh the panels. Each request must go through per-panel/grantee routes, with no `/api/outputs` or `/api/pipelines` request (the HEL-1773 e2e route guard pattern) and no error UI.
  - If it already works, the e2e assertion locks it. If not, it is fixed here.

### D6. Shared-only first run

- **Auto-open:** `getMostRecentDashboardId(items)` returns the first owned item. If none is owned, it returns the first item, which is the most recently updated shared dashboard, because the server sorts by `lastUpdated` desc. It is used by `fetchDashboards.fulfilled`, `deleteDashboard.fulfilled` and `dashboardRemoved`, so all three get the same rule.
  - The tabs hydration reads the reducer's auto-selection (`autoSelectedId`), so the shared dashboard becomes the only tab with no change to the tabs files.
- **Home:** `DashboardShelf` shows the shelf (shared cards with their badges) and then `FirstRunDropZone` below it when `status === "succeeded"` and the user owns no dashboard. The zero-dashboard case keeps its current drop-zone-only rendering. HomePage passes the owned count, or a `sharedOnly` flag, from `selectOwnedDashboards`.
- **/dashboards:** PanelList's `selectedDashboardId === null && dashboards.length > 0` branch renders `FirstRunDropZone` in place of the "No dashboard open" EmptyState when the user owns no dashboard. Owners keep "No dashboard open". This drop zone gets the same wiring as the zero-dashboard branch: `onStepByStep` sets `setStepByStep(true)` and calls `reopenOnboarding()`, and it is guarded by `!stepByStep`, so "Set up step by step" never renders the drop zone and the checklist together.
- **Sidebar and sheet entry:** the row is labelled "Build your own dashboard" with a `Plus`/`LayoutDashboard` icon.
  - Sidebar: a footer row in `DashboardList.tsx`'s dashboards list. Phone: an extra action row in the dashboards sheet (`usePickerSelection` exposes it, and `MobileNavSheet` renders it beside the create action).
  - It is rendered only while `selectOwnedDashboards(state).length === 0` and at least one dashboard is listed.
  - Choosing it navigates to `/dashboards` and dispatches `setSelectedDashboardId(null)`. The existing tabs listener turns that into `clearActiveTab()`, which is the same path as closing a tab. PanelList then shows the drop zone.
- **Risk:** a `fetchDashboards` refetch with `selectedDashboardId === null` re-runs the auto-select. The executor probes whether anything refetches the list while the user sits on the drop zone. If it does, the fix stays inside `dashboardsSlice.ts`: a null selection is preserved once the tabs are hydrated and the user chose it. It must not touch the tabs files.
- **Reload:** the drop-zone state does not survive a reload. `planHydration` reopens the most recently viewed saved tab when none is active. That is consistent with the tabs model and is NOT "fixed" from the slice. The spec requires the drop zone whenever a shared-only user has no dashboard open, not that the state persist.
- **Alternative rejected:** a new route such as `/dashboards/new`. The tabs model and HEL-1209's landing assume `/dashboards` and `/dashboards/:id` only.

### D7. Merge order with HEL-1783

The only shared file is `features/dashboards/state/dashboardsSlice.ts`. This change edits only `getMostRecentDashboardId`, plus the D6-risk guard if it turns out to be needed. If HEL-1783 merges first, this branch merges main and re-runs the slice tests. If this merges first, HEL-1783 does the same. Neither change depends on the other.

### D8. Tests (red first, committed before implementation)

- **Deliberately inverted and kept tests:**
  - `frontend/src/features/dashboards/state/dashboardsSlice.accessRole.test.ts:46` ("selects nothing when every listed dashboard is shared, yet keeps them listed") asserts the pre-ruling behaviour. It is REWRITTEN, not quietly edited, to "selects the most recently updated shared dashboard when none is owned (HEL-1782 owner ruling 1)", with the ruling cited in the test name and a comment.
  - `frontend/src/features/panels/ui/PanelList.test.tsx:313` ("No dashboard open", whose fixture item has no `accessRole` and so counts as owned) stays green UNCHANGED as the owner control.
- **useLayoutUndoRedo viewer test (D2):** the test first dispatches `pushLayoutSnapshot` for the viewer's dashboard id, with a layout differing from the current one. This models the downgraded editor. It then presses ⌘Z and ⌘⇧Z and asserts (i) `event.defaultPrevented === false` and (ii) the stored layout for that dashboard is unchanged. A companion editor test with the same seeded history asserts that undo IS applied, so the test is not vacuous. The "revert the `when` guard" mutation must turn (i) and (ii) red.
- **Jest**, written first and run red, with the red run committed (C12):
  - `DashboardMetaRow.roles.test.tsx`: View only for a viewer, absent for an editor and the owner, kept at tier 3.
  - `DashboardRefreshLine.test.tsx`: viewer line.
  - `useLayoutUndoRedo` test: a viewer's ⌘Z is not prevented and dispatches nothing.
  - A CreateCommandActions role test.
  - `dashboardsSlice.accessRole.test.ts`: shared-only landing, including after delete.
  - `DashboardShelf` test.
  - PanelList shared-only drop zone.
  - DashboardList and sheet entry rows (shown and hidden).
  - The chip CSS badge equality test.
- **Mutations:** one per behaviour, for example revert the `when` guard, drop the role check in `getMostRecentDashboardId`, or render the entry unconditionally. Each must turn the matching test red.
- **e2e:** a new `e2e/hel1782-viewer-shell.spec.ts`, built on the HEL-1773 spec's seeding pattern (a lane-private DB through `DATABASE_URL`).
  - Viewer desktop: View only shown; ⌘Z inert; palette with no Add panel.
  - Viewer phone: meta line View only; chip badge computed style equals the sidebar badge's; pull-to-refresh with no Output or pipeline request.
  - Editor phone: no View only; no Share in the sheet.
  - Shared-only user: auto-opens the shared dashboard; Home shows the drop zone; the sidebar entry shows the drop zone on /dashboards.
  - Owner control: no entry and no View only.
- **Further e2e hits to run in full** (C16; already found by the skeptic): `hel1646-skeleton-refresh-slot`, `hel1583-refresh-line-no-shift`, `hel1786-shared-dashboard-freshness`, and the specs using `e2e/support/hel1583-glass-nav.ts`, plus `hel1575-dashboard-tabs` and `hel1773-viewer-grantee-dashboard`. The executor's own grep is authoritative; this list is a floor.
- **Selector grep:** before the e2e run, grep `e2e/` for every altered selector (`.dashboard-chip__shared`, "No dashboard open", `.first-run-drop`, `.dashboard-refresh-line`, meta-facts classes). Known hit: `hel1575-dashboard-tabs.spec.ts:419` expects "No dashboard open" for an OWNER who closed every tab. That is unchanged, because owners keep the generic state. Run that spec in full.

## Risks / Trade-offs

- [The phone line now renders for a viewer even on a dashboard with no pipeline-fed panel] → this is intended. The fixed slot is still constant per dashboard, because the role does not change mid-view.
- [Accent-dim badge on the active inverted chip] → the inverse pill (D5), checked in both themes on the running app.
- [The D6 refetch re-selects away from the drop zone] → probe it; if needed, add the slice-local guard (D6).
- [A shared-only user's auto-opened dashboard becomes the only tab] → the same behaviour as an owner's first auto-select. The tabs files are not touched.

## Gate-Chain Implications Checklist

Not applicable: this change touches no `.husky/**` file and no script the pre-commit hook invokes.
