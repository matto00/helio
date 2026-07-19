## Context

HEL-308/314 established the mobile ≥44px tap-target convention for shared controls, each guarded by a
`@media (max-width: 768px)` block plus a static CSS-lock test (`inputs.css.test.ts`,
`ActionsMenu.css.test.ts`). Three controls in the shared `Modal` and `EmptyState` primitives are still
below the floor and are phone-reachable via bottom-nav create/empty-state routes:

- `.ui-modal__close` — a `--control-sm` (28px) square icon button (`Modal.css`).
- `.ui-modal-btn` — a `--control-md` (32px) footer button (`Modal.css`).
- `.ui-empty-state__cta` — a `--control-md` (32px) CTA button (`EmptyState.css`); its sidebar variant
  drops to `--control-sm` (28px) but the sidebar column is hidden at ≤768px.

Neither `Modal.css` nor `EmptyState.css` currently has any `@media (max-width: 768px)` block, and
neither has a `.css.test.ts` yet. jsdom evaluates no layout or media queries, so rendered-height
assertions are impossible in Jest; the established pattern is a static CSS-lock test that brace-matches
the mobile media block and greps the rule.

## Goals / Non-Goals

**Goals:**
- Floor `.ui-modal__close` (both axes), `.ui-modal-btn` (height), and `.ui-empty-state__cta` (height)
  to ≥44px at `max-width: 768px`, both themes, glyph/label centered.
- Preserve desktop density exactly (all new rules live inside the mobile media block).
- Add one CSS-lock test per new rule, matching the existing precedent, in new `Modal.css.test.ts` and
  `EmptyState.css.test.ts`.

**Non-Goals:**
- No changes to already-covered `.panel-detail-modal`-scoped overrides.
- No JS/TSX changes, no desktop restyle, no new design tokens.

## Decisions

- **Literal `44px`, mobile media block only** — matches the HEL-308/314 rules and the
  `MobileNavSheet.css` / `PanelDetailModal.css` convention. A shared `--tap-target` token is out of
  scope (would touch more than these two files); rejected to keep the sweep surgical.
- **`.ui-modal__close`: set both `min-width: 44px` and `min-height: 44px`** rather than overriding
  `width`/`height`. It is a square icon button, so both axes must clear 44px; `min-*` leaves desktop's
  fixed `--control-sm` intact while the mobile floor wins. The glyph is already `inline-flex`
  center/center, so centering holds once the box grows.
- **`.ui-modal-btn`: add `min-height: 44px`** in the mobile block. It is already `inline-flex;
  align-items: center`, so the label stays centered with only a height bump. Desktop keeps
  `height: var(--control-md)` (32px). The footer is `align-items: center`, so a taller button does not
  disturb its row.
- **`.ui-empty-state__cta`: add `min-height: 44px`** on the base selector in the mobile block. Because
  `min-height` always wins over a smaller computed `height`, this also floors the more-specific
  `.ui-empty-state--sidebar .ui-empty-state__cta` (28px) override defensively — acceptable since the
  sidebar variant is not mounted at ≤768px (the sidebar column is hidden on the phone shell), and even
  if shown it should meet the floor. The CTA is already `inline-flex; align-items: center`.
- **CSS-lock tests** — new `Modal.css.test.ts` and `EmptyState.css.test.ts` reuse the
  `findMediaBlock` / `findRuleBody` brace-matching helpers from `inputs.css.test.ts`, asserting the
  mobile block keeps `min-height: 44px` (and `min-width: 44px` for the close button) for each selector.

## Risks / Trade-offs

- [Taller close button shifts the header] → `.ui-modal__header` is `align-items: flex-start` with the
  close button `flex-shrink: 0`; a 44px min box only affects its own footprint. Verify at 390×844 that
  the header row and title do not overflow.
- [Base `.ui-empty-state__cta` floor leaking into an unwanted call site] → only applies at ≤768px where
  the sidebar variant is not mounted; the main hero CTA is the intended target. Acceptable and
  defensive.
- [CSS-lock test brittleness to formatting] → reuse the existing whitespace-tolerant brace-matching
  helpers.

## Planner Notes

- Self-approved: no external deps, no API/contract change, no architectural change — a scoped CSS +
  test continuation of the HEL-308/314 sweep. No escalation warranted.
