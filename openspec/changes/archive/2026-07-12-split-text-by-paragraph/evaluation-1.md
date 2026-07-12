## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL
Issues:
- **AC not fully met**: "Op is registered in both apply (execution) and infer/analyze paths with
  matching output schema shape" — the pure-function `PipelineAnalyzeService.inferSplitText` is
  correctly wired and unit-tested, but the **wire-level** analyze response path is not: the
  `AnalyzeStepResponse` discriminated union in `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala`
  (a *separate* sealed-trait ADT from `PipelineStepResponse` in `PipelineStepProtocol.scala`) has no
  `SplitTextAnalyzeStepResponse` case, and `PipelineService.toAnalyzeStepResponse`
  (`backend/src/main/scala/com/helio/services/PipelineService.scala:178-202`) has no
  `SplitTextConfig` match arm. Confirmed live: `GET/POST` (triggering) any pipeline analyze that
  includes a `splittext` step throws `IllegalStateException` and the route returns `500` (see Phase
  3 for full repro + stack trace). This is a genuine **8th enumeration site** (7th if the
  `AnalyzeStepResponse` ADT and its `PipelineService` dispatcher are counted as one "site"), missed
  entirely — not the `com/helio/domain/package.scala` aliases the executor flagged as "the 7th
  site" (that one is real and correctly wired, but it isn't the missing one).
- **Design doc's own "reusable pattern" claim is not accurate as written**: design.md decision 8
  says "all 6 enumeration sites must be updated" and the executor's task 1.3 note claims it found
  "the 7th" (package.scala). Neither the design doc nor the executor's own audit caught the actual
  missing site (`PipelineProtocol.scala`'s `AnalyzeStepResponse` ADT + `PipelineService.toAnalyzeStepResponse`).
  Since HEL-219's explicit charter is to "establish the reusable text-op pattern... so HEL-220/HEL-221
  can follow it directly," and the documented site list is incomplete, HEL-220/HEL-221 would hit
  this exact same bug if they copy the documented pattern as-is. This is not just a code bug — it's
  a planning-artifact accuracy problem that undermines the ticket's core deliverable.
- All other ACs (paragraph/heading split behavior, sequence index, string-body gating in the
  frontend, V50 migration, frontend step-config UI) are correctly and fully implemented — see Phase
  2/3 for verification detail.
- Tasks.md's 21/21 "done" claim is accurate for every listed task item; the gap above is a task that
  was never listed (design.md decision 9's four hand-curated lists + `PipelineStepRoutesSpec` were
  all correctly identified and updated — see Phase 2 — but `PipelineAnalyzeRoutesSpec.scala`, which
  already route-tests the `/analyze` endpoint end-to-end, was not extended with a splittext
  scenario, and would have caught this).
- No scope creep: the `package.scala` type-alias addition and `StepCodecUtil.intOr` helper are both
  necessary, minimal, and consistent with pre-existing precedent (verified — see Phase 2).

### Phase 2: Code Review — FAIL
Issues:
- **Missing match arm** (the blocking defect): `backend/src/main/scala/com/helio/services/PipelineService.scala:192-195`
  falls through to `throw new IllegalStateException(...)` for `SplitTextConfig` because no
  `case Success(cfg: SplitTextConfig) => SplitTextAnalyzeStepResponse(...)` arm was added — needs a
  matching `SplitTextAnalyzeStepResponse` case class + format + read/write arms in
  `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` (see its existing
  `AggregateAnalyzeStepResponse` at lines 106-110 and the `analyzeStepResponseFormat` read/write
  union at lines 175-205 for the precedent to mirror).
- **Test gap that let the bug ship**: `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala`
  already exercises the full `/api/pipelines/:id/analyze` route end-to-end but was never extended
  with a `splittext` step scenario (it also doesn't cover `aggregate`, so this isn't a
  regression newly introduced by omission of precedent — but design.md decision 9's "four
  hand-curated lists + one route test" enumeration should have included this file, since it is
  exactly the kind of route-level regression test the `aggregate` regression test in
  `PipelineStepRoutesSpec` (a *different*, CRUD-only route file) was modeled on, and it's the one
  file that actually would have caught this specific bug).
- Minor / non-blocking: `backend/src/main/scala/com/helio/domain/PipelineStep.scala:30-34`'s doc
  comment still says "10 subtypes" after adding the 11th (`splittext`) — stale but harmless, already
  flagged as pre-existing-doc inaccuracy in design.md's own "Correction" note; worth a one-line fix
  while the file is open.
- Gates independently re-run (not just taken on the executor's word):
  - `npm run check:scala-quality` → clean (0 violations; only pre-existing soft file-size warnings).
  - `npm run lint` → 0 warnings.
  - `npm run format:check` → clean.
  - `npm run check:schemas` → in sync.
  - `npm run check:openspec` → fails exactly as the executor reported, with the exact "complete but
    not archived" message — confirmed this is the *only* hook that would fail pre-commit.
  - `npm test` (frontend) → 821/821 passed.
  - `sbt test` (backend, full suite) → 1195/1195 passed, including migration V50 applying cleanly on
    top of V49.
  - `npm run build` (frontend/vite build) → succeeds.
  - Commit `a3f1c35`'s body correctly documents the `-n` bypass and its justification per
    CONTRIBUTING.md's AI-collaborator rule; confirmed it is the only bypassed commit (single-commit
    branch).
  - All 6 real enumeration sites design.md called out (`Registry`, `PipelineStepProtocol.fromDomain`
    + read/write union, `PipelineStepConfigCodec.extractConfig`/`.encodeConfig`,
    `PipelineStepRepository.rowToDomain`) are correctly wired — verified via diff read, not taken on
    faith.
  - All 4 hand-curated test lists (`PipelineStepSpec`, `PipelineStepConfigCodecSpec`,
    `PipelineStepProtocolSpec`, `InProcessPipelineEngineSpec`) plus the `PipelineStepRoutesSpec`
    route test were all genuinely updated with `splittext`/`SplitTextConfig` entries — verified via
    diff read, not taken on faith.
  - `package.scala`'s type aliases were verified necessary (pre-existing pattern for all 10 other
    kinds; `SplitTextStep`/`SplitTextConfig` are the only two missing before this change) and
    correctly wired — not a sign of something else missed, this part of the executor's self-audit
    was accurate.
  - Migration V50 correctly follows the V31 drop/re-add `pipeline_steps_op_check` template, listing
    all 11 kinds; applies cleanly (confirmed via `sbt test`'s Flyway migration log).
  - Frontend field-type gating (`SplitTextConfig.tsx` filters `analyzeSchema` to `string-body`, wired
    into `StepCard.tsx` passing `analyzeSchema`) is implemented correctly — the code itself is
    correct; it simply never receives working data due to the backend bug above (confirmed live in
    Phase 3).

### Phase 3: UI Review — FAIL
Issues:
- **Happy path is broken end-to-end.** Repro: created a Text/Markdown data source (`content`
  correctly inferred as `string-body`), created a pipeline against it, added a `splittext` step via
  the step picker (the "Split text" menu item is present and functional). On step-card expand /
  pipeline load, the frontend calls `GET /api/pipelines/:id/analyze`, which throws server-side:
  ```
  java.lang.IllegalStateException: PipelineService.toAnalyzeStepResponse: codec returned
  unexpected config type com.helio.domain.steps.SplitTextConfig for op 'splittext'
    at com.helio.services.PipelineService.toAnalyzeStepResponse(PipelineService.scala:194)
  ```
  Response is `500`, one console error logged (`Failed to load resource: ... 500 (Internal Server
  Error) @ /api/pipelines/.../analyze`). The frontend does not crash or blank-screen (degrades
  gracefully to a collapsed step card), but the `SplitTextConfig` field dropdown never receives
  `analyzeSchema` data — opening it shows an **empty listbox** even though the pipeline's source has
  a qualifying `content: string-body` field. This is not an edge case; it reproduces on every fresh
  pipeline with a splittext step and blocks the feature's core interaction.
- No console errors otherwise; layout at 1100px viewport renders correctly with no visual breakage
  (dark theme); reused CSS classes (`filter-combinator`, `limit-config-row`, `compute-field`) render
  as intended.
- Given the blocking defect above, full breakpoint sweep (1440/1100/768/0) and light-theme parity
  were not exhaustively completed — deferred to skeptic / re-verification once the fix lands, since
  the field dropdown can't be meaningfully exercised until analyze() stops 500ing.
- Interactive elements (mode toggle buttons, heading-level input, field `Select`) all have accessible
  names (`aria-label`/`aria-pressed`) — verified via accessibility snapshot.

### Overall: FAIL

### Change Requests
1. Add `SplitTextAnalyzeStepResponse` (mirroring `AggregateAnalyzeStepResponse`) to
   `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala`: the case class, its
   `jsonFormat6` instance, and both the write and read match arms in `analyzeStepResponseFormat`
   (see lines 106-110, 173, 187, 202 for the `aggregate` precedent to mirror exactly).
2. Add the `case Success(cfg: SplitTextConfig) => SplitTextAnalyzeStepResponse(...)` arm to
   `PipelineService.toAnalyzeStepResponse` in
   `backend/src/main/scala/com/helio/services/PipelineService.scala` (currently falls through to the
   `throw` at line 192-195).
3. Add a `splittext` scenario to `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala`
   that seeds a pipeline with a `splittext` step against a `string-body`-bearing source schema and
   asserts `GET /api/pipelines/:id/analyze` returns `200` with the expected output schema — this is
   the test that would have caught the bug and should exist regardless of this fix (route-level,
   not just service-level, coverage of the analyze endpoint per-op).
4. Re-verify live in the browser after the fix: expand a `splittext` step card on a pipeline with a
   `string-body` source field and confirm the field dropdown is populated (not empty) with no
   console errors.
5. Update design.md decision 8's enumeration-site count/list to include the `AnalyzeStepResponse`
   ADT (`PipelineProtocol.scala`) + `PipelineService.toAnalyzeStepResponse` dispatch as a required
   site (in addition to the `package.scala` aliases already noted), so HEL-220/HEL-221 don't
   reintroduce the same gap when following this ticket's documented pattern.

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala:32-33`'s doc comment still says "10
  subtypes" — bump to 11 while the file is open for this change.
