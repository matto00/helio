# HEL-732: Consolidate the hand-copied `.eyebrow` CSS recipe into one shared utility

## Description

From the beta UI/UX polish sweep (PR #382), deferred as too collision-prone to parallelize alongside
that sweep's 21 packages. DESIGN.md's `.eyebrow` utility already exists in `theme.css:319-325`, but
component CSS files re-declare the same mono/uppercase/tracked recipe locally instead of using it.

Parent: HEL-346 (Design-System Hardening).

## The canonical recipe (`theme.css:319-325`, tokens at `:38-40`)

```
.eyebrow { font-family: var(--font-mono); font-size: var(--eyebrow-size);
           letter-spacing: var(--eyebrow-tracking); font-weight: var(--eyebrow-weight);
           text-transform: uppercase; }
--eyebrow-size: var(--text-micro);  --eyebrow-tracking: 0.14em;  --eyebrow-weight: var(--weight-medium);
```

## Measured scope — the ticket's "17 files" matches nothing

Measured against `9e995f69`, comments stripped, `theme.css` excluded. **Predicate:** a rule block
declaring N of the 5 recipe properties *with the recipe's own values*.

| measure | count |
| --- | --- |
| files containing a block with >= 3 of 5 | **23** |
| such rule blocks | **29** |
| blocks with all 5 (exact hand-copies) | **12** |
| blocks with exactly 3 | **17** |

"17 files" matches none of these. It coincides numerically with the 17 partial BLOCKS, which **may**
be what the original sweep counted — that is a **guess, not a finding**, and must be labelled as one
wherever it appears. Report the predicate and what it yields; do not pin a number in prose that
decays on the next edit.

## The population is uniform, and the risk is ONE property

All 17 partial blocks are missing **exactly the same two properties**: `font-size` and `font-weight`.
That uniformity is the finding — one systematic pattern, not 17 ad-hoc variations. What they declare
instead:

| property | the partials declare | vs `.eyebrow` |
| --- | --- | --- |
| `font-size` | `var(--text-micro)` x16, `var(--text-xs)` x1 | `--eyebrow-size` IS `var(--text-micro)` — 16 value-identical |
| `font-weight` | none x14, `var(--weight-medium)` x3 | `--eyebrow-weight` IS `var(--weight-medium)` — 3 value-identical, 14 INHERIT |

So the split is **not** "full copy vs partial":

* **15 blocks provably safe from the values alone** — 12 full copies + 3 partials whose size and
  weight already equal the token values. Converting is a pure refactor.
* **14 blocks declare NO `font-weight` and currently inherit one.** Converting ADDS
  `font-weight: var(--weight-medium)`. Whether that changes rendering depends on the inherited
  weight at each site.
* **1 block uses `var(--text-xs)`** rather than `--text-micro` — genuinely a different size.

## Acceptance criteria

* No component CSS file hand-declares the eyebrow recipe outside `theme.css`'s `.eyebrow` utility,
  except blocks explicitly listed in the PR as deliberately untouched with a stated reason.
* **Every converted block is shown not to change its computed `font-size` or `font-weight`** — by
  measurement, not inspection.
* Any block whose conversion WOULD change computed style is either justified in the PR or left
  alone; it is never converted silently.
* The `var(--text-xs)` block is NOT converted, and IS listed with the open question below.

## Method for the 13 — mechanical, not aesthetic

For each, read the **computed** `font-weight` in the running app **before** conversion and
**after**. Equal ⇒ the conversion is a no-op and safe. Different ⇒ it is a visual change and must be
justified in the PR or left alone.

**Do not eyeball this.** A weight change from 400 to 500 is exactly the magnitude that looks fine in
isolation and wrong beside its neighbour — which is how HEL-451's `--weight-normal` fallback shipped
at computed 600 with no one noticing.

## The `var(--text-xs)` block — flag, do not decide

Do NOT convert it, and do NOT quietly leave it. List it in the PR with the observation that it is a
different size, and note whether it **should** be an eyebrow at all: a mono-uppercase label at a
different size may be a deliberate variant, or drift that predates the recipe. If that is not obvious
from the code, it is a question for the owner — flag it rather than deciding it.

## Out of scope

* HEL-830's off-scale spacing literals, HEL-680's chip padding. This is one recipe, not a token sweep.
* Introducing new eyebrow variants or tokens.
* Changing `.eyebrow` itself or its tokens.

## Dependencies

Related: HEL-1037 (merged `9e995f69`) — its `check:tokens` guard now governs every `var(--*)` this
sweep touches, so a typo'd token fails at commit rather than rendering wrong. Binding: DESIGN.md,
CONTRIBUTING.md, `.concertino/laws/`.
