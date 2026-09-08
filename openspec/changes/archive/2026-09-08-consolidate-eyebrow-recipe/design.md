# Design — HEL-732 Consolidate the `.eyebrow` recipe

## Context

Base `origin/main` @ `9e995f69`. `.eyebrow` exists at `theme.css:319-325` with tokens at `:38-40`:
`--eyebrow-size: var(--text-micro)`, `--eyebrow-tracking: 0.14em`,
`--eyebrow-weight: var(--weight-medium)`.

Measured (comments stripped, `theme.css` excluded), predicate = a rule block declaring N of the 5
recipe properties with the recipe's own values: **23 files, 29 blocks** with >= 3 of 5; **12** with
all 5; **17** with exactly 3. The ticket's "17 files" matches none of these — it coincides with the
17 partial BLOCKS, which is a **guess** at what the original sweep counted, not a finding.

## What this ticket delivers, stated plainly

An inventory plus a consolidation of the subset that is **reachable, measurable and provably
neutral** — not a sweep of all 29 blocks. The exclusions are evidence-driven, not cautious:
2 blocks have no consumer at all, 1 has a genuinely different size, and a substantial share of the
weight-inheriting population lives on AI proposal / patch-set / assistant surfaces that may be
unreachable in a dev session.

**The final converted count cannot be stated from these artifacts.** It depends on reachability,
which is determined at execution time, and on per-block measurement, which either passes or does
not. The upper bound is roughly 18 of 29; the floor could be materially lower. **The executor
reports the actual number** (task 0.3), and if it is small the ticket is honestly described as a
documented inventory plus a small consolidation rather than as a partial success.

## RESCOPED (ruled) — this ticket does not prohibit anything

`DESIGN.md:276` — a BINDING standard — reads verbatim: *"Use the `.eyebrow` utility **or copy its
recipe**."* So all 29 blocks are currently **compliant**, and the ticket's AC ("no component CSS
file hand-declares the eyebrow recipe") **forbids what the standard permits**. Satisfying it would
require editing the design language, which is not a refactor.

Ruling: **rescope as an optional tidy-up.**
- The spec asserts **no prohibition** — that contradiction was the real defect here.
- Consolidate ONLY where measurement proves rendering is unchanged. That is justified on its own
  terms and needs no change to the standard.
- **Do NOT touch DESIGN.md**, not even to add a note.
- The AC is **unachievable under the current standard — say so explicitly in the PR** rather than
  quietly under-delivering. Full elimination requires the amendment, filed as **HEL-1043** (open),
  which gives the owner the actual decision with the argument on both sides.

## The decisive measurement

All 17 partials are missing **exactly the same two properties**, `font-size` and `font-weight` — one
systematic pattern, not 17 variations. What they declare instead is what makes this ticket
tractable:

- `font-size`: `var(--text-micro)` x16, `var(--text-xs)` x1. **`--eyebrow-size` IS
  `var(--text-micro)`**, so 16 are value-identical to the utility.
- `font-weight`: none declared x14, `var(--weight-medium)` x3. **`--eyebrow-weight` IS
  `var(--weight-medium)`**, so 3 are value-identical and 14 INHERIT their weight.

### D1 — Three populations, one decidable question each

**SUPERSEDED by task §0's predicates — kept only to show what the integer framing got wrong.** The
table below double-counted (summing to 30 for 29 blocks) and asserted a safety that D1a falsifies.
The authoritative classification is P1..P5, evaluated in order, with every count DERIVED by the
executor rather than read from here.

| population (superseded) | conversion |
| --- | --- |
| declares all five recipe properties | candidate ONLY — value-identical is not safe (D1a); measure it |
| declares four, no explicit `font-weight` | candidate ONLY — conversion ADDS `var(--weight-medium)`; safe only if that equals the inherited weight |
| declares a `font-size` the utility would not produce | NOT converted — see D3 |
| selector with no consumer | NOT converted — unmeasurable |

**Arithmetic correction:** the rows above previously summed to 30 for 29 blocks. The `var(--text-xs)`
block (`AgentMemoryList.css:82`, `.agent-memory-list-table__kind`) declares **no `font-weight`
either**, so it belongs to BOTH the "14" and the "1". It is counted once, in the
NOT-converted population: 12 + 3 + 13 + 1 = 29. Task 3 therefore measures **13** blocks, not 14, and
the double-counted block is governed by D3 alone.

The per-block question is narrow: **does adopting `.eyebrow` change this element's computed
`font-size` or `font-weight`?** For 15, provably no from the declared values. For 14, only
measurement can answer. For 1, it demonstrably does.

### D1a — "Provably safe from declared values" is FALSIFIED; measure every converted block

Adopting a utility CLASS in place of local declarations is not value-neutral even when every value
matches. **7 of the 29 blocks are descendant/compound selectors at specificity (0,1,1) against
`.eyebrow`'s (0,1,0)**, and cascade POSITION also shifts: `theme.css` is a global import at
`main.tsx:12` while component CSS arrives transitively at `:6`. So the swap can change **which
declaration wins with no value changing anywhere**.

Consequence: **per-population sampling is invalid** — the delta is per-SELECTOR, not per-population,
so one measurement cannot stand for its class. **Measure every block that is converted.** If that
makes the safe set smaller, the safe set is smaller; do not stretch a sample to cover it.

### D2 — The measurement is MECHANICAL, not aesthetic

For each of the 13, read the **computed** `font-weight` in the running app BEFORE conversion and
AFTER. Equal ⇒ no-op, safe to convert. Different ⇒ a visual change: justify it in the PR or leave
the block alone.

**Do not eyeball this.** A change from computed 400 to 500 is exactly the magnitude that looks fine
in isolation and wrong beside its neighbour — which is how HEL-451's `--weight-normal` fallback
shipped at computed 600 with nobody noticing.

**This is the two-axes (a) answer, and it is the ticket's central risk rather than a side concern:
the inherited `font-weight` at those 14 sites is carried by NO SOURCE TEXT ANYWHERE.** It is the
product of the cascade at each site. A CSS diff cannot see it, and neither can any unit test. Only
computed style in a rendered page can. The gate must hold this change to MEASUREMENT, not inspection.

### D3 — The `var(--text-xs)` block: flag, do not decide

Do NOT convert it. Do NOT quietly leave it either. List it in the PR with the observation that its
size genuinely differs from the utility, **and with the open question of whether it should be an
eyebrow at all** — a mono-uppercase label at a different size may be a deliberate variant, or drift
that predates the recipe. If the code does not make that obvious, it is a question for the owner;
flag it rather than deciding it.

### D4 — Unconverted blocks are listed, never silent

Any block left alone — for a computed-style difference, for D3, or for any other reason — appears in
the PR body with its file, selector and reason. A sweep whose output is "most of them" without
saying which and why cannot be reviewed, and the unconverted remainder becomes invisible debt.

### D5 — HEL-1037's guard covers the token risk

`check:tokens` is on `main` as of `9e995f69` and runs in pre-commit and CI. Every `var(--*)` this
sweep touches is therefore checked to resolve — a typo'd token introduced here **fails at commit
rather than rendering wrong**, which is exactly the failure mode (`--weight-normal` → computed 600)
that motivated this family of work. Worth stating in the PR: the guard shipped two tickets ago is
protecting this one.

## Risks

| Risk | Mitigation |
| --- | --- |
| A differently-weighted label silently folded into `.eyebrow` | Computed-style measurement before/after for EVERY converted block, not a sample (D1a, D2) |
| Aesthetic judgement substituted for measurement | The question is numeric — computed weight equal or not (D2) |
| The `--text-xs` block converted or silently dropped | Neither: listed with an open question for the owner (D3) |
| Unconverted remainder becomes invisible debt | Every skipped block listed with file, selector, reason (D4) |
| A typo'd token introduced by the sweep | `check:tokens` fails the commit (D5) |
| A stale count repeated into the PR | Predicate stated, counts derived from it, the 17-coincidence labelled a guess |

## Two-axes review targets

**(a) What does no source text carry?** The inherited `font-weight` at the 13 sites — the cascade's
product, invisible to a CSS diff and to any unit test. See D2; this is the ticket's central risk.

**(b) What data shape did the gates not exercise?** The partial blocks sit in three structurally
different contexts — table headers (`__th`), inline badges/kinds, and `dt` terms — and a container
that sets its own weight affects each differently. Both themes, since weight and tracking read
differently against different surface contrasts.

## Test plan

There is no logic to unit-test: this is a CSS consolidation. The evidence IS the computed-style
comparison — before/after `font-size` and `font-weight` for every converted block, plus rendered
screenshots in both themes for at least one instance of each converted class. A CSS diff is not
evidence here, and a green unit suite proves nothing about it.
