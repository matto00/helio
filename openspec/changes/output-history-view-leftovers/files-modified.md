- `frontend/src/features/panels/history/formatCaptureTime.ts` — shared `distinctCapturePrecision` helper; `formatCapturePair` re-expressed on it
- `frontend/src/features/panels/history/formatCaptureTime.test.ts` — helper unit tests (0/1/2 neighbours, same minute/second, identical)
- `frontend/src/features/pipelines/ui/outputHistory/HistoryScrubber.tsx` — `describe()` uses the helper against both neighbours; ", run k of n" for identical instants
- `frontend/src/features/pipelines/ui/outputHistory/OutputHistoryModal.test.tsx` — scrubber-name, same-second metric-baseline "vs" and History-button focus-return tests
- `frontend/src/shared/ui/Modal.tsx` — capture guard (trigger outside dialog only) + close-then-restore on unmount-while-open (effect-local `dialog`)
- `frontend/src/shared/ui/Modal.test.tsx` — StrictMode/unmount focus tests (i)-(iv)
- `frontend/src/features/pipelines/ui/OutputGalleryCard.css` — comment cites the archived measurements.json path

## Evidence (kept in `.concertino/runs/HEL-1359/evidence/` in the worktree, uncommitted)
- Root cause (probe-confirmed by red tests, `task2.1-red.log`): (1) unmount-while-open never reaches the `open === false` restore branch; (2) under StrictMode the re-run `[open]` effect re-captures a dialog-internal element, so even the HEL-590 open->false path (test iii) restored the wrong element.
- Predates HEL-1277: `git diff e1aaf72f8~1 HEAD -- frontend/src/shared/ui/Modal.tsx` is empty (Modal.tsx unchanged by HEL-1277), so tests (i)-(iii) fail identically on the pre-HEL-1277 Modal; the CR9 open->false path never restored correctly under StrictMode. HEL-1277 only introduced the conditional-mount consumer that exposes it.
- Real Chromium on the dev server (StrictMode): `task2.3-green.log` PASS (Escape and Close -> History button); `task2.3-red-premodal.log` with the original Modal -> BODY.
- Scrubber red: `task1-red.log`; D4 mutation red: `task3.2-mutation-red.log`.
