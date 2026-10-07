## Context

See proposal.md. All four items are frontend-only. `formatCapturePair` (HEL-1352, `frontend/src/features/panels/history/formatCaptureTime.ts`) already escalates minute -> second -> millisecond for a selected/comparison pair. `HistoryScrubber.describe()` calls `formatCaptureTime(point.capturedAt)` at minute precision. `PipelineDetailPage` mounts `OutputHistoryModal` only while `historyOutput` is set and passes `open` constantly true; the shared `Modal` (HEL-590 CR9) captures the invoking element when `open` becomes true and restores focus only in the `open === false` branch of that effect.

## Goals / Non-Goals

**Goals:** distinct scrubber names; focus returned to the History button on any close path; correct comment path; same-second metric-baseline test.

**Non-Goals:** changing what the scrubber's visible UI shows; changing the pipeline run-history modal; any e2e screenshot code (HEL-1363's lane owns hel1277/hel1350/hel1275 screenshot paths - do not touch those specs).

## Decisions

### D1 - One precision helper, shared by the pair label and the scrubber
Extract the escalation into a helper in `formatCaptureTime.ts` that, given an ISO time and the ISO times it must be distinguished from (0..2 neighbours), returns the lowest precision at which its formatted text differs from every neighbour's at that same precision (or `"millisecond"` plus an "identical" signal when none does). `formatCapturePair` is re-expressed on top of it with unchanged output (its existing tests stay green unmodified). `HistoryScrubber.describe()` uses it with the point's newer and older neighbours. For an identical-instant neighbour the scrubber appends a position suffix (", run <k> of <n>", k counted oldest = 1, matching the range's left-to-right order) to BOTH points of the identical pair rather than "(older capture)" - a point can have an identical neighbour on either side, so "older" is not well-defined for both. Alternative rejected: always speaking milliseconds - noisy for the common case and diverges from the visible header.

### D2 - Fix focus return in the shared Modal, robust to the StrictMode double-invoke
Hypothesis (executor MUST confirm with failing tests first, per the systematic-debugging law), in two parts:
1. **Unmount-while-open gap.** `PipelineDetailPage` closes the History view by unmounting `OutputHistoryModal` while `open` is still true, so `Modal`'s restore branch (`open === false`) never runs.
2. **StrictMode re-capture (design-gate round 1).** The app renders under `<React.StrictMode>` (`frontend/src/main.tsx`), so in dev the `[open]` effect runs setup -> cleanup -> setup. Setup #1 captures the trigger and calls `showModal()`, which moves focus into the dialog; setup #2 re-captures `document.activeElement`, now an element INSIDE the dialog. Its `if (!dialog.open)` guard skips `showModal()` but not the capture. So even the existing HEL-590 open->false restore probably focuses a dialog-internal element in dev, and a naive unmount restore would be equally broken.

Fix, both parts together: (a) capture the invoking element only when it is NOT inside the dialog (`!dialog.contains(document.activeElement)`), so a StrictMode re-setup keeps the original trigger; (b) restore focus on unmount when the dialog was still open, closing the dialog first (`dialog.close()` before `focus()`) so the trigger is no longer inert at the moment it is focused; clear the ref afterwards. The open->false path is unchanged except that it now benefits from (a). Both restore paths are no-ops for a detached element.

Required tests (task 2.1, red before the fix, recorded in evidence): (i) a plain mount -> unmount-while-open restores focus to the trigger; (ii) the same inside `<StrictMode>`; (iii) StrictMode mount -> `open` true->false restores focus to the trigger (the HEL-590 path); (iv) open->false then unmount does not restore twice / does not steal focus moved elsewhere afterwards. Because `Modal.test.tsx` stubs `showModal`/`close`, the stub MUST move focus into the dialog on `showModal()` (as real Chromium does) for (ii)/(iii) to be meaningful - otherwise they pass vacuously; state this in the test.

Why the primitive and not the caller: HEL-590's stated intent was "closing (any path) ... can restore focus", the conditional-mount pattern is common across `Modal` consumers, and a caller-side workaround would leave every other conditionally-mounted modal (and the StrictMode re-capture) broken. Passive unmount cleanups run before the next commit's mount effects, so a consumer that deliberately moves focus elsewhere in its own effect after closing still wins.

"Predates HEL-1277": the History view itself was introduced by HEL-1277, but the Modal gaps date to HEL-590. The executor records in evidence whether the failing tests (i)-(iii) also fail against the pre-HEL-1277 `Modal.tsx` (e.g. `git show 5f3990f8e~:frontend/src/shared/ui/Modal.tsx` or the commit before HEL-1277 merged), including whether the CR9 open->false path ever restored focus under StrictMode.

Real-browser verification (task 2.3) runs on the worktree's Vite dev server (StrictMode active), Chromium, Escape and Close, asserting `document.activeElement` is the History button.

### D3 - Comment path
Repoint the comment at `openspec/changes/archive/2026-10-07-output-history-view-polish/screenshots/measurements.json` (verified to exist).

### D4 - Metric-baseline same-second test
Add to `OutputHistoryModal.test.tsx` a metric Output with two same-second points and assert the `.output-history__metric` "vs <time>: <baseline>" text contains the comparison's milliseconds and differs from the header. Must be shown failable by mutation (e.g. reverting `HistorySummary` to `formatCaptureTime(comparison.capturedAt)` at minute precision turns it red).

## Risks / Trade-offs

- [Modal change affects 26 consumers] -> unmount restoration only fires for a modal unmounted while open with a captured element; full Jest suite plus Modal.test.tsx unmount tests (both "restores" and "does not restore when already closed") guard it.
- [StrictMode double-invoke in dev] -> addressed by D2 (a)/(b) and proven by tests (ii)/(iii) plus the dev-server browser check, not by reasoning.
- [Capture guard changes HEL-590 behaviour for every consumer] -> only the case where focus was already inside the dialog changes, which was always wrong; full Jest suite guards the rest.
