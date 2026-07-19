# HEL-314 — Final mobile tap-target audit (task 3.3)

Re-audit of interactive controls in the mobile-shell chrome and shared components.
"Covered" = the control meets the ≥ 44px tap-target floor at the phone breakpoint
(`max-width: 768px`) **and** is actually rendered on the phone shell, verified by a
rendered `getBoundingClientRect` at 390×844. "Defensive" = the 44px rule is present
and correct at `max-width: 768px` but the control is **not mounted** on the phone
shell, so there is no rendered element to measure (verified via computed style /
CSS-lock test only). The bare `.ui-select__trigger` is rendered-verified; the
`.actions-menu__trigger` is defensive — see the Evidence section.

## Mobile-shell chrome (phone PWA)

| Control                                         | Source                          | Mobile size            | Status                     |
| ----------------------------------------------- | ------------------------------- | ---------------------- | -------------------------- |
| `.bottom-nav__tab`                              | `BottomNav.css`                 | bar 56px, min-width 44 | Covered (rendered)         |
| `.mobile-nav-sheet__item`                       | `MobileNavSheet.css`            | min-height 44          | Covered (HEL-270/308)      |
| `.actions-menu__item`                           | `ActionsMenu.css`               | min-height 44          | Covered (HEL-308)          |
| **`.ui-select__trigger`** (bare)                | `inputs.css`                    | **min-height 44**      | **Covered, rendered-verified (this change) — 182×44 at 390px in pipeline step-config** |
| `.ui-select__option`                            | `inputs.css`                    | min-height 44          | Covered (HEL-308)          |
| `.panel-detail-modal__edit-btn` / `__close` / `__btn` / `__mode-toggle-btn` / `__type-option` / `__type-clear` | `PanelDetailModal.mobile.css` | min 44 | Covered (HEL-303) |
| `.panel-list__*` / `.panel-grid` phone controls | `PanelList.css` / `PanelGrid.css` | 44 rules present     | Covered (HEL-245/303)      |
| **`.actions-menu__trigger`**                    | `ActionsMenu.css`               | **min 44×44 (defensive)** | **NOT rendered on phone shell — see below** |

`MobilePanelStack` cards are whole-panel surfaces (auto/fixed height), not discrete
tap-target buttons, so the 44px floor does not apply.

### `.actions-menu__trigger` is a defensive (inert) rule — not a live phone tap target

Independently reproduced (final-gate skeptic, real authenticated dev app; confirmed
against the CSS here): the kebab trigger is **not mounted on the phone shell**, so it
is **0×0 at 390px** and there is no rendered phone element that measures ≥44px.

- The two host chromes that render a *visible* kebab are hidden or replaced below
  768px: the desktop sidebar dashboard-list is `display: none` at `max-width: 768px`
  (`App.css:395`), and `PanelGrid` mounts `MobilePanelStack` → `PanelCardBody` on
  phone, which omits the kebab.
- The kebab is first visible at **≥769px** (desktop chrome), where the media query
  `(max-width: 768px)` is inactive. So the desktop-visibility threshold (≥769px) and
  this change's mobile rule (≤768px) **do not overlap** — the `min-width/min-height:
  44px` rule never applies to any *visible* kebab in a reachable viewport. It is a
  **defensive** rule: correct if that chrome is ever shown ≤768px, but inert today.
- The CSS rule and its CSS-lock test are kept regardless (the guard is cheap and the
  rule is correct); the lock test is the real regression guard for the kebab, not a
  rendered-height assertion.

**Assertion (revised):** no remaining sub-44px interactive control among the
*rendered* phone PWA shell chrome (bottom nav, nav sheet, panel stack, panel-detail
modal, actions-menu items, select popovers, and the bare select trigger). The
`.actions-menu__trigger` 44px rule is present and correct but defensive (its host
chrome is not part of the phone shell).

## Remaining sub-44px controls — out of this change's scope (spinoff candidates)

The bottom nav routes to `/sources`, `/pipelines`, and `/registry` on phone, so the
following **shared** controls are phone-reachable yet still below 44px. They are
outside this change's scoped surface (the proposal/spec fix only the two triggers
above; these controls have no `max-width: 768px` override) and are flagged here so
the "app-wide" claim stays falsifiable rather than overstated:

| Control                 | Source            | Mobile size                    | Phone-reachable via            |
| ----------------------- | ----------------- | ------------------------------ | ------------------------------ |
| `.ui-modal__close`      | `shared/ui/Modal.css` | 28px (`--control-sm`)      | CreatePipelineModal, AddSourceModal, RunHistoryModal, PipelinePreviewModal, PipelineShareDialog, ProposalReview |
| `.ui-modal-btn`         | `shared/ui/Modal.css` | 32px (`--control-md`)      | same shared-Modal footers      |
| `.ui-empty-state__cta`  | `shared/ui/EmptyState.css` | 32px (main) / 28px (sidebar) | any phone-reachable empty state |
| `.ui-input` / `.ui-textarea` (trigger height) | `shared/ui/inputs.css` | 32px min-height | shared form fields (text inputs; borderline — HEL-308 sweep bumped option rows/triggers, not text fields) |

Recommendation: a follow-up ticket to bring the shared `Modal` chrome
(`.ui-modal__close`, `.ui-modal-btn`) and `EmptyState` CTA to the 44px floor at
`max-width: 768px`, matching the `PanelDetailModal.mobile.css` precedent, if the
pipeline/source management flows are to be treated as first-class phone surfaces.
This was not in HEL-314's planned scope (two trigger controls) and touching it here
would exceed the surgical CSS+test continuation the proposal/design ratified.

## Evidence

### Bare `.ui-select__trigger` — rendered-verified (real Chromium, 390×844, authenticated dev app)

| Viewport / theme | select trigger              | source          |
| ---------------- | --------------------------- | --------------- |
| 390px (phone)    | **182×44** (`getBoundingClientRect`), computed `min-height: 44px` | final-gate skeptic, pipeline step-config (30 visible triggers); evaluator independently saw 310×44 on CreatePipelineModal |
| >768px (desktop) | height **32** (`--control-md`, unchanged) | — |

This half of the change is genuinely reachable and correct. AC-1 holds for the
select trigger.

### `.actions-menu__trigger` — computed-style / CSS-lock only (NOT rendered on phone)

There is **no** rendered phone measurement for the kebab, because it is not mounted
on the phone shell (see the "defensive rule" section above). What is verified:

- **Computed style:** inside the `max-width: 768px` block the kebab resolves
  `min-width: 44px; min-height: 44px` (CSS-lock test `ActionsMenu.css.test.ts`
  guards this; a negative probe — removing the rule — makes the test fail).
- **Rendered reality (final-gate skeptic, real app):** every `.actions-menu__trigger`
  in the DOM is **0×0 at 390px**; the first *visible* kebab appears at **769px** at
  **24×24** with `matchMedia('(max-width: 768px)') === false`.
- **Desktop size is 24×24, not 28×28.** The base `.actions-menu__trigger` is
  `--control-sm` (28px), but every call site that renders a visible kebab overrides
  it to 24px: `.panel-grid-card__actions .actions-menu__trigger` (`PanelGrid.css:70`)
  and `.dashboard-list__item-row .actions-menu__trigger` (`DashboardList.css:238`),
  both outside any media query. (My earlier synthetic-harness figure of "44×44 phone /
  28×28 desktop" was wrong: the harness hand-mounted the base kebab with no host
  chrome, so it neither reflected the phone shell — where the kebab is absent — nor
  the real 24px desktop override. That measurement is retracted.)

### AC-1 divergence (on record)

Ticket AC-1 (in Linear, not editable from here) asserts the kebab "measures ≥44px at
390px (`getBoundingClientRect`, both themes)". That is **false as written** for the
`.actions-menu__trigger`: it is 0×0 at 390px because the kebab is not on the phone
shell. The in-repo spec (`specs/shared-popover-touch-targets/spec.md`) and this audit
have been reconciled to the truthful, testable condition (computed 44px floor at
`max-width: 768px` + CSS-lock guard, defensive). The bare-select half of AC-1 is met
and rendered-verified. This divergence should be reflected back to Linear AC-1 when
the change is archived.
