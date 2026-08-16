## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not from evaluation-1.md's narrative):
- Read `ticket.md`, `design.md`, both spec deltas (`specs/pipeline-steps-persistence/spec.md`,
  `specs/pipeline-editor-page/spec.md`), and `git diff main...HEAD` in full for every changed file
  (`PipelineStepProtocol.scala`, `PipelineStepRepository.scala`, `PipelineService.scala`,
  `PipelineStepRoutesSpec.scala`, `pipelineService.ts`, `PipelineDetailPage.tsx`,
  `PipelineRiverView.tsx`, `PipelineDetailPage.css`, both `.test.tsx` files,
  `create-pipeline-step-request.schema.json`).

**Backend logic (read, not just claimed):**
- `PipelineStepRepository.insertAtInternal` (lines 189–213): reads the pipeline's steps sorted by
  position, `Vector.patch(index, Vector(newRow), 0)` to splice at `index`, then
  `DBIO.sequence` over a renumbering pass (0..n) inside one `.transactionally` block — the exact
  `reorderInternal` idiom, correct under gaps (patch on a freshly re-read sorted vector, not raw
  DB positions).
- `PipelineService.persistNewStep` (lines 528–553): `None` branches to the byte-for-byte-untouched
  `insertInternal` call (confirmed by diff — this line is unchanged from pre-HEL-410); `Some(index)`
  reads a fresh count via `listByPipelineInternal`, validates `0 <= index <= count`, else
  `ServiceError.UnprocessableEntity` (confirmed mapped to HTTP 422 in `ServiceResponse.scala:82`)
  with no write attempted. The entire ACL/validation chain above `persistNewStep` (kind check,
  join/union/lookup pre-flight ACLs, owner-vs-editor `findByIdShared`/`requireEditorAccess`) is
  verbatim, unindented, untouched — confirmed by diff (no lines changed above the call sites).
- Schema: `schemas/create-pipeline-step-request.schema.json` (new) matches
  `reorder-pipeline-steps-request.schema.json`'s conventions exactly (optional integer `position`,
  `minimum: 0`, `additionalProperties: false`).

**Backend gates (re-run fresh, this session, not reused from evaluation-1.md):**
```
sbt "testOnly com.helio.api.PipelineStepRoutesSpec"  → 40/40 passed (includes all 6 new HEL-410 tests:
  position 0 / middle / count(=append) / -1→422+nothing-persisted / count+1→422+nothing-persisted /
  gap-healing 0,2,5→contiguous)
sbt test (full suite)                                 → 3048/3048 passed, 0 failed
npm run check:schemas                                 → "schemas in sync ... (61 checked across 45 protocol files)"
npm run check:scala-quality                           → "clean (112 soft warning(s))" — all pre-existing,
  none in the touched files beyond the acknowledged (ticket-flagged, HEL-682-owned) PipelineDetailPage/
  PipelineRiverView growth
```

**Frontend gates (re-run fresh):**
```
npm run lint                                          → clean, zero warnings
npm run format:check                                  → clean
npm test -- --testPathPatterns="PipelineDetailPage|PipelineRiverView"  → 103/103 passed
npm test (full suite)                                 → 1820/1820 passed
npm run build                                          → succeeded (pre-existing >500kB chunk warning, unrelated)
```

**Live UI verification (this run's ports only — dev 5842 / backend 8749, via
`start-servers.sh` + `assert-phase.sh servers` → PASS):**
- Created a fresh pipeline ("HEL-410 skeptic insert test") for this review only; left all
  pre-existing fixtures ("Skeptic Dry-Run Test Pipeline", "HEL-454 eval smoke", "HEL-407 eval
  reorder test", "Skeptic Test Pipeline", "Skeptic Test Dashboard") untouched — confirmed present
  before and after via snapshot.
- Added "Rename column" (append, empty-state control) → 1 gap button rendered before it, matching
  the "before-first" spec scenario.
- Appended "Filter rows" via the bottom "+ Add transformation step" row → 2 gap buttons (before
  Rename, between Rename/Filter), after-last stays the add row (not a 3rd gap) — matches
  `renderGap(idx+1)` only for `idx < steps.length - 1`.
- Clicked the middle gap, selected "Cast type" → optimistic render `[Rename, Cast, Filter]``
  immediately; confirmed via `fetch('/api/pipelines/:id/steps')` from the page's own session that
  the **persisted** order/positions were exactly `[(rename,0),(cast,1),(filter,2)]` — later step
  correctly shifted down, contiguous positions, matches the "Insert in the middle" spec scenario.
- Reloaded the page (`browser_navigate` to the same URL) — order rendered identically from a fresh
  GET, confirming server-side persistence (not just optimistic local state).
- HEL-407 drag-indicator interplay: dispatched real `DragEvent`s (`dragstart` on the drag handle,
  `dragover` on an earlier step-section, with a render-settle delay between them so React's
  batched state update actually applied before the second event) — `.pipeline-detail-page__drop-indicator`
  rendered (1 instance) while all 3 `.pipeline-detail-page__gap-insert-btn` elements remained
  present; screenshot confirms the orange drop-indicator line renders above the step card as a
  separate sibling, with no visual overlap with the gap "+" buttons.
- Theme parity: screenshotted the 3-step pipeline in both dark (default) and light (toggled)
  themes — token-driven contrast is correct in both (`--app-border-subtle`/`--app-surface`/
  `--app-text-muted` idle, `--app-accent-surface`/`--app-accent-mid`/`--app-accent` hover/focus,
  confirmed present in `frontend/src/theme/theme.css` for both blocks), consistent with the
  sibling `RibbonSegment` treatment.
- Responsive: 1440px and 390px (mobile) viewports both screenshotted — gap buttons stay centered
  on their ribbons at every width, no layout breakage, mobile bottom-nav unaffected.
- No console errors beyond the pre-existing, unrelated `404` on `GET .../schedule` ("no schedule
  set" pattern, present on every pipeline regardless of this ticket).
- Cleanup: deleted the test pipeline via `DELETE /api/pipelines/:id` (with the required
  `X-Helio-Requested-With` CSRF header) → `204`; confirmed gone from the list and all
  pre-existing fixtures still present; removed the 7 screenshot PNGs this review wrote to the repo
  root (known Playwright-session-shares-repo-root-cwd quirk, not this ticket's doing); stopped the
  `vite` (5842) and `java`/sbt (8749) processes and confirmed both ports free via `ss -ltnp`.

### Acceptance criteria — traced

1. **Insert at any position (start/middle/end), positions shift and persist** — traced to
   `insertAtInternal` + the 6 backend tests + live insert-before-first/insert-middle +
   persisted-after-reload check above. Met.
2. **Insert affordance between/around cards, refreshes analyze + previews** — traced to
   `PipelineRiverView.renderGap` (gap 0 before-first, `renderGap(idx+1)` between pairs, after-last
   untouched) + `PipelineDetailPage.test.tsx`'s dedicated `stepsFingerprint`/`stepIndex`-refresh
   tests (design.md Decision 7's "implement nothing, assert the existing machinery composes" —
   verified true by reading the fingerprint code: nothing new was added there). Met.
3. **Existing append unchanged** — traced to `handleAddStep` → `handleInsertStep(op, steps.length)`
   with `isAppend` computed synchronously in the same closure as the splice (no race), `position`
   omitted from the wire when `isAppend`; `insertInternal` itself is byte-identical pre/post-diff.
   Verified live (append landed at the end) + unit test asserting the 4th arg is `undefined`. Met.
4. **Tests present and meaningful** — 6 new backend tests (each does a full HTTP round-trip +
   follow-up GET, not just checking the immediate response) + 11 new frontend tests across two
   files (DOM order, exact service-call args, failure-path DOM+toast, fingerprint/stepIndex
   call-count deltas). Met.
5. **Backward compatible** — `position: Option[Int] = None` default preserves every pre-existing
   2-arg construction site; `jsonFormat2`→`jsonFormat3` is additive; new schema file, no route or
   enum change; `check:schemas` clean. Met.

### Verdict: CONFIRM

No change requests. The implementation matches the design exactly as planned, the ACL chain is
provably untouched (not just claimed untouched — diffed line-by-line), positions stay contiguous
under gaps (tested and live-reproduced), the append path is provably byte-identical, and the
HEL-407 drag-indicator/gap-button coexistence holds under a real `DragEvent` simulation, not just
a static screenshot.

### Non-blocking notes

- The TOCTOU between `persistNewStep`'s count-read and `insertAtInternal`'s own fresh read inside
  its transaction (two separate reads, not one) is real but consequence-free: `Vector.patch`
  clamps out-of-range indices rather than throwing, so every interleaving still yields a valid,
  contiguous order — this was already flagged in `skeptic-design-1.md` and accepted in `design.md`'s
  Risks section under "concurrent inserts... last write wins... Accepted." Agree with that
  acceptance; restating only for completeness.
- `PipelineDetailPage.tsx` (653L) and `PipelineRiverView.tsx` (289L) are both past the ~250L soft
  budget (`check:scala-quality`'s frontend analogue isn't wired up, but the same convention
  applies per `CONTRIBUTING.md`); ticket explicitly defers the split to HEL-682 and file growth is
  informational-only per `CONTRIBUTING.md:123`. No action needed now.
