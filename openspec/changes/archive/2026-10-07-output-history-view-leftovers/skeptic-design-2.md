## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `dd6463764aadaa3bab4ca03e8c00a3b727dff1bf`. The change dir is untracked and there is no code diff yet.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/output-history-view-leftovers/HEL-1359`.
- **Artifacts read.** I re-read ticket.md, proposal.md, design.md, tasks.md, specs/output-history-scrubber/spec.md, skeptic-design-1.md and workflow-state.md. C1 (the StrictMode proof constraint) is recorded.
- **Round-1 CR1 is addressed.**
  - (a) D2 now treats StrictMode re-capture as part 2 of the hypothesis to probe. The "harmless / covered by reasoning" claim is gone.
  - (b) The fix is the capture guard `!dialog.contains(document.activeElement)` plus close-then-restore when the modal unmounts while open.
  - (c) Required tests (ii) and (iii) are red-first StrictMode jsdom cases. Task 2.3 is a real-Chromium check on the dev server.
  - The pre-HEL-1277 record must now say whether the CR9 open->false path ever restored focus under StrictMode.
- **The StrictMode fix survives the double-invoke.** I traced it against `frontend/src/shared/ui/Modal.tsx:103-118`.
  - Setup #1 captures the trigger, then `showModal()` moves focus inside the dialog.
  - If the restore lives in the effect cleanup, the simulated cleanup closes the dialog and focuses the trigger. Setup #2 then re-captures the trigger and shows the dialog again.
  - If the restore lives only in an unmount path, guard (a) makes setup #2 keep the original trigger.
  - Either way, the real close focuses a live, non-inert trigger.
  - `Modal` never listens for the dialog's `close` event; Escape routes through `cancel` (`Modal.tsx:122-131`). So the extra `dialog.close()` in cleanup cannot fire a spurious `onClose` and dismiss the modal in dev. That was the main way this fix could have backfired, and it does not apply.
  - Nested modals are still captured correctly. The guard checks only the modal's own dialog, so a trigger inside an outer modal is still captured.
- **The root-cause premise is real.**
  - `PipelineDetailPage.tsx:347-350` conditionally mounts `OutputHistoryModal`.
  - `OutputHistoryModal.tsx:26-27` passes `open` as a constant true.
  - `Modal.tsx`'s restore runs only in the `open === false` branch, and that effect has no cleanup.
  - `main.tsx:61` wraps the app in `<React.StrictMode>`.
- **The test stub is already non-vacuous.** `Modal.test.tsx:21-31` (HEL-520) already makes the `showModal` stub focus the first focusable descendant. D2's "stub MUST move focus" requirement is therefore already met. The executor only needs to keep it.
- **D1's precision rule always gives distinct names.**
  - When two adjacent points get the same precision, the helper guarantees their texts differ at that precision.
  - When they get different precisions, the strings differ in shape (`formatCaptureTime.ts:14-21` adds `second`/`fractionalSecondDigits` per level).
  - Identical-instant points both get distinct ", run k of n" suffixes. That closes round-1 note 1.
  - With one neighbour, the helper returns the same precision for both points. `formatCapturePair`'s output is therefore unchanged, and its existing tests stay unmodified (task 1.1).
  - The current `describe()` (`HistoryScrubber.tsx:16-18`) uses minute precision, so the defect is real.
- **D3's path exists.** `test -f openspec/changes/archive/2026-10-07-output-history-view-polish/screenshots/measurements.json` printed EXISTS. The stale citation is at `OutputGalleryCard.css:64`.
- **D4's mutation target exists.** `HistorySummary.tsx:34` builds the labels with `formatCapturePair`, and line 65 renders `vs {labels.comparison}: {baseline}`. Reverting it to a minute-precision `formatCaptureTime` would remove the milliseconds, so the planned test is failable.
- **The driver's claim about HEL-1363 holds.**
  - `e2e/hel1277-output-history-scrubber.spec.ts`, `hel1275-metric-delta-sparkline.spec.ts` and `hel1350-chart-compare-picker.spec.ts` exist.
  - No task touches them, and design Non-Goals excludes them.
  - Grep shows they don't assert on the scrubber's `aria-valuetext` or on focus after Escape, so D1/D2 shouldn't break them.
- **Every AC is covered by a task, with no scope drift.**
  - AC1: D1, tasks 1.1/1.2, plus 2 spec scenarios.
  - AC2: D2, tasks 2.1-2.3, plus the spec requirement text and the Escape scenario. The probe and the pre-HEL-1277 record are in task 2.1.
  - AC3: D3, task 3.1.
  - AC4: D4, task 3.2.
  - There is no API, schema or backend impact, so no contract delta is needed. The spec MODIFIED blocks keep the baseline text and scenarios and only add to them, as already checked in round 1.

### Verdict: CONFIRM

### Non-blocking notes

- **Implementation hazard for D2(b).** By the time React 19 runs passive cleanups on unmount, it has already set `dialogRef.current` to null. The unmount restore must therefore use the `dialog` local captured in the effect closure (or capture it in a separate effect's setup), not read `dialogRef.current` in the cleanup. Test (i) will catch a mistake here, but knowing it up front saves a cycle.
- **Detached dialogs in Chromium.** When a modal `<dialog>` is removed from the DOM, Chromium drops it from the top layer but keeps the `open` attribute. So "the dialog was still open" (`dialog.open`) is still a valid check at unmount time, and `close()` on a detached dialog is harmless. Task 2.3 confirms this empirically.
- **Hidden ordering dependency.** The `titleKey` effect (`Modal.tsx:96-99`) is declared before the `[open]` effect. In StrictMode setup #2 it runs first. If the dialog is still open at that moment, the title takes focus and guard (a) correctly keeps the original trigger. If the dialog was closed by cleanup (b), the title focus fails because the dialog is hidden, and the trigger is re-captured. Both orderings are correct, but they depend on effect declaration order. Do not reorder these effects without re-running tests (ii)/(iii).
