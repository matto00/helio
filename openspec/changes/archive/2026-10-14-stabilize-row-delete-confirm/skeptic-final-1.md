## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `e04ddb34811adc5b831818db4d0756ea065c2e8e`. The base was resolved live with `resolve-review-base.sh`: `cd64409ad828d9024074f907a7ea32800ab71ff3`.

### What I verified (with evidence)

**Ground truth**
- `git diff cd64409ad...HEAD`: I read every source change:
  - `useNow.ts`, `rowDeleteFocus.ts`, `ConfirmInline.tsx`, `formatRelativeTime.ts`;
  - the call sites in both tables and both pages, and `App.css`;
  - both e2e specs and `e2e/support/rowDeleteGesture.ts`.
- I also read the ticket, design.md, the spec delta, evaluation-2.md and red-guard-evidence.md, treating them as claims.

**Unit tests**
- Run in this worktree: `jest --testPathPatterns=(rowDeleteFocus|useNow|ConfirmInline|formatRelativeTime|...Table|...Page)` gave 12 suites and 106 tests passed.
- A `--json` run confirmed the paths are under `.../HEL-1605/frontend/src/` and the counts are rowDeleteFocus 19, ConfirmInline 7, useNow 4, formatRelativeTime 3.

**E2E**
- Command: `DEV_PORT=7037 nice -n 19 npx playwright test e2e/hel1605-row-delete-confirm.spec.ts e2e/hel1574-shell-rail.spec.ts --workers=2 --repeat-each=2`.
- Result: **50 passed (2.0m), exit 0**. Teardown deleted 50 users.
- The re-enabled 375 test ("row Delete confirm opens below its row ... at 375px") is no longer `test.fixme`. It passed twice.
- I cannot observe CI from here. That AC (fixme-test-1605) is judged on the local result plus my review of the method below.

**`page.clock` soundness**
- `installFreshClock` starts the browser clock 1.5s before the earliest row, so the first render reads "just now". `agePage` then fast-forwards 8s without reaching the 60s tick.
- On base, any re-render recomputes labels from the faked `Date.now()`, so the relabel shift is forced deterministically. The red-on-base record is 3/3.
- On the fix, only a tick changes labels. The test asserts freshness right before the gesture and does not wait for labels to settle.
- I judge this sound. It is stricter than CI's timing luck, not weaker.
- `settledRowTop` (inside `placeBottomNearViewportEdge`) waits for row *position* stability against late fetches, not for a label change. That is acceptable.

**Live probes**
- Setup: servers on 7037/9944, `assert-phase.sh servers` PASS. I used a throwaway user with 24 sources and 24 pipelines, and real Playwright `dblclick`s on wall-clock-fresh rows (no fake clock).
- **375 /sources, I2/I4 combined.** Row bottom 75px above the viewport edge, label "7 seconds ago". Both presses landed on `Delete Skeptic Src 15`, top 599.5 → 599.5 (delta 0), one confirm, URL unchanged. After the window the confirm was revealed at bottom 632, which equals the BottomNav top of 632.
- **375 /sources, I6 keyboard Enter.** The confirm group bottom was 632 with the nav at 632, and the group held focus. Cancel returned focus to the row's Delete.
- **375 /sources, I8 switch.** A (Src 12) confirm open, B (Src 08) placed near the bottom, double-click B. Both presses landed on B, top 599.5 at both presses, and the page scrolled 750 → 656 (the pin compensating A's closing confirm). Only B's confirm was open, revealed at 632 (the nav top).
- **820, list at 400, /pipelines, dark, table scrolled to its end.** Both presses landed on Pipe 05, delta 0, one confirm, revealed with bottom 800 = viewport.
- **1280 /sources, light.** Both presses landed on Src 04, delta 0, one confirm revealed inside the viewport.
- **Owner rulings.** No table or ConfirmInline CSS changed in the diff, so the secondary/danger recipe and the 44px expander are untouched. Delete is still only on the overview rows, the confirm is still a row under the clicked row, and the `handleRowClick` guards are untouched (the M0 cell in the e2e still covers `detail > 1`).
- **Screenshots** (persisted). Note: `375-sources-light-dblclick.png` is actually the dark theme; it was misnamed at capture.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/skeptic-final-evidence/375-sources-light-dblclick.png` (375, dark)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/skeptic-final-evidence/375-sources-light-switch.png` (375, light, I8)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/skeptic-final-evidence/820-400-pipelines-dark-dblclick.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/skeptic-final-evidence/1280-sources-light-dblclick.png`
  - Visually consistent with the sibling screens in both themes. There is no new UI surface.

**Defect found: the `useNow` tick is reset by every re-render.** Measurement: `/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/skeptic-final-evidence/usenow-label-freeze.txt`.
- The rows were created at 04:45:36Z.
- With a Delete+Cancel on /sources every 40s, the label read "3 minutes ago" at all five samples from 04:49:07 to 04:51:49. By then the row was 6m13s old.
- Separately, with no interaction, the label changed exactly 60s after the *last* interaction, not 60s after mount.
- I reproduced this twice.

### Verdict: REFUTE

### Change Requests

1. **`frontend/src/hooks/useNow.ts:35-51`: `useSyncExternalStore` is given a new inline `subscribe` closure on every render.**
   - **Cause.** React resubscribes whenever the subscribe identity changes. The old subscription's cleanup clears the interval (line 48) and the new subscribe starts a fresh 60s interval (line 40). Any re-render of `SourceListTable`/`PipelineListTable` (opening or closing a confirm, sorting) therefore restarts the "periodic" tick. While the user interacts at intervals under 60s, the relative-time labels freeze indefinitely.
   - **Measured.** A 6-minute-old row read "3 minutes ago" (evidence above).
   - **Why it ships a bug.** It is a regression against base, which recomputed labels correctly on every render. It contradicts the spec delta ("Relative-time labels ... SHALL change only on a shared periodic tick") and design D1 ("one module-level ticker per interval"). `useNow` is now a documented shared hook in `hooks/README.md`, so every future consumer that re-renders inside 60s inherits a clock that never ticks.
   - **Fix.** Give `subscribe` a stable identity per `intervalMs`, for example:
     - a module-level `Map<number, (l) => () => void>` of subscribe functions; or
     - `useCallback(..., [intervalMs])`, with a `getSnapshot` that is stable as well.
   - **Test.** Add a red-first unit case in `useNow.test.ts`: mount, advance 50s, `rerender()`, advance 20s, and expect the value to have advanced (fires at the 60s mark from mount). It fails on the current code.
   - **Scope.** This must not change the double-click behaviour: a re-render still must not change `now`.

### Non-blocking notes
- At 820/1280 the pointer reveal stops with the confirm flush against the viewport bottom (`block: "nearest"`, group bottom = innerHeight). It is readable, but a small scroll margin (e.g. `scroll-margin-bottom: var(--space-2)` on the group) would look less cramped. This is polish.
- After a pointer double-click, focus sits on the row's Delete rather than on the confirm group (the second mousedown refocuses the button). This is the same as base and is already noted by the evaluator as an a11y follow-up candidate.
- red-guard-evidence.md records a late re-flow of the rows above the clicked row on /sources at 375 (55→53px rows), 40-300ms after a click on a freshly loaded page, in about 1 of 4 runs, also present on base. The e2e avoids it with `gotoSettled`/`settledRowTop`. A real user double-clicking within about a second of the page load could still hit it. That is outside this ticket's relabel defect, but worth a follow-up.
- `e2e/hel1605-row-delete-confirm.spec.ts:173`: the precondition compares against the confirm *group* height (25px), not the inserted *row* height (42px). I agree with the evaluator that this cannot make the cell vacuous.

### Gate-chain notes
- Neither the evaluator's reports nor this gate rely on mtime ordering. evaluation-2 states its evidence is content dumps. No gate defect to record.
- Throwaway data:
  - My user `9854646f-9afe-4eba-9a74-c34b2b147953` (`hel1605-skeptic-1792039536698@example.com`) was deleted by exact id via `buildUserDeleteSql` + `psql`. A re-count returned 0.
  - The e2e teardown deleted its 50 users.
  - The dev account was not touched, and the servers were left running.
