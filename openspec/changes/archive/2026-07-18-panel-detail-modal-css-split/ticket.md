# HEL-309 — PanelDetailModal.css token migration + file split

Type: refactor · Priority: Low · Project: Helio v1.5 — Panel System v2

## Context

Accumulated debt flagged across the v1.5 phase reviews (HEL-245/248/303):
`frontend/src/features/panels/ui/PanelDetailModal.css` is ~1024 lines (actually 1045)
(soft budget ~400) and carries ~50 literal px spacing values that should be DESIGN.md
spacing tokens. The mobile ≥44px `@media` block and its CSS-lock tests
(`PanelDetailModal.css.test.ts`) now guard many rules in this file — any split must
keep those locks passing.

## What

One holistic, behavior-preserving pass:
1. Migrate literal spacing values to DESIGN.md tokens (`--space-1` 4px … `--space-10` 64px).
2. Split the file along the modal's section structure (e.g. chrome / binding editor /
   per-kind sections / mobile overrides).

Structural refactor only — no visual changes beyond exact token equivalents; verify with
before/after screenshots at desktop and 390×844 in both themes.

## Acceptance criteria

- [ ] No literal px spacing values remain where a DESIGN.md token exists
- [ ] No file exceeds the ~400-line soft budget after the split
- [ ] All existing CSS-lock tests still pass (44px mobile rules intact)
- [ ] Screenshot diff shows no visual change at desktop and 390×844 in both themes

## Hard constraints (from orchestrator brief)

- BEHAVIOR-PRESERVING STRUCTURAL REFACTOR. refactor-discipline rule is paramount:
  NO visual changes beyond exact token equivalents.
- The mobile ≥44px `@media` blocks and their CSS-lock tests (`PanelDetailModal.css.test.ts`,
  and any sibling locks) MUST keep passing. If the split moves rules across files, update
  the lock tests' file targets accordingly but do NOT weaken the assertions. The ≥44px
  touch-target guarantees from HEL-245/255/248/303 ride on these.
- Only migrate a literal to a token when the token's value is EXACTLY equal to the literal —
  no "close enough" rounding that shifts pixels. If a literal has no exact token, LEAVE it
  and note it. Small optical tweaks ≤4px MAY remain literal per DESIGN.md.
- Verify with before/after screenshots at desktop AND 390×844 in BOTH themes; the diff must
  be visually identical (pixel-identity, not "looks fine").
- No component/TSX behavior changes; CSS + test-target updates + any necessary import-path
  wiring only.

## Key technical note (from orchestrator verification)

`PanelDetailModal.css.test.ts` reads a single CSS file via `path.join(__dirname,
"PanelDetailModal.css")` and calls `findMediaBlock(css, "max-width: 768px")`, which locates
the FIRST `@media (max-width: 768px)` block and asserts ALL locked selectors
(mode-toggle-btn, type-option, ui-select__trigger, type-clear, edit-btn, btn, close,
column-row, column-visibility, reset-widths-btn, column-move-btn, toggle-row, slider,
chart-label, color-swatches input[type=color], segmented-btn) live inside that one block.
=> If the split relocates the mobile `@media` block to a separate file, ALL those mobile
overrides must stay together in ONE `@media (max-width: 768px)` block in ONE file, and the
test's `CSS_PATH` must be repointed at that file. Do not weaken any assertion.
