## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS

Issues: none blocking. One notable observation (not scope creep, not a defect):

- The proposal/design's stated rationale for including `.actions-menu__item`
  ("mobile-reachable via panel-card, dashboard-list, and sidebar kebab menus")
  does not hold empirically in the current app: `MobilePanelStack` (which
  replaces `PanelCard` below the `sm` grid breakpoint) renders `PanelCardBody`
  with no `ActionsMenu`, and the entire `.app-sidebar` (which hosts
  `DashboardList` / `SidebarItemList`, the only other `ActionsMenu` call
  sites) is `display: none` at `max-width: 768px` (the same threshold as the
  new CSS rule), per the documented "no CRUD/editing on phone" policy
  (`mobile-pwa-handoff.md` §2, enforced in `App.css`). I could not find any
  live, reachable `.actions-menu__item` in the app at ≤768px viewport width
  across Dashboards, Data Sources, and Data Pipelines. This means the rule is
  currently inert in production use, not a defect fix for a real touch-target
  problem users can hit today. It causes no harm (additive CSS inside an
  existing media query, fully tested), and fixing reachability is explicitly
  a non-goal (no TSX/behavior changes), so I'm not treating this as a
  blocker — flagging for orchestrator/skeptic awareness and as a possible
  documentation correction in the proposal/design docs.
- All ticket ACs (checkbox list) addressed: ui-select rows ≥44px at 390px
  both themes (verified), desktop unchanged (verified), CSS-lock test present
  (verified, passing).
- tasks.md accurately reflects implementation; 1.4/1.5 correctly deferred to
  evaluator/skeptic as planned.
- No scope creep: diff is exactly `inputs.css`, `ActionsMenu.css`, and their
  two new `.css.test.ts` files, matching the proposal's stated impact.
- No regressions: full Jest suite (1121 tests) still passes; changes are
  additive inside a new `@media (max-width: 768px)` block only.
- No schema/API contract changes (correctly, none needed).

### Phase 2: Code Review — PASS

Issues: none.

- CONTRIBUTING.md: no inline FQNs (N/A, CSS/TS-only), file sizes well under
  budget, no dead code/TODOs.
- DESIGN.md [mechanical]: breakpoint `768` is a canonical value (§4). The
  literal `44px` (not a `--control` token) matches the already-ratified
  exception documented at `MobileNavSheet.css:145-156` and
  `PanelDetailModal.css.test.ts` (HIG minimum, explicitly not a density
  token) — consistent with precedent, not a new violation.
  `frontend/src/shared/ui/inputs.css:163-169`,
  `frontend/src/shared/chrome/ActionsMenu.css:82-88`.
  No hardcoded colors introduced.
- DRY: the two new test files duplicate the `findMediaBlock`/`findRuleBody`
  helper (~35 lines each) rather than extracting a shared utility — this
  matches design.md's explicit, documented decision (#3) citing the existing
  `PanelDetailModal.css.test.ts` precedent of the same duplication; a
  shared-helper refactor is out of scope and correctly deferred.
  `frontend/src/shared/ui/inputs.css.test.ts`,
  `frontend/src/shared/chrome/ActionsMenu.css.test.ts`.
- Readable: comments in both CSS files clearly explain the fix, the
  block→flex switch rationale, and cite precedent.
- Tests meaningful: `inputs.css.test.ts` / `ActionsMenu.css.test.ts` assert
  the media block's `max-width: 768px` prelude and the `min-height: 44px` +
  `display: flex` + `align-items: center` rule bodies — would catch a
  regression that removed or weakened the rule. Both pass.
- Behavior-preserving: confirmed the change is purely additive inside a new
  media block; nothing outside it was touched.

### Phase 3: UI Review — PASS

Ran `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` —
`PASS servers`.

**Verified via `getBoundingClientRect` (real DOM + a lightweight injected-element
technique for the unreachable actions-menu, see note below):**

| Selector | 390×844 dark | 390×844 light | 320×568 | 768×800 (boundary) | 1100×800 | 1440×900 |
|---|---|---|---|---|---|---|
| `.ui-select__option` (real popovers: panel-detail field select, chart-type creator select, pipeline sort-key select) | 44px | 44px | 44px | 44px | 34px | 34px |
| `.actions-menu__item` (real desktop kebab + injected element, see note) | 44px (injected) | 44px (injected) | — | 44px (injected) | 31px | 31px (real, panel-card kebab: Rename/Customize/Duplicate/Delete) |

- Happy path: field select (30 options), chart-type select (4 options),
  pipeline sort-key select (3 options) all open, scroll (30-option list:
  `scrollHeight` 1372 > `clientHeight` 278, `overflow-y: auto`,
  `max-height: 280px` unchanged), and select correctly in both themes.
- No horizontal overflow at 320px (`document.documentElement.scrollWidth ===
  window.innerWidth`).
- Zero console errors across every interaction (only pre-existing,
  unrelated `selectPipelineOutputDataTypes` memoization warnings).
- Desktop density confirmed unchanged both via real DOM (panel-card kebab at
  1440px: 31px item rows) and injected-element measurement at 1100/1440px
  for both classes, and the `max-width: 768px` boundary is inclusive
  (confirmed 44px exactly at 768px, 34/31px at 769px+ conceptually via 1100).

**Required check that could not be performed as specified — reported, not
blocking:**

- "Open a bottom-of-screen panel card's kebab menu at 390×844 and confirm
  it stays on-screen": at 390×844, `PanelCard`'s `ActionsMenu` kebab does not
  render at all — the dashboard grid mounts `MobilePanelStack` (read-only
  `PanelCardBody`, no `ActionsMenu` import) below the `sm` breakpoint, and I
  confirmed via `grep` that `MobilePanelStack.tsx` never imports
  `ActionsMenu`. I could not find any reachable `.actions-menu__item` at
  ≤768px anywhere in the app (Dashboards sidebar, Data Sources, Data
  Pipelines — all hide `.app-sidebar` at that width). I instead verified the
  CSS rule directly by injecting a detached `.actions-menu__item` element
  into the live page at 390×844 (both themes) and confirmed `min-height:
  44px` / `display: flex` / `align-items: center` apply correctly, and revert
  to the original `31px` / `display: block` above 768px. The rule is
  mechanically correct; its real-world reachability is a separate,
  pre-existing architecture fact (see Phase 1 note), not a HEL-308 defect.

**Unrelated pre-existing bug found during exploration (informational,
recommend spinoff, NOT a HEL-308 regression):**

- The chart-type `<Select>` inside `panel-creation-modal` (creating a new
  Chart panel, "Select chart type" step) renders its popover almost entirely
  below the visible viewport at 390×844: `usePortalPopover` computes
  `top: rect.bottom + 4` = `493.5px` (verified via `panel.style.top`), but
  the panel's actual rendered `getBoundingClientRect().top` is `776px` — a
  ~283px discrepancy, evidently a `position: fixed` containing-block issue
  specific to how the select is portalled into that particular `<dialog>`.
  I confirmed this is **independent of the HEL-308 CSS change** — the `top`
  style value is computed by JS from the trigger rect before any option
  row renders, so row height cannot affect it — and confirmed the identical
  positioning mechanism works correctly (rect matches the computed style
  exactly) for the `panel-detail-modal`'s field select. Not touched by this
  diff (`Select.tsx` / `usePortalPopover.ts` / `PanelCreationModal` CSS are
  all unmodified); recommend a spinoff ticket.

### Overall: PASS

### Non-blocking Suggestions

- Consider correcting the proposal/design's claim that `.actions-menu__item`
  is "mobile-reachable via PanelCard / DashboardList / SidebarItemList" —
  none of those three are reachable at ≤768px in the current app. The fix is
  harmless, tested, and consistent with the touch-target convention, but the
  stated justification doesn't match today's architecture.
- Spinoff candidate: `panel-creation-modal`'s portalled `<Select>` popover
  renders far below its JS-computed position at phone width (see Phase 3
  finding above) — some chart-type options are practically unreachable by
  touch in that specific modal at 390×844. Unrelated to HEL-308's diff.
