## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md and specs/* (untracked) at HEAD 361c22f223ee27409b045860aab6ab889bbbb687 (== main), checked against the live tree. Prior rounds: skeptic-design-1/2/3.md.

### What I verified (with evidence)
- **Cwd guard:** printed `READY ambient=/home/matt/Development/helio branch=task/spine-compact-menu-rule/HEL-1671`.
- **The design.md Context facts match the live CSS.**
  - PipelineSpine.css:333-343: the regular `.spine-row__menu` is in flow with `opacity: 0`. It is revealed by the ungated mixed rule `:hover` / `:focus-within` / `--selected`.
  - PipelineSpine.css:441-519: the compact block makes the select a grid with columns `auto minmax(0,1fr) auto auto`. Its menu is absolute with `pointer-events: none`. The selected row's reveal is cancelled. `pointer-events` is restored by the UNGATED `.spine-row:hover` / `:focus-within`, which is the defect that design-3 named.
- **The hover-gating guard can accept the planned rules.**
  - `cssHoverGating.ts` `parseRules` keeps nested ancestors. `ungatedHoverSelectors` exempts any rule whose ancestors include `@media (hover: hover)`, so a gated rule nested inside the compact `@container` passes.
  - `mixedGatedRules` forces the gated `:hover` restore to be its own rule. The design writes it alone, so that check passes.
  - Both allowlist "still exists" checks stay satisfied. The regular opacity selector is kept, and the compact block keeps ungated `:hover` tone rules.
- **The round-3 CR1 is addressed in the actionable artifacts.**
  - The new D1 bullet "Which states re-enable the hidden ⋮" adopts CR1(a) exactly. It restores pointer events only on these three states, in both the regular rules and the compact block:
    - `.spine-row--selected`
    - `.spine-row__menu:focus-within`
    - `.spine-row:hover` gated by `@media (hover: hover)`
  - CR1(b): the no-hover contract scope appears in D1, the spec requirement ("with no-hover input (touch)") and the proposal.
  - CR1(c): D5.3c uses a `hasTouch` context and a real `touchscreen.tap` at 1100px AND at a compact width. It asserts `aria-current` and that no menu opens, includes the second tap, and requires red on main at both widths. `elementFromPoint` is supplementary only.
  - CR1(d): the keyboard trade-off is stated. The touch-laptop residual risk is recorded.
  - Task 1.5 and task 2.3b match, and 2.3b says "ONLY".
- **I prototyped the compact variant fresh.** Round 3 only prototyped the regular row. I used an absolute menu over a full-width grid select at a 180px spine, in headless Chromium (playwright-core), 2 repetitions each, using the CR1(a) restore set ("fixed"):
  - touch and touch+mobile: first tap `pd:cnt, ck:cnt, select` (the row is selected), second tap `ck:m2, menu`.
  - mouse: the hover reveal opens the menu. This is intended.
  - Restoring `pointer-events` on the existing mixed reveal rule instead ("mixed"): touch first tap `pd:cnt, ck:m2, menu`. The menu opens and the row is not selected.
  - So the CR1(a) mechanism also works in compact mode, and the alternative reading below reproduces the defect.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1671/evidence/.concertino/scratch/HEL-1671/skeptic-design-4/results.txt`, `proto5.html`, `proto5.cjs` (same dir).
- **Item 5:** PipelineSpineHeader.css:345 `@container (max-width: 800px)` makes the chip compact, and :379/:389 `(max-width: 600px)` give the icon form and the "Paused" word. Both key off the page container (PipelineSpineLayout.css:14 `container-type: inline-size`). The delta matches. The live spec (openspec/specs/pipeline-schedule-config-ui/spec.md:19) does say ≤1100/≤900, so the correction is real.
- **Items 2, 3, 4, D3, D4, D6:** unchanged in substance since rounds 1-3. I found nothing new against them.

### Verdict: REFUTE

### Change Requests
1. **design.md still contains the round-3-refuted restore mechanism, in direct contradiction with its own new bullet.** The new D1 bullet (design.md line 33) says `pointer-events` is restored ONLY by selected, `.spine-row__menu:focus-within` and gated hover. Three earlier sentences, left over from round 2, still instruct the opposite:
   - (a) design.md line 32, D1 "A hidden trigger never takes a press" bullet: "once revealed (hover, focus-within, selected) it is `pointer-events: auto` and on top". Row `:focus-within` and ungated hover are exactly the states that the press creates.
   - (b) The same bullet: "Hover-gating: the `pointer-events: auto` restoration is added to the existing allowlisted reveal rule (`.spine-row:hover .spine-row__menu, .spine-row:focus-within ..., .spine-row--selected ...`), so no new ungated hover selector appears." That is the "mixed" variant. My proto5 run reproduces it failing under touch: `ck:m2` opens the menu and the row is not selected. It also contradicts the new bullet's guard-impact statement, which says there is one NEW gated hover selector.
   - (c) The same bullet: "Compact mode keeps its own overlay (its menu is already absolute over a full-width select)". This reads as "compact unchanged", but the new bullet requires the compact restore set to change.
   - (d) design.md line 43, D2: "Unselected compact rows keep HEL-1608's overlay reveal (... `pointer-events: none` until hover/focus)". "Focus" here is row focus, which the new bullet forbids as a `pointer-events` trigger.

   **Required revision:** edit (a)-(d) so that design.md states one restore set, the line-33 set. Specifically:
   - Revealed for opacity means row hover / row focus-within / selected.
   - Enabled for pointer means selected / menu focus-within / `@media (hover: hover)` row hover.
   - Remove the "added to the existing allowlisted reveal rule" sentence, and point the hover-gating statement at the line-33 guard-impact text.
   - State that the compact block's restore set changes.

   tasks.md 2.3b and the spec are already correct. Only the design text is stale. D5.3c would catch an executor who followed the stale sentences, but the design should not instruct a mechanism that is shown to fail.

### Non-blocking notes
- When writing the gated restore, keep it as its own rule inside `@media (hover: hover)`. `mixedGatedRules` rejects a gated rule that also lists `.spine-row--selected` or `:focus-within`.
- In the compact block, the top-level gated `.spine-row:hover .spine-row__menu { pointer-events: auto }` already outranks the compact `.spine-row__menu { pointer-events: none }` on specificity (0,3,0 vs 0,1,0). A second copy inside the container is optional, not required. The design says "in each of the regular rules and the compact block", and either is fine.
- Persisted refs from the main-checkout scratch dir take the shape `.concertino/runs/HEL-1671/evidence/.concertino/scratch/...`, as round 3 noted.
