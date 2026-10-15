## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed head: `cd64409ad828d9024074f907a7ea32800ab71ff3`. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/overview-row-delete-confirm/HEL-1605`.
- **Artifacts read in full:** ticket.md, proposal.md, design.md, tasks.md, specs/app-shell-rail/spec.md, workflow-state.md, and skeptic-design-1.md.
- **Code read at base:**
  - `rowDeleteFocus.ts`, a module flag with no timers and no button argument.
  - Both tables' Delete handlers (`PipelineListTable.tsx:236-239`, `SourceListTable.tsx:185-188`) and their `handleRowClick` guards (`:139`, `:120`).
  - Both pages' `rowExtra` and `onRequestDelete` (`PipelinesPage.tsx:62-99,151-154`, `SourcesPage.tsx:81-99,215-219`).
  - `formatRelativeTime.ts`, which reads `Date.now()` per call and emits seconds.
  - The `App.css:288` `.app-content` rule (`overflow-y: auto`) and `:498` (phone `padding-bottom: var(--bottom-nav-height)`).
  - `theme.css:119`, where `--bottom-nav-height` = capsule + inset + safe-area. This equals `BottomNav.css`'s
    `bottom` + `height`, so the token sits exactly at the nav's top edge. **D4 is sound** (round 1 also probed this).
  - `ConfirmInline.tsx/.css` and `PipelineListTable.css:94-110`.
  - `e2e/hel1574-shell-rail.spec.ts`: helpers at :16-58, the `fixme` at :387, and the HEL-1604 test at :505-567.
    Every design citation into this file is accurate.

**Round-1 change requests, checked against the revised text:**

1. **Scroller choice (CR1): addressed.** D2 now requires `overflow-y` auto/scroll **and** `scrollHeight > clientHeight`,
   falling back to `document.scrollingElement`. The Context section is corrected (the table scrollers compute
   `overflow-y: auto` but never overflow vertically). C6 and D2 state that only the e2e top-delta guards it.
2. **Delta sign (CR2): addressed.** The rule is now `|delta| >= 0.5`, and a unit test covers both signs.
3. **Arming rule (CR3): addressed.** D3 defines `mounted`, `timer` and the last mode:
   - `ref(null)` keeps the mode.
   - `noteDeleteActivation` re-arms only for `mounted`.
   - The switch order and StrictMode el/null/el both end armed on the right element. I traced both sequences by hand
     and they are correct.
   - Unit tests are listed in task 2.2 and C6.
4. **Tick coverage claim (CR4): addressed.** The claim is gone and the tick is recorded as a residual.
5. **`useNow` snapshot lifecycle (CR5): addressed.** The rule is stated, `getSnapshot` stays stable, and a remount
   test plus a reset export are planned. A residual-staleness note is below.
6. **Missing matrix cells (CR6): addressed.** I14, I15, I16 and I17 were added, and I17 cites skeptic-final-5 CR1.

The round-1 non-blocking notes were also taken: the seconds-granularity wording, why `useRelativeTime` is not reused,
the README (task 1.8), the rewrite of the "pointer does not scroll" test, the +1px tolerance, and I18.

**AC coverage:**
- AC1 → tasks 2.3 and 2.4.
- AC2 → task 2.5.
- AC3 → I4 and task 2.5.
- AC4 → task 2.3.

**Owner rulings:** D1-D5 change none of them, and C1 and C4 preserve them.

**New findings (fresh eyes):**

- **D2's compensation is bounded by the scroller's range, and the design does not say so.** In I8, closing A's confirm
  above B moves B **up** by the confirm row's height h. That height is `extra-cell` padding `--space-3` × 2 plus the
  wrapped label or button row, which is at least a table row's height. The pin compensates with
  `scrollTop += delta` where `delta = -h`.
  - **Where it fails.** If `scrollTop < h` (page at or near the top), or the page does not overflow at all (fallback
    `document.scrollingElement`, e.g. 1280 with a handful of pipelines), the browser clamps `scrollTop` at 0. B then
    moves up by about h. This is deterministic geometry, not a measurement.
  - **Where the second press lands.** The pointer sits at B's old position, which is now `h + offset` below B's new
    top. With h ≥ row height, that point is past B's row and inside **B's newly inserted confirm row**.
  - **Why that is dangerous.** `ConfirmInline` puts the label first and then the Confirm/Cancel buttons, inline-flex and
    centred. At narrow widths the sticky group is bounded to the scroller's width, so its buttons sit at the right,
    the same side as the Delete column when the table is scrolled to its end. The second press can therefore hit
    **"Confirm delete B"**. `onConfirm` has no `detail` guard, so B would be deleted by a double-click on its Delete
    button. The ticket's safety floor is "Nothing is deleted without an explicit Confirm."
  - **How it contradicts the artifacts.** It breaks the design's stated invariant ("for every cell of the matrix ...
    the activated Delete button does not move"), I8's expectation, and the spec's "Switching the confirm to another
    row" scenario, all of which are unconditional.
  - **Why the matrix would not catch it.** Every I8/I14 setup in the plan has the page scrolled (rows near the bottom),
    so the matrix would pass while the common case fails: a user with a short list, at the top of the page.
- **The pin record's lifetime is unspecified, and the stale record can scroll the page.**
  - **How a stale record arises.** D2 records a pin "for pointer" on every `noteDeleteActivation` and consumes it on
    "the first `focusOnMount(el)` after the activation". The second click of a double-click commits nothing (same
    state), so its record is never consumed and survives the gesture. D2 and D3 never say whether a **keyboard**
    activation clears it. The text ("for pointer, a pin record"; keyboard "clears any pending timer") reads naturally
    as leaving it alone.
  - **Failure sequence.**
    1. Double-click Delete on A, leaving a stale record for A's button at top T0.
    2. Cancel.
    3. Scroll the page by 300px.
    4. Press Enter on B's Delete.
    5. `focusOnMount(elB)` "applies the pin (D2)": A's button is still connected, with `delta = -300`, so
       `scrollTop -= 300` and the page jumps before the keyboard reveal runs.
  - **Other paths.** Any confirm mount without a fresh activation (a remount) hits the same path.
  - **Why it would slip through.** No matrix cell or unit test exercises it.

### Verdict: REFUTE

The round-1 requests were genuinely fixed, not reworded. D1, D3 and D4 are now sound and well-specified. Two new
defects are in the same class HEL-1574 kept rediscovering one cycle at a time:
- an unbounded claim in D2 whose failure mode can delete a row;
- an unspecified state lifetime in D2 that can jump the page.

Both are cheap to settle on paper.

### Change Requests

1. **Bound D2's claim, and make a missed second press harmless (design.md D2, the invariant paragraph, I8/I14,
   spec.md "Switching the confirm to another row").**
   - **(a) State the limit.** The pin can only compensate within `[0, scrollHeight - clientHeight]`. When A's confirm
     closes above B with `scrollTop < h`, or on a non-overflowing page, B moves up by the uncompensated remainder.
     Reword the invariant and the spec scenario to say so, or design a mechanism that holds B still in that case.
   - **(b) Decide what the second press may hit when B does move, and make it safe.** The cheapest option is the
     HEL-1604 pattern: the confirm group's Confirm and Cancel ignore a click with `event.detail > 1`. This lives in the
     pages' `onConfirm`/`onCancel` wrappers or via a `ConfirmInline` prop, and keyboard clicks are `detail === 0`, so
     they are unaffected. If another mechanism is chosen, name it.
   - **(c) Add a matrix cell, E2E at 375 and 1280:**
     - Setup: page at `scrollTop` 0, or a short non-overflowing list at 1280, with a confirm open on row 1. Double-click
       the Delete on row 3.
     - Expected: no deletion (the row count is unchanged and no DELETE request is sent), exactly one confirm open, and
       it names row 3. Record B's top delta, which is expected to be non-zero.
     - Red-first: shown failing (or the hazard shown) on base.
   - **(d) Record any remaining residual** in Risks.
2. **Specify the pin record's lifetime (design.md D2/D3, task 1.3/1.4, task 2.2).** State that:
   - every `noteDeleteActivation` overwrites the record, and a keyboard activation sets it to none;
   - a record not consumed by the activation's own commit is discarded. This covers the second click of a
     double-click, which commits nothing, and a mount with no fresh activation. For example, discard records older
     than the activation's task (a `setTimeout(0)` clear), or record a pin only when no confirm is mounted **or** the
     clicked button is not inside `mounted`'s row. Name one rule; do not leave it to the implementer.

   Add unit tests:
   - the sequence `note(1, btnA)`, `ref(elA)`, `note(2, btnA)` (no commit), move btnA by -300, `note(0, btnB)`,
     `ref(null)`, `ref(elB)`: the scroller's `scrollTop` is unchanged by the pin;
   - a remount with no fresh activation does not pin.

### Non-blocking notes

- **`useNow` staleness can reach about two intervals.**
  - **Why.** With D1's rule, a table that mounts while no ticker is running and the stored value is 59s old renders
    against that value. The first tick then arrives 60s after `subscribe`, so labels can lag up to about 119s.
  - **Effect on the e2e.** Rows created after the stored value read "just now" (negative diff). That still matches
    the freshness regex, so the e2e is unaffected.
  - **Simpler fix.** Refresh the stored value and notify on every 0→1 subscribe. Accepting the lag is also fine, but
    say "up to about 2 intervals".
- **I4 and task 2.5 disagree.** I4 says "no movement for 400ms"; task 2.5 checks at 300ms. Pick one; 400ms is the
  stronger check against a 500ms timer.
- **The HEL-1604 e2e may flake on its freshness check on a slow CI runner.** It creates 22 sources and 22 pipelines
  serially and then tests /pipelines before /sources. If the sources pass 60s old, the planned freshness assertion
  fails as a flake rather than catching a real defect. Consider seeding each page's rows right before that page's
  gesture, or give the assertion a message that says "precondition: rows not fresh".
- **D3's deferred reveal can pull the page back.** The timer reveal runs `scrollIntoView({block:"nearest"})` 500ms
  after the last press, even if the user has started scrolling away. Clearing the pending reveal on a user
  `wheel`/`touchmove`/`keydown` on `.app-content` would avoid this. It is optional, so I am noting it rather than
  requiring it.
- **No gate defect.** No report I drew on discloses unsound evidence mtimes, and nothing here rests on mtime ordering.
