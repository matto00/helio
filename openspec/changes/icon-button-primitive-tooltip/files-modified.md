## New

- `frontend/src/shared/ui/IconButton.tsx` — the shared icon-only button primitive (HEL-718):
  required `aria-label`, `title` defaults to `aria-label`, ghost/secondary/danger variants at
  xs/sm/md sizes, forwards `ref` for `usePortalPopover`-style triggers.
- `frontend/src/shared/ui/IconButton.css` — ghost/secondary/danger recipes at xs(24px)/
  sm(`--control-sm`)/md(`--control-md`), derived from `.cmd-btn.cmd-btn--icon` (`app/App.css`),
  `.ui-modal__close` (`shared/ui/Modal.css`), and `.preferences-editor__icon-btn`
  (`features/settings/ui/PreferencesEditor.css`); includes the mobile ≥44px tap-target floor
  (HEL-319 convention).
- `frontend/src/shared/ui/IconButton.test.tsx` — aria-label/title rendering, variant/size classes,
  disabled, click, className passthrough.
- `frontend/src/shared/ui/IconButton.css.test.ts` — static regression guard locking the mobile
  ≥44px floor (mirrors `Modal.css.test.ts` / `EmptyState.css.test.ts`'s precedent), now the home
  for the assertion that used to live in `Modal.css.test.ts` against `.ui-modal__close`.

## Modified — IconButton adoption + DESIGN.md

- `DESIGN.md` — new §5 "Icon-only buttons" subsection (recipe, variants/sizes, required
  `aria-label`, tooltip-pairing pattern as the app-wide rule) and `IconButton` added to §6's
  shared-primitives list.
- `frontend/src/shared/ui/index.ts` — exports `IconButton`.

## Modified — task-group-2 migrations (the three converged duplicate recipes)

- `frontend/src/app/CommandBar.tsx` — theme toggle, "Refine with AI", and quick-launcher trigger
  migrated onto `IconButton` (`variant="secondary"` `size="sm"`); Undo/Redo (icon+text) untouched.
- `frontend/src/app/App.css` — removed the now-dead `.cmd-btn--icon` block; refreshed the F-186
  historical comment to point at `IconButton`.
- `frontend/src/shared/ui/Modal.tsx` — close button migrated onto `IconButton`
  (`variant="ghost"` `size="sm"`).
- `frontend/src/shared/ui/Modal.css` / `Modal.css.test.ts` — removed the now-dead `.ui-modal__close`
  block and its mobile-floor test (moved to `IconButton.css.test.ts`).
- `frontend/src/shared/ui/Modal.test.tsx` — added a title-tooltip assertion for the close button.
- `frontend/src/features/settings/ui/PreferencesEditor.tsx` — both remove-row buttons (series
  colors, naming conventions) migrated onto `IconButton` (`variant="danger"` `size="md"`).
- `frontend/src/features/settings/ui/PreferencesEditor.css` — removed the now-dead
  `.preferences-editor__icon-btn` block.
- `frontend/src/features/settings/ui/PreferencesEditor.test.tsx` — added tests covering both
  remove-row buttons' accessible name/tooltip and click behavior.

## Modified — task-group-3 audit (a 4th converged duplicate + additional migrations + title-only fixes)

- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` / `.test.tsx` — the
  "Customize dashboard appearance" popover trigger (a 4th `cmd-btn cmd-btn--icon` call site
  design.md's Context section explicitly names as deferred to this ticket) migrated onto
  `IconButton`; required adding `forwardRef` + `aria-expanded`/`aria-haspopup` passthrough to
  `IconButton` since this trigger is a `usePortalPopover` consumer needing a real DOM ref for
  `getBoundingClientRect()` positioning.
- `frontend/src/features/dashboards/ui/RefinementChatDrawer.tsx` / `.css` / `.test.tsx` — the
  header close button (a 5th independently-converged near-duplicate of the same recipe, not
  previously named in design.md's Decision 5 list) migrated onto `IconButton`
  (`variant="ghost"` `size="sm"`); removed the now-dead `.refinement-drawer__close` block.
- `frontend/src/app/Sidebar.tsx` — the collapse toggle migrated onto `IconButton`
  (`variant="secondary"` `size="sm"`); `.app-sidebar-toggle` kept as a modifier class carrying
  only its two genuine deltas (the DESIGN.md §8 flush-edge `-2px` inset focus ring and the
  `<=768px` hide rule) — its box-model declarations, now redundant with `IconButton`'s own, were
  removed.
- `frontend/src/features/dashboards/ui/DashboardList.tsx` / `.css` / `.test.tsx` — the
  add-dashboard toggle migrated onto `IconButton` (`variant="secondary"` `size="xs"`, "+" glyph
  as the `icon`); removed the `.dashboard-list__add` block (see Cycle 2 below — this block was
  NOT actually dead; `shared/chrome/SidebarItemList.tsx` was a second, unmigrated consumer).
  `IconButton.css` gained a `font-weight`/`line-height` base declaration to preserve the "+"
  glyph's prior boldness (no effect on FontAwesome/lucide icon children).
- `frontend/src/features/dashboards/ui/DashboardList.tsx` / `.test.tsx` — filter-clear button:
  left its bespoke, absolutely-positioned 20px recipe as-is (below `IconButton`'s 24px `xs`
  floor); added the missing `title="Clear filter"` (it already had `aria-label`).
- `frontend/src/shared/ui/Toast.tsx` / `.test.tsx` — dismiss button: left its bespoke 20px recipe
  as-is (same below-floor reasoning as the filter-clear button); added
  `title="Dismiss notification"`.
- `frontend/src/shared/chrome/SidebarBody.tsx` / `.test.tsx` — conversation rename/pin row
  actions: left `.dashboard-list__row-action-btn`'s bespoke `outline-offset: 1px` focus-ring
  tuning as-is (a real, deliberate deviation from the flush-row clipping concern, not a casual
  drift); added the missing `title` to both, matching their existing `aria-label`.
- `frontend/src/features/pipelines/ui/StepCard.tsx` / `.test.tsx` — move-up/move-down/
  toggle-enabled/duplicate buttons: left their shared 24px recipe as-is (the toggle-enabled
  button's `[aria-pressed="true"]` accent-color state has no `IconButton` variant equivalent, and
  migrating only the other three would fragment one intentionally-shared CSS rule); added the
  missing `title` to all four, matching their existing `aria-label`.
- `frontend/src/features/panels/ui/PanelList.tsx` / `.test.tsx` — zoom in/out/reset controls:
  left their recipe as-is; added the missing `title` to all three, matching their existing
  `aria-label`.
- `frontend/src/features/panels/ui/PanelDetailModal.mobile.css`,
  `frontend/src/features/panels/ui/PanelDetailModal.css.test.ts` — refreshed stale comments that
  pointed at `Modal.css`/`Modal.css.test.ts` for the close button's mobile floor; it now lives in
  `IconButton.css`/`IconButton.css.test.ts`. No behavior change, comment-only.

## Cycle 2 — evaluation-1.md Change Requests

- `frontend/src/shared/chrome/SidebarItemList.tsx` / `.test.tsx` — **regression fix (Change
  Request 1)**: this file imports `features/dashboards/ui/DashboardList.css` specifically to
  reuse `.dashboard-list__add`/`.dashboard-list__filter-clear` for its own header "+" add button
  (Data Sources/Data Pipelines/Metrics/Conversations sidebar sections, wired via
  `SidebarBody.tsx`'s `onAdd` props) — cycle 1 deleted `.dashboard-list__add` after only
  migrating `DashboardList.tsx`'s *own* button, missing this second consumer, which regressed to
  fully unstyled (no border/background/radius) at `/pipelines`, `/sources`, `/metrics`, and the
  Assistant "New chat" trigger. Fixed by migrating this button onto `IconButton`
  (`variant="secondary"` `size="xs"`, matching `DashboardList.tsx`'s own migration) — now both
  consumers render identically and neither depends on the deleted CSS. Also added the missing
  `title="Clear filter"` to this file's own filter-clear button (non-blocking suggestion,
  addressed while already in this file for the regression fix) — its bespoke 20px recipe is left
  as-is, same reasoning as `DashboardList.tsx`'s and `Toast.tsx`'s own filter-clear/dismiss
  buttons.
- `frontend/src/features/dashboards/ui/DashboardList.css` — comment-only: the
  `.dashboard-list__add` dead-code comment now names `SidebarItemList.tsx` as the second consumer
  that also needed migrating, so a future reader doesn't need to re-derive this the hard way.
- Re-verified (Change Request 2) that no other consumer of any CSS class deleted in cycle 1
  (`.cmd-btn--icon`, `.ui-modal__close`, `.preferences-editor__icon-btn`,
  `.refinement-drawer__close`) exists outside the files already migrated — grepped every `.tsx`/
  `.ts`/`.css` file in `frontend/src` for each class name; the only remaining references are
  historical/pointer comments (no live selectors or `className` usages). `.dashboard-list__add`
  was the only actual regression.

## Cycle 3 — skeptic-final-1.md Change Requests

- `frontend/src/features/panels/ui/PanelCard.tsx` / `.test.tsx` — **AC-2 fix (Change Request 1)**:
  the panel-card delete-confirmation's cancel button (bare `×` glyph) had neither `aria-label` nor
  `title` — a live counterexample to AC-2 that both cycles' audits missed because their stated
  methodology (grep for `FontAwesomeIcon`/`lucide-react`/`<svg>` children) structurally can't catch
  a plain-character glyph button. Migrated onto `IconButton` (`variant="secondary"` `size="xs"`,
  the closest existing recipe to the deleted `.panel-grid-card__delete-cancel-btn` — same 24px
  hairline-border box, hover only differed by not adding a `--app-surface-raised` background,
  judged an unintentional inconsistency rather than a deliberate exception worth preserving) —
  `aria-label={`Cancel delete ${panel.title}`}`, matching the file's existing panel-scoped naming
  convention (`Move ${panel.title} panel`), gets `title` for free from `IconButton`'s default.
- `frontend/src/features/panels/ui/PanelGrid.css` — removed the now-dead
  `.panel-grid-card__delete-cancel-btn` block (grepped first; the sibling `Confirm` button's
  `.panel-grid-card__delete-confirm-btn` is untouched — it's a labeled text button, not icon-only,
  so it wasn't in scope).
- Widened the app-wide sweep (Change Request 2) beyond `FontAwesomeIcon`/`lucide-react`/`<svg>`
  children to also catch bare-glyph buttons (visible content with no alphabetic text at all, e.g.
  `×`/`+`/`−` alone) missing both `aria-label` and `title` — a parenthesized-body AST-ish scan of
  every `.tsx` file's `<button>` blocks. Found zero additional instances beyond `PanelCard.tsx`
  (now fixed above); spot-checked the skeptic's own named "already correct" examples
  (`DataTypePicker.tsx`'s clear button, `PanelList.tsx`'s zoom controls, `SidebarItemList.tsx`/
  `DashboardList.tsx`'s add buttons) to confirm no regression.

## Audited, no change needed

- `shared/chrome/ActionsMenu.tsx`'s trigger (task 3.3) — already has both `aria-label` and
  `title`; left as-is per design.md's explicit non-goal.
- `shared/chrome/BottomNav.tsx` — tab items carry a real (aria-hidden'd) visible label plus
  `aria-label`; not icon-only.
- `features/pipelines/ui/PipelineShareDialog.tsx`, `PipelineDetailHeader.tsx` — no icon-only
  controls found (the "Revoke"/"Done"/"Grant access" buttons all have visible text; edit actions
  route through `ActionsMenu`).
- A full-codebase sweep of every `<button>` containing a `FontAwesomeIcon`/`lucide-react`/`<svg>`
  child with no visible text found zero instances missing `aria-label` — every icon-only button in
  the app already had an accessible name before this change; the actual app-wide gap was the
  missing *visible* half of the tooltip pattern (`title`), which the above fixes close for every
  finding.
