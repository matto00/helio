## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `50a8494d023f05304a1ceba3624e839af9a3d9e8`. The diff base was resolved live with `resolve-review-base.sh` (main/origin) and is `dd6463764aadaa3bab4ca03e8c00a3b727dff1bf`. The diff touches only frontend files and the change directory.

Durable evidence directory (EV): `/home/matt/Development/helio/.concertino/runs/HEL-1359/evidence/.concertino/runs/HEL-1359/skeptic-final/`

### What I verified (with evidence)

**AC1: no two adjacent scrubber points share a spoken name. The fix reuses the HEL-1352 escalation.**
- `formatCaptureTime.ts` now has a single `distinctCapturePrecision` helper. `formatCapturePair` is rewritten on top of it, so there is still only one implementation.
- `HistoryScrubber.describe(points, index)` compares each point against both of its neighbours.
- Proof that two adjacent names can never be equal:
  - Each point's precision is the lowest precision at which it differs from every neighbour.
  - Escalation only ever adds fields, so the strings stay different at any higher precision.
  - If the two points end up at different precisions, the strings have different shapes.
  - Identical instants get different `run k of n` suffixes.
- Measured in real Chromium against the dev server: three real runs about 1.3 s apart gave three distinct names, `01:00:43 PM`, `01:00:42 PM` and `01:00:41 PM`, all with seconds. Evidence: `EV/skeptic-check.log`.

**AC2: focus returns to the History button after Escape or Close, and the root cause is confirmed by a probe.**
- The code in `Modal.tsx` does two things:
  - (a) It only records the previously focused element when that element is outside the dialog.
  - (b) It adds an unmount cleanup with `[]` deps. The cleanup uses the `dialog` captured inside the effect, calls `close()` first and then `focus()`, and clears the ref.
- I worked through the StrictMode order by hand and found it correct:
  1. Mount: the code records the trigger and calls `showModal`.
  2. Simulated unmount: the cleanup closes the dialog and refocuses the trigger.
  3. Re-setup: the code records the trigger again and calls `showModal` again.
- Test (iv) proves focus is neither restored twice nor taken back from an element that was focused afterwards.
- **"Predates HEL-1277": I checked this by running the tests, not just by inferring it.**
  - I extracted `git archive e1aaf72f8~1 frontend`, which is the tree before the HEL-1277 merge (#806), into a scratch directory outside the repo, with `node_modules` symlinked.
  - I added the new `Modal.test.tsx` to that copy and ran it.
  - Tests (i), (ii) and (iii) **fail** and (iv) passes, so 3 failed and 24 passed. Evidence: `EV/pre1277-modal-tests.log`.
  - The sha1 of `Modal.tsx` is identical at e1aaf72f8~1 and at the base (`9c6c23af…`). `git log` shows the last change to Modal.tsx was HEL-443 (588558355).
  - Conclusion: the Modal defects came in with HEL-590 (CR9) and predate HEL-1277. HEL-1277 only added the conditionally-mounted consumer that exposes them.
- **Real-Chromium check (constraint C1).** I wrote my own script (`EV/skeptic-check.mjs`), used my own browser instance and my own user `hel1359-skeptic-*@example.test`, and ran it against `localhost:6791`.
  - The dev server serves the HEL-1359 `Modal.tsx`: a `curl` of the module shows the HEL-1359 markers. `main.tsx` wraps the app in `<React.StrictMode>`.
  - I opened the view from the keyboard (focus on the button, then Enter) and closed it three ways: Escape, Close, and Tab Tab then Escape, in both the light and the dark theme. That is 6 out of 6 cases.
  - While the view was open, focus was on the dialog's `H2`, so the check could actually fail.
  - After every close, `document.activeElement` was the `History for HEL1359Skeptic Out` button. After keyboard closes the button matched `:focus-visible`. After a Close click it did not, which is the correct behaviour for a mouse click.
  - `EV/after-escape-dark.png` shows the focus ring on the History button.
  - Everything I created was deleted afterwards (pipeline and source, both 204).
- The executor's browser run with the original Modal, which landed on `BODY` (`task2.3-red-premodal.log`), agrees with my pre-HEL-1277 jsdom red run.
- I checked the other Modal consumers that call `.focus()`: OutputPicker, CommandPalette, StepPalette and AddSourceModal. Every one of them focuses an element inside its own modal, so none of them conflicts with restoring focus on unmount.

**AC3: the comment path.** `OutputGalleryCard.css:66` now cites `openspec/changes/archive/2026-10-07-output-history-view-polish/screenshots/measurements.json`, and `test -f` on that path succeeds.

**AC4: a test for a same-second pair.**
- The new test in `OutputHistoryModal.test.tsx` asserts the `vs .*318.*: 25` baseline, checks that the header contains `742`, and checks that the baseline differs from the header.
- `task3.2-mutation-red.log` shows the test turn red when HistorySummary is mutated: it renders `" vs Oct 5, 07:02 AM: 25"`, which is at minute precision.

**Gates, all re-run fresh by me with `nice -n 19`:**
- Full frontend Jest with `--maxWorkers=3`: 460 out of 460 suites and 4869 out of 4869 tests pass, exit 0. Evidence: `EV/frontend-full-jest.log`.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run format:check`: exit 0.
- No files outside scope are touched, and the hel1277/hel1350/hel1275 e2e files are unchanged.

**UI and design.** The only user-visible change is where focus goes after closing. There is no visual or styling change, and the CSS edit is a comment only. The returned focus ring renders correctly in dark mode (screenshot) and in light mode (`EV/after-escape-light.png`). There are no page errors. The only console errors are the existing `GET /api/pipelines/:id/schedule` 404s for a pipeline with no schedule, from code this change does not touch.

### Verdict: CONFIRM

### Non-blocking notes
- Both test files are now past CONTRIBUTING's ~400-line threshold: `OutputHistoryModal.test.tsx` is about 541 lines and `Modal.test.tsx` about 428. The scrubber-name test also has step-narration comments and four scenarios in one `it`. Splitting it into separate named tests would be clearer. The different-minute step never asserts that the name has no seconds. The helper's unit test "stays at minute precision" does cover that rule, but the view-level test does not.
- `formatCaptureTime` leaves out the year. Two points exactly a year apart would escalate to millisecond precision and then fall back to the `run k of n` suffix. Their names are still distinct, which is all AC1 requires.
- The schedule-404 console noise predates this change. It could be a spinoff ticket.
