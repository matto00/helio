## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md and specs/* (untracked) at HEAD 361c22f223ee27409b045860aab6ab889bbbb687 (== main), checked against the live tree. Prior rounds: skeptic-design-1..4.md (all REFUTE).

### What I verified (with evidence)
- **Cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/spine-compact-menu-rule/HEL-1671`.
- **Round-4 CR1 is resolved.** I re-read design.md in full. It now states one opacity-reveal set and one pointer-enable set:
  - D1 "A hidden trigger never takes a press", line 32: "once enabled for pointer input (the restore set in the next bullet: selected row, focus inside the menu itself, or row hover under `@media (hover: hover)`)". It continues: "Revealed for OPACITY (row hover, row focus-within, selected) and enabled for POINTER input are deliberately two different state sets."
  - The "added to the existing allowlisted reveal rule" sentence is gone. The hover-gating text now points to the guard-impact statement.
  - Compact: "its `pointer-events` restore set DOES change, to the same set as the regular rules".
  - D2 compact-row bullet, line 43: "`pointer-events: none` until enabled by the D1 restore set: selected, focus inside the menu itself, or row hover under `@media (hover: hover)`; its opacity reveal stays on row hover/focus-within".
  - I grepped design.md for every `pointer-events` / `focus-within` / `hover` mention. No remaining sentence ties the pointer restore to row `:focus-within` or to ungated `:hover`.
- **Live CSS still matches the Context section** (PipelineSpine.css on main):
  - The regular reveal rule at :340-342 is the mixed hover / focus-within / selected rule.
  - The compact block is `@container spine-column (max-width: 226px)` at :430. It contains `.spine-row__markers:empty` at :431, a grid of `auto minmax(0,1fr) auto auto` with `column-gap: var(--space-2)` at :440-441, and a menu with `pointer-events: none` at :485.
  - The compact block's ungated `:hover` / `:focus-within` restore at :493-496 is the defect the design removes.
  - `.spine-card__menu` at :86 has no opacity rule.
- **The spec deltas are faithful to the live specs.** I diffed against openspec/specs/pipeline-detail-spine-layout/spec.md:8-23 and openspec/specs/pipeline-schedule-config-ui/spec.md:10-37. The only text changes are:
  - the replaced hover/focus-only allowance;
  - the new ⋮ rule and empty-markers paragraph, plus four scenarios;
  - the corrected Layout-scope sentence. The 800/600 page-content-width wording matches the header requirement's own text and PipelineSpineHeader.css, as round 4 verified.

  Everything else is identical.
- **Validation:** `openspec validate spine-compact-menu-rule --type change` printed "Change 'spine-compact-menu-rule' is valid".
- **The tasks match the design:**
  - 1.1-1.5 are red-first, covering D5.1, D5.2, D5.3, D5.3b and D5.3c.
  - 2.3b says "restored ONLY by" the three states, and applies the same set inside the compact block.
  - 3.1 and 3.2 cover items 4 and 5.
  - 4.1-4.4 match the ticket's acceptance criteria: 769/900/1024/1100, light and dark, and re-running both spine specs.
- **The mechanism was proven in prior rounds, and I accept that evidence.** Round 3 prototyped the regular-row hit-box extension and the restore set (proto3). Round 4 prototyped the compact variant (proto5) with real `touchscreen.tap` and mouse input, two repetitions each. The design's mechanism is exactly the variant those prototypes showed working. The variant shown failing is no longer described anywhere.
- **Every acceptance criterion is covered.** Item 1 is D1/D2/D5.2/D5.3c. Item 2 is D3/D5.3. Item 3 is D5.1, labelled as a guard, with a mutation. Item 4 is D4, with the measurement recorded. Item 5 is D6 plus the delta. I found no scope drift beyond the ticket's ⋮-rule work. The no-hover tap fix is needed for the chosen rule to hold on touch, and the design justifies it.

### Verdict: CONFIRM

### Non-blocking notes
- design.md line 32 says "`:focus-within` still reveals and enables it". This is accurate for focus on the trigger, which matches `.spine-row__menu:focus-within` and enables it. Read as row focus-within, it would contradict line 33. When writing the CSS, use line 33 as the authority.
- As round 4 noted, the gated `.spine-row:hover .spine-row__menu { pointer-events: auto }` must be its own rule inside `@media (hover: hover)`. `mixedGatedRules` rejects a gated rule that also lists `--selected` or `:focus-within`.
- The compact `.spine-row--selected:hover .spine-row__menu` rule at :517 and the related tone rules need re-checking once the selected compact ⋮ moves to line 2 with a transparent background (D2).
