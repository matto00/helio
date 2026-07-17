# Files modified — mobile-style-ux-polish (HEL-303)

Style-only pass. No behavior/backend/schema changes. All edits are CSS or CSS-lock tests.

## Source

- `frontend/src/shared/chrome/MobileNavSheet.css` — added a `@media (max-width: 768px)` block lifting `.mobile-nav-sheet__item` to `min-height: 44px` (was `--control-lg` = 40px, under the HIG minimum), mirroring the established `BottomNav.css` / `PanelDetailModal.css` literal-`44px` tap-target convention.
- `frontend/src/features/panels/ui/PanelDetailModal.css` — extended the existing 768px mobile block with `min-height: 44px` for the header Edit button (`__edit-btn`, was 28px), a 44×44 minimum for the header Close button (`__close`, was 28px), and `min-height: 44px` for the footer Save/Cancel buttons (`__btn`, was 32px). These are the entry/exit controls of the edit flow reachable by tapping a stack panel on phone; HEL-245/255/248/247 had covered only the editor-content controls. **Cycle 2 (evaluator live-measurement gaps):** added `min-height: 44px` for the Chart Display checkbox rows (`.panel-detail-modal__chart-label` — Show legend / Enable tooltip / Show X/Y-axis label, measured ~19px tall live) and a 44×44 minimum for the Series-color swatches (`.panel-detail-modal__color-swatches input[type="color"]`, 32×28px) — both reachable in every chart panel's edit flow.
- `frontend/src/features/panels/ui/MobilePanelStack.css` — added `--collection` to the intrinsic-height container-type override rule and added a `.mobile-panel-stack__item--collection .panel-content--collection { height: auto; overflow: visible }` rule. Fixes a collection-panel collapse + forbidden nested scroller in the stack (see root cause below).

## Tests

- `frontend/src/shared/chrome/MobileNavSheet.css.test.ts` — NEW static CSS lock asserting the ≥44px sheet-row rule at the mobile-shell breakpoint (findMediaBlock/findRuleBody scan, mirroring the existing `PanelDetailModal.css.test.ts` / `MobilePanelStack.css.test.ts` locks).
- `frontend/src/features/panels/ui/PanelDetailModal.css.test.ts` — added a HEL-303 lock for the header/footer ≥44px rules (edit-btn, close 44×44, footer btn).
- `frontend/src/features/panels/ui/MobilePanelStack.css.test.ts` — extended the intrinsic-height/container-type guard to include `collection`, and added a lock for the collection content-body intrinsic-sizing rule (no nested scroller).

## Bug found + fixed during the audit (CSS-only, in scope)

**Symptom:** A `collection` panel would collapse to ~0 content height in the phone stack, and (secondarily) render a forbidden internal scroller.

**Root cause (CSS layer, `MobilePanelStack.css`):** `collection` is an intrinsic-height kind — `mobilePanelHeights.ts:112` returns `height: null`, so no `--mobile-panel-height` is set. `.panel-grid-card` (`PanelGrid.css:28,31`) applies `container-type: size` + `height: 100%` unconditionally; against the stack's auto-height flex parent that resolves to `auto`, and `container-type: size` on an auto-height box collapses it to ~0 — the exact failure mode HEL-301 fixed for table/markdown/text/image. `collection` (added later, HEL-247) was absent from that override list. Separately, `CollectionRenderer.css:10` sets `overflow-y: auto` (desktop's in-card scroll), which the `mobile-panel-sizing` spec forbids for collection in the stack.

**Probe:** Static code trace (jsdom implements no CSS containment or real layout, which is precisely why these kinds are guarded by static CSS-lock tests rather than DOM-render tests — see the header comment in `MobilePanelStack.css.test.ts`). Evidence: `grep` confirmed `collection` was absent from every override rule in `MobilePanelStack.css`; `mobilePanelHeights.ts:106-112` confirmed `height: null` for collection; `PanelGrid.css:28,31` confirmed the unconditional `container-type: size` + `height: 100%`; `CollectionRenderer.css:10` confirmed `overflow-y: auto`.

**Fix:** Added `collection` to the intrinsic-height override (restores `container-type: inline-size; height: auto`) and made its content body intrinsic (`height: auto; overflow: visible`) — mirroring the existing markdown/text overrides. Locked by the extended `MobilePanelStack.css.test.ts`. This implements the `mobile-panel-sizing` spec's collection requirement ("fully intrinsic — no fixed height, no internal scroll; the item grid wraps to the stack's content width").

## Spinoff candidate reported (not fixed inline)

- **PanelDetailModal.css pre-token spacing debt + file split.** The now-1030-line shared desktop/mobile modal uses ~50 literal `Npx` gap/padding values (8/12/14/18/20px etc.). Many (14, 18, 6, 7, 5, 10px) have no matching `--space-*` token, so a partial conversion would leave the file more inconsistent, and the values drive desktop layout — a wholesale token migration is out of this mobile-shell style pass's scope and risk budget. The file is also well over CONTRIBUTING.md's ~400-line "propose a split" threshold (pre-existing; this change added ~40 mobile-scoped lines). Recommend a dedicated spinoff to (a) migrate PanelDetailModal.css spacing to tokens holistically and (b) propose a file split at the same time.
- **Stale-form-state bug (evaluator finding, out of scope).** The evaluator reproduced a pre-existing behavioral bug: jumping directly from one panel's open edit form to another (without closing the modal first) shows the previous panel's stale title value under the new panel's correct dialog. This is untouched PanelDetailModal state-management behavior — spinoff candidate, not part of this style-only change.

## Color-swatch decision (cycle 2, CR3) — FIXED, not exempted

The evaluator flagged the Series-color swatches (`input[type="color"]`, 32×28px) as a softer finding because native color inputs' effective hit areas vary by engine. **Decision: fix, not exempt.** This ticket's mandate is measured ≥44px targets on every reachable edit control, and the swatches sit in the same reachable Chart Display flow as the checkbox rows. A 44×44 minimum via the same `@media` pattern is consistent with the other icon-sized controls already lifted this way (`__close`, `__type-clear`, `__column-move-btn`). Crowding does not get worse: `.panel-detail-modal__color-swatches` already sets `flex-wrap: wrap`, so at ~350px phone content width the 7 wider swatches wrap to a second row rather than overflow. Locked by `PanelDetailModal.css.test.ts`.

## Notes on scope / verification division

- No `mobilePanelHeights.ts` constant changed: metric (120px) and chart (`clamp(200, w×0.62, 340)`) sit within the `mobile-panel-sizing` spec bands and are documented within-band starting values; Decision 4 forbids evidence-free tuning, and the static audit surfaced no per-kind sizing problem (only the collection collapse, which is a CSS-rule gap, not a constant value). No `specs/mobile-panel-sizing` delta needed.
- **Verification division / delegated live measurements (CR4).** The executor environment has **no browser**, so executor verification is automated gates (lint/format/test/build) + static CSS/code analysis. Cycle 1 proved this misses a real defect class: the **rendered pixel height of a reachable control** (the ~19px chart-label rows, the 32×28px swatches) cannot be observed by jsdom or by grepping CSS, because it depends on real layout plus the intrinsic size of native form controls (a 13px checkbox, a native color input). Every 44px rule this change adds is now locked by a static `*.css.test.ts` assertion — but a CSS lock only proves *the rule exists*, **not** that the rendered control clears 44px. These measurements are therefore delegated to the evaluator/skeptic's live 390×844 (both themes) `getBoundingClientRect` pass:
  1. `.panel-detail-modal__chart-label` rows render ≥44px tall (checkbox + text vertically centred).
  2. `.panel-detail-modal__color-swatches input[type="color"]` render ≥44×44 and wrap without overflow at phone width.
  3. All cycle-1 controls (sheet rows, header/footer buttons, collection intrinsic sizing) re-confirm unchanged.
  The CSS-lock tests are the durable in-repo guard against *regression* of these rules; the live pass is the guard against *incompleteness* of the rule set — exactly the gap cycle 1 had.
