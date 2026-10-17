## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `60086f02bb5b1ee48f2246bc09e3e66349199585`. The planning artifacts are untracked in the change dir.
Scope: Phase A (D1–D7, tasks 1.x/2.x, three spec deltas). Phase B is an outline, blocked on PENDING_ESCALATION
(`workflow-state.md:29`), and I did not judge it for completeness.

### What I verified (with evidence)

- **CR1 (stack/grid boundary) is resolved.** `PanelList.css:100-104` sets the phone `.panel-list` padding to `--space-5`
  on all sides. D1 keeps the inset on `.panel-list` (inline `--space-3`), so a 768px viewport gives a 768 - 24 = 744px
  container, and `PanelGrid` still picks the stack (`< 768`). The phone shell has no rail. Spec scenario "A 768px phone
  viewport keeps the stack" and task 2.1 pin this.
- **CR2 (non-stack children at 0px) is resolved.** `.panel-list` is still the single inset owner, so StatusMessage,
  the onboarding checklist, the drop zone, CrossFilterIndicator and the empty states inherit 12px. There is a spec
  scenario for this ("Other dashboard-view content shares the 12px edge"), and task 2.1 measures one non-panel child.
- **The 27px chain holds.** I traced the markdown render path in
  `MobilePanelStack.tsx:184` → `PanelCardBody` → `PanelContent.tsx:238` → `MarkdownRenderer` → `MarkdownPanel.tsx:22`.
  No `.panel-content` wrapper (padding `--space-3 --space-4`) sits around markdown; that class appears only on the
  state branches at `PanelContent.tsx:154-205`. So the chain is 12 (`.panel-list`) + 0 (stack) + 1 (border) + 14 (card)
  + 0 (markdown) = 27 <= 28.
- **CR3 (tap) is resolved.** `DashboardRoute.tsx:31-33` re-selects only when `[id, known]` changes. D3's tap is
  dispatch + navigate, with navigate skipped when the URL already matches. That makes the chip A → sheet B → chip A
  sequence switch in one tap, and it holds on main (`/home` mounts `PanelList`, `AppRoutes.tsx:112`) and after HEL-1578
  (`/dashboards` mounts `PanelList`; `/dashboards/:id` is unchanged, confirmed in its worktree diff). The order is a
  module-scope session snapshot, so it survives the `PanelList` remount. RTL coverage for the sequence and for the
  remount is in task 1.4.
- **CR4 (DOM position) is resolved.** The row is the first flow child of `.panel-list`, outside
  `.panel-list__zoom-container`, and not sticky. It sits below `FirstRunRefineBar` (`DashboardRoute.tsx:54-56`). It
  bleeds with `margin-inline: -space-3` plus `padding-inline` and `scroll-padding-inline` of `space-3`. The spec now
  says "above the dashboard's panels (and below any bar rendered above the dashboard view)". `.panel-list` has
  `overflow: hidden` (`PanelList.css:8`), but the negative margin only reaches the padding edge, so nothing is clipped.
- **Round-1 notes are addressed.** The spec now says the active chip uses inverted ink with no accent (matches D4).
  The ctrl-wheel handler (`PanelList.tsx:239-270`) is made inert on the phone shell in D2 and task 1.3. "Items" now
  means `state.dashboards.items`.
- **D2 is sound.** `useIsPhoneShell` = `(max-width: 768px)` (`app/shell/useIsPhoneShell.ts`), the same boundary the
  CSS uses. The zoom is a `transform: scale` plus `width: 100/zoom%` on the zoom container (`PanelList.tsx:186-191`),
  so forcing an effective zoom of 1.0 on the phone shell also stops a saved 50% from doubling the measured container
  width. The ticket allows "hide it on phones".
- **D7:** `App.css:499,502` already apply `padding-bottom` and `scroll-padding-bottom: var(--bottom-nav-height)` on
  the phone shell.
- **DESIGN.md §12** (lines 1111-1142): 12px edge, 10px only as a ≤4px optical tweak, chips, and touch rules. D1/D4
  are consistent with it. `tapTarget.css` exists.
- **Spec hygiene.** `openspec validate mobile-dashboard-glass-nav-v2 --strict` prints "valid". The MODIFIED zoom
  requirement name matches `openspec/specs/dashboard-chrome-zoom-widget/spec.md:6` and keeps its existing scenarios.
  The `mobile-viewer-stack` ADDED requirement does not collide with an existing name.
- **No Phase B pre-emption.** Phase A touches no BottomNav, `navDestinations`, `sections` or the hel1574 tab pin. The
  chip row lives inside `PanelList` and stays valid under every tab-set option (`assistant-to-header`,
  `home-absorbs-dashboards`, `me-stays-avatar`, `six-tabs`). D6 defers the refreshed line.
- **Siblings.** HEL-1576 changes only a comment line in `MobilePanelStack.css` (lines 8-10), which D1 also edits, so
  expect a trivial conflict. HEL-1578 changes `PanelList.tsx`, `AppRoutes.tsx` and `DashboardRoute.tsx` (the
  "Back to dashboards" target) as noted in Risks. HEL-1572 has no overlapping committed diff.

### Verdict: CONFIRM

All four round-1 change requests are fixed in the artifacts, and the fixes hold up against the tree. Phase A is
implementable without guessing and does not pre-empt the pending ruling.

### Non-blocking notes

- **proposal.md Impact contradicts D3.** It lists "`CommandBar`/`AppShell` (chip row mount)", but D3 mounts the row in
  `PanelList`. The executor should follow D3. Fix the proposal at archive time.
- **Snapshot reset on logout has no mechanism.** D3 says the module-scope order snapshot is "reset on reload/logout",
  but logout is a thunk (`authSlice.ts:145`), not a reload. Follow the `outputFreshness.ts:99` reset-on-logout
  precedent, or key the snapshot by user id. Also export a test reset so the RTL tests in task 1.4 do not leak order
  between cases.
- **The "current dashboard takes the last slot" rule can change one chip.** If the sheet selects a dashboard outside
  the 12-chip cap, the last chip changes. A chip tap cannot cause this, so "tapping does not reorder" holds. Document
  it as intended so an evaluator does not read it as a spec violation of "switching SHALL NOT reorder".
- **Null selection is unhandled.** The spec says "exactly one chip is active", but it does not say what happens when
  `selectedDashboardId` is null and dashboards exist. Render no active chip in that case and do not crash.
- **The 768px / 0px-scrollbar pin is hard to reach in e2e.** Headless Chromium has classic scrollbars. Use either a
  unit test with a mocked 744px container plus a phone-shell match, or Playwright `isMobile` emulation for overlay
  scrollbars. State which one in the test.
- **D1 scoping.** Say explicitly whether the stack's zero inline padding and 14px card padding are unscoped or sit
  under the `(max-width: 768px)` query. The stack also renders on a narrow desktop-shell container, where
  `.panel-list` keeps `--space-6`. Either choice is fine, as long as `mobilePanelHeights` matches it.
- **27px leaves 1px of headroom against the 28px AC.** Measure from the Range rect as planned. Do not loosen the
  bound if a font side-bearing lands at 28.x; trim the card padding instead.
