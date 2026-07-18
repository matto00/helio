## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **Ground-truth facts match the design doc's claims.**
   - `wc -l PanelDetailModal.css` → 1045 lines (matches ticket/design).
   - `grep -n '@media' PanelDetailModal.css` → three at-rules at lines 22, 623, 887; line 712 is
     confirmed a comment (`/* ... via the same @media pattern; ... */`), not an at-rule — matches
     design.md's Context claim exactly.
   - `PanelDetailModal.css.test.ts` reads `CSS_PATH = path.join(__dirname, "PanelDetailModal.css")`
     and calls `findMediaBlock(css, "max-width: 768px")` against 16 locked selectors across 5
     `describe` blocks (HEL-245/303/255/248/247) — matches design's characterization of the test
     mechanism and the selector list in ticket.md's "Key technical note."

2. **Concern #1 (barrel → TSX imports) — resolved and technically sound.**
   - `grep -n 'import.*\.css' PanelDetailModal.tsx` → exactly one import
     (`import "./PanelDetailModal.css";` at line 7), confirming the design's premise that today's
     wiring is a single side-effect import to retarget.
   - The stated reason a CSS `@import` barrel is invalid (must precede all other rules in a file,
     so a barrel `PanelDetailModal.css` couldn't keep its own base rules before an imported
     override) is a correct, standard CSS-spec constraint. The TSX sibling-import alternative in
     explicit cascade order (shell → binding → sections → appearance → mobile last) is sound.

3. **Concern #2 (line-count budget, 5-file split) — resolved; verified by direct arithmetic on
   actual section boundaries, not just re-asserted.**
   - Computed real line ranges from the file's own section-banner comments:
     shell part A (1-171, minus the 11-line 430px block that moves out) + shell part B
     (discard-warning/footer, 720-811) = 160 + 92 = **252** lines (design estimate: ~260 ✓)
     binding (172-423) = **252** lines (design estimate: ~250 ✓)
     sections (424-622) = **199** lines (design estimate: ~190 ✓)
     appearance (812-1045, minus the 5-line 430px block) = **229** lines (design estimate: ~225 ✓)
     mobile (11 + 97 + 5 = 113 lines of @media content) ≈ **115-130** lines assembled (design
     estimate: ~100 — slightly optimistic but irrelevant, real number is still far under the
     ~400 budget).
   - All five real projected sizes are comfortably under 400. The prior round's "~418-line risk"
     for a 4-way split is now moot regardless of its own precision, since the current 5-way
     numbers are independently confirmed safe.

4. **Concern #3 (markdown-textarea placement) — resolved.**
   - `.panel-detail-modal__markdown-textarea` is declared at line 968, which falls inside the
     812-1045 range D1 assigns to `PanelDetailModal.appearance.css` ("chart appearance, chart-type
     selector, markdown/text content textarea, image-upload control"). Assignment is consistent
     with the file's actual location.

5. **Concern #4 (shorthand per-component tokenization) — resolved; cross-checked against every
   real occurrence in the file, not just the two worked examples.**
   - Extracted all margin/padding/gap declarations with `grep -noE`. Every multi-value shorthand
     found (lines 57, 105, 234, 262, 280, 298, 371, 727, 742, 765, 863, 873, 928) tokenizes exactly
     per the stated per-component rule, and the literal-only components found (2, 5, 6, 7, 10, 14,
     18px) are the **exact same set** design.md's Context section claims has "no exact token" — no
     omissions, no extras.
   - The design's two worked examples (`padding: 8px 12px` → line 262; `padding: 8px 4px` → line
     928) and its worked "stays fully literal" example (`padding: 7px 10px` → lines 234 and 280)
     are drawn directly from real code, not fabricated — confirms the rule was derived from
     ground truth.
   - Cross-checked `theme.css` — `--space-1`..`--space-10` values (4/8/12/16/20/24/32/40/48/64px)
     match design.md's stated scale exactly (`grep -n '\-\-space-' theme.css`).
   - `DESIGN.md:110-111` confirms "small optical tweaks ≤4px may be literal" is the actual binding
     rule, correctly cited.

6. **Concern #5 (@media count) — resolved,** confirmed above in item 1.

7. **Concern #6 (cascade safety) — the conclusion holds, but the design doc's own stated
   justification is narrower than what's actually true; I verified the broader, correct
   invariant myself.**
   - Spot-checked base (non-media) declarations for 8 of the 16 locked 768px selectors
     (`.btn`, `.slider`, `.slider input[type=range]`, `.chart-label`,
     `.color-swatches input[type=color]`, etc.) against their mobile overrides — confirmed
     property-disjoint (e.g. base sets `height`/`width`, mobile sets `min-height`/`min-width`) as
     design.md claims for that block.
   - However, the **two 430px blocks are not property-disjoint** from their base rules: the
     block at line 22 overrides `width`/`height`/`max-width`/`max-height`/`border`/`border-radius`
     on `.panel-detail-modal`/`.panel-detail-modal--view` (same properties as the base rule at
     line 1), and the block at line 887 overrides `grid-template-columns` on
     `.panel-detail-modal__row` (same property as the base rule at line 181). Design.md's Risks
     section states the safety argument only as "[Mobile file loaded last strengthens an
     override] ... only affects matched breakpoints and only min-*/max-* dimensions the desktop
     rules don't set" — this phrasing is **inaccurate** for these two blocks.
   - I independently verified the actual invariant that makes this still safe: since `mobile.css`
     is **unconditionally the last TSX-imported stylesheet**, any same-specificity/same-property
     conflict between a base rule (in shell/binding/sections/appearance) and a mobile-file
     override resolves in the override's favor purely by cascade position — regardless of whether
     the properties overlap. This generalizes correctly to both 430px blocks.
   - I ran a whole-file duplicate-selector scan (`grep`-based, bare top-level selectors) and found
     exactly **one** true duplicate: `.panel-detail-modal__chart-preview` (lines 825 and 961),
     both with byte-identical declarations, and both destined for the same file
     (`appearance.css`) in unchanged relative order — harmless, pre-existing redundancy, not
     introduced or affected by the split.
   - **Net:** the design's actual plan is behavior-preserving, but its stated rationale for why is
     incomplete/wrong for 2 of the 3 `@media` blocks it moves. See non-blocking note below.

### Verdict: CONFIRM

### Non-blocking notes

- design.md's Risks section ("[Mobile file loaded last strengthens an override vs. today]")
  should be corrected to state the actual safety invariant — *mobile.css is unconditionally the
  last import, so any same-specificity conflict resolves in its favor regardless of property
  overlap* — rather than leaning on "only min-*/max-* dimensions," which is true only for the
  locked 768px block, not the two 430px blocks that also relocate into the same file. This is a
  documentation-accuracy issue, not a plan defect (I independently verified the plan is correct
  under the broader invariant), but an implementer relying on the narrower stated reasoning could
  be misled if they ever need to add a new cross-cutting mobile rule that isn't property-disjoint.
- This is the first component in the codebase to split styles across multiple sibling
  `Component.suffix.css` files (no existing precedent found via `find . -name "*.css"` search
  under `frontend/src`). The chosen convention is reasonable and well-justified, but worth a
  passing sanity check during implementation that no lint/import-order tooling flags the new
  multi-file pattern.
- The design's `~100`-line estimate for `mobile.css` is a bit optimistic (real content is closer
  to ~115-130 lines once the three `@media` bodies are combined); irrelevant to the ~400 budget
  but worth noting so the executor isn't surprised.
