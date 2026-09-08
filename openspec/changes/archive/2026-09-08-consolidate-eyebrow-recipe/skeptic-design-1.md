## Skeptic Report — design gate (round 1, skeptic-design-1.md)

## What I verified (with evidence)

**Ground truth re-derived, not inherited.** I wrote my own scanner (strip `/*...*/`, split rule
blocks including those nested inside `@media`, exclude `frontend/src/theme/theme.css`) applying the
stated predicate: a block declaring N of the 5 recipe properties WITH THE RECIPE'S OWN VALUES.

- Tokens confirmed at `frontend/src/theme/theme.css:38-40` — `--eyebrow-size: var(--text-micro)`,
  `--eyebrow-tracking: 0.14em`, `--eyebrow-weight: var(--weight-medium)`; `.eyebrow` confirmed at
  `theme.css:319` (`grep -n '^\.eyebrow'`). `--text-micro: 0.625rem`, `--text-xs: 0.75rem`,
  `--weight-medium: 500`.
- **Counts reproduce EXACTLY** on `9e995f69`: `FILES 23 BLOCKS 29`, `Counter({3: 17, 5: 12})`.
- **The uniformity claim reproduces exactly**: all 17 partials are missing the same two properties —
  `Counter({('font-size','font-weight'): 17})`.
- **The value distribution reproduces exactly**: partial `font-size` = `var(--text-micro)` x16,
  `var(--text-xs)` x1; partial `font-weight` = absent x14, `var(--weight-medium)` x3.
- The "17 files matches no measure" framing is correct: 17 is the partial-BLOCK count, and labelling
  it a guess is the right call.
- `check:tokens` verified live in this worktree: `check-tokens: OK`.
- Deferral ownership spot-checked: HEL-830 is open (`status: Backlog`, `archivedAt: null`, parent
  HEL-346) and does own the off-scale spacing sweep. HEL-1037 is merged and is `9e995f69` itself.

So the measurement the orchestrator asked me to attack **holds**, with one exception that changes
the design — see CR1.

### Verdict: REFUTE

The enumeration is sound and unusually well-grounded. The *derived* design has four defects: an
arithmetic double-count that makes two tasks contradict each other, an unexamined specificity axis
that falsifies the "provably safe" argument, a measurement method too loose to exclude the exact
false-difference the ticket warns about, and a binding-standard contradiction.

## Change Requests

### 1. The three-population split is NOT exhaustive — D1 sums to 30 for 29 blocks

The `var(--text-xs)` block is `frontend/src/features/.../AgentMemoryList.css:73`
`.agent-memory-list-table__kind`, and my scan shows its `font-weight` is **absent**. It is therefore
a member of the "14 that declare no `font-weight`" AND of the separate "1 with a different size".
D1's four rows (12 + 3 + 14 + 1) total 30 against a measured 29 blocks. Only `15 + 14 = 29` closes,
which means the "14" and the "1" are not disjoint.

This is not a cosmetic arithmetic nit — it puts two tasks in direct contradiction for that block:

- task 3.1: "For EACH of the 14, read the COMPUTED `font-weight` ... BEFORE conversion and AFTER"
- task 3.4: "Record the before/after pair for each of the 14"
- task 4.1: "Do NOT convert it."

There is no "after conversion" reading for a block that must never be converted. An executor can
read this two ways, and one of them converts the one block the AC explicitly forbids converting.

**Required:** restate the populations as disjoint and summing to 29 — 12 full copies + 3
value-identical partials (safe) + **13** measure-then-convert + 1 flagged-never-converted — and
change every occurrence of "the 14" (ticket, proposal, design D1/D2, tasks 3.1/3.3/3.4, and
`workflow-state.md`'s "THE DELIVERABLE IS 14 MEASUREMENTS") to the corrected figure, or state
explicitly that the xs block is measured but never converted so "14 measurements, 13 conversions".
Do not leave the two numbers reconcilable only by inference.

### 2. "Provably safe from the declared values alone" is an argument about VALUES, not about which declaration WINS

D1 asserts that for 15 blocks "computed style cannot change" because every value already matches.
That reasoning is incomplete: the change does not merely relocate declarations, it swaps a
component selector for a **single-class utility in a different stylesheet**. Two things move:

**(a) Specificity drops for 7 of the 29 blocks.** These are descendant selectors at (0,1,1),
strictly higher than `.eyebrow` at (0,1,0):

- `MfaEnrollModal.css:84` `.mfa-enroll-modal__field label`
- `auth.css:88` `.auth-field label`
- `PipelineProposalReview.css:45` `.pipeline-proposal-review__meta-row dt`
- `CombinedProposalReview.css:75` `.combined-proposal-review__meta-row dt`
- `ProposalReview.css:118` `.proposal-review__meta-row dt`
- `SourceListTable.css` `.source-list-table th`
- `DashboardList.css:28` and `:30` `.dashboard-list__header h2`

Anything else in the tree touching these five properties on those elements at (0,1,0)-or-above
currently loses to the block and would win against `.eyebrow`.

**(b) Cascade position changes.** `theme.css` is a single global import (`main.tsx:12`), while
component CSS is injected transitively via the `App` import at `main.tsx:6`. At equal specificity
the winner is decided by injected order, which is bundler/dev-server determined, not by anything
stated in the design. I found no competing global `h2`/`dt`/`th`/`label` rule in `theme.css`, so
this may well be benign in practice — but the design nowhere establishes that, and "may well be" is
not the standard this ticket set for itself.

**Required:** (i) add a risk row and a design section for specificity + cascade position; (ii) add a
task requiring, for each block converted, a check for any other rule at or above (0,1,0) that sets
`font-family` / `font-size` / `font-weight` / `letter-spacing` / `text-transform` on the same
element — with the 7 descendant selectors above called out by name as the higher-risk subset;
(iii) **drop the word "SAMPLE" from task 2.3.** Sampling is valid for a per-population argument;
the specificity delta is per-SELECTOR, so a sample of the 15 says nothing about the unsampled
remainder. Measure all 15, or justify the sample against the specificity axis specifically.

### 3. Tasks §3 leave open exactly the false-difference the ticket warns about

Task 3.1 says only: "read the COMPUTED `font-weight` in the running app BEFORE conversion and
AFTER". It does not pin the three things that make such a reading trustworthy:

- **Both themes.** `workflow-state.md`'s BINDING block says the measurement is taken in "BOTH
  themes", but tasks §3 does not carry that; §6 covers both themes only for *screenshots*, and a
  screenshot is not a numeric reading. Tasks and the binding state disagree.
- **Same element, same state.** Nothing requires the before and after readings to come from the
  same node on the same route with the same data. A before taken in one state and an after in
  another produces a difference that is real and irrelevant.
- **Which element.** Nothing requires the node to be the one actually matched by the block's
  selector. This is the HEL-469 `DataGrid.css:72` failure verbatim — a citation that pointed at
  `thead th` rather than the cell — and it is the single most likely way this ticket produces a
  confident wrong number.

**Required:** amend task 3.1 to state that each reading is `getComputedStyle` on the node matched by
the block's own selector (record the selector used to obtain the node alongside the number), that
before and after come from the same route/state, and that both themes are read numerically.

### 4. The spec's core requirement contradicts `DESIGN.md`, and nothing updates it

`DESIGN.md:276` currently reads:

> **Eyebrows** (section labels): mono, `--text-micro`, uppercase, tracked `--eyebrow-tracking`. Use
> the `.eyebrow` utility **or copy its recipe**.

The spec's ADDED requirement says a component stylesheet "SHALL NOT re-declare the eyebrow type
recipe locally". DESIGN.md is binding for all `frontend/` work, so as written the change ships a
spec that forbids what the standard permits — and the 16 partials spelling `var(--text-micro)`
rather than `var(--eyebrow-size)` are DESIGN.md-conformant *today* precisely because :276 describes
the recipe in `--text-micro` terms. No task touches DESIGN.md.

**Required:** either amend `DESIGN.md:276` in this change (drop "or copy its recipe", and reconcile
`--text-micro` vs `--eyebrow-size`), with a task owning it, or state in design.md why the standard
stands unchanged alongside a stricter spec. Do not leave the two in conflict.

## Non-blocking notes

- Task 3.1 measures only computed `font-weight`, while the AC says "computed `font-size` **or**
  `font-weight`". For the 16 `--text-micro` partials size is value-identical so this is harmless
  today, but capturing both costs nothing and matches the AC's own wording.
- D4/§5 (unconverted blocks listed with file, selector, reason) and §6.4 (content
  self-authentication) are well specified — no objection.
- The 3 value-identical partials the orchestrator flagged as least obvious are
  `MfaEnrollModal.css:84`, `MfaSecuritySection.css:19`, `auth.css:88`. I confirmed all three declare
  `font-size: var(--text-micro)` AND `font-weight: var(--weight-medium)`, so the "3 value-identical"
  assignment is correct. Two of them are also in CR2's specificity list.
