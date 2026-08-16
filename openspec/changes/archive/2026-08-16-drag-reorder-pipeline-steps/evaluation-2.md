## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS

Re-checked against `git diff c363a9ed..a691ed08 --name-only`: the cycle-2 commit touches only
`PipelineRiverView.tsx`, `PipelineRiverView.test.tsx`, and `PipelineDetailPage.css` (plus
`files-modified.md`/`workflow-state.md`/`evaluation-1.md` governance files) — no scope creep,
no backend files touched (confirmed; `sbt test` correctly not re-run this cycle, per the
orchestrator's instruction). Both evaluation-1.md change requests are addressed exactly as
scoped, nothing extra. `files-modified.md`'s new "Cycle 2" section documents root cause, probe,
fix, and fresh verification for both CR1 and CR2, consistent with the systematic-debugging law.
This resolves the AC gap noted in evaluation-1.md ("Steps can be reordered by drag and by
keyboard; the new order persists" was not fully met for drag) — see Phase 3 live confirmation.

### Phase 2: Code Review — PASS

Gates (fresh run, this session, `WORKTREE_PATH`):

- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm test` (full suite) — 1788/1788 pass, 177 suites (was 1787 in cycle 1; +1 for the new CR1
  regression test).
- `npm run check:schemas` — clean.
- `npm --prefix frontend run build` — succeeds.
- Backend `sbt test` — not re-run (no backend files in `c363a9ed..a691ed08`, confirmed via
  `git diff --name-only`).

Fix review:

- **CR1** (`PipelineRiverView.tsx` `handleCardDrop`, now lines 98-112): adds
  `const targetIndex = draggedIndex < overIndex ? overIndex - 1 : overIndex;` before calling
  `moveStep`, with a clear comment explaining the shift-after-removal root cause. This is exactly
  the fix I recommended in evaluation-1.md. A new regression test
  (`PipelineRiverView.test.tsx`, "dragging Filter down past Sort to hover over Cast (CR1)")
  reproduces the exact 4-step scenario from evaluation-1.md's live repro and asserts the corrected
  id order. Move up/down (`handleMoveUp`/`handleMoveDown`) are untouched, as expected — they never
  call through `handleCardDrop`.
- **CR2** (`PipelineDetailPage.css:373`): `.pipeline-detail-page__step-card-toggle`'s `gap: 10px`
  → `gap: var(--space-2)`, matching the sibling `.pipeline-detail-page__step-card-header` rule
  one line above — resolves the DESIGN.md `[mechanical]` token violation exactly as requested.

No new issues introduced by the fix (see Phase 3 for one minor non-blocking observation).

### Phase 3: UI Review — PASS

Dev servers started via `scripts/concertino/start-servers.sh` (dev 5839 / backend 8746),
confirmed healthy via `assert-phase.sh servers`; stopped cleanly afterward (verified no process
remained listening on either port). Re-ran the live `DragEvent` reproduction from evaluation-1.md
against the same 4-step test pipeline created that cycle (`HEL-407 eval reorder test`,
`63130b24-78f3-41b1-b934-cac6c7130f0e`, still present in the shared dev DB):

- **Downward drag spanning >1 card (the reported bug)**: dragged "Limit rows" (index 0) down to
  hover over "Filter rows" (index 3, the last card) in `[Limit, Cast, Sort, Filter]`. Verified
  the drop-indicator rendered directly above "Filter rows" *before* checking the result, then
  confirmed the final order is `[Cast, Sort, Limit, Filter]` — Limit now lands exactly where the
  indicator showed (directly before Filter), not one slot past it. **Confirmed fixed.** Verified
  the `PUT .../steps/order` fired and the new order survives a full page reload.
- **Upward drags**: dragged "Filter rows" (last) up to hover over "Cast type" (first) — landed
  directly before Cast, i.e. at the very front, matching the indicator. Correct, as before (this
  direction was never broken; unaffected by the fix, confirmed).
- **Single-position (adjacent) drag transpositions**: adjacent **upward** drag-swap (Sort dragged
  up over Cast) works correctly via drag. Adjacent **downward** drag-hover directly on the
  immediately-following card computes to a same-position no-op post-fix (was a coincidental swap
  pre-fix) — this is the mathematically correct consequence of "lands exactly where the indicator
  shows" (the indicator above the very next card sits exactly at the dragged item's own current
  position), not a regression in final-order correctness. Dragging one card further (hovering the
  *following* card instead) still achieves the swap via drag, as expected of an insert-before
  indicator model. One harmless side effect noted below.
- **Keyboard reorder (Move up/down)**: re-verified live — "Move step down" on a middle card still
  correctly transposes it with its successor. Fully unaffected by this cycle's changes, as
  expected (`handleMoveUp`/`handleMoveDown` don't call `handleCardDrop`).
- **Console**: no new errors from any interaction this cycle — only the same pre-existing,
  unrelated `404` on `GET .../schedule` for a pipeline with no schedule set.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- Minor, not from this cycle's diff but newly visible while re-testing: when a downward drag's
  computed `targetIndex` equals `draggedIndex` (i.e. hovering exactly on the card immediately
  following the dragged item — the no-op case described above), `handleCardDrop`'s guard
  (`overIndex !== draggedIndex`) doesn't catch it, so `onReorderSteps` still fires with a
  content-identical array, which still triggers a real `PUT .../steps/order` (verified: harmless,
  idempotent, 200 OK, no incorrect final state) plus a redundant analyze re-dispatch. Consider
  guarding on `targetIndex !== draggedIndex` instead of `overIndex !== draggedIndex` in
  `handleCardDrop` if this is worth tightening — not blocking, no AC or spec.md scenario requires
  suppressing redundant idempotent no-op writes, and the final order is always correct.
