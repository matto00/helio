## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `dd6463764aadaa3bab4ca03e8c00a3b727dff1bf` (change dir untracked; no code diff yet).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/output-history-view-leftovers/HEL-1359`.
- Read ticket.md, proposal.md, design.md, tasks.md, specs/output-history-scrubber/spec.md.
- AC coverage: AC1 (scrubber names) → D1 + tasks 1.1/1.2; AC2 (focus return, probe + pre-HEL-1277 record) → D2 + tasks 2.1–2.3; AC3 (comment path) → D3 + task 3.1; AC4 (same-second "vs" test) → D4 + task 3.2. Every AC has a task; no out-of-scope work.
- `formatCaptureTime.ts`: `formatCapturePair` escalates minute→second→millisecond, then " (older capture)" — matches design's description. `HistoryScrubber.describe()` (line 16-18) uses `formatCaptureTime(point.capturedAt)` at minute precision — the stated defect is real.
- `PipelineDetailPage.tsx:347-353`: `{historyOutput && <OutputHistoryModal key=... />}` — conditionally mounted, as claimed.
- `Modal.tsx`: the `[open]` effect captures `document.activeElement` when `open` is true and restores only in the `else` (open===false) branch; no cleanup — the unmount-while-open gap is real.
- `OutputGalleryCard.css:65` cites `openspec/changes/output-history-view-polish/screenshots/measurements.json` (stale); `test -f openspec/changes/archive/2026-10-07-output-history-view-polish/screenshots/measurements.json` → EXISTS.
- `HistorySummary.tsx:60-66` renders `vs {labels.comparison}: {baseline}` inside `.output-history__metric` — D4's mutation target exists.
- Spec delta: both MODIFIED requirements carry the full baseline text and all baseline scenarios (compared against `openspec/specs/output-history-scrubber/spec.md:8-33`), plus new text/scenarios. D1's per-point precision is pairwise-safe (different precisions always render different strings; identical instants get distinct ", run k of n").
- `frontend/src/main.tsx:61` wraps the app in `<React.StrictMode>`; `frontend/package.json` React `^19.3.0`.

### Verdict: REFUTE

One design defect that would very likely fail the plan's own task 2.3 and leave the root-cause record incomplete. Catching it now is cheaper than an execution round.

### Change Requests

1. **D2's StrictMode risk entry is wrong, and the fix as specified will not restore focus on the dev server that task 2.3 verifies against.** The design says the StrictMode double-mount is "harmless" because "the re-mount re-captures it". That is not what happens. The app runs under `<React.StrictMode>` (`main.tsx:61`, React 19), so in dev every mount effect runs setup → cleanup → setup.
   - Setup #1 of the `[open]` effect captures the History button and calls `showModal()`, which moves focus into the dialog. Real Chromium does this, and `Modal.test.tsx:5-18` documents the same behaviour.
   - The proposed unmount cleanup then calls `focus()` on the History button while the dialog is still modal. Everything outside the dialog is inert at that point, so the call does nothing.
   - Setup #2 re-captures `document.activeElement`, which is now an element **inside the dialog**. Its `if (!dialog.open)` guard skips `showModal()` but not the capture.
   - On the real close, the dialog is removed and the cleanup focuses that detached inner element. Nothing happens and focus falls to `<body>`.

   So, by this reasoning, the existing open→false restore from HEL-590 CR9 is already broken in dev for every Modal consumer, and the new unmount restore would be broken the same way. Task 2.3 checks Escape/Close on the worktree's dev server, so it would most likely go red. Revise D2 (and tasks 2.1/2.2) to:
   - (a) Treat StrictMode re-capture as part of the hypothesis to probe, not as a dismissed risk. Task 2.1 should add a failing jsdom case that renders `<StrictMode><Modal open .../></StrictMode>` from a focused trigger, then unmounts and closes it.
   - (b) Choose a fix that survives the double-invoke. Examples: only capture when the dialog is not already open, or when `activeElement` is not inside the dialog; or have the unmount cleanup `close()` the dialog before restoring focus, so the re-setup re-captures the now-focusable trigger.
   - (c) Delete the "Covered by reasoning; harmless" claim and replace it with the probe result.

   The pre-HEL-1277 record required by the AC should also say whether the CR9 open→false path ever restored focus under StrictMode.

### Non-blocking notes

- D1 doesn't say whether the ", run k of n" suffix goes on both identical-instant points or only one. Both is the only reading that satisfies the spec ("tells them apart" from either side). Worth one clarifying sentence.
- Task 1.2 says "shown red against the old minute-only describe()". The executor should record that red run's output in evidence, not just assert it.
- The Close-button path has no dedicated spec scenario. The requirement text covers it and task 2.1 tests it, so this is fine as is.
