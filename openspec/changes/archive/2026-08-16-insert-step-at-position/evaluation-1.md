## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verified against `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
(`specs/pipeline-editor-page/spec.md` ADDED, `specs/pipeline-steps-persistence/spec.md`
MODIFIED), and `files-modified.md`.

- All 5 ACs addressed explicitly, none reinterpreted:
  - Insert at start/middle/end with correct persisted reindexing — backend tests cover position
    0, middle, count(=append-equivalent), and a gap-healing case (0,2,5 → contiguous after
    insert); each asserts persistence via a follow-up GET.
  - Insert affordance between/around cards, refreshing analyze + previews — `PipelineRiverView`
    renders one gap button per list index (before-first + between-pairs); refresh is proven to
    come "free" via the existing order-sensitive `stepsFingerprint` (analyze) and
    `${stepIndex}:config` (preview) mechanisms — asserted in tests, not reimplemented (matches
    design.md Decision 7's "implement nothing" claim).
  - Existing append unchanged — `handleAddStep` now delegates to `handleInsertStep(op,
    steps.length)`, wire payload omits `position` for that path (verified in code, unit test, and
    live network check).
  - Backend + frontend tests present and meaningful (see Phase 2).
  - Backward compatible — `position: Option[Int] = None` on `CreatePipelineStepRequest`
    (`jsonFormat2`→`jsonFormat3`), new `schemas/create-pipeline-step-request.schema.json`, no
    route or enum change.
- Tasks 1.1–3.5 all marked done in `tasks.md`, and each matches what's actually in the diff (spot
  checked 1.2/1.3 against `PipelineStepRepository.insertAtInternal` /
  `PipelineService.persistNewStep`, 2.2/2.3 against `PipelineDetailPage.tsx` /
  `PipelineRiverView.tsx`).
- No scope creep: the one structural change beyond the literal ticket text —
  `handleAddStep`→`handleInsertStep(op, steps.length)` consolidation — is explicitly called out
  and justified in `design.md` Decision 6 / Planner Notes as deliberate and behavior-preserving
  (verified: append still omits `position`, same optimistic/reconcile/failure-toast semantics).
  This matches the project's refactor-discipline convention (behavior-preserving structural
  changes stay inline; anything non-trivial would be a spinoff).
- No regressions: full backend suite (3048 tests) and full frontend suite (1820 + 186 helio-mcp
  tests) pass; existing HEL-407 reorder tests and drag-indicator behavior unaffected (verified
  live, see Phase 3).
- Schema updated in the same change (`schemas/create-pipeline-step-request.schema.json`,
  `npm run check:schemas` clean).
- Planning artifacts reflect final implementation: `skeptic-design-1.md` (round 1, CONFIRM) traces
  every load-bearing design claim to actual code line-by-line before implementation; the
  as-built code matches those claims (`insertAtInternal`'s renumber-from-scratch idiom mirrors
  `reorderInternal` exactly as designed; the 422/`UnprocessableEntity` precedent from
  `reorderSteps` is reused verbatim). The one factual drift the skeptic flagged
  (`PipelineRiverView.tsx` baseline 228, not design.md's stated 219) is non-blocking and doesn't
  affect correctness; `files-modified.md` records the real growth (228→289).

### Phase 2: Code Review — PASS

Issues: none.

**Gates (fresh run, this worktree, `EVALUATOR_CLEAN_WORKTREE=false` so no clean-worktree
re-run required):**

| Gate | Result |
| --- | --- |
| `cd backend && sbt -batch "testOnly com.helio.api.PipelineStepRoutesSpec"` | 40/40 passed |
| `cd backend && sbt -batch test` (full suite) | 3048/3048 passed, 0 failed |
| `npm run lint` | clean (zero-warnings) |
| `npm run format:check` | clean |
| `npm test` (full — helio-mcp 186 + frontend 1820) | 2006/2006 passed |
| `npm run check:schemas` | "schemas in sync with JsonProtocols (61 checked across 45 protocol files)" |
| `npm --prefix frontend run build` | succeeded (pre-existing >500kB chunk-size warning, unrelated) |

**Code quality (CONTRIBUTING.md, mechanical rules):**
- No inline FQNs introduced (`UUID`, `Instant`, etc. all top-of-file imports already present;
  `insertAtInternal` reuses them).
- ACL-bypass comments present and correct at every new internal repo/service call site
  (`PipelineStepRepository.scala:186-199` doc comment on `insertAtInternal`; `PipelineService.scala`
  `persistNewStep` comment explaining the editor-grantee RLS-owner-JOIN rationale) — matches the
  ACL triad convention.
- File-size soft budgets: `PipelineDetailPage.tsx` 626→653, `PipelineRiverView.tsx` 228→289 —
  both already over the ~250L soft budget pre-change; growth is informational only per
  CONTRIBUTING.md ("File-size warnings ... are informational only") and the ticket explicitly
  defers the split to HEL-682. Not a violation.
- API contract: schema added in the same change, in sync with the protocol (`check:schemas`
  green).

**DESIGN.md (mechanical, frontend-only):** new CSS (`PipelineDetailPage.css:218-251`) uses only
`--app-*`/`--text-*` tokens (`--app-border-subtle`, `--app-radius-pill`, `--app-surface`,
`--app-text-muted`, `--text-xs`, `--app-transition`, `--app-accent-surface`, `--app-accent-mid`,
`--app-accent`) — all confirmed present in `frontend/src/theme/theme.css` for both light and dark
blocks. No hardcoded colors/spacing.

**DRY / Readable / Modular:** `insertAtInternal` reuses the exact `reorderInternal`
one-transaction-full-renumber idiom rather than inventing a new pattern; frontend reuses the
existing `OpDropdown` anchor pattern and `RibbonSegment`. Naming is clear
(`handleInsertStep`/`insertAtInternal`/`persistNewStep`); no magic numbers (index bounds
`0`/`count` are named, not literals scattered).

**Type safety:** `position: Option[Int]`, `position?: number` — no `any`/untyped escape hatches.

**Security / validation:** `0 <= index <= count` enforced server-side (not just client-side)
before any write; out-of-range → 422 with nothing persisted (verified by dedicated backend
tests). Existing per-kind ACL pre-flights (join/union/lookup) untouched and still run before the
persist branch.

**Error handling:** backend returns typed `ServiceError.UnprocessableEntity`; frontend keeps the
optimistic temp step and surfaces a toast on failure (existing convention, unchanged, tested).

**Tests meaningful:** backend — 6 new tests exercise real insert/shift/reject/gap-heal behavior
via full HTTP round-trips + follow-up GETs (would catch a broken renumber or a validation
regression). Frontend — asserts actual DOM order after insert, exact service-call arguments
(including the `undefined` position for append), failure-path DOM state + toast content, and the
analyze/preview refresh machinery via call-count deltas (would catch a broken fingerprint wiring).

**No dead code / no over-engineering:** no leftover TODOs; no unused imports; the design
explicitly rejected a separate insert-at endpoint and delete-time renumbering as unnecessary
(YAGNI), consistent with what's implemented.

**Behavior-preserving refactor check:** `handleAddStep`→`handleInsertStep` consolidation verified
behavior-preserving — append still omits `position` on the wire (network-level check during live
review, plus a dedicated unit test), same optimistic/reconcile/failure semantics.

### Phase 3: UI Review — PASS

Issues: none.

Servers started via `scripts/concertino/start-servers.sh` on this run's ports only (dev 5842,
backend 8749); `assert-phase.sh servers` → `PASS servers`.

Live checks performed on a fresh pipeline created for this review ("HEL-410 eval insert test",
deleted afterward via `DELETE /api/pipelines/:id`; pre-existing "HEL-407 eval reorder test" /
"Skeptic Test *" fixtures were left untouched):

- **Happy path:** built a 2-step pipeline (Rename column, Filter rows); inserted "Cast type"
  before the first step (gap index 0) → optimistic render `[Cast type, Rename column, Filter
  rows]`, `POST .../steps` returned 201 with `position: 0`. Inserted "Select fields" between Cast
  type and Rename column (gap index 1) → `[Cast type, Select fields, Rename column, Filter
  rows]`. Reloaded the page (`browser_navigate` to the same URL) — order persisted exactly as
  inserted, confirming server-side reindexing survived a fresh GET.
- **Analyze + preview refresh:** opened Filter rows' preview before an insert
  (`fetchStepPreview` request observed); after inserting upstream, `/analyze` was re-requested
  (3 calls observed across the session, consistent with the debounced fingerprint-driven refresh)
  and a new `/steps/:id/preview` request fired for the still-open preview — confirms downstream
  steps pick up the new upstream step without manual action.
- **Append unchanged:** used the bottom "+ Add transformation step" control to append "Limit
  rows" — landed at the end (`[Cast type, Select fields, Rename column, Filter rows, Limit
  rows]`), matching the append-not-insert code path.
- **HEL-407 drag-indicator interplay:** simulated an HTML5 drag (`dragstart` on the drag handle,
  `dragover` on a later card) via `DragEvent` dispatch — the `.pipeline-detail-page__drop-indicator`
  rendered correctly (1 instance) while all 4 `.pipeline-detail-page__gap-insert-btn` elements
  remained present and unaffected; screenshot confirms no visual overlap between the orange
  drop-indicator line and the gap "+" buttons.
- **No console errors:** only pre-existing, unrelated `404` for `GET .../schedule` (existing
  "no schedule set" pattern, present before any HEL-410 interaction and unrelated to this
  ticket).
- **Accessible names / keyboard support:** gap buttons are real `<button aria-label="Insert step
  here">` elements (not the `aria-hidden` drag handle) — natively focusable and operable via
  Enter/Space; role/name confirmed via accessibility snapshot (`button "Insert step here"`).
- **Both themes:** dark (default) and light (toggled) both render the gap buttons with correct
  token-driven contrast — verified via screenshot in each theme.
- **Breakpoints 1440 / 1100 / 768 / 375** (0 → mobile-narrowest available): no layout breakage at
  any width; gap buttons stay centered on their ribbons at every size, mobile bottom-nav bar
  unaffected at 768/375.

Dev servers were stopped after the review (killed the `vite` and backend `java`/sbt processes
bound to 5842/8749); ports confirmed free afterward. All screenshots and the test pipeline
created for this review were deleted; no stray artifacts left at the repo root.

### Overall: PASS

### Non-blocking Suggestions

- `skeptic-design-1.md`'s note #1 (TOCTOU: the service's count-validation read and the repo's
  fresh read inside `insertAtInternal`'s transaction are two separate reads) is accepted as safe
  (every outcome is a valid contiguous order) but isn't named in `design.md`'s Risks section next
  to the already-documented "concurrent inserts" risk. Purely a documentation completeness nit,
  not a code issue.
- `PipelineDetailPage.tsx` (653L) and `PipelineRiverView.tsx` (289L) are both past the ~250L soft
  budget and getting further from it; no action needed now (HEL-682 owns the split per the
  ticket's delivery notes), but worth keeping in mind for the next change that touches either
  file.
