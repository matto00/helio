## Context

`DESIGN.md`'s Control-metrics section (line ~207) currently sanctions a sized `::after`
hit expander as an alternative to `min-width`/`min-height: 44px` for painted chrome
controls that must not visually grow. This clause was added by HEL-772 (PR #409,
`98862321`), whose own `openspec` `design.md` (archived at
`openspec/changes/archive/2026-08-21-anchor-mobile-command-bar/design.md`) records the
gap/tiling constraint and verification method in full, but that detail never made it
into the binding `DESIGN.md` prose itself. This change edits only `DESIGN.md`; it is
documentation-only, no code changes.

Ground-truth numbers, verified directly against HEL-772's archived design.md and
evaluation reports:
- Line 119/122 of `design.md`: `.app-command-bar__right` gapped controls by `var(--space-2)`
  (8px); with that gap, round 4 measured a real horizontal extent of **35.75px** while
  `::after` still computed a full 44px.
- Line 123-124: the gap was widened to `var(--space-4)` (16px), at which the three
  right-hand expanders tile exactly `294..338 | 338..382 | 382..426` — zero overlap.
- `tasks.md` line 78 (task 7.11) and `evaluation-1.md` line 177: the bisection method is
  `elementFromPoint` at a 0.25px step; a *correctly* tiled abutting region legitimately
  reads **~43.75px** (not a full 44), so the assertion is `>= 44 - samplingStep`, never a
  literal 44, and the gap must never be widened past `var(--space-4)` to force the number
  over 44 — "the threshold takes the epsilon, not the gap" (skeptic-design-5.md line 232).

## Goals / Non-Goals

**Goals:**
- Extend the existing `::after` clause with the 4 missing facts from the ticket:
  per-side extension formula, minimum-gap rule, why `getComputedStyle`/painted-box
  sampling cannot detect the overlap, and the epsilon/anti-widen-gap warning.
- Keep the addition consistent with the surrounding Control-metrics prose (same
  paragraph style, `44px` remains sanctioned as the tap-target floor).

**Non-Goals:**
- Not re-deciding the 44px floor or the `::after` mechanism (both already settled).
- Not scoping which selectors the pattern applies to (HEL-778's concern).
- Not touching any code, test, or the `--control-*` token scale.

## Decisions

**D1 — Where the addition lands.** Append directly to the existing `::after`
sentence/paragraph in the Control-metrics section (not a new `####` subheading), since
the clause is short and the surrounding section already mixes multi-sentence prose
rules within one paragraph (see the existing 44px tap-target-floor sentence in the same
paragraph). A new heading would visually detach the constraint from the mechanism it
qualifies, which is the exact failure this ticket is about.

**D2 — Formula vs. bare 8px literal.** State the general formula
`(44 - controlSize) / 2` per side, not just "8px", because `DESIGN.md`'s control-height
scale has multiple tokens (`--control-sm` 28px, `--control-md` 32px, `--control-lg`
40px) and a future author may apply this pattern to a control of a different size. The
28px→8px case is the worked example, not the whole rule.

**D3 — Verification wording.** State plainly that `getComputedStyle(el, "::after").width`
and neighbouring-painted-box sampling both fail to detect the overlap (per HEL-772's own
measurement: computed stayed 44px, painted-box sampling reported zero violations, while
the real bisected extent was 35.75px), and name `elementFromPoint` bisection as the
required verification — this is what the ticket and HEL-772's evaluation gate both
converged on as the only proof method that actually works.

**D4 — Epsilon wording.** State the abutting-region reading (~43.75px at a 0.25px
step) as the reason the assertion needs an epsilon (`>= 44 - samplingStep`, not a literal
`>= 44`), paired with the explicit warning not to widen the gap past the tiling point to
push the number over 44 — both halves are needed, or a reader might "fix" a correctly-
tiled 43.75 reading by widening the gap, which breaks the exact-tiling property HEL-772
established.

## Risks / Trade-offs

- [Risk] The added prose could grow the Control-metrics paragraph long enough to hurt
  scanability → [Mitigation] keep wording terse, reuse HEL-772's own phrasing where
  possible instead of re-deriving it; skeptic design-gate review checks length/clarity.
- [Risk] Introducing a formula (D2) rather than the flat "8px" literal HEL-772 used
  inline risks reading as scope creep beyond the ticket's literal ask → [Mitigation]
  the ticket's own AC #1 already asks for "the per-side extension" generically, and the
  28px/8px worked numbers stay in the text as the concrete example, satisfying both the
  general-formula need and the literal-numbers-grounded requirement.

## Planner Notes

Self-approved: choosing to append inline (D1) rather than add a new subheading, and
stating the general formula (D2) alongside the concrete 28px/8px numbers. Both are
editorial/wording choices within the ticket's stated scope, not architectural or
external-dependency decisions, so no escalation raised.
