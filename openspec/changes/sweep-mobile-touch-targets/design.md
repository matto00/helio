## Context

HEL-308 established the mobile ≥44px tap-target convention for shared popover option rows
(`.ui-select__option`) and menu items (`.actions-menu__item`), each guarded by a `max-width: 768px`
media block and a static CSS-lock test (`inputs.css.test.ts`, `ActionsMenu.css.test.ts`). Two trigger
controls were left below the minimum:

- `.actions-menu__trigger` — a `--control-sm` (28px) square kebab button in panel-card, dashboard-list,
  and sidebar header rows.
- Bare `.ui-select__trigger` — `min-height: var(--control-md)` (32px) in the shared `inputs.css`
  primitive, used at call sites outside `.panel-detail-modal` (which already has its own mobile
  override).

jsdom evaluates no layout or media queries, so rendered-height assertions are impossible in Jest; the
established pattern is a static CSS-lock test that greps the mobile media block for the rule.

## Goals / Non-Goals

**Goals:**
- Bring `.actions-menu__trigger` (width + height) and bare `.ui-select__trigger` (height) to ≥44px at
  `max-width: 768px`, both themes, with glyph/label centered.
- Preserve desktop density exactly (all new rules live inside the mobile media block).
- Add one CSS-lock test per new rule, matching the existing precedent.
- Verify the taller kebab does not break its host header rows at 390×844.

**Non-Goals:**
- No change to `.panel-detail-modal`-scoped trigger overrides (already handled).
- No JS/TSX changes, no desktop restyle, no new tokens.

## Decisions

- **Literal `44px`, mobile media block only** — matches the existing HEL-308 rules and
  `MobileNavSheet.css` / `PanelDetailModal.css` convention. Alternative (a shared `--tap-target` token)
  is out of scope and would touch more than these two files; rejected to keep the sweep surgical.
- **Kebab: set both `min-width: 44px` and `min-height: 44px`** rather than overriding `width`/`height`.
  The trigger is a square icon button, so both axes must clear 44px; using `min-*` leaves desktop's
  fixed `--control-sm` intact while letting the mobile floor win. The dots glyph is already
  `inline-flex` column-centered inside a flex button, so centering holds once the box grows. Verify at
  390×844 that the wider button does not push sibling header controls (the "resizing affects layout"
  caveat from the ticket).
- **Bare select: add `min-height: 44px`** in the shared `.ui-select__trigger` rule's mobile block. It
  is already `display: flex; align-items: center`, so the label stays centered with only a height bump —
  no flex switch needed (unlike the `display: block` option rows in HEL-308). The `.panel-detail-modal`
  override is a more specific selector and is unaffected.
- **CSS-lock tests** extend the existing `ActionsMenu.css.test.ts` and `inputs.css.test.ts` with
  cases asserting the trigger selectors' mobile `min-height`/`min-width: 44px`, reusing their
  `findMediaBlock` / `findRuleBody` helpers.

## Risks / Trade-offs

- [Taller/wider kebab shifts header layout] → Use `min-width`/`min-height` (not fixed size); verify at
  390×844 in panel-card and dashboard-list headers that rows do not overflow and controls stay aligned.
  If a specific host row is tight, the fix stays in that host's mobile CSS, not the shared rule.
- [Bare-select rule leaking into an already-covered call site] → `.panel-detail-modal` override is more
  specific and lives in its own file; the shared floor is a no-op where a taller override already
  applies.
- [CSS-lock test brittleness to formatting] → Reuse the existing brace-matching helpers, which are
  whitespace-tolerant.

## Planner Notes

- Self-approved: no external deps, no API/contract change, no architectural change — a scoped CSS +
  test continuation of HEL-308. No escalation warranted.
