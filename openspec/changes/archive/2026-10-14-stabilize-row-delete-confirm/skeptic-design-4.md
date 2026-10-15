## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed head: `cd64409ad828d9024074f907a7ea32800ab71ff3`. The planning artifacts are untracked in the change directory.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/overview-row-delete-confirm/HEL-1605`.
- **Read in full:** ticket.md, proposal.md, design.md, tasks.md, specs/app-shell-rail/spec.md, workflow-state.md and
  skeptic-design-3.md. I also read the change-request sections of skeptic-design-2.md.
- **Code checked at base:**
  - `rowDeleteFocus.ts`: a module flag, `noteDeleteActivation(clickDetail)`, and `focusOnMount`, which reveals only on
    `detail === 0`. This matches the design's Context section.
  - `ConfirmInline.tsx`: its handlers are `() => void` and it has no repeat guard today, so D2b's opt-in prop is a real
    addition.
  - `ConfirmInline` is used in 11 non-test `.tsx` files. That is the component itself plus 10 caller files, which is
    consistent with "the other 9 callers" outside the two pages (AgentMemoryList uses it twice).
  - `e2e/hel1574-shell-rail.spec.ts`:
    - `:387` is the 375 `test.fixme`.
    - `recordPresses` (`:42`) records the button's aria-label, or the tag name for a non-button. That is enough for
      I19's "press 2 landed on Confirm/Cancel" assertion.
    - `settledRowTop` and `placeBottomNearViewportEdge` exist as the design describes.
  - `App.css:498-499` sets the phone `.app-content { padding-bottom: var(--bottom-nav-height) }`.
  - `theme.css:119` defines `--bottom-nav-height` as capsule + inset + safe-area. Reusing that token for
    `scroll-padding-bottom` (D4) therefore stops a reveal at the nav's top edge.

**Round-3 change requests:**

1. **CR1 (scope the invariant and the spec): addressed, not just re-worded.**
   - The `design.md` invariant now reads "wherever the page can scroll enough to compensate ... (every cell except
     I19)". It names the weaker guarantee for I19 and D2's limit.
   - In `spec.md`:
     - The SHALL NOT is now prefixed "Wherever the page can scroll enough to compensate".
     - The "Switching the confirm to another row" scenario's WHEN now includes "the page can scroll far enough to
       compensate".
     - The near-top scenario only promises "no delete request ... exactly one confirm".
   - The two scenarios no longer overlap, so they no longer contradict each other.
2. **CR2 (classification and I19's validity): addressed.**
   - Every new or restored E2E cell is classified:
     - **Red on base:** I2@375, I4, I6, I15, and I17's reveal half.
     - **Guards, each with a named mutation:**
       - I2@820/400 and its top delta: M1 (per-render `Date.now()`).
       - I8 and I14 top delta: M2 (no-op pin).
       - I17's double-click half: M0 (remove the `detail > 1` row guard).
       - I19: M5 (drop `ignoreRepeatClicks`).
   - **(a)** I19 is now /pipelines at 375, with the page at the top and the table at its end. The executor tunes the
     geometry. If no such geometry exists, the fallback is a unit-level `ConfirmInline` guard, reported explicitly.
   - **(b)** Press 2's target must be asserted through `recordPresses`, so I19 cannot pass on background hits.
   - **(c)** The 1280 variant is dropped.
   - C5 is retired in favour of C7, and tasks 2.6b and 2.7 match.

**Round-3 non-blocking notes:**
- The orphaned fragment is gone.
- The Guard and Not-covered lines sit under D2 again (`design.md:62-63`).
- The listener is specified: one passive, capture-phase `wheel`/`touchstart` pair on `window`, added when the timer
  arms and removed whenever it fires or clears.
- I19 records B's top delta.

**Fresh review:**
- **D1 (`useSyncExternalStore`, stable snapshot, refresh-on-idle) is sound.** It removes the root cause of defect 1:
  a label changing on an unrelated re-render.
- **D2's pin-record lifetime and D3's arming are consistent with the ref orders.** I re-traced:
  - the same-row double-click (the second click's record is discarded by rAF, and the re-arm targets `mounted`);
  - the switch A to B (A's `ref(null)` clears, B's `ref(el)` consumes and arms);
  - StrictMode el/null/el (the first attach consumes the record, and the re-attach re-arms because the mode is kept).
- **D4 is a one-line change on the existing token.**
- **D2b is opt-in, and it bounds the residual to "a confirm for the row under press 2".**
- **Every AC maps to a task:**
  - AC1 (fresh-row double-click, both widths): tasks 2.3 and 2.4.
  - AC2 (nav clearance asserted in e2e): task 2.5.
  - AC3 (pointer bottom-row reveal): I4 and task 2.5.
  - AC4 (un-fixme): task 2.3.
- **Owner rulings (C1) are untouched.** The non-goals and D5 keep the call sites minimal.
- **No gate defect.** No report I drew on discloses unsound evidence mtimes, and nothing here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes

- **"M0-M5" names six mutations, but only M0, M1, M2 and M5 are defined** (`design.md:139-141`). The range appears in
  tasks.md 2.7, C7 and workflow-state. The executor and evaluator should read it as {M0, M1, M2, M5}. M3 and M4 do not
  exist, and their absence is not missing evidence.
- **I8 (a guard against M2) only holds under the compensable geometry.** At 375 the test must scroll the page down by at
  least A's confirm height before the switch. Otherwise it degenerates into the I19 case and its < 2px assertion fails
  for reasons the design already accepts. The spec scenario carries this condition, but the I8 matrix row does not
  restate it.
- **I19 may well also be red on base, since base has no repeat guard on Confirm.** That is fine. Running the M5
  mutation is still the required proof.
