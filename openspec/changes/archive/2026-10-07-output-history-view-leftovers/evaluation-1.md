## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `50a8494d023f05304a1ceba3624e839af9a3d9e8` against live-resolved base `dd6463764aadaa3bab4ca03e8c00a3b727dff1bf` (`resolve-review-base.sh`). The diff touches frontend and openspec files only.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (scrubber names): `HistoryScrubber.describe()` now compares each point against both adjacent points using `distinctCapturePrecision`. This is one shared helper in `formatCaptureTime.ts`, and `formatCapturePair` is now built on it, so there is no second implementation. When two points share an identical instant, both get a `, run k of n` suffix. I checked the reasoning that adjacent names can never read the same. If both points are at the same precision, their text differs by construction. If they are at different precisions, the formats have different shapes. Identical instants get different k values. The existing `formatCapturePair` tests pass without changes.
- AC2 (focus return): the root cause is confirmed by failing tests in `task2.1-red.log`, which show 7 failures before the fix. It has two parts: an unmount-while-open gap, and a re-capture under StrictMode. I confirmed the claim that this predates HEL-1277 myself. `e1aaf72f8` is the HEL-1277 commit, and `git diff e1aaf72f8~1 dd6463764 -- frontend/src/shared/ui/Modal.tsx` is empty. Escape, Close and backdrop all return focus correctly in my own Chromium run (Phase 3).
- AC3: the comment in `OutputGalleryCard.css` now cites `openspec/changes/archive/2026-10-07-output-history-view-polish/screenshots/measurements.json`, and `test -f` on that path succeeds.
- AC4: there is a dedicated same-second metric-baseline "vs" test in `OutputHistoryModal.test.tsx`. `task3.2-mutation-red.log` shows it failing under the HistorySummary mutation.
- Every item in tasks.md is ticked and matches the diff. Nothing is out of scope, and nothing touches the hel1277/hel1350/hel1275 e2e specs. The spec delta in `specs/output-history-scrubber/spec.md` matches the implemented behavior.
- Constraint C1 is met. The jsdom StrictMode tests are Modal tests (ii) and (iii), plus the StrictMode Escape and Close cases at History-view level. The `showModal` stub moves focus into the dialog, so these tests cannot pass vacuously. The real-Chromium check ran on the Vite dev server with StrictMode active. I repeated it independently (Phase 3).

### Phase 2: Code Review — PASS
Gates I ran myself in WORKTREE_PATH, using `nice -n 19` and 3 Jest workers:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm --prefix frontend run build`: exit 0
- `npm test -- --maxWorkers=3`: exit 0. Root: 39 suites, 376 tests passed. Frontend: 460 suites, 4869 tests passed.

Issues: none blocking.
- `Modal.tsx`: the effect-local `dialog` closes before `focus()` is called. The unmount cleanup runs before the next commit's mount effects, so a consumer that moves focus deliberately still wins. Test (iv) proves that focus is neither restored twice nor stolen back. I checked the StrictMode sequence: setup, then the unmount cleanup closes the dialog and refocuses the trigger, then the re-setup captures the trigger again and calls `showModal` again. The sequence is correct. Both restore paths do nothing for a detached element.
- The changed source files have no FQN or import violations, no `any`, no dead code and no TODOs.

### Phase 3: UI Review — PASS
Servers: `start-servers.sh` reused healthy servers. I checked through `/proc/<pid>/cwd` that both listeners on 6791 and 9698 run from this worktree, and the served `Modal.tsx` contains the HEL-1359 changes.
I used my own Chromium instance and my own test user (`hel1359-eval-*@example.test`). Everything I created was deleted afterwards (both deletes returned 204).
- I opened the History view by keyboard: focus on the History button, then Enter. After closing with Escape, Close, or a click on the backdrop, `document.activeElement` is the `History for HEL1359Eval Out` button in all three cases.
- Scrubber: two real runs 2 s apart in the same minute gave `aria-valuetext` values of "Oct 7, 12:57:13 PM, 2 rows" and "Oct 7, 12:57:11 PM, 2 rows". The two values differ and include seconds.
- No horizontal overflow at 1100, 768 or 375. The view at 375 renders cleanly (screenshot).
- Console: no JS errors. The only error lines are 404s from `GET /api/pipelines/:id/schedule` for a pipeline that has no schedule. This happens before this change and comes from a file this change does not touch.

Evidence (persisted):
- /home/matt/Development/helio/.concertino/runs/HEL-1359/evidence/.concertino/runs/HEL-1359/eval-1/eval-check.log
- /home/matt/Development/helio/.concertino/runs/HEL-1359/evidence/.concertino/runs/HEL-1359/eval-1/eval-check.mjs
- /home/matt/Development/helio/.concertino/runs/HEL-1359/evidence/.concertino/runs/HEL-1359/eval-1/open-1440.png
- /home/matt/Development/helio/.concertino/runs/HEL-1359/evidence/.concertino/runs/HEL-1359/eval-1/open-375.png

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `OutputHistoryModal.test.tsx` is now 541 lines and `Modal.test.tsx` is 428, both past CONTRIBUTING's ~400-line threshold. The PR body should propose a split, for example moving the HEL-1359 focus-return describe block into its own file.
- The scrubber test in `OutputHistoryModal.test.tsx` has step-narration comments ("Different minutes: ...", "Same minute: ..."). CONTRIBUTING disallows these in tests, so split it into an `it.each`, or into separately named tests. Its different-minutes step only checks `newestMinute !== diffMinute`. It never checks that the different-minute name has no seconds, so a regression that always spoke seconds would still pass. Add a negative assertion such as `not.toMatch(/:\d{2}:\d{2}/)`.
- The `GET /api/pipelines/:id/schedule` 404 is logged as a console error for every pipeline without a schedule. It predates this change; consider a spinoff ticket.
