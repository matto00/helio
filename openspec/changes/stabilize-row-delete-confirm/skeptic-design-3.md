## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed head: `cd64409ad828d9024074f907a7ea32800ab71ff3`. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/overview-row-delete-confirm/HEL-1605`.
- **Read in full:** ticket.md, proposal.md, design.md, tasks.md, specs/app-shell-rail/spec.md, workflow-state.md,
  skeptic-design-1.md and skeptic-design-2.md.
- **Code read at base:**
  - `rowDeleteFocus.ts` (module flag, `noteDeleteActivation(clickDetail)` only).
  - `ConfirmInline.tsx`/`.css`: `.ui-confirm-inline` is `inline-flex`, content-sized, label first, then Confirm and
    Cancel. `onConfirm`/`onCancel` are `() => void`.
  - `PipelineListTable.tsx:134-262` and the `SourceListTable.tsx` call sites (`:120`, `:180`, `:187`, `:198`).
  - `PipelinesPage.tsx` and `SourcesPage.tsx` `rowExtra` and `onRequestDelete`. Both are synchronous `setState`, so the
    confirm mounts in the click's own commit, as D2's rAF-discard rule assumes.
  - `PipelineListTable.css:94-110` and `SourceListTable.css:160-176`: the extra-cell child is `position: sticky; left:
    var(--space-3); max-width: calc(100cqw - ...)`, so it is left-pinned.
  - `PipelinesPage.css:134-139`: the actions cell is `text-align: right`, so Delete is always the rightmost control.
  - `App.css:288` and the phone `padding-bottom` rule; `theme.css:119`.
  - The `e2e/hel1574-shell-rail.spec.ts` helpers (`placeBottomNearViewportEdge`, `settledRowTop`, `recordPresses`).
  - `ConfirmInline` callers: 10 files, the two pages plus 8 others, with AgentMemoryList using it twice. That matches
    "the other 9 callers".

**Round-2 change requests:**

1. **CR1 is only partly addressed.**
   - Done:
     - (a) D2 now states the limit ("scrolling cannot go below 0 or past the end").
     - (b) D2b adds `ignoreRepeatClicks` on Confirm and Cancel (`detail > 1`), opt-in and set only by the two pages.
       This is a sound, cheap mechanism. Keyboard (`detail` 0) and a deliberate single click are unaffected.
     - (c) I19 was added.
     - (d) Risks records the residual.
   - Not done: CR1(a) also required rewording **the invariant and the spec scenario**. Neither was reworded (see CR1
     below). The new limit sits beside the old unconditional claims, which still contradict it.
2. **CR2 is addressed.** There is one named rule:
   - every activation overwrites the record, and a keyboard activation sets it to none;
   - the first `focusOnMount(el)` consumes it;
   - a record not consumed by its own activation's commit is discarded on the next animation frame.

   I traced the cases by hand and each behaves correctly:
   - a double-click on the same row (the second click's record is discarded);
   - the switch A→B (B's `ref(el)` consumes the record);
   - StrictMode el/null/el (the first attach consumes it, and the re-attach finds none);
   - the I20 stale sequence.

   The required unit tests are listed (I20, plus a remount with no fresh activation).

**Round-2 non-blocking notes:**
- Taken:
  - wheel/touch cancels the pending reveal (I21);
  - the ~2-interval lag is in Risks;
  - the e2e seeds minimal rows to keep labels fresh.
- Not taken, which is fine: I4 and its tests now agree on 300ms.

**Fresh review.** D1, D3 and D4 remain sound. I re-traced D3's arming against the switch and StrictMode orders, and a
touch double-tap (the second tap's `touchstart` cancels the reveal, and its click re-arms it). AC1-AC4 each map to a
task (2.3/2.4, 2.5, I4/2.5, 2.3). D1-D5 and D2b change no owner ruling, and C1 is intact.

### Verdict: REFUTE

Two defects, both cheap to fix on paper. The second would cost an execution cycle as written.

### Change Requests

1. **The invariant and the spec still promise what D2's limit admits is false (finishing round-2 CR1(a)).**
   - **The contradiction.** D2 says that near the top, or on a page that does not scroll, a switch "still moves B up by
     up to the closed confirm's height, and the second press may land in B's own new confirm row". The artifacts still
     state the opposite unconditionally:
     - **`design.md:20-22`:** "for every cell of the matrix below: between the two presses of a double-click the
       activated Delete button does not move on screen". I19 is a matrix cell in which, by D2's own text, it moves.
     - **`spec.md:4-6`:** "Opening, re-rendering or switching ... SHALL NOT move the activated row's Delete button under
       the pointer: both presses of a double-click SHALL land on the same button". This is unconditional, and the limit
       sentence at :10-12 only adds a fallback without carving out the SHALL NOT.
     - **`spec.md:29-31`, scenario "Switching the confirm to another row":** "THEN both presses land on the second
       row's Delete", with no condition. Its WHEN also covers the page-at-top case, so it directly contradicts the
       scenario at :33-36.
   - **Why it matters.** An evaluator checking the spec literally will mark I19's measured movement as a SHALL
     violation, or the executor will chase an impossible hold.
   - **The fix.** Scope the invariant, the SHALL NOT and the "Switching" scenario to "where the scroller can absorb the
     shift" (or "while the page can scroll by the closed confirm's height"). Keep the near-top scenario as the
     explicitly weaker guarantee.
2. **I19 is required to be red on base where it cannot be, and as written it can pass without exercising D2b.**
   - **I19 at 1280 cannot fail on base.** It says "E2E 375 + 1280, red on base" (also C5 and task 2.6b). At 1280 the
     confirm content is content-width and left-pinned, while the second press lands at the Delete button's x, at the
     right edge:
     - The extra-cell child is `sticky; left: var(--space-3)` (`PipelineListTable.css:106-110`, `SourceListTable.css:172-176`).
     - `.ui-confirm-inline` is `inline-flex`.
     - The actions cell is `text-align: right` (`PipelinesPage.css:134-139`).
     - The /pipelines label is about 80 characters at `--text-xs`, so its buttons end roughly 650px from the table's
       left. The Delete column is far right of that. On /sources the label is shorter, so its buttons sit further left.
     - On base, then, the second press lands on the extra cell's empty background. Every I19 assertion (no DELETE, no
       navigation, one confirm) holds on base and **also holds with D2b removed**, so the cell proves nothing about D2b.
     - The same reasoning makes /sources at 375 doubtful. The plausible red is /pipelines at 375 with the table
       scrolled to its end, where the wrapped label pushes Cancel or Confirm to the visible right edge.
   - **I14 may also be green on base.** Chrome scroll anchoring can itself absorb A's confirm closing above the
     viewport, which is why round 1 asked for this cell. C5's blanket "every new/restored assertion red on base" is
     then unsatisfiable for it.
   - **Required.** For each new or restored E2E cell (I2, I4, I6, I8, I14, I15, I17, I19), state whether it is red on
     base or a guard. For each guard, name the mutation that makes it fail, per the repo's red-vs-guard rule.
   - **For I19 specifically:**
     - **(a)** Pin a configuration where the second press lands on a confirm button on base: page, width, table
       scrolled to its end, and page at top. For example, /pipelines at 375. If none exists, say so, and make I19 a
       guard whose mutation (dropping `ignoreRepeatClicks`) is shown to fail it.
     - **(b)** Require the test to record the second press's target with the existing `recordPresses` helper and
       assert it. A run whose second press hit `TD`/`DIV` background is not evidence for D2b.
     - **(c)** Drop "red on base" from the 1280 variant, or remove that variant.

     Update C5 and task 2.6/2.6b/2.7 to match.

### Non-blocking notes

- **D2b paragraph cleanup (`design.md:67-70`).**
  - Line 67 is an orphaned sentence fragment (" React flushes a click's update synchronously ...").
  - The "Guard:" and "Not covered (residual)" lines that belong to D2 now sit under D2b, so they read as D2b's
    residual. Move them back under D2.
- **The wheel/touchstart listener's target and removal are unspecified.** It could be on `document` or on the
  scroller. Name it, and remove it when the timer fires or clears, so that no listener leaks per open confirm.
- **I19's Expected could also record B's top delta,** as round 2 asked, so that the size of the residual is measured
  rather than assumed.
- **No gate defect.** No report I drew on discloses unsound evidence mtimes, and nothing here rests on mtime ordering.
  The geometry in CR2 is derived from cited CSS lines, not from a measurement. CR2's required action (classify, record
  the press target, or relabel) holds even if a probe placed the buttons differently.
