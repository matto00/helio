## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed head: `cd64409ad828d9024074f907a7ea32800ab71ff3` (the planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/overview-row-delete-confirm/HEL-1605`.
- **Artifacts read in full:** ticket.md, proposal.md, design.md, tasks.md, specs/app-shell-rail/spec.md.
- **Code read:** `rowDeleteFocus.ts` (+ test), `SourceListTable.tsx`, `PipelineListTable.tsx`, `SourcesPage.tsx`, `PipelinesPage.tsx`,
  `App.css` (the `.app-content` rule at :288 and the phone block at :391-500), `BottomNav.css`, `theme/theme.css:107-121`,
  `SourceListTable.css` / `PipelineListTable.css` (scroller and extra-row rules), `e2e/hel1574-shell-rail.spec.ts`,
  `hooks/useRelativeTime.ts`, `hooks/README.md`, `main.tsx`, and the base `openspec/specs/app-shell-rail/spec.md`
  (no conflicting requirement, so ADDED is correct).
- **HEL-1574 evidence:** evaluation-8 (root cause and measurements), evaluation-9, skeptic-final-5 (the 820/400
  last-row CR1).
- **Standalone headless-Chromium probe** (scratchpad, run twice, identical output). A 700px scroller with
  `overflow-y:auto; scroll-padding-bottom:88px`, containing a `overflow-x:auto` wrapper around a table:
  `{"tableScrollerOverflowY":"auto","tScrollH":1042,"tClientH":1042,"afterNearestBottom":612,"cScrollTop":364}`.
  - An element with only `overflow-x: auto` computes `overflow-y: auto`, but it has no vertical overflow
    (scrollHeight equals clientHeight).
  - `scrollIntoView({block:"nearest"})` honours the outer scroller's `scroll-padding-bottom`: the bottom lands at 612,
    which is 700 - 88. **D4 is sound.**
- **React facts relevant to D2/D3.** React is `^19.3.0`. `main.tsx:66` wraps the app in `<React.StrictMode>`, and the
  e2e suite runs against the Vite dev server (`playwright.config.ts:155`).
  - Under React 19, StrictMode double-invokes ref callbacks on mount in development: attach, then `null`, then attach.
  - In one commit, a deleted fiber's ref is detached in the mutation phase, before new refs attach in the layout phase.
    On a switch from row A to row B, the call order is therefore `focusOnMount(null)` for A, then `focusOnMount(elB)`.
- **The second click of a double-click causes no commit.** `onRequestDelete` sets the same object
  (`setDeletingSource(source)` / `setDeletingPipeline(p)`) plus nulls that are already null, so React bails out and no
  ref callback runs.
- **Owner rulings.** Nothing in D1-D5 touches confirm placement, copy, the button recipe, the 44px expander, focus
  return (`focus({preventScroll:true})` stays) or the HEL-1604 guard (`detail > 1` and the actions-cell check in both
  `handleRowClick`s). C1 and C4 preserve them. I see no ruling regression from the planned edits.
- **AC coverage.**
  - AC1 is covered by 2.3 (375, /sources) and 2.4 (375 and 820/400, both pages).
  - AC2 is covered by 2.5.
  - AC3 is covered by I4/2.5.
  - AC4 is covered by 2.3.
  - Every AC has a task.

### Verdict: REFUTE

D1 and D4 are sound, as are the overall shape (deferred pointer reveal plus pin) and the matrix idea. D2 as written
is a silent no-op. Its interaction with D3's timer is underspecified in a way that fails in exactly the switch and
StrictMode paths. One coverage claim is false. These are cheap to fix on paper and expensive to discover in an
execution cycle, which is the pattern HEL-1574 repeated nine times.

### Change Requests

1. **D2 picks the wrong scroller: the pin becomes a no-op.**
   - **The defect.** D2 says to use the "nearest ancestor whose computed `overflow-y` is `auto|scroll`".
     `.source-list-table__scroll` (`SourceListTable.css:93`) and `.pipeline-list-table__scroll`
     (`PipelineListTable.css:27`) set only `overflow-x: auto`, and the probe shows that this computes `overflow-y: auto`.
     The nearest match above the Delete button is therefore the horizontal table scroller, whose
     `scrollHeight === clientHeight`. Writing `scrollTop` there does nothing, and I8 stays broken.
   - **Revise D2** so that it names the vertical scroller unambiguously. Either:
     - take the nearest ancestor with `overflow-y` auto/scroll **and** `scrollHeight > clientHeight`, falling back to
       `document.scrollingElement`; or
     - use `button.closest(".app-content") ?? document.scrollingElement` and state why.
   - **Correct the Context section.** "The table scrollers are horizontal only" is true of intent but not of computed
     style.
   - **Say how this is guarded.** jsdom does not compute the visible→auto rule, so a unit test cannot catch this. The
     I8 e2e top-delta assertion is the guard.
2. **D2's threshold must be on the magnitude of the delta.** "Adds the delta ... when it is >= 0.5px" reads as signed.
   In I8, closing A's confirm above B moves B **up**, so the delta is negative and a signed check would skip exactly
   the case D2 exists for. Write `|delta| >= 0.5`.
3. **Specify where D3's timer is armed and what `focusOnMount(null)` clears, given React's ref ordering.**
   - **Why it matters.** As designed, the timer is scheduled by the pointer activation in the click handler, before the
     commit, and `focusOnMount(null)` "clears the timer and the element". That loses the reveal in two paths:
     - **Switch (I8).** The same commit calls `focusOnMount(null)` for A after B's activation scheduled the timer, so
       B's reveal is cancelled.
     - **StrictMode in dev, the environment the e2e runs in.** Mount runs attach → `null` → attach, so the first
       pointer reveal is cancelled. The result is a dev/prod divergence, and I4 fails only under e2e.
   - **The revised design must state an arming rule that survives both paths.** For example:
     - The reveal is (re)armed in `focusOnMount(element)` when the last activation was a pointer one.
     - `noteDeleteActivation` re-arms only when a confirm is already mounted. This covers the second click, which
       causes no commit.
     - `focusOnMount(null)` clears the timer and element but not the pin record, or the pin record is consumed when
       an element attaches.
   - **Add unit tests** for:
     - the call order `noteDeleteActivation(1, btnB)`, `focusOnMount(null)`, `focusOnMount(elB)`, followed by the
       reveal firing on `elB`;
     - a render under `<StrictMode>`, or the equivalent el/null/el sequence, followed by the reveal firing once.
4. **Remove or fix the false coverage claim in D2.** D2 claims it covers "the tick firing mid-gesture". A `useNow` tick
   re-renders the tables without remounting the confirm (`focusOnMount` is a stable ref), so no pin runs and a
   tick-induced reflow between the two presses is not compensated. Either:
   - drop the claim and record it as a residual (roughly a 0.3% window per minute, and only when a label changes
     length and wraps); or
   - design an actual mitigation, such as holding the tick's snapshot while a pointer gesture or reveal is pending.
5. **Specify `useNow`'s snapshot lifecycle.**
   - **The gap.** The design says the interval starts with the first subscriber and stops with the last, but
     `getSnapshot` runs during render, before `subscribe`. A module-level value initialised at import, or left over
     from when the ticker last stopped, makes a table that mounts after idle render ages relative to a stale `now`.
     Old rows would read too young, and rows newer than that `now` would read "just now". Calling `Date.now()` inside
     `getSnapshot` would break snapshot caching.
   - **State the rule**, for example: refresh the stored value once when the subscriber count goes from 0 to 1 (or in
     `getSnapshot` when no ticker is active and the value is older than the interval), then keep it cached.
   - **Add a `useNow.test.ts` case:** mount, unmount, advance the clock by 10 minutes, remount, and the label is
     current. Also reset the module state between tests, since jest keeps module state within a file.
6. **The matrix is missing four cells:**
   - **(a) I8 with A's confirm scrolled above the viewport.** This is the case where Chrome scroll anchoring can also
     compensate, so anchoring and the pin could double-correct or cancel each other. Test it at 375 and at 820/400 and
     record B's top delta.
   - **(b) An I8 reveal expectation.** After the switch gesture, B's confirm, if it is below the fold, is revealed
     after the window. I8 currently asserts only the presses and the delta, so CR3's failure would pass it.
   - **(c) A switch from A to B within the 500ms window,** while A's reveal is still pending. Only B's confirm should
     be revealed, and A's timer must not scroll to a detached element.
   - **(d) The HEL-1574 skeptic-final-5 CR1 configuration,** which regressed once. At 820×800 with the list at 400,
     `.app-content` at its maximum `scrollTop` and the table scrolled to its end, double-click the **last** row's
     Delete on both pages. Expect I2 during the gesture, then I4. Mark it at least LIVE. The existing HEL-1604 e2e uses
     `nth(15)` of 22 rather than the last row at maximum scroll.

### Non-blocking notes

- **D1 says "the tables' granularity is minutes", but it is not.** `formatRelativeTime` emits "N seconds ago", so a
  fresh row will show a frozen "5 seconds ago" for up to a minute. Accepting that is fine, but say so accurately. The
  60s tick is also a new periodic reflow source at narrow widths, where labels previously changed only on re-render.
  Worth one sentence.
- **The design does not mention `hooks/useRelativeTime.ts`,** an existing relative-time ticker with a per-instance 10s
  interval and its own formatter. Note why it is not reused.
- **Update `hooks/README.md`.** It enumerates the directory's hooks and its placement rule. Placing `useNow` in
  `hooks/` is correct, since two features consume it, but the README should list it.
- **D3's `inline: "nearest"` is already the `scrollIntoView` default,** so it is harmless but not a change.
- **D4 tolerance and side effects.**
  - Assert `bottom <= navTop + 1`, since subpixel scroll offsets are possible. The probe landed exactly on the edge.
  - Other `scrollIntoView` callers at phone widths will now clear the nav: `ActiveConversationPanel.tsx:99`
    (`block:"end"`), `OutputPicker.tsx:206`, `ProvenancePopover.tsx:67`, `CommandPalette.tsx:179`,
    `StepPalette.tsx:194`, and `useScrollToHashSection.ts:29` (start, unaffected). That is intended, but the evaluator
    should spot-check the assistant panel at 375.
- **Rename and rewrite the unit test in task 2.2.** The existing test "does not scroll into view after a pointer
  activation" (`rowDeleteFocus.test.ts`) asserts the opposite of D3. Task 2.2 should say it is rewritten, not just
  added to.
- **`placeBottomNearViewportEdge` still calls `settledRowTop` internally.** That waits for layout stability (the
  references fetch), not for labels, so it is compatible with the AC. The freshness regex check right before the
  `dblclick` is what proves the rows are fresh.
- **No gate defect.** No report I drew on discloses unsound evidence mtimes, and nothing here rests on mtime ordering.
