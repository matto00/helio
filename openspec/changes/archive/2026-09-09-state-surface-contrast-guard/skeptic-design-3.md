## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Every number below was re-derived from the tree in this worktree, not read from the plan.

**D3's four threshold numbers are exactly right.** Parsed `frontend/src/theme/theme.css`
(dark 151-153, light 201-203) and computed WCAG ratios myself:
`raised`/`strong` = **1.000** light, **1.040** dark; `soft`/`strong` = **1.179** light,
**1.167** dark. Identical to design.md D3 to three decimals. The 1.10 threshold does sit in
the gap, and task 1.2's stop-and-report is a real check against a real number.

**CR1 (alpha compositing) — genuinely resolved, and the specification is CORRECT, not merely
present.** Three separate properties hold:
- *Termination.* D4.2 walks ancestors accumulating alpha "until total opacity reaches 1 (the
  root background terminates the walk by construction)". That parenthetical is true in this
  app, not an assumption: `theme.css:265-267` sets `body { background-color: var(--app-bg) }`
  and `--app-bg` is `#121110` / `#f4f2ed` (149/199) — opaque hex in both themes. The walk has
  a guaranteed opaque floor.
- *Ratio between two opaque colours.* D4.3 states it outright ("computes the ratio between two
  opaque colours ... an opaque state simply composites to itself"), and correctly identifies
  why the naive read is wrong: `getComputedStyle` returns the colour **with** its alpha.
- *The translucent family is correctly identified.* `theme.css:172-173,223-224` define
  `--app-accent-surface`/`--app-accent-dim` as `color-mix(..., transparent)` — alpha < 1.
  I checked the sibling accent tokens: `--app-accent-strong` (171/222) mixes with `white`/
  `black`, and `--app-accent` is a plain hex — both **opaque**. So the design's claim that
  exactly the dim/surface pair is the alpha family is right, and the "composites to itself"
  clause covers the rest. This is the round-2 defect, closed properly.

**CR2 (spec delta) — resolved, and it now holds up as a durable artifact.** The population
requirement in `specs/state-surface-contrast-guard/spec.md` derives from the rendered
application; the abandoned "parsing the stylesheet set" language is gone. Critically, the
overclaim is gone too: the newly-added-state scenario is now scoped to "a **visited** part of
the application", and a new requirement clause states that "a state on a part of the
application the check does not visit is outside the reported scope and SHALL NOT be described
as checked". That is D6.2's qualification carried honestly into the shipped spec. The two new
requirements (painted-colour/compositing; absence detection with the advisory/failure split)
are written behaviourally, without naming Playwright or file paths, which is the right level
for a capability spec.

**CR3 — resolved.** tasks 6.4 now routes D6.1 (equal-luminance hue) and D6.2 (route-bounded
coverage), matching design.md D6's own "items 1 and 2 are the ones that qualify this ticket's
claim". The stale D6.3 reference is gone.

**CR4 — resolved.** Pseudo-element reads are tasked at 2.4 (`getComputedStyle(el, '::before'/
'::after')`) and self-tested at 3.10. The cited real instance is real:
`frontend/src/shared/ui/DataGrid.css:184` `.ui-data-grid__resize-handle:hover::after`.

**New requirements have tasks behind them, and the scenarios are testable.** Compositing →
2.1 (pure function), 2.4a (composite before any ratio), 3.9 (a case that passes uncomposited
and fails composited — the exact discriminating case). Absence → 2.6 (the three-way
classification), 3.6 (nothing-changed red, shadow-only advisory). Coverage-scope reporting →
2.7 and 5.2a. No orphan requirement.

**AC coverage traced.** AC5: mechanical enumeration 2.2 (explicitly "no file list, no
component list anywhere in the input path"), mutation-failability 3.2/3.3 plus the live
green→red on a resolved call site at 3.8, contrast-not-inequality 3.3. AC1 → 5.5 (rendered
screenshots, both themes). AC2 → 5.8 + 5.2a. AC3 → 5.7. AC4 → 6.1. Buildable as written.

**Re-measured population figures myself.** 58 files reference `--app-surface-raised` (task
1.3's "expected 58" reproduces). My own rule-level parse of state selectors with a background
declaration returns 155 declarations, of which 72 use `--app-surface-raised`; see note 1 on
the "45 of 161" accent figure.

### Verdict: CONFIRM

All four of round 2's change requests are genuinely closed, and the compositing specification
survives being checked for correctness rather than presence — it terminates, it names the
right alpha family, and it takes the ratio between two opaque colours. I found no contradiction
between design.md, proposal.md, tasks.md and either spec delta that would produce the wrong
thing. The remaining items below are real but carryable by the executor.

### Non-blocking notes

1. **"45 of 161" does not reproduce under my parse; 1.4 must re-derive it rather than cite it.**
   Counting state-selector rules with a background declaration, I get 155 total, and
   `--app-accent-surface` + `--app-accent-dim` account for **19**, not 45 (a looser
   declaration-level grep gives 37). The *decision* is unaffected — the translucent accent
   family exists, is alpha 0.15/0.10 (dark) and 0.11/0.08 (light), and must be composited —
   but D3/D4/1.4 all repeat "45 of 161" and "28% of the population" as if measured. Task 1.4
   already requires a runtime re-measurement; when it lands, correct the figure in D3, D4 and
   1.4 in place rather than carrying a number that does not reproduce.
2. **Design D4.3/D4 say the accent tokens are "alpha 0.15 and 0.10" — that is the dark block
   only.** The light block (`theme.css:223-224`) is 11%/8%. Harmless for the argument, wrong as
   a stated fact; correct it when 1.4 measures both themes.
3. **design.md D6's pseudo-element bullet points at the wrong self-test.** It says "tasked at
   2.2/2.4 and self-tested at **3.9**", but 3.9 is the alpha-compositing case and the
   pseudo-element case is **3.10**; task 2.2 also does not mention pseudo-elements (only 2.4
   does). Both are one-line pointer fixes — exactly the crosswiring that in-place editing
   produces. Nothing is missing, only mislabelled.
4. **The walk must open overlay surfaces, and that is nowhere stated.** D6.2 frames coverage as
   a *route* list, but this ticket's canonical defect lives in a modal and a command palette —
   surfaces no route navigation renders. Task 2.3 (verify `.command-palette__item` resolves)
   and 5.6 (cover `Modal.css`/`ActionsMenu.css`) implicitly force it, but an executor reading
   D6.2 literally could build a route-only walk that never renders the ticket's own exemplar.
   State explicitly that the walk opens modals, menus and the command palette, and count them
   in 5.2a's scope report.
5. **A modal-hosted ADVISORY is an AC1 problem, and the split does not say so.** D4a routes
   shadow-only states to advisory because adjudicating them is HEL-1044's call — correct for
   the panel card, which is not modal-hosted. But AC1 requires every *modal-hosted* hover/active
   state to render a visibly distinct **background**. If the sweep finds a modal-hosted
   shadow-only state, 5.4 ("fix every failing state") does not cover it and it would ship
   silently as advisory with AC1 claimed met. Either remediate modal-hosted advisories under
   5.4 or report AC1 as partially unmet under 6.3 — do not let the advisory bucket absorb them
   without a word.
6. **Two D6 open items are not routed anywhere.** D6's heading says the open items are "routed
   out rather than papered over", but only D6.1 and D6.2 reach task 6.4; D6.3 (states behind
   data/permissions) and D6.4 (transient/animated states) have no destination. Either name them
   in 6.4 as known-and-accepted or say in D6 that only 1 and 2 are routed.
7. **Unaddressed backdrop edge cases.** The accumulate-alpha walk handles `rgba`/`color-mix`
   backgrounds, but not an ancestor carrying the `opacity` *property* or a
   `background-image`/gradient — both make "the colour the state composites against" ill-defined.
   Neither appears load-bearing for this ticket's population; if the walk meets one, classify it
   as unresolved and report it in 2.7's count rather than guessing a colour.
8. Section 1 is still ordered 1.1, 1.2, 1.4, 1.3, and section 2 is 2.1–2.7, 2.9, 2.8. Cosmetic,
   but it is the visible fingerprint of three rounds of insertion.
