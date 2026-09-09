## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Numbers re-derived from source, not trusted.** Parsed `frontend/src/theme/theme.css`
(dark block at L150-153, light at L200-203) and computed WCAG ratios myself in a
throwaway script. All eight numbers in design.md's Context table reproduce **exactly**:

```
light raised on strong 1.000   dark raised on strong 1.040
light soft   on strong 1.179   dark soft   on strong 1.167
light soft   on surface 1.150  dark soft   on surface 1.030
light raised on surface 1.025  dark raised on surface 1.089
```

The HEL-444 hand-copy trap was avoided. Task 1.2's four load-bearing numbers are correct.
`grep -rl app-surface-raised frontend/src | wc -l` = **58**, matching the plan's correction.

**Threshold (scrutiny #1) — sound.** 1.10 genuinely sits in the measured gap
(worst broken 1.040, worst good 1.167). The real dark pair #232019 on #262320 **does**
fail it. The rejection of WCAG 3:1 is correctly reasoned (no adjacent-surface pair in
this theme approaches 3:1; adopting it would fail every correct surface). D3's
luminance-only limitation is honestly recorded. No objection.

**D5 / D7 (scrutiny #7) — sound.** `soft` on `strong` clears 1.10 in both themes by my
own numbers (1.179 / 1.167), so the remediation is real, not nominal. Recommend-not-adopt
is the correct disposition given the stated constraint, the escalation was raised and
recorded rather than silently defaulted, and no `theme.css` value is touched. D7's
unblock-and-hand-off is right and does not absorb HEL-1044's scope.

**D4 parent-surface resolution (scrutiny #2) — REFUTED, see CR1.** I parsed every CSS rule
under `frontend/src` and classified the 161 state-carrying background declarations by
whether D4's stated heuristic (*"the base rule for the same selector, the `:hover` rule's
own element minus the state"*) can resolve them:

```
base rule sets transparent/none/inherit : 94
no base rule with a background at all   : 22
base rule sets a real colour            : 45
```

**116 of 161 (72%) are unresolvable by the stated heuristic.**

**The canonical exemplar is one of them.** `frontend/src/features/commandPalette/ui/CommandPalette.css:62-71`
declares `.command-palette__item { background: transparent; }`, and L83-86 is the
`:hover`/`[data-active]` rule. D4 would therefore compare the hover value against
`transparent` — not against the Modal's `--app-surface-strong`, which is the pair that
*is* the defect. Same shape at `frontend/src/shared/ui/inputs.css:128-146`
(`.ui-select__option` base has no background; `:hover` sets `--app-surface-raised`).

**A further 45 state backgrounds use `--app-accent-*`**, which `theme.css:172-173,223-224`
defines as `color-mix(... , transparent)` over the runtime-injected `--app-accent` —
unresolvable by construction (D6.2 + D6.4 acknowledge the shape but not its scale).

**Mutation-failability (scrutiny #3) — REFUTED, see CR3.** Task 3.9 mutates a real call
site back to `--app-surface-raised`. For the two named call sites, the pair is
*unresolvable* both before and after the mutation, so under fail-closed the guard is red
either way and the mutation proves nothing about contrast detection. The task does not
require picking a call site whose pair the guard actually resolves.

**Rendered sweep (scrutiny #4) — REFUTED, see CR2.** Task 5.3 says "fix every pair **the
guard reports**"; 5.5 adds two named files. The section's population is therefore
guard-derived plus two hand-pins. No task enumerates "states that *should* be visible" and
checks whether they are — which is precisely what the ticket demands, and precisely the
population that D6.3's admitted blind spot (absence-shaped states) lives in. As written,
section 5 does reduce to a token-referenced sweep with rendered confirmation bolted on,
and the claim to close the class is not carried.

**D6 honesty (scrutiny #6) — mostly honest, two omissions.** The six enumerated items are
real and D6.3 is stated with appropriate weight. Omitted: (a) pseudo-element-expressed
states — real instance at `frontend/src/shared/ui/DataGrid.css`
(`.ui-data-grid__resize-handle:hover::after`), where the background is on `::after` and
the base-rule heuristic has no counterpart; (b) breakpoint/media-scoped overrides of a
state's background (`inputs.css:185` already re-declares `.ui-select__option` inside a
media block), where the checked declaration may not be the rendered one.

**Scrutiny #5 (cohesion judged against the running app):** tasks 5.1/5.2/5.4/5.6 do
require rendered capture in both themes with `location.href` self-authentication, and
explicitly reject computed style alone. This part is correctly specified. It is not the
reason for this REFUTE.

### Verdict: REFUTE

The threshold, the measurements, and D5/D7 are sound. The mechanism that carries AC5 is
not: the guard's parent-surface resolution cannot resolve the majority of the real
population, including the exact defect the ticket is named for.

### Change Requests

1. **Fix D4's parent-surface resolution, or the guard cannot see this defect class.**
   The heuristic "base rule for the same selector minus the state" resolves the element's
   *own* base background, which is `transparent` or absent for 116/161 (72%) of state
   declarations — including `.command-palette__item` (`CommandPalette.css:62-71`), the one
   call site HEL-496 actually fixed. The invariant the ticket names is *state vs. the
   surface it renders on*, which for a transparent element is an **ancestor's** surface,
   not its own. Specify a resolution strategy that reaches the ancestor — e.g. BEM-block
   ancestry within the stylesheet, or resolving against the rendered DOM/computed styles
   of the running app rather than statically — and state its measured coverage of the 161
   pairs before implementation proceeds.

2. **Fail-closed at 72% is an allowlist, not a guard — state the expected first-run
   numbers.** D4 offers "reviewed allowlist with a reason per entry" as the escape hatch,
   and design.md Risks anticipates only threshold-weakening. With the current heuristic the
   first run is red on ~116 pairs and the only way to land it is ~116 allowlist entries —
   which is exactly the hand-curated population the ticket forbids. Add a task requiring
   the executor to report resolved/unresolved counts *before* remediation, plus a stated
   ceiling above which the parser is treated as defective rather than the tree
   (design.md Risks already says a collapsed count is a defect; the converse needs the same
   treatment).

3. **Make task 3.9's real-value mutation non-vacuous.** Require the mutated call site to be
   one whose pair the guard **resolves** (i.e. it is green before the mutation), and require
   the captured transcript to show the check going from green to red *naming the contrast
   ratio and theme* — not merely red, and not red-for-unresolved. As written, both named
   call sites are unresolvable in both states, so the mutation cannot distinguish a working
   guard from a broken one.

4. **Section 5's sweep population must be enumerated independently of the guard.** Add a
   task that derives a "states that should be visible" population from the rendered app —
   interactive elements (rows, options, menu items, cards, list items) in each changed
   view — and checks whether each conveys a visible state, rather than starting from the
   pairs the guard already reports. Without it, D6.3's admitted blind spot (the
   shadow-only/border-only/opacity absence, i.e. the HEL-1044 shape) is untested by *both*
   the guard and the sweep, and AC2's "complete sweep" is not achievable.

5. **Add the two missing D6 entries** so the routed-out gap list is honest: pseudo-element-
   expressed states (real instance: `DataGrid.css`, `.ui-data-grid__resize-handle:hover::after`)
   and breakpoint/media-scoped state-background overrides (`inputs.css:185`). Both are shapes
   the guard cannot see and both exist in this tree today.

6. **Validate the threshold against the accent family, not only the surface family.** 45 of
   161 state backgrounds use `--app-accent-dim` / `--app-accent-surface`, defined at
   `theme.css:172-173,223-224` as `color-mix(..., transparent)` over a runtime-injected
   accent. D3 justifies 1.10 solely from surface-token pairs. Either state that accent-based
   states are out of the guard's population (and say so in D6, with the count), or extend
   D3's justification to cover them.

### Non-blocking notes

- Task 1.3's "expected 58" is confirmed correct against the tree as of this gate.
- The gate-chain implications checklist is unusually thorough and the no-baseline-file
  decision is right — a regenerable baseline is exactly the fixture-edited-to-pass failure
  mode. Keep it.
- `workflow-state.md` records `SPEED_NOTE` honestly (slow unavailable, substance
  reconstructed). No objection; noting it so the final gate knows the budget is deliberate.
