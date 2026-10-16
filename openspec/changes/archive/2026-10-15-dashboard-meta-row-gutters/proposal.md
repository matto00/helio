## Why

The dashboard page has no place that says how many panels it holds, when its data last refreshed or where it comes from, and its main actions are split between a kebab and two undo/redo buttons in the top bar. DESIGN.md v3 §9 (owner sign-off 2026-10-13) replaces the dashboard title with a slim mono meta row and actions. The desktop grid's 18px literal gutter is looser than the approved B2 board, and with `noCompactor` some dashboards show large empty vertical gaps.

## What Changes

- New desktop dashboard **meta row** that replaces the command bar on the rail-shell dashboard view (owner answer 1), directly under the tab strip once HEL-1575 lands: `N panels` · refresh dot + relative "refreshed …" time · `source · <name(s)>`, then the save-state indicator; trailing actions **Edit layout**, **Share**, the single primary **Add panel**, and the command bar's former dashboard controls (appearance editor, assistant, a kebab with Refine with AI). No dashboard title anywhere on the page (the visually hidden landmark `<h1>` stays).
- New **layout edit mode**: drag and resize are enabled only while editing; the Edit layout toggle reads "Done" while on. Undo/redo buttons move out of the command bar into the meta row and show only in edit mode. `⌘Z`/`⇧⌘Z` (`Ctrl` elsewhere) keep working on the dashboard view in and out of edit mode.
- Command bar: undo/redo buttons removed; it no longer renders on the rail-shell dashboard view; unchanged on other pages and on the phone shell.
- **BREAKING (visual)**: the desktop grid gutter becomes `--space-3` (12px) horizontally and vertically (was 18px), sourced from the spacing token, recorded in DESIGN.md §9. Saved layouts (grid units) are unchanged; rendered panel heights shrink by 6px per row gap.
- Large empty layout gaps (AC4, owner answer 3 `tidy-layout`): an edit-mode **Tidy layout** button compacts panels upward across all breakpoints, undoable with ⌘Z, persisted only through the normal save path after the click. No saved layout is rewritten unprompted.

## Capabilities

### New Capabilities
- `dashboard-meta-row`: the dashboard page's title-free meta row (facts + actions) and its data derivation.
- `dashboard-layout-edit-toggle`: the explicit layout edit mode that gates drag/resize and hosts undo/redo buttons.

### Modified Capabilities
- `layout-undo-redo`: the toolbar-button requirement moves the buttons from the command bar into edit mode; keyboard behaviour unchanged.
- `panel-content-sizing`: the grid layout sizing baseline margin changes from 18 to 12 (the `--space-3` token).
- `panel-save-state-indicator`: on the rail-shell dashboard view the indicator lives in the meta row.
- `chat-quick-launcher`: on the rail-shell dashboard view the trigger lives in the meta row.

## Impact

- Frontend only. No backend, schema or migration change.
- Files (expected): a new `features/dashboards/ui/DashboardMetaRow.{tsx,css}` plus a meta derivation hook/selector, `app/App.tsx` (CommandBar/meta-row swap), a new `app/dashboardChrome.ts` predicate, `features/layout/state/` (edit-mode state, tidy thunk, `tidyLayout`), `features/panels/ui/PanelList.tsx`, `features/panels/ui/grid/{PanelGrid,DesktopPanelGrid,panelGridConfig}.ts(x)`, `PanelGrid.css` (handle visibility), `app/CommandBar.tsx` (remove undo/redo), `app/App.css` (delete the dead `.undo-redo-btn` rule), DESIGN.md §9, CSS file-count pins in `theme/elevationTokenGuard.css.test.ts`/`motionTokenGuard.css.test.ts`, tests and e2e that click the old command-bar undo/redo buttons.
- Overlaps HEL-1575 (unmerged) and HEL-1578 (see design D1); the shell grid itself is not edited.
