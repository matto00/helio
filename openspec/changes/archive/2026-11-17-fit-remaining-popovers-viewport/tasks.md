## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; never run env-dumping commands. scripts/concertino/.concertino.env may be read by scripts but never printed.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; DB residue deleted only by exact id via buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] Long calls use timeout 600000.
- [C6] Before trusting any MCP-browser probe or screenshot, verify the page URL/port is this lane's DEV_PORT.
- [C7] Every new e2e test and guard is shown red first against a recorded mutation.
- [C8] Lane scratch goes in .concertino/scratch/HEL-1756/ only.
- [C9] Focus-on-open of any popover hidden until placed is proven by a real-browser e2e (document.activeElement inside the panel), never by a jsdom toHaveFocus test alone.
- [C10] Never dispatch a synthetic window resize event to re-place a popover; use the hook's reposition() (D7).

## 1. Probe

- [x] 1.1 Start this worktree's servers on its own ports; seed a dashboard with enough panels and enough dashboards that the rail scrolls and a provenance trigger sits near the middle and near the bottom of a short window.
- [x] 1.2 Probe UserMenu (rail on desktop 1280x400 and 1280x320; bottom-nav on phone 390x500 and 390x400), light and dark; record panel rect, viewport, last item `elementFromPoint` result in probes.md.
- [x] 1.3 Probe DashboardAppearanceEditor on desktop only (the visible instance: CommandBar or DashboardMetaRow, recorded per size; phone recorded as not rendered per App.css's max-width 768px rule, D10) in both themes; record the "Save dashboard style" button's result.
- [x] 1.4 Probe the provenance popover with the trigger mid-viewport and near the bottom at the same sizes and themes, including after its content has loaded; record the last section's result.
- [x] 1.5 For each popover, conclude "can clip" or "fits" in probes.md with the numbers.

## 2. Fix each popover that can clip (skip any that fits)

- [x] 2.1 Write the e2e for the popover in e2e/hel1756-popover-viewport-fit.spec.ts (desktop short and, except the appearance editor, phone short; light and dark; `elementFromPoint` on the last item; for the editor the "Save dashboard style" button) plus the focus-on-open e2e (D6, C9) and, for provenance, the cache-miss e2e (D7); record each red on the unfixed code in red-evidence.md.
- [x] 2.2 If any popover is converted: add the additive `reposition()` return to usePortalPopover.ts (D7) with its own unit test; existing consumer tests unchanged and green.
- [x] 2.3 Add a local measured `place` function using `fitPanelVertically` (provenance with the D8 cap and width/left clamp), attach the hook's `panelRef` (merged with provenance's local ref, replacing UserMenu's local ref; D8), hide until `placed`, apply `maxHeight`, scroll via consumer-scoped classes (D9: `.user-menu__popover`, the NEW `.dashboard-appearance-editor__panel` on the form, never `.dashboard-appearance-editor` and never `.popover__panel`), clamp horizontally to an 8px margin, observe an inner content element and call `reposition()` on growth for provenance and the editor only (D7, D11), key focus-on-open on `placed` (D6), update the HEL-1207 doc comment.
- [x] 2.4 Unit tests for the placement functions (fits, flips, caps, no-layout, horizontal clamp, provenance cap), for focus behavior inside forms/content (D3, D12), and for re-fit on growth (provenance loading to ready and to error; editor contrast warning and save error).
- [x] 2.5 Re-run every e2e from 2.1 green in both themes and every viewport class; compare against the running app in light and dark, desktop and phone (provenance spacing unchanged, D11).

## 3. Rail guard

- [x] 3.1 Add the last-row, scrolled-to-end hover test (scroll window and .dashboard-list scroller to their ends; assert the last row is inside the viewport before hovering) to e2e/hel1750-actions-menu-viewport-fit.spec.ts (light and dark, 1280x400).
- [x] 3.2 Record it red with `position: relative` removed from `.dashboard-list` in DashboardList.css, then restore and record green.

## 4. Gates

- [x] 4.1 lint, typecheck, format:check, jest (maxWorkers 3), the touched e2e specs (workers 2); no backend gate needed (no backend change).
- [x] 4.2 files-modified.md lists every file touched, naming any shared file (usePortalPopover.ts, panelFit.ts, ProvenancePopover/Trigger) edited and why.
