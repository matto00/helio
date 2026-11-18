## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: the planning artifacts (ticket.md, proposal.md, design.md, tasks.md, specs/*), which are untracked, at HEAD 361c22f223ee27409b045860aab6ab889bbbb687 (== main), checked against the live tree. Prior rounds: skeptic-design-1.md and skeptic-design-2.md.

### What I verified (with evidence)
- **Cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/spine-compact-menu-rule/HEL-1671`.
- **Live CSS/TSX facts in design.md Context:** correct.
  - Regular `.spine-row` is flex (PipelineSpine.css:184-189).
  - `.spine-row__select` is `flex: 1` with padding `--space-2` (:219-234).
  - `.spine-row__menu` is in-flow and `opacity: 0`, revealed by the ungated `:hover` / `:focus-within` / `--selected` rule (:349-359).
  - The compact block's menu is absolute with `pointer-events: none`, restored by `.spine-row:hover` / `.spine-row:focus-within` (:478-497).
  - The menu is a sibling of the select, and only non-phone rows render it (SpineStepRow.tsx:247-251).
- **Geometry half of the round-3 mechanism:** sound. I tested the negative right margin plus equal extra padding on a flex `flex:1` select in a minimal page in headless Chromium (playwright-core 1243).
  - Title `clientWidth` (193 / 167) and count left edge (233.17) were identical with and without the extension.
  - The select's right edge moved from 256 to 280, under the menu slot.
  - With the pointer parked, `elementFromPoint` at the hidden trigger's centre resolved to the select (`s2`). On main it resolved to the trigger (`m2`).
  - So D5.3c's static `elementFromPoint` clause is red on main and would go green.
- **Behavioural half (the contract):** fails. See CR1. Results were reproduced in 2 independent repetitions each. Persisted evidence:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1671/evidence/.concertino/scratch/HEL-1671/skeptic-design-3/results.txt`
  - pages/scripts `proto.html`, `proto2.cjs`, `proto3.html`, `proto4.html` (same dir)
- Items 2, 3, 4 and 5, D3, D4, D6 and the spec delta for `pipeline-schedule-config-ui` were checked in rounds 1–2 and are unchanged in substance. I found nothing new against them.

### Verdict: REFUTE

### Change Requests
1. **The D1 / task 2.3b mechanism does not deliver "a press where an unselected row's hidden ⋮ sits SHALL select that row", for mouse or touch. D5.3c as written cannot go green.** These are the Chromium results with the design's exact rule set (`pointer-events: none` on the hidden menu, restored by the existing reveal rule `.spine-row:hover …, .spine-row:focus-within …, .spine-row--selected …`). `pd` is the `pointerdown` target, `ck` the `click` target:
   - **Mouse (`page.mouse.click`):** `pd:m2, ck:m2` → the menu opens and the row is not selected. The click's own mousemove applies `.spine-row:hover`, which restores `pointer-events: auto` before mousedown. D5.3c's "a real `page.mouse.click` there selects the row" is therefore permanently red. With a hovering pointer the ⋮ is never hidden at press time, so for mouse input the contract contradicts the hover-reveal half of the same rule.
   - **Touch (`hasTouch`, `touchscreen.tap`, `(hover: hover)` false):** `pd:s2, ck:m2` → the menu opens and the row is not selected. Pointerdown hits the select, but Chromium re-hit-tests the tap after applying the tap's sticky `:hover`. The ungated `:hover` restoration (which D1 deliberately adds to the allowlisted ungated rule) re-enables the trigger mid-gesture. This is the exact touch path D1 depends on, and it behaves as it does on main.
   - **Moving only the `:hover` restoration into `@media (hover: hover)` is not enough:** the touch tap then gives `pd:s2, ck:r2`, and nothing is selected. The press focuses the select, `.spine-row:focus-within` restores `pointer-events`, and the release lands on the trigger. The click then targets the common ancestor, the non-interactive row div. That is the round-2 dead zone again.
   - **Compact mode has the same defect on main, and the design leaves it untouched** ("Compact mode keeps its own overlay"). The compact structure (absolute menu, `pointer-events: none`, restored on `.spine-row:hover` / `:focus-within`, PipelineSpine.css:478-497) under a touch tap gives `ck:m2` → the menu opens. D5.3c at a compact width would therefore be measured green by `elementFromPoint` while the real touch tap still opens the menu.
   - **Root cause:** every state that restores `pointer-events` (`:hover` on touch, row `:focus-within`) is created by the press itself, before its click is targeted.

   **Required revisions:**
   - (a) Restore the hidden menu's `pointer-events` only from states the press on the select does not create:
     - `.spine-row--selected .spine-row__menu`
     - `.spine-row__menu:focus-within` (focus inside the menu itself, not the row)
     - `.spine-row:hover .spine-row__menu` only inside `@media (hover: hover)`

     The opacity reveal may stay on the row's `:hover` / `:focus-within`. Apply this in both the regular rules and the compact block, and state the hover-gating guard impact. A new hover selector inside `@media (hover: hover)` is permitted.

     I prototyped this variant (`proto3.html`, 2 repetitions):
     - touch: first tap `pd:s2, ck:s2` → selects; second tap `ck:m2` → opens the menu.
     - mouse: hover reveals and the click opens the menu, as intended.

     Any other mechanism is acceptable only if it is shown to pass the same real-input test.
   - (b) Scope the contract to no-hover input in the spec scenario, D1 and proposal.md. With a hovering pointer, the ⋮ is visible at the moment of the press, and opening it is the intended hover-reveal behaviour.
   - (c) Rewrite D5.3c as follows:
     - Use a touch context (`hasTouch: true`, `page.touchscreen.tap` at the hidden trigger's centre) at 1100px AND at a compact width.
     - Assert that the tap selects the row (`aria-current="true"`) and that no "Step actions" menu is open.
     - A second tap opens the menu.
     - Record red on main at both widths. On main, both widths open the menu.
     - Keep `elementFromPoint` only as a supplementary check. On its own it is evidence-shaped non-evidence: it is green for a mechanism that fails real input.
   - (d) Keyboard: with (a), a row whose select has focus shows its ⋮ (opacity 1) but the ⋮ is not pointer-operable until hovered or selected. State whether that is acceptable or add a rule for it.

### Non-blocking notes
- A touch laptop whose primary pointer is fine still matches `(hover: hover)`, so a touch tap there can still restore pointer-events through sticky hover. Playwright's touch emulation cannot reproduce that device class. Record it as a residual risk in design.md rather than claiming the touch-laptop case is covered.
- The "no-shift" clause of D5.3c (title `clientWidth` and count left edge unchanged with the extension disabled) is confirmed sound by the prototype. Keep it.
- Persisting evidence from the main-checkout scratch dir produced a ref under `.concertino/runs/HEL-1671/evidence/.concertino/scratch/...`. The executor should expect that path shape.
