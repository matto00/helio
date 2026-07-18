## Context

`PanelDetailModal.css` is 1045 lines and imported once by `PanelDetailModal.tsx`
(`import "./PanelDetailModal.css";`). Its structure (verified via section-banner comments)
is: shell/backdrop/inner → header/close/unsaved-badge/header-actions/edit-btn → view body →
edit-section-headings → content/row/field/slider → data tab (type search/list/selected-type/
mapping rows/mode toggle) → collection segmented control → table display (columns/reorder/
reset) → chart display controls → mobile ≥44px block → discard warning → footer → chart
appearance → chart type selector → markdown/text content textarea → image-upload control.

It contains exactly THREE real `@media` at-rules (line 712 is a comment, not an at-rule):
- `max-width: 430px` at line 22 (shell full-screen-dialog tweak: `.panel-detail-modal`
  `width: 100vw` etc., overriding the base `width: min(540px, 96vw)` at lines 1-11)
- `max-width: 768px` at line 623 — the **locked** mobile ≥44px tap-target block
- `max-width: 430px` at line 887 (chart-type-selector tweak)

`PanelDetailModal.css.test.ts` reads a single file via `path.join(__dirname,
"PanelDetailModal.css")`, then `findMediaBlock(css, "max-width: 768px")` locates the FIRST
`@media` whose prelude contains the substring `max-width: 768px` and asserts ~16 locked
selectors all live inside that one block. The substring match is specific, so the two
`430px` blocks never satisfy it.

Ground-truthed cascade fact: every locked mobile override sets ONLY `min-height`/`min-width:
44px`. The corresponding desktop rules set `height`/`width` (e.g. `.panel-detail-modal__btn`
desktop sets `height: var(--control-md)`; its mobile rule sets `min-height: 44px`). These are
DIFFERENT properties, so the mobile overrides do not collide with any desktop declaration —
moving all mobile rules to load LAST cannot change desktop rendering and can only strengthen
(never weaken) the mobile overrides at phone widths.

DESIGN.md tokens (from `theme.css`): `--space-1` 4px, `-2` 8px, `-3` 12px, `-4` 16px,
`-5` 20px, `-6` 24px, `-7` 32px, `-8` 40px, `-9` 48px, `-10` 64px. DESIGN.md permits small
optical tweaks ≤4px to remain literal. Values seen with NO exact token (must stay literal):
2px, 5px, 6px, 7px, 10px, 14px, 18px, and all 44px tap targets and 1px borders.

## Goals / Non-Goals

**Goals:**
- Replace literal spacing px with the exactly-equal `--space-*` token everywhere one exists.
- Split into sibling CSS files each comfortably under ~400 lines, along section boundaries.
- Keep the `max-width: 768px` ≥44px block intact and in ONE file; repoint the test there.
- Preserve pixel-identical rendering at desktop + 390×844, both themes.

**Non-Goals:**
- No token invention, no rounding, no ≤4px-optical migration where no exact token exists.
- No component/logic change; no assertion weakening.

## Decisions

**D1 — Split axis (5 files, each well under 400 lines).** A 4-way split risks the per-kind
file landing ~418 lines (measured), over the AC's ~400 budget, so use five files:
- `PanelDetailModal.css` — shell/chrome: dialog, backdrop, inner, header, title, close,
  unsaved badge, header actions, edit button, view body, edit-section headings, discard
  warning, footer + Save/Cancel buttons. (~260 lines) Keeps the original filename.
- `PanelDetailModal.binding.css` — content/row/field/slider + data tab (type search/list/
  selected-type, mapping rows, bind/literal mode toggle). (~250 lines)
- `PanelDetailModal.sections.css` — per-kind config editors: collection segmented control,
  table display (columns/reorder/reset), chart display controls. (~190 lines)
- `PanelDetailModal.appearance.css` — chart appearance, chart-type selector, markdown/text
  content textarea (`.panel-detail-modal__markdown-textarea`), image-upload control. (~225
  lines) — everything below the mobile block in the original except the `@media` at line 887.
- `PanelDetailModal.mobile.css` — ALL THREE `@media` blocks consolidated (both `430px` blocks
  and the single `768px` ≥44px block). Test `CSS_PATH` repoints here. (~100 lines)

Rationale: matches the ticket's suggested axis with headroom; BEM class names are
section-scoped and property-disjoint, so no cross-file equal-specificity collision exists.

**D2 — Import wiring via TSX, NOT a CSS `@import` barrel.** A CSS `@import` barrel is
INVALID here: the CSS spec requires `@import` statements to precede all other rules in a
file, so a barrel `PanelDetailModal.css` could not keep its own shell rules (e.g. the base
`.panel-detail-modal { width: min(540px, 96vw) }`) BEFORE an imported `mobile.css`'s
`@media (max-width: 430px) { .panel-detail-modal { width: 100vw } }` override — it would load
the base AFTER the override and silently break the ≤430px full-screen dialog. Instead, add
sibling style imports to `PanelDetailModal.tsx` in exact cascade order:
```
import "./PanelDetailModal.css";            // shell/base — FIRST
import "./PanelDetailModal.binding.css";
import "./PanelDetailModal.sections.css";
import "./PanelDetailModal.appearance.css";
import "./PanelDetailModal.mobile.css";     // all @media overrides — LAST
```
Vite/PostCSS injects stylesheets in import order, so base rules precede every `@media`
override (correct today's order) and mobile overrides win at their breakpoints. This is
"import-path wiring only" — no component logic changes. Alternative (single `@import` barrel)
rejected as spec-invalid per the above.

**D3 — Token migration rule (exact-equal, per-component for shorthands).**
- Migrate a spacing declaration ONLY if a token's px is exactly equal
  (4/8/12/16/20/24/32/40/48/64). Migrate widths/heights/min-height/min-width (incl. all 44px
  tap targets), border widths, and no-exact-token values NEVER.
- For SHORTHAND declarations (e.g. `padding: 8px 12px`, `padding: 8px 4px`), tokenize
  PER-COMPONENT: each exact-equal component becomes its token, each non-exact component stays
  literal — e.g. `padding: 8px 12px` → `padding: var(--space-2) var(--space-3)`; `padding:
  8px 4px` → `var(--space-2) var(--space-1)`; `padding: 7px 10px` stays fully literal (neither
  7 nor 10 has a token). Per-component substitution is pixel-exact and preserves behavior.
- Record every intentionally-retained literal in the tasks notes.

## Risks / Trade-offs

- [Split changes a rule's relative source order and shifts a pixel] → BEM section classes are
  property-disjoint across files; mobile overrides set only min-*; verified no cross-file
  collision. Preserve exact within-block source order; move whole contiguous blocks. Net:
  pixel-diff screenshots at desktop + 390×844 in BOTH themes are the binding safety gate.
- [Mobile file loaded last strengthens an override vs. today] → For the 768px ≥44px block this
  is doubly safe (min-* only, property-disjoint). For the two `430px` blocks, which DO override
  the same properties as their base rules (e.g. `.panel-detail-modal { width }`), correctness
  rests specifically on `mobile.css` being the UNCONDITIONALLY last-imported stylesheet so every
  `@media` override still follows its base rule. Keep the mobile import strictly last; confirm
  via the 390×844 (and ≤430px) screenshots.
- [Test silently passes against stale file] → After retargeting `CSS_PATH` to
  `PanelDetailModal.mobile.css`, confirm the suite still EXECUTES all locked cases (count > 0)
  and the mobile file actually contains the `max-width: 768px` block.
- [A "spacing" value is actually a dimension] → Only migrate margin/padding/gap/inset; never
  widths/heights/tap-targets/borders.

## Migration Plan

1. Screenshot baseline first (desktop + 390×844, both themes, representative kinds).
2. Token pass in place on `PanelDetailModal.css` (per-component shorthand rule); re-run the
   CSS-lock suite (still single file) to confirm 44px literals untouched.
3. Carve sections into the four new sibling files; move all `@media` blocks into
   `PanelDetailModal.mobile.css`; add the five TSX imports in cascade order.
4. Repoint the test `CSS_PATH`; run `npm test -- --testPathPattern=PanelDetailModal.css`,
   full `npm test`, lint, format:check, build.
5. After screenshots; pixel-diff against baseline — must be visually identical.
Rollback: revert the branch — no data/contract impact.

## Open Questions

- None blocking.

## Planner Notes

Self-approved: pure refactor, no external deps, no API/schema/contract change, scope matches
the ticket exactly — no escalation warranted.
