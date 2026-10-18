## Standing Constraints

- [C1] Scratch only under /home/matt/Development/helio/.concertino/scratch/HEL-1582/; durable evidence in .concertino/runs/HEL-1582/evidence/ (persist-evidence.sh) and the change's evidence/ folder.
- [C2] Load gate (1-min loadavg > 10 → sleep 60, re-check, up to 30 min); jest/Playwright ≤ 2 workers under nice -n 19; full Playwright suites wrapped in flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock; Playwright --trace retain-on-failure, screenshots/video only on failure, outputDir inside scratch, cleared between runs.
- [C3] Never signal processes or use pkill/pgrep/killall; stop servers only with scripts/concertino/stop-servers.sh.
- [C4] No edits to BottomNav, the phone shell, or shared/ui/Modal.tsx (compose it); no literal durations/easings.
- [C5] Throwaway e2e users deleted by exact id via buildUserDeleteSql; specs stay under 120 req/60s (count them).
- [C6] Every jest test broken by replacing the phone layout is retargeted (no weakened assertion), ported, or deleted with a named replacement; mapping recorded in evidence/test-mapping.md.
- [C7] A BottomSheet at rest carries no transform (inline style removed), so portalled Select popovers anchor correctly.
- [C8] Touch-floor sweeps measure the real tap area (elementFromPoint bisection) on both axes for every control including selects, inputs and labels, never only the painted box.

### Frontend

## 1. Shared sheet primitive (shared/motion)

- [x] 1.1 `useSheetSwipe` gesture hook: handle + header only (`touch-action: none`, pointer capture), no body path; follow finger; 25% height or 0.5 px/ms; pointercancel springs back; no transform at rest
- [x] 1.2 `BottomSheet` composing `Modal`: phone full-height presentation, grab handle, visible close; holds `open` through exit; veto → spring back; entrance overrides `ui-modal-in` (Subtle fade, Off none)
- [x] 1.3 Document the sheet API in DESIGN.md §10 Primitives; update CSS file-count/motion guards as needed

## 2. Spine reuse

- [x] 2.1 Extract `useSpineStepActions` (palette/shape/add-root state, openers, `menuItemsFor`, the dialogs) from `PipelineSpine`, desktop behaviour unchanged
- [x] 2.2 Add `variant="phone"` to `PipelineSpine`/`SpineLane`/`SpineStepRow`/`SpineSourceCard`/`SpineOutputs`: sr-only eyebrows, no grip/row menu, full-width ≥60px row button with chevron and `aria-haspopup="dialog"`, board-style cards, sample label + refresh kept
- [x] 2.3 Extract `RunHistoryList` from `RunHistoryModal` (modal output unchanged); add non-opening `ensureRunHistoryLoaded()` to `useRunHistory`
- [x] 2.4 Extract `useAddedStepId(steps)` from `useStepSelection` (desktop unchanged) for the phone sheet
- [x] 2.5 Phone cards: Source card name button = Edit source (when resolvable, never nesting the menu/refresh) + kept Source actions menu; Output card tap = open + kept History menu; "New output"; step-count line with visible `TruncatedRowCountBadge`

## 3. Phone layout

- [x] 3.1 `ui/mobile/PipelineMobileLayout.tsx` wired into `PipelineDetailPage` in place of `phoneLayout` (StepSaveContext, dedupe, dialogs stay sibling)
- [x] 3.2 `MobilePipelineHeader`: back, mono truncated name, status line with compact `SpineScheduleChip` (Paused visible), full error reachable, actions menu (D2), rename Save/Cancel/discard; `SpineStatusStrip` under tabs
- [x] 3.3 Steps / Preview / Runs tabs (ARIA, roving tabindex, `useIndicatorSlide` accent indicator, ≥44px); Preview/Runs mount on activation only
- [x] 3.4 Step sheet keyed by `stepRenderKey`: `StepCardFocused` + `StepPreviewTable` + Step actions menu; re-keys to the confirmed step on an ordinary create (no close/reopen); closes only on removal; any appeared step opens
- [x] 3.5 Preview tab: step `Select`, schema chips, `StepPreviewTable`; Runs tab: inline `RunHistoryList` via `ensureRunHistoryLoaded` (never opens the modal)
- [x] 3.6 `MobilePipelineActions`: Dry run (opaque) + Run pipeline (accent), 40px + ::after expanders, disabled while running, `data-slot="draft-status"` row, ResizeObserver → `--pipeline-mobile-actions-h` scroller padding
- [x] 3.7 12px gutters; verify accent appears only on Run, the active tab indicator, the open step's row and focus

## 4. Retire the river

- [x] 4.1 Delete river-only modules (D9) + their CSS/tests once tsc and an import grep prove them unreachable; keep shared hooks
- [x] 4.2 Sort the ~183 tests in the 9 `installPhoneShell` jest files per describe (retarget / port / delete-with-replacement), record evidence/test-mapping.md, invert PipelineDetailPage.spine.test.tsx:709
- [x] 4.3 Port e2e specs that used river selectors (hel908 ×3, hel520 regression, hel1628 sample label, state-surface-contrast-guard), keeping intent; do not hand-edit shard weights

### Tests

## 5. Unit tests

- [x] 5.1 `useSheetSwipe`/`BottomSheet`: threshold, velocity, spring-back, cancel, body never drags, no transform at rest, veto → spring back, exit holds open, Off/Subtle, literal-timing guard
- [x] 5.2 Phone layout: tabs ARIA, every `OpType` editor in the sheet, AI temp→server swap and ordinary append confirm keep the sheet open with no close/reopen, remove closes, Runs leaves `historyOpen` false, no Preview/Runs request before activation, paused schedule + partial badge visible, empty zero-height `draft-status` slot
- [x] 5.3 Desktop spine tests (`PipelineDetailPage.spine*`, `SpineStatusStrip`) green after the extractions without weakened assertions; the river-driven files follow 4.2/C6

## 6. E2E and measurement (running app, 375×812 / 390×844 / 768×1024, both themes)

- [x] 6.1 `e2e/hel1582-mobile-pipeline.spec.ts`: AC1 fit (rects inside scroller and above bar top), AC2 CDP touch drag on the handle + close button + every op kind's editor geometry in the sheet at 375, AC3 last-item and nav clearance, AC4 touch-target sweep of each tab and the open sheet
- [x] 6.2 Measure phone hover/focus/pressed contrast (state surface ≥1.10, text ≥4.5, non-text ≥3) for new controls; record JSON evidence; mutation shows each new guard can fail
- [x] 6.3 After/before measurements at 375×812 (same seed as baseline), screenshots in scratch, numbers in evidence; re-measure nav clearance after HEL-1583 (#1052) merges
- [x] 6.4 Full gates: lint, format, typecheck, build, jest (≤2 workers), targeted + full e2e under the lock; record known flakes HEL-1633/1644/1620 and rerun once
