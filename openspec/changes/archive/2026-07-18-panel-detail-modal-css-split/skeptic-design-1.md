## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/panel-detail-modal-css-structure/spec.md` in full.
- Read the full `frontend/src/features/panels/ui/PanelDetailModal.css` (1045 lines) and
  `PanelDetailModal.css.test.ts` to ground-truth every claim the design makes about current
  file structure.
- `grep -n "@media" PanelDetailModal.css` → real `@media` at-rules are at lines **22, 623, 887**
  only (a fourth textual hit at line 712 is inside a code comment, not an at-rule). design.md's
  Context section says the file "contains FOUR `@media` blocks" but then enumerates only three
  bullets — the prose count is wrong (three real blocks). Doesn't affect the plan's mechanics
  (the plan operates on the three real blocks correctly) but is a factual inaccuracy in the
  design doc.
- Confirmed all 16 locked selectors from `PanelDetailModal.css.test.ts` live inside the single
  `@media (max-width: 768px)` block at lines 623-718 — no selector's mobile rule lives in a
  different block. The test-lock retarget plan (move this one contiguous block to
  `PanelDetailModal.mobile.css`, repoint `CSS_PATH`) is sound on that front.
- Read `frontend/src/theme/theme.css` and confirmed `--space-1..10` = 4/8/12/16/20/24/32/40/48/64px
  exactly as design.md states.
- Traced spacing declarations line-by-line (`grep -nE '(padding|margin|gap|inset)...'`) against
  the token table to check the token-migration rule's precision.
- Manually mapped every rule range in the 1045-line file to the four planned files per D1's
  content list, and summed line counts for `PanelDetailModal.sections.css`
  (`sed -n '424,464p;466,580p;582,611p;812,891p;893,985p;987,1045p' | wc -l` → **418 lines**),
  contradicting design.md's estimate ("≈300 each... well under 400").
- Worked through the concrete cascade mechanics of D2's `@import`-barrel plan against the CSS
  spec's requirement that `@import` rules must precede all other rules in a stylesheet.

### Verdict: REFUTE

### Change Requests

1. **D2's `@import` barrel plan will break the mobile full-screen shell behavior — this is not
   a hypothetical risk, it is a structural bug in the plan as written.** CSS requires `@import`
   statements to precede all other rules in a file. `PanelDetailModal.css` (barrel) is planned
   to hold `@import` lines for the three siblings **at the top**, followed by its own retained
   rules (`.panel-detail-modal`, `.panel-detail-modal--view`, header/close/footer/discard, etc. —
   lines 1-168 and 720-810 of the current file). Because the imports must come first, the
   resolved cascade order becomes `[binding.css][sections.css][mobile.css][barrel's own rules]`
   — i.e. **barrel's own base rules end up loading *after* `mobile.css`, not before it.**
   `mobile.css` will contain `@media (max-width: 430px) { .panel-detail-modal, .panel-detail-modal--view { width: 100vw; height: 100dvh; ... } }` (today's lines 22-32), which today
   correctly overrides the base `.panel-detail-modal { width: min(540px, 96vw); ... }` rule
   (lines 1-11) because the override comes *after* the base in source order. Under the planned
   `@import` structure, the **base rule (barrel, unconditional) will load after the media-query
   override (mobile.css)**, and since both have equal specificity (single class selector, same
   properties: width/height/max-width/max-height/border/border-radius), **the later, unconditional
   base rule wins** — silently un-doing the phone full-screen dialog behavior (the `W4.5` fix)
   at ≤430px. This is a real pixel-shift regression the design's own risk mitigation ("preserve
   barrel `@import` order identical to the original top-to-bottom order... mobile file imported
   last") does not actually prevent, because it doesn't account for the fact that a file's own
   rules can never be interspersed around its own `@import` statements — they must follow all of
   them. Required fix: choose one of —
   - (a) Make the primary plan the TSX-side sibling-import alternative (already in D2 as a
     fallback): four separate `import` statements in `PanelDetailModal.tsx` in true source order
     — `PanelDetailModal.css` (barrel, own rules only) first, then `.binding.css`, `.sections.css`,
     `.mobile.css` last. This avoids the CSS `@import`-must-be-first constraint entirely and
     genuinely preserves order; or
   - (b) If `@import` is kept, split the barrel into an imports-only file and a separate file for
     its own base rules, and import *that* file in correct first position alongside the others.
   Either way, add an explicit verification task that traces, per selector with a media-query
   override, that the **override still resolves after its base rule in final processed order**
   — not just "file `@import` order looks preserved."

2. **`PanelDetailModal.sections.css` is very likely to exceed the ~400-line soft budget, contrary
   to design.md's confidence.** D1 assigns collection-segmented + table-display + chart-display
   + chart-appearance + chart-type-selector + image-upload (plus, per gap #3 below,
   markdown-textarea) all to one file. Actually summing those ranges in the current file gives
   **418 lines**, not the "≈300 each... well under 400" the design claims. This risks failing the
   `panel-detail-modal-css-structure` spec's file-size requirement and AC #2. Revise D1 to either
   plan a fifth sibling file up front (e.g. carve chart-type-selector + image-upload into their
   own file), or add an explicit fallback task ("if `sections.css` exceeds ~400 lines after the
   carve, split it further along the chart-appearance/chart-type boundary") so the executor isn't
   left improvising a fix outside the stated plan.

3. **D1's per-file content enumeration for `PanelDetailModal.sections.css` omits
   `.panel-detail-modal__markdown-textarea` (+ `:focus`, lines 968-985 of the current file).**
   Neither proposal.md, design.md's D1 bullet list, nor tasks.md 3.2 mention where the markdown
   rules land. Add explicit placement (presumably `sections.css`, alongside the other per-kind
   config) so the executor doesn't have to guess or accidentally orphan/duplicate these rules.

4. **The token-migration rule doesn't address shorthand declarations that mix an exact-token
   value with a non-exact value in the same declaration**, e.g. `padding: 18px 20px 14px;`
   (line 57 — 20px is exact, 18px/14px are not), `padding: 2px 8px;` (line 105), `padding: 10px 20px;`
   (line 727), `padding: 5px 12px;` (line 742), `padding: 14px 20px;` (line 765),
   `padding: 6px 8px;` (lines 371/863). D3/tasks 2.1 phrase the rule as "migrate the value if a
   token is exactly equal," which is technically satisfiable per-component in a shorthand
   (CSS permits `padding: 18px var(--space-5) 14px;`), but neither doc says whether partial
   in-shorthand tokenization is required, permitted, or to be avoided in favor of leaving the
   whole shorthand literal for readability. This won't cause a pixel shift either way (both
   readings are pixel-identical), but it is a real ambiguity a competent implementer could
   resolve two different, inconsistent ways across the file — call it out explicitly (e.g.
   "tokenize the individual value within a shorthand where exact; leave the sibling values
   literal in the same declaration").

5. **Non-blocking:** fix design.md's Context section — it states the file "contains FOUR
   `@media` blocks" but only three real `@media` at-rules exist (verified via grep); the fourth
   hit is a code comment, not a rule. Doesn't change the plan's mechanics, just correct the prose.

### Non-blocking notes

- The test-lock retargeting mechanics (single contiguous 768px block → `mobile.css`, `CSS_PATH`
  repoint, no assertion changes) are otherwise sound and match the actual file structure exactly.
- `.panel-detail-modal__chart-preview` is defined twice in the current file (lines 825-830 and
  961-966, identical values) — pre-existing duplication, harmless either way, but worth a note in
  the executor's task list so it isn't "fixed" as an unplanned dedup (which would be out of scope
  for a behavior-preserving refactor, though in this case harmless since the values are identical).
