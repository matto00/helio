## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

- **Regression: `.dashboard-list__add` CSS deleted while a live, non-`DashboardList.tsx` consumer still
  references it — the sidebar "+" add buttons for Data Sources, Data Pipelines, and Metrics (and the
  Assistant "New conversation" button) render completely unstyled.** `frontend/src/shared/chrome/SidebarItemList.tsx`
  (a separate, generic list component reused by `SidebarBody.tsx` for the Sources/Pipelines/Metrics/
  Conversations sections) imports `frontend/src/features/dashboards/ui/DashboardList.css` (line 9:
  `import "../../features/dashboards/ui/DashboardList.css";`) specifically to share `.dashboard-list__add`
  and friends, and still renders `<button type="button" className="dashboard-list__add" ...>` at
  `SidebarItemList.tsx:242-251`. Task 3.2 migrated `DashboardList.tsx`'s *own* add-dashboard button onto
  `IconButton` and then deleted the `.dashboard-list__add` block from `DashboardList.css` (see the diff —
  the block is replaced by a comment, "now-dead", at `DashboardList.css:38-43`), without checking
  `SidebarItemList.tsx`'s own use of the exact same class. Confirmed live at `http://localhost:6150/pipelines`
  and `/sources`: `document.querySelector('.dashboard-list__add')` computes `border: 0px none`,
  `background: transparent`, `border-radius: 0px` (previously a 24×24 bordered square with hover state) —
  the button still has its `aria-label` (e.g. "New pipeline", "Add source") so it isn't an AC-2 accessible-
  name violation, but it is a real, reachable visual/UX regression this ticket introduced and neither
  `files-modified.md` nor `design.md`/`tasks.md` mentions `SidebarItemList.tsx` anywhere. This is exactly
  the "No regressions to existing behavior covered by other specs" checklist item, and the Risk-1
  mitigation design.md itself commits to ("treat each remaining file as an independent, individually-
  verified small edit") was not actually applied to the CSS-deletion step of task 2.4/3.2's own migration.
- Everything else in Phase 1 is solid: both ACs are otherwise met (`IconButton` exists in `shared/ui/`,
  documented in DESIGN.md §5/§6; the ticket's audit is thorough and its "already had aria-label everywhere,
  gap was `title`" finding checks out against every file spot-checked). Tasks are marked done and match
  what's implemented; `openspec/specs/icon-button/spec.md`'s four requirements match `IconButton.tsx`'s
  actual behavior exactly. No scope creep beyond what design.md's Decision 5 self-approved (the app-wide
  audit was in-scope by design). Planning artifacts (proposal/design/tasks/spec) accurately reflect the
  implementation modulo the one regression above, which none of them anticipated.

### Phase 2: Code Review — FAIL (same regression; code quality itself is otherwise clean)

Issues:

1. Same defect as Phase 1: `frontend/src/features/dashboards/ui/DashboardList.css:38-43` deletes
   `.dashboard-list__add` while `frontend/src/shared/chrome/SidebarItemList.tsx:242-251` still depends on
   it via its `DashboardList.css` import at `SidebarItemList.tsx:9`. This is a DRY/behavior-preservation
   failure at the CSS-consolidation step specifically (not the `IconButton` component itself, which is
   sound) — a shared stylesheet had a class removed without grepping all its consumers first.

No other violations found:

- **Canonical code-quality compliance**: no inline FQNs (frontend-only change, that CONTRIBUTING.md rule
  is Scala-scoped); imports are top-of-file throughout; file sizes are well within budget
  (`IconButton.tsx` 96 lines, `IconButton.css` 106 lines).
- **Design-standard [mechanical] rules**: `IconButton.css` uses only existing tokens
  (`--control-sm`/`--control-md`, `--app-radius-sm`, `--app-border-subtle/strong`, `--app-surface-raised`,
  `--app-text-muted`/`--app-text`, `--app-error`/`--app-error-surface`, `--weight-medium`, `--text-base/lg`,
  `--app-transition`) — all verified present in `frontend/src/theme/theme.css` for both light and dark
  themes. No new tokens introduced, matching proposal.md's stated non-goal. The `xs` 24px size and its
  "dense-row exception" framing match DESIGN.md §3's pre-existing documented exception (line 128), not a
  new invention.
- **DRY**: the three/four/five converged recipes are correctly consolidated into one component with
  byte-identical hover/variant CSS (verified `.ui-icon-btn--danger:hover`, `--secondary:hover`,
  `--ghost:hover` against the exact removed blocks — all match).
- **Type safety**: `aria-label` is a required `string` (not optional), satisfying the ticket's core
  ask; no `any` anywhere in the diff.
- **Tests**: `IconButton.test.tsx` and `IconButton.css.test.ts` are meaningful (variant/size class
  assertions, title-default-vs-override, disabled, click); every migrated call site got an updated test
  asserting the accessible name/tooltip survived the migration (`App.test.tsx`, `Modal.test.tsx`,
  `PreferencesEditor.test.tsx`, `DashboardAppearanceEditor.test.tsx`, `RefinementChatDrawer.test.tsx`,
  `DashboardList.test.tsx`, `SidebarBody.test.tsx`, `StepCard.test.tsx`, `PanelList.test.tsx`,
  `Toast.test.tsx`).
- **No dead code**: no leftover TODO/FIXME; no unused imports (lint gate below confirms).
- **No over-engineering**: `IconButton`'s prop surface is minimal and every prop maps to an actual call
  site's need (the `forwardRef`/`aria-expanded`/`aria-haspopup` additions are justified by
  `DashboardAppearanceEditor`'s real `usePortalPopover` requirement).
- **Behavior-preserving**: every migrated call site's rendered class/size/variant matches the pre-migration
  CSS byte-for-byte, confirmed both by diff comparison and live DOM inspection (see Phase 3) — with the
  one exception above.

**Gates — re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` for this run):**

```
npm run lint           → PASS (0 warnings/errors)
npm run format:check   → PASS (Prettier clean)
npm test                → PASS (216 suites, 2325 tests)
npm --prefix frontend run build → PASS (pre-existing >500kB chunk-size warning, unrelated to this change)
```

### Phase 3: UI Review — FAIL

Triggered by `frontend/**` changes. Dev servers started via
`scripts/concertino/start-servers.sh`/`assert-phase.sh` → `PASS servers` (backend :9057, frontend :6150).

- **Happy path**: theme toggle, "Refine with AI", quick-launcher, sidebar collapse, Modal close,
  PreferencesEditor remove-row, DashboardAppearanceEditor trigger, DashboardList's own "Add dashboard" —
  all render as properly sized/bordered `IconButton` instances (`ui-icon-btn ui-icon-btn--{variant}
  ui-icon-btn--{size}`) with both `aria-label` and `title` populated, confirmed via
  `document.querySelectorAll('.ui-icon-btn')` DOM inspection at 1440px.
- **Regression reproduced live** (same defect as Phases 1/2): navigating to `/pipelines` and `/sources`
  shows the sidebar's "+" add button (`.dashboard-list__add`, `aria-label="New pipeline"` /
  `"Add source"`) rendered with `border: 0px none`, `background: transparent`, `border-radius: 0px` — no
  visible button chrome at all, just a bare "+" glyph floating in the header row. This is present on every
  `SidebarItemList` section that passes `onAdd` (Data Sources, Data Pipelines, Metrics, and — per
  `SidebarBody.tsx:314` — the Assistant/Conversations "new conversation" trigger), i.e. 4 of the app's ~5
  sidebar sections are affected; only `DashboardList.tsx`'s own dashboards section (migrated directly onto
  `IconButton`) is unaffected.
- **Mobile tap-target floor**: verified correct — at 768px, the `IconButton` instances that remain
  visible in the top bar measure 44×44 (`min-width`/`min-height: 44px` from `IconButton.css`'s mobile
  block).
- **No console errors** across all navigations tested (home, /pipelines, /sources, resize to 768px).
- **Keyboard/accessible names**: every migrated `IconButton` exposes a correct accessible name via
  `getByRole("button", { name: ... })` in both the live DOM and the updated Jest tests; native `<button>`
  semantics give free keyboard support (Enter/Space activation, Tab focus, global `:focus-visible` ring
  from `theme.css:235-237`).
- Breakpoints 1440/768 checked directly; 1100/0 not separately re-checked given the regression above
  already fails this phase — no value in additional passes until the CSS-deletion fix lands.

### Overall: FAIL

### Change Requests

1. Restore styling for `SidebarItemList.tsx`'s add button (and confirm no other consumer of the classes
   removed in this change was missed). Two viable fixes, either is acceptable:
   - **(a)** Migrate `SidebarItemList.tsx:242-251`'s `<button className="dashboard-list__add">` onto the
     same `IconButton` (`variant="secondary" size="xs"`, matching `DashboardList.tsx`'s own migration) —
     the more consistent fix, and in scope of this ticket's own stated goal (task 3's audit should have
     caught this file; it renders an icon-only "+" via the identical recipe `DashboardList.tsx`'s did).
   - **(b)** If (a) is deferred, at minimum restore the `.dashboard-list__add` CSS block in
     `DashboardList.css` (or move it somewhere both consumers can share) so `SidebarItemList.tsx`'s button
     isn't left unstyled — but (a) is strongly preferred since it's a drop-in of the exact pattern already
     proven for `DashboardList.tsx` in this same change.
   - Before closing this out, grep every other CSS class deleted in this diff
     (`.cmd-btn--icon`, `.ui-modal__close`, `.preferences-editor__icon-btn`, `.refinement-drawer__close`)
     for any other consumer outside the files already migrated — this evaluation found only the one
     `.dashboard-list__add` instance, but re-verify after the fix rather than assuming it's the only one.
   - Update `files-modified.md`/`tasks.md` to note `SidebarItemList.tsx` if migrated, and add/adjust a
     test (e.g. in a new or existing `SidebarItemList.test.tsx`, or via `SidebarBody.test.tsx` which
     already renders it) asserting the add button carries the `ui-icon-btn` styling classes post-fix.

### Non-blocking Suggestions

- `SidebarItemList.tsx`'s own icon-only controls (`.dashboard-list__filter-clear` at line 270,
  `.dashboard-list__row-action-btn` rename/pin actions if any exist here beyond `SidebarBody.tsx`'s
  own copies) have `aria-label` but no `title` — not an AC violation (AC-2 is "visible OR accessible"),
  but DESIGN.md's new §5 prose states pairing both is "the default expectation" for every icon-only
  control app-wide. Worth a quick pass once change request #1 lands, since fixing #1 will already have
  eyes on this file.
