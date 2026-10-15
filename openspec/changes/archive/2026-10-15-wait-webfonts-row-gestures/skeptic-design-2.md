## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The planning artifacts are uncommitted in the change dir. I checked each round-1 change request against the tree and did not rely on the revision's own account.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/web-font-wait-row-gestures/HEL-1606`.
- **CR1 (predicate): addressed.**
  - D2 now allows `unloaded` faces. It requires stylesheet `media === "all"`, no face `loading`, and `document.fonts.status === "loaded"`, all evaluated once the target row is visible.
  - The 34-face reasoning is recorded, and the "at least one web face" clause is gone.
  - Tree facts hold:
    - `frontend/app.html:32/34` has the `media="print"` link with an onload swap to `all`.
    - The second href at :42 is inside `<noscript>`, so it is not a live element when JS runs.
    - There is no `document.fonts` usage anywhere in `e2e/` or `frontend/src`.
- **CR2 (placement): addressed.** D4 and task 2.2 place the wait in `settledRowTop(button)` and explicitly not in `gotoSettled`. I grepped every gesture in both specs:
  - hel1574 :387 dblclick goes through `placeBottomNearViewportEdge` (:381), which calls `settledRowTop` (rowDeleteGesture.ts:9).
  - hel1574 :536 goes through `placeBottomNearViewportEdge` :530, inside the per-route loop starting at :517.
  - hel1605 :182 goes through :171.
  - hel1605 I19 :236 calls `settledRowTop` directly at :225.
  - hel1605 I17 :287/:307-308 calls `settledRowTop` directly at :281.
  - hel1605 :100 (I4/I6, a single click or keyboard, not a double-click) also goes through it, which is harmless.
  - Every row gesture therefore reaches `settledRowTop` after its own navigation, so the wait runs once per document.
  - `settledRowTop`, `placeBottomNearViewportEdge` and `gotoSettled` are used only by these two specs (grep over `e2e/`), so the blast radius is contained.
- **CR3 (fake clock): addressed.**
  - D3a requires the probe to confirm `waitForFunction` keeps polling under `installFreshClock`. D5 and task 1.2 require the forced-delay red/green run on a clock-installed test.
  - The risk is also low on the tree's own evidence. In the installed playwright-core 1.55.1, `lib/server/frames.js:1246/1248` polls through `injected.utils.builtins.requestAnimationFrame` and `builtins.setTimeout`. Those are native references captured before page scripts run, so they are not the clock-faked globals.
- **Scope and ACs.** AC1 (the wait, plus `--repeat-each=30` with 2 workers) is covered by tasks 2.1-3.1. The optional product AC is explicitly deferred in proposal Non-goals. The C1 rule (no retries, no raised timeouts) is restated. `playwright.config` has `retries: 0`, and its workers setting is `CI ? 2 : localWorkers()`.
- **No placeholders.** No TODO or TBD markers. Each task names its evidence.

### Verdict: CONFIRM

### Non-blocking notes

1. **Proposal and design disagree on placement.** proposal.md "What Changes" still says "`gotoSettled` and `placeBottomNearViewportEdge` ... call it". D4 and task 2.2 say `settledRowTop`, and not `gotoSettled`. The tasks are unambiguous, but align the proposal line when the executor touches the artifacts so the final gate is not checking against a stale claim.
2. **One vacuity window is still not named in D1.** This was the last bullet of round-1 CR1.
   - After the stylesheet applies and the row is in the DOM, Chromium starts a face load only when it lays out text that needs that face.
   - `waitForWebFonts` runs at the top of `settledRowTop`, before that function's first `getBoundingClientRect`. So the predicate could read `loaded` in the gap between the row's insertion and the layout that starts the load.
   - Suggested fixes, either of which closes it:
     - Have the predicate force layout of the target row first (read its rect inside the polled function).
     - Make D2's optional clause mandatory: the target row's font families have a face in `loaded` or `error`.
   - D1's probe should log, per frame, any sample where `media === "all"` and `status === "loaded"` while the row's family faces are all `unloaded`.
   - The D5 forced-delay run will not catch this window, because it delays the response, not the start of the request.
3. **Pick the stylesheet link by its live attributes.** The helper should select the `link[href*="fonts.googleapis.com/css2"]` that is in the live DOM, which is the :32 element. The :42 copy is inside `<noscript>`.
4. **Measurement order.** Run the forced-delay repro (1.2/2.3) before relying on the 30x repeats. At about a 3% natural rate, 60 passes on both base and fix is weak evidence on its own.
