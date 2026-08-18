## 1. Frontend: IconButton primitive

- [x] 1.1 Create `frontend/src/shared/ui/IconButton.tsx`: required `aria-label` string prop,
      `icon: ReactNode`, `onClick`, optional `title` (defaults to `aria-label`), `variant?: "ghost" |
      "secondary" | "danger"` (default `"ghost"`), `size?: "xs" | "sm" | "md"` (default `"sm"`),
      `disabled?`, `className?`, `type?` (default `"button"`).
- [x] 1.2 Create `frontend/src/shared/ui/IconButton.css`: ghost/secondary/danger recipes at
      xs(24px)/sm(`--control-sm`)/md(`--control-md`), derived from `.cmd-btn.cmd-btn--icon`
      (`app/App.css`), `.ui-modal__close` (`shared/ui/Modal.css`), and
      `.preferences-editor__icon-btn` (`features/settings/ui/PreferencesEditor.css`).
- [x] 1.3 Export `IconButton` from `frontend/src/shared/ui/index.ts`.
- [x] 1.4 Write `IconButton.test.tsx`: aria-label required (type-level, no runtime test needed) +
      renders aria-label/title (default and explicit-override) + each variant/size renders its class.

## 2. Frontend: migrate the converged duplicate recipes

- [x] 2.1 Migrate `app/CommandBar.tsx`'s three `cmd-btn cmd-btn--icon` icon-only buttons (theme
      toggle, "Refine with AI", quick-launcher trigger) onto `IconButton` (`variant="secondary"`,
      `size="sm"`); leave the Undo/Redo buttons (icon + visible text, not icon-only) unchanged.
- [x] 2.2 Migrate `shared/ui/Modal.tsx`'s close button onto `IconButton` (`variant="ghost"`,
      `size="sm"`, `aria-label="Close"`).
- [x] 2.3 Migrate `features/settings/ui/PreferencesEditor.tsx`'s two `preferences-editor__icon-btn`
      remove-row buttons onto `IconButton` (`variant="danger"`, `size="md"`).
- [x] 2.4 Remove the now-unused `.cmd-btn--icon`-only icon styling, `.ui-modal__close`, and
      `.preferences-editor__icon-btn` CSS blocks once their call sites are migrated (keep `.cmd-btn`
      itself — Undo/Redo still use it for their icon+text recipe). Also migrated
      `DashboardAppearanceEditor.tsx`'s "Customize dashboard appearance" trigger, a fourth
      `cmd-btn cmd-btn--icon` call site design.md's Context section names as deferred to this
      ticket — `IconButton` gained `forwardRef` + `aria-expanded`/`aria-haspopup` passthrough to
      support it (it's a `usePortalPopover` trigger needing a real DOM ref).

## 3. Frontend: audit and fix remaining icon-only controls

- [x] 3.1 Grep the codebase for icon-only `<button>` elements (SVG/FontAwesomeIcon child, no
      sibling text) missing both `aria-label`/`aria-labelledby` and `title` — every file design.md's
      Decision 5 names as unaudited (`RefinementChatDrawer`, `PipelineDetailPage`,
      `PanelDetailModal.mobile`, `Toast`, `PipelineShareDialog`, `SidebarBody`/`Sidebar.tsx`
      (collapse toggle), `BottomNav`) plus any other match the grep turns up. Result: every
      icon-only `<button>` app-wide already carries `aria-label` (confirmed via an AST-ish sweep
      of every `.tsx` file, cross-checked by hand) — the app-wide gap was consistently the missing
      *visible* half of the pattern (`title`), not the accessible name.
- [x] 3.2 For each finding: migrate onto `IconButton` if it's a plain icon-only control with no
      surrounding bespoke CSS worth preserving; otherwise add the missing `aria-label`/`title`
      directly and note in `files-modified.md` why migration wasn't warranted there. Migrated:
      `RefinementChatDrawer`'s close button, `DashboardAppearanceEditor`'s "Customize dashboard"
      trigger (design.md's Context-named 4th `cmd-btn--icon` site — `IconButton` gained
      `forwardRef`/`aria-expanded`/`aria-haspopup` to support it), `Sidebar.tsx`'s collapse toggle
      (kept `.app-sidebar-toggle` as a modifier class for its DESIGN.md §8 flush-edge inset focus
      ring + mobile hide rule), `DashboardList.tsx`'s add-dashboard toggle. Title-only fix (bespoke
      CSS kept as-is): `Toast`'s dismiss button and `DashboardList`'s filter-clear (both a
      sub-`xs`-floor 20px recipe), `SidebarBody`'s rename/pin row actions (bespoke flush-row inset
      focus offset), `StepCard`'s move-up/down/toggle-enabled/duplicate buttons (the toggle button's
      `[aria-pressed="true"]` accent state has no `IconButton` variant equivalent), `PanelList`'s
      zoom in/out/reset controls.
- [x] 3.3 Spot-check `shared/chrome/ActionsMenu.tsx`'s trigger — already has `aria-label`; leave as
      pure internal styling only if migrating it is a no-behavior-change refactor, otherwise skip.
      Left as-is per design.md's explicit non-goal (already has `aria-label`, lower priority than
      controls with an actual accessibility gap).

## 4. DESIGN.md

- [x] 4.1 Add the `IconButton` recipe to DESIGN.md §5 (Buttons): variants, sizes, the
      `title`-defaults-to-`aria-label` tooltip pattern, and the required-`aria-label` rule.
- [x] 4.2 Add `IconButton` to DESIGN.md §6's shared-primitives list.

## 5. Tests

- [x] 5.1 Update/add tests for every migrated call site (`CommandBar`, `Modal`, `PreferencesEditor`,
      and each file touched in task group 3) to assert the accessible name/tooltip is still present.
- [x] 5.2 Run `npm run lint` and `npm test` in `frontend/`; fix any fallout.

## 6. Cycle 2 — evaluation-1.md Change Requests

- [x] 6.1 **Regression fix**: `shared/chrome/SidebarItemList.tsx` imports `DashboardList.css`
      specifically to reuse `.dashboard-list__add`/`.dashboard-list__filter-clear` for its own
      header "+" add button (Data Sources/Data Pipelines/Metrics/Conversations sections, via
      `SidebarBody.tsx`'s `onAdd` prop) — task 3.2's `.dashboard-list__add` deletion only checked
      `DashboardList.tsx`'s own migrated call site, missing this second consumer, which rendered
      fully unstyled. Migrated `SidebarItemList.tsx`'s add button onto `IconButton`
      (`variant="secondary"` `size="xs"`, matching `DashboardList.tsx`'s own migration — evaluator's
      preferred fix (a)). Also added the missing `title="Clear filter"` to this file's own
      filter-clear button (non-blocking suggestion, addressed while already in this file).
- [x] 6.2 Re-verified every other CSS class deleted in cycle 1 (`.cmd-btn--icon`, `.ui-modal__close`,
      `.preferences-editor__icon-btn`, `.refinement-drawer__close`) for any other consumer outside
      the already-migrated files — grepped every `.tsx`/`.ts`/`.css` file in `frontend/src`; only
      historical/pointer comments remain, no other live regression found.
- [x] 6.3 Updated `files-modified.md` (new "Cycle 2" section) and this file to record
      `SidebarItemList.tsx`; added tests in `SidebarItemList.test.tsx` asserting the add button
      carries `ui-icon-btn`/`ui-icon-btn--secondary`/`ui-icon-btn--xs` classes plus its title, that
      clicking it calls `onAdd`, that the default aria-label derives correctly, and that the
      filter-clear button carries its title.

## 7. Cycle 3 — skeptic-final-1.md Change Requests

- [x] 7.1 **AC-2 fix**: `features/panels/ui/PanelCard.tsx`'s delete-confirmation cancel button (a
      bare `×` glyph) had neither `aria-label` nor `title` — missed by both prior cycles' audits
      since their `FontAwesomeIcon`/`lucide-react`/`<svg>`-scoped methodology can't catch a
      plain-character glyph. Migrated onto `IconButton` (`variant="secondary"` `size="xs"`,
      `aria-label={`Cancel delete ${panel.title}`}`); removed the now-dead
      `.panel-grid-card__delete-cancel-btn` block from `PanelGrid.css` (grepped first — no other
      consumer). The sibling `Confirm` button (`.panel-grid-card__delete-confirm-btn`) is a
      labeled text button, out of scope.
- [x] 7.2 Widened the app-wide sweep to catch bare-glyph (non-icon-component) icon-only buttons —
      an AST-ish scan of every `.tsx` file's `<button>` blocks for visible content with no
      alphabetic characters (i.e. a symbol alone: `×`/`+`/`−`/etc.) and neither `aria-label` nor
      `title`. Found zero additional instances beyond `PanelCard.tsx` (fixed above); spot-checked
      the skeptic's own named "already correct" examples (`DataTypePicker.tsx`, `PanelList.tsx`'s
      zoom controls, `SidebarItemList.tsx`/`DashboardList.tsx`'s add buttons) — no regression.
- [x] 7.3 Updated `files-modified.md` (new "Cycle 3" section) and this file; added tests in
      `PanelCard.test.tsx` asserting the cancel button's accessible name/title and that clicking it
      calls `onCancelDelete`.
