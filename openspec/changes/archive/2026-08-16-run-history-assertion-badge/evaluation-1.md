## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verified against `ticket.md`/`proposal.md`/`design.md`/`tasks.md`/both `specs/*/spec.md`:

- All 4 ticket ACs addressed explicitly, not partially:
  1. Run History pass/fail-by-severity summary + expandable failing rules — implemented
     (`RunHistoryModal.tsx`) and confirmed rendering correctly in a live browser session (Phase 3).
  2. Panel badge for invalid/blocked DataType — implemented (`PanelCard.tsx` +
     `GET /api/types/:id/assertion-status`), confirmed live: badge shows for a DataType whose latest
     real run had an error-severity failure, no badge for a clean DataType.
  3. `PipelineRunRecord` + JSON Schema carry the assertion summary, additive/backward-compatible —
     `jsonFormat9` → `jsonFormat10`, one production construction site
     (`PipelineRunService.scala:238`), `schemas/pipeline-run-record.schema.json` updated with
     `$defs.AssertionSummary`/`AssertionFailureDetail`.
  4. DESIGN.md/lint/test — lint and tests pass (see Phase 2); one DESIGN.md mechanical violation found
     (see Phase 2 Change Request 1).
- No AC silently reinterpreted. AC2's "had error-severity assertion failures (or was blocked)" is
  correctly collapsed into one criterion (design.md Decision 3) — verified 419-C's blocking is always
  caused by exactly that condition, so this is not a weakening of the AC.
- All 19 tasks.md items marked `[x]` and match the implemented code 1:1 (cross-checked every task
  against its corresponding diff hunk).
- **Dry-run exclusion (the design gate's round-1 REFUTE finding) verified landed and tested.** The
  filter (`r.status =!= "dry_run"`) is present in
  `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala`'s new
  `findLatestRunIdByOutputDataTypeIdInternal`. I re-ran the dedicated tests in isolation (not trusting
  the executor's report):
  - `PipelineRunRepositorySpec` — 4/4 tests pass, including "excludes a dry run more recent than the
    last real run."
  - `DataTypeRoutesSpec` — the dedicated "dry run after a clean real run does not flip invalid to true"
    case passes.
  Also independently reproduced this exact scenario live via the API (see Phase 3) — confirmed correct.
- No scope creep of consequence. One minor, benign addition: `frontend/src/test/renderWithStore.tsx`
  also now sets `selectedTypeId: null` in its `dataTypes` slice normalization (line 184) — a
  pre-existing gap (this field existed on `DataTypesState` before this ticket but was never set here)
  that files-modified.md's "the two new dataTypes state fields" description doesn't explicitly
  mention. It's a one-line, non-behavior-changing fix bundled into the same hunk the executor was
  already touching for the real load-bearing fix — not flagged as an issue, just noting the
  files-modified.md characterization is very slightly incomplete.
- No regressions to existing behavior: full `sbt test` (3035/3035) and full `npm test` (164 + 1758)
  pass; pre-existing `PipelineRunRecord` test fixtures updated only with the new required field
  (compile fallout, no behavior change — confirmed via diff read).
- Schema updated in the same change as the code that uses it, per CLAUDE.md convention.
- Planning artifacts reflect the final implemented behavior (design.md Decision 5's dry-run filter,
  Decision 10's toggle-broadening — both match the diff exactly).

### Phase 2: Code Review — FAIL

Issues:

1. **DESIGN.md §3 Spacing `[mechanical]` violation — hardcoded px values instead of `--space-*`
   tokens** in `frontend/src/features/pipelines/ui/RunHistoryModal.css`:
   - Line 137: `margin: 8px 0 0;` (in `.run-history-modal__assertion-failures`)
   - Line 142: `gap: 6px;` (same rule)
   - Line 146: `padding: 8px 10px;` (in `.run-history-modal__assertion-failure`)

   DESIGN.md: "**[mechanical]** All margin/padding/gap use a `--space-*` token (small optical tweaks
   ≤ 4px may be literal)." None of these three values are ≤4px, so the exception doesn't apply.
   `--space-2` (8px) is an exact match for the `8px` occurrences; `6px`/`10px` don't map exactly to
   any scale value (`--space-1`=4px, `--space-2`=8px, `--space-3`=12px) and need to be rounded to the
   nearest token. This does mirror an already-existing anti-pattern in the same file (e.g. the
   pre-existing `.run-history-modal__row-error` at lines 109-118 has the identical `margin: 8px 0 0;
   padding: 10px;`), but DESIGN.md's own header explicitly warns against exactly this justification:
   "'consistent with existing patterns' means _consistent with what is written here_, not inferred
   from scattered code." New code should not perpetuate a pre-existing violation. Suggested fix:
   `margin: var(--space-2) 0 0;`, `gap: var(--space-2);` (or `var(--space-1)` if a tighter list is
   preferred), `padding: var(--space-2) var(--space-3);` (8px/12px, closest token pair to 8px/10px).

All other Phase 2 checks pass:

- **Gates re-run fresh by me (not trusting the executor's report)**, all green, matching the
  executor's claimed counts exactly:
  - `sbt test`: 3035/3035 passed (2m20s), plus an isolated re-run of the dry-run-exclusion tests.
  - `npm run lint`: 0 warnings.
  - `npm run format:check`: clean.
  - `npm test` (root + frontend): 164 + 1758 passed; also re-ran the three HEL-576-specific suites
    (`dataTypesSlice`, `PanelCard`, `RunHistoryModal`) in isolation — 28/28 pass.
  - `npm --prefix frontend run build`: succeeds (pre-existing >500kB chunk-size warning, unrelated to
    this diff).
- **No inline FQNs** — verified via grep against every new `import` line in the backend diff; all are
  proper top-of-file imports (`com.helio.services.{...}`, `com.helio.domain.{...}`, etc.).
- File-size soft budget: `PipelineRunService.scala` was already 605 lines pre-ticket (over the
  ~250/400 CONTRIBUTING.md budget) and grew to 652; this is pre-existing tech debt the ticket adds
  ~50 lines to rather than proposing a split. Per the pre-commit policy this warning is
  "informational only," so not a blocking finding — see Non-blocking Suggestions.
- DRY: reuses `listAssertionsByRunInternal`, the existing `panel-grid-card__type-badge` chip
  recipe/BEM pattern, the existing `deleteOldRunsInternal` dry-run-filter precedent, and the existing
  `condition:`-based thunk-dedup pattern (`panelThunks.ts`/`dashboardsSlice.ts`). No unnecessary
  duplication found.
- Readable, modular: small, single-purpose functions (`summarizeAssertions`,
  `assertionStatusForDataType`, `AssertionSummaryBadge`, `AssertionFailureList`); no magic values in
  the backend logic (rule severities compared against literal `"error"`/`"warn"`, which are the
  domain's own supported-severity constants used consistently elsewhere in the codebase).
- Type safety: no `any`/untyped escape hatches introduced; new TS types
  (`AssertionSummary`/`AssertionFailureDetail`/`AssertionStatusResponse`) are precise, including a
  literal union for `severity`.
- Security: the new route is ACL-gated identically to the existing `/rows` route
  (`dataTypeService.findById(id, user)` before delegating to the privileged service method) — verified
  in the diff and via a live cross-user 404 test (`DataTypeDataSourceAclSpec`), plus I independently
  confirmed via the running backend that the badge/summary reads require an authenticated session.
- Error handling: `fetchAssertionStatus`'s rejected case resets the pending flag without crashing;
  the badge simply doesn't render on failure — an explicit, twice-skeptic-reviewed design decision
  (design.md Decision 8's "degrades safely"), not a silent swallow of a user-initiated action.
- Tests meaningful: the dry-run-exclusion tests would catch a real regression (I confirmed by reading
  them — they insert a dry run with a failing assertion after a clean real run and assert the badge
  stays clean); the `RunHistoryModal`/`PanelCard`/`dataTypesSlice` new test files exercise real
  component/thunk behavior, not implementation details.
- No dead code: no unused imports, no leftover TODO/FIXME in the diff.
- No over-engineering: no bulk-join optimization was introduced despite being tempting (design.md
  explicitly rejects it as premature given the bounded ~20-call fan-out); two backend read surfaces
  (`history()`'s per-run summary vs. the dedicated per-DataType status route) are a deliberate,
  justified split, not accidental duplication.
- `check:openspec` hook bypass (`git commit -n`) is real, explicitly called out in the commit body and
  `workflow-state.md` ("Hooks bypassed (-n): npm run check:openspec fails with... archiving is a
  distinct downstream phase... All other hooks (lint, format:check, check:schemas) passed cleanly"),
  and matches the established convention for this epic's prior tickets. Not a violation.

### Phase 3: UI Review — PASS

Issues: none (the Phase 2 CSS-token issue above is the only defect found in this diff; it does not
manifest as a visible layout break).

Started servers via the canonical script (`start-servers.sh` / `assert-phase.sh servers` → both PASS).
Built and tore down real test fixtures via the live API (not stubs) rather than a quick pass, per the
orchestrator's explicit request:

- **Run History assertion summary + expand toggle**: created a pipeline with an `assert` step (one
  `error`-severity `rowCountMax` rule guaranteed to fail, one `warn`-severity `rowCountMin` rule
  guaranteed to fail, one passing `notNull` rule), ran it (blocked per 419-C as expected), opened Run
  History in the browser. The summary chip renders "1 passed · 1 error · 1 warn" with error/warn in the
  correct intent colors. Clicking "Show log" expands both the existing `errorLog` `<pre>` and a new
  failing-rules list (`rowCountMax` / `rowCountMin`, each with its message), in both dark and light
  theme — screenshots confirmed token-correct contrast in both.
- **Panel invalid-data badge**: created a dashboard with a panel bound to the above failing DataType, a
  second panel bound to a separate, all-clean DataType, and a third panel bound to the same failing
  DataType (to test the dedup requirement). Confirmed live:
  - The failing-DataType panels show an "INVALID DATA" chip in `--app-error` styling; the clean panel
    shows none — both dark and light theme screenshots confirmed correct token usage and contrast.
  - Network tab confirmed exactly one `GET /api/types/:id/assertion-status` request per distinct
    `dataTypeId` on page load (2 requests total across 3 panels spanning 2 distinct DataTypes) —
    the dedup requirement from the spec's own scenario is genuinely satisfied, not just unit-tested.
  - Zero console errors throughout every tested flow (the one pre-existing 404 on
    `GET /api/pipelines/:id/schedule` is unrelated to this diff — it fires whenever no schedule is set,
    on `main` too).
- **Breakpoints**: resized to 1440 / 1100 / 768 / 430 — no layout breakage at any width. At 768/430 the
  dashboard grid switches to `MobilePanelStack`, which does not render the footer/type-badge/invalid-
  badge at all — confirmed this is pre-existing behavior unrelated to this ticket (`MobilePanelStack.tsx`
  has no footer or type-badge markup today, on `main` or in this diff), not a regression or a gap this
  ticket needed to close.
- **Accessibility**: the only new interactive-adjacent element is the informational badge `<span>`
  (non-interactive by design, carries a descriptive `title`); the pre-existing "Show/Hide log" toggle
  button's accessible name and keyboard operability are unchanged by the broadened expand condition.

### Overall: FAIL

### Change Requests

1. **Fix the DESIGN.md spacing-token violations in
   `frontend/src/features/pipelines/ui/RunHistoryModal.css`** (lines 137, 142, 146 — see Phase 2 for
   full detail): replace the three hardcoded px values (`margin: 8px 0 0;`, `gap: 6px;`,
   `padding: 8px 10px;`) with `--space-*` tokens (e.g. `var(--space-2)` for the 8px occurrences, and
   the nearest scale value for 6px/10px — `var(--space-2)`/`var(--space-3)` respectively). This is the
   only blocking issue found; everything else (spec, gates, dry-run-exclusion correctness, live UI
   behavior in both themes) passed.

### Non-blocking Suggestions

- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` is 652 lines, already well over
  CONTRIBUTING.md's ~250/400-line soft budget before this ticket (605 lines pre-ticket). Not a gate
  failure (file-size warnings are informational only), but worth a split proposal in a follow-up if the
  file keeps growing.
- `frontend/src/test/renderWithStore.tsx`'s `files-modified.md` description ("the two new dataTypes
  state fields") is slightly incomplete — it also silently fixes an unrelated pre-existing gap
  (`selectedTypeId` was never set in this test helper's `dataTypes` slice normalization before this
  ticket). The fix itself is correct and harmless; just flagging the description undersells what
  changed by one field.
