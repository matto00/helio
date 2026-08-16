## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

- **AC "Steps can be reordered by drag and by keyboard; the new order persists and survives
  reload" is not fully met for drag.** Keyboard reorder (Move up/down) is correct in every case
  tested (live-verified). Drag reorder is correct for upward drags and adjacent transpositions,
  but **mis-places the dragged step for downward drags spanning more than one position** — the
  step lands one slot further than the drop-indicator line shows (root cause + live reproduction
  under Phase 2/3 below). This is a real functional gap in the primary interaction mode the AC
  names, not a cosmetic nit.
- AC "Analyze + previews refresh after reorder, surfacing any newly-invalid step" — met. Live
  network trace confirms both the debounced `GET .../analyze` and (when a preview is open) the
  debounced `GET .../steps/:id/preview` re-fire immediately after a reorder PUT.
- AC "Follows DESIGN.md; frontend tests cover reorder → persisted order + analyze refresh" —
  tests exist and mostly pass meaningfully, but the drag-drop coverage in
  `PipelineRiverView.test.tsx` has a gap: only the single upward-drag case from spec.md's own
  example ("drag C above A") is exercised. No test drags an item downward past more than one
  sibling, which is exactly the case that's broken — task 3.2 ("drop handler computes correct id
  order") is checked done but the coverage doesn't validate general correctness.
- AC "Backward compatible: reuses existing position semantics; no enum/wire break (or additive
  batch endpoint only)" — met. `check:schemas` is clean; only a new route/request/schema was
  added; the per-step PATCH is untouched.
- No scope creep: implementation stays within the files proposal.md's Impact section named.
- No regressions to existing behavior: full backend suite (3029 tests) and full frontend suite
  (1787 tests) both pass unmodified elsewhere.
- Planning artifacts (proposal/design/tasks) otherwise accurately reflect the implemented
  behavior — design.md's Decisions 1-9 all match the diff line-for-line except for the drag
  destination-index computation, which design.md Decision 5's own comment (`overIndex` = "the
  slot the dragged step would land in on drop", `PipelineRiverView.tsx:78`) states was intended
  to work as I found it does *not*, for the downward multi-position case.

### Phase 2: Code Review — FAIL

Gates (fresh run, this session, `WORKTREE_PATH`, no `CLEAN_WORKTREE`):

- Backend `sbt "testOnly com.helio.api.PipelineStepRoutesSpec"` — 34/34 pass (7 new HEL-407
  tests: happy path + persistence, 404, 403 viewer, 3× 422 non-permutation, failed-reorder-leaves-
  positions-unchanged).
- Backend `sbt test` (full suite) — 3029/3029 pass, 193 suites, 0 failures.
- Frontend `npm run lint` — clean (zero-warnings).
- Frontend `npm run format:check` — clean.
- Frontend `npm test` (full suite) — 1787/1787 pass, 177 suites.
- `npm run check:schemas` — clean (59 schemas checked across 45 protocol files, including the new
  `reorder-pipeline-steps-request.schema.json`).

Issues:

1. **Off-by-one destination-index bug in native drag-drop reorder** —
   `frontend/src/features/pipelines/ui/PipelineRiverView.tsx:98-101` (`handleCardDrop`) calls
   `onReorderSteps(moveStep(steps, draggedIndex, overIndex))` using the raw, pre-removal
   `overIndex` as the splice destination. `moveStep` (`PipelineRiverView.tsx:46-51`) removes the
   dragged item first, which shifts every subsequent index down by one — so for
   `draggedIndex < overIndex` (a downward drag past more than one card), the correct destination
   is `overIndex - 1`, not `overIndex`. Live reproduction (dev server, this session): with steps
   `[Limit, Filter, Sort, Cast]`, dragging "Filter" (index 1) so the drop-indicator renders above
   "Cast type" (index 3) and dropping produces `[Limit, Sort, Cast, Filter]` — Filter lands
   *after* Cast, not before it where the indicator was shown. The PUT sent to the backend
   reflects this wrong order and the backend correctly persists whatever it's given (backend is
   not at fault). Upward drags and adjacent (single-position) transpositions — including every
   Move up/down button path, which only ever moves by one — are unaffected; this was confirmed
   live for both directions. **Fix**: adjust the destination index before calling `moveStep`,
   e.g. in `handleCardDrop`: `const target = draggedIndex < overIndex ? overIndex - 1 :
   overIndex;` then `moveStep(steps, draggedIndex, target)`. Add a regression test to
   `PipelineRiverView.test.tsx` for a downward multi-position drag (e.g. drag the first card to
   hover over the last of 4+ cards) — the existing "drop handler computes the correct id order"
   test only covers the upward case from spec.md's example.
2. **(minor) DESIGN.md [mechanical] token violation in new CSS** —
   `frontend/src/features/pipelines/ui/PipelineDetailPage.css:373`. The newly-added
   `.pipeline-detail-page__step-card-toggle` rule hardcodes `gap: 10px`. DESIGN.md §3 Spacing:
   "All margin/padding/gap use a `--space-*` token (small optical tweaks ≤4px may be literal)" —
   10px exceeds the 4px literal allowance and no token is used. The sibling rule one line above
   (`.pipeline-detail-page__step-card-header`, line 365) uses `gap: var(--space-2)` for the
   equivalent visual spacing in this same diff — use the same token here
   (`gap: var(--space-2);`) for consistency. (The file has ~6 other pre-existing `gap: 10px`
   instances outside this diff's touched lines; those are out of scope and not raised here.)

Everything else reviewed clean: no inline FQNs (backend imports all top-of-file), ACL/service
pattern for `reorderSteps` mirrors `updateStep`/`deleteStep` exactly (editor/owner check,
NotFound-masking, `listByPipelineInternal` + `reorderInternal` split), repository transaction is
a single `.transactionally` `DBIO.sequence`, protocol/schema addition is additive-only, no dead
code, no premature abstraction, `files-modified.md`'s reported file-growth numbers
(StepCard.tsx 503, PipelineDetailPage.tsx 626, PipelineRiverView.tsx 219) match `wc -l` exactly,
and the regression-fix record (drag handle `<button>` → `aria-hidden` `<span>`) is a genuine,
correctly-diagnosed root-cause fix consistent with design.md Decision 5.

### Phase 3: UI Review — FAIL

Dev servers started via `scripts/concertino/start-servers.sh` (dev 5839 / backend 8746) and
confirmed healthy via `assert-phase.sh servers`; stopped cleanly afterward (verified no process
remained listening on either port).

- **Happy path (keyboard)**: created a 4-step test pipeline (Filter rows → Limit rows → Sort
  rows → Cast type). Move up/down: correct transposition every time, disabled at the correct
  ends, persists via `PUT .../steps/order`, survives a full page reload, and triggers a debounced
  `GET .../analyze` immediately after. Clicking Move up/down on an **expanded** card left its
  expanded/preview-open state untouched (no accidental collapse) — confirmed via snapshot before
  and after.
- **Happy path (drag)**: reproduced the off-by-one bug described in Phase 2 live, via
  programmatically dispatched `DragEvent`s (`dragstart`/`dragover`/`drop`) on the drag handle and
  section wrapper. Not exercisable in jsdom per the ticket's own note, but fully reproducible in
  a real browser.
- **Preview refresh after reorder**: opened the preview on an expanded step card, then used Move
  down on that same card — a second debounced `GET .../steps/:id/preview` fired after the
  reorder, and the preview panel stayed open across the reorder (no flicker/close).
- **Console**: no new errors from any reorder interaction. The only console error observed is a
  pre-existing, unrelated `404` on `GET .../schedule` for pipelines with no schedule set (expected
  empty-state check, not caused by this diff).
- **Accessible names / keyboard operability**: Move up/Move down buttons have `aria-label="Move
  step up"` / `"Move step down"`, are real `<button>` elements, and are keyboard-operable —
  verified by programmatically focusing a Move button and activating it with `Enter`, which
  performed the reorder. The drag handle is `aria-hidden` by design (Decision 5); its absence
  from the keyboard/AT path is intentional, not a defect.
- **Breakpoints**: 1440 / 1100 / 768 / 430 all render the restructured step-card header (drag
  handle + Move buttons + toggle) without layout breakage or overlap at any width.
- **Light theme**: quick parity check — no contrast or missing-token issues observed in the new
  header/actions-cluster/drop-indicator styling.

Non-blocking, out of scope for this ticket (not caused by this diff, noted for awareness only):
the pipelines list shows "NaN years ago" for a never-run pipeline's Last Run At column; and at
the 430px breakpoint the page's sticky footer bar (OUTPUT / step count / run buttons — not part
of this diff's touched files) overlaps awkwardly. Neither is touched by `files-modified.md`.

### Overall: FAIL

### Change Requests

1. Fix the drag-drop destination-index off-by-one for downward, multi-position drags in
   `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` (`handleCardDrop` at line 98,
   `moveStep` at line 46) — adjust the destination index when `draggedIndex < overIndex` (e.g.
   `overIndex - 1`) so the dropped step lands where the drop-indicator line shows it will,
   matching spec.md's "Drag reorders and persists" requirement in both directions. Add a
   regression test in `PipelineRiverView.test.tsx` for a downward drag spanning more than one
   card (the current test suite only covers the upward case).
2. (minor) `frontend/src/features/pipelines/ui/PipelineDetailPage.css:373` — replace the
   hardcoded `gap: 10px` in the newly-added `.pipeline-detail-page__step-card-toggle` rule with
   `gap: var(--space-2)`, matching the sibling `.pipeline-detail-page__step-card-header` rule one
   line above in this same diff (DESIGN.md §3 [mechanical] token rule).

### Non-blocking Suggestions

- Consider a Playwright/e2e-level drag test if the project ever adds one, since native HTML5 DnD
  logic bugs like CR1 are invisible to jsdom-based unit tests by construction (per the ticket's
  own risk note) — a live-browser regression test would have caught this directly.
- (Informational, out of scope) the pipelines list's "NaN years ago" display for never-run
  pipelines and the 430px sticky-footer overlap are both pre-existing and unrelated to this
  diff's touched files — worth a spinoff ticket if not already tracked, but not a blocker here.
