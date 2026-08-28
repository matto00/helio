# Tasks — HEL-860

Ordered deliberately: section 1 discharges HEL-859's inherited coverage debt on the multi-failure join
**before** section 3 composes new behaviour through it (ticket requirement, not a preference).

## 1. Close HEL-859's analyze-surface coverage debt (do this first)

- [x] 1.1 Re-derive the uncovered validator set by enumeration: diff `a8ea26ae`'s added validators against
      its added test names. Confirm it is exactly `validateAggregate`, `validateGroupBy`, `validatePivot`,
      `validateUnion`, `validateJoin` (design Decision 4). If the tree disagrees, correct the plan inline
      and say so — do not silently proceed on the assumed five.
- [x] 1.2 In `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala`, add
      route-level coverage (`GET /api/pipelines/:id/analyze`) for each of the five, asserting the response
      JSON's `validationError` names the offending value and lists the supported values. AC6 requires the
      real analyze surface; unit-level tests alone do not satisfy it.
- [x] 1.3 Add route-level coverage for `validateStepConfig`'s multi-failure join at
      `PipelineAnalyzeService.scala:126` (NOT the second `problems.mkString("; ")` at line 619, which is
      `inferAssert`'s own join): one step with two
      independent failures, asserting the single `validationError` contains **both** messages. This is the
      contract section 3 composes through.
- [x] 1.4 For `groupby` and `join`, assert only the invalid-enum path, with an inline comment recording that
      the valid-config path is unassertable because neither kind has an `inferOutputSchema` dispatch case
      (design Decision 7a). Do not "fix" that here.

## 2. Prove the raw-config-string contract (AC7)

- [x] 2.1 Add a route-level test against **`POST /api/pipelines/analyze-proposal`** (existing spec:
      `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala`):
      for a raw `casts` value that `CastConfig.decode` reduces to `Map.empty`, assert
      `CastConfig.decode(raw).casts.isEmpty` **and** that the proposal-analyze response carries a non-empty
      `validationError` for that step. This is the only surface where the contract holds — proposal step
      config is passed through as `req.config.compactPrint`, un-round-tripped.
- [x] 2.1a Add the complementary **negative** test proving why the write-path fix is necessary: a persisted
      step with the same mistyped config produces **no** `validationError` from
      `GET /api/pipelines/:id/analyze`, because `PipelineService.analyze` re-encodes from the tolerantly
      decoded step. Do NOT assert a `validationError` there — it will not appear, and chasing one is the
      trap that consumed design-gate round 2 (design Decision 5).
      **Seeding is load-bearing and must not be shortcut.** Every `PipelineStepRepository` write seam
      (`insert:66`, `insertInternal:162`, `insertAtInternal:214`) takes a **typed** config and calls
      `encodeConfig`, so `insert(pid, "cast", CastConfig(Map.empty), user)` would store `{"casts":{}}` — a
      config that was never mistyped — and the test would assert nothing. After section 3, the HTTP route
      cannot create such a row either. Therefore: seed with a raw `sqlu"INSERT INTO pipeline_steps ..."`
      carrying the literal text `{"casts":[{"field":"x","to":"float"}]}` (the same raw-insert mechanism
      `PipelineAnalyzeRoutesSpec.scala:73-95` already uses for `data_sources`/`data_types`/`pipelines`), and
      **assert the stored raw text is that mistyped shape BEFORE** asserting the analyze response carries no
      `validationError`. Without that pre-assertion the negative is unbound and vacuous (standing
      requirement 3).
- [x] 2.2 If the 2.1 assertion cannot be made to hold **on the proposal surface**, stop and escalate — do
      not weaken it and do not relocate it to another surface. The ticket makes this contract load-bearing,
      and it has already been relocated once in error.

## 3. Strict write-path rejection for `cast` and `rename`

- [x] 3.1 Add `def validateRawConfig(raw: String): Option[String] = None` to `PipelineStep.Companion`
      (`backend/src/main/scala/com/helio/domain/model/PipelineStep.scala`), with a scaladoc contrasting it
      against `decodeConfig`'s mandatory read-path tolerance. The default keeps the other 21 anonymous
      companions compiling untouched.
- [x] 3.2 Add `requireStringMap(obj: JsObject, key: String, kind: String): Option[String]` to `StepCodecUtil`
      — note the `JsObject` first parameter, so each `validateRawConfig(raw: String)` override calls
      `StepCodecUtil.asObject(raw)` first rather than inventing a second signature. Reusing `asObject` also
      means a non-object top-level config is treated as "key absent → accept" instead of throwing a 500
      (`backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala`), returning a message that names
      the offending key **and** the expected shape. Reject a present-but-unrepresentable value (non-object,
      or object with any non-string value); accept an absent key (design Decision 3).
- [x] 3.3 Override `validateRawConfig` in `CastStep.companion` (`casts`) and `RenameStep.companion`
      (`renames`). Leave both `*Config.decode` methods **byte-for-byte unchanged** (AC3).
- [x] 3.4 In `PipelineService.addStep`, call `validateRawConfig` on the raw supplied config before the
      existing `PipelineStepConfigCodec.decode` call; on `Some(msg)` return
      `ServiceError.UnprocessableEntity(msg)`. Keep the `PipelineStepKind.All` unknown-type 400 check first.
- [x] 3.5 Apply the identical change in `PipelineService.updateStep`'s config-change branch.

## 4. Tests for the rejection path (AC1, AC2, AC5)

- [x] 4.1 In `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala`, assert
      `POST /api/pipelines/:id/steps` returns **422** for a list-shaped `casts`, that the message names
      `casts` and the expected shape, and that **no step was created** (re-list the pipeline's steps).
- [x] 4.2 Same for a `casts` object with non-string values.
- [x] 4.3 Same for a list-shaped `renames`.
- [x] 4.4 Assert a correctly-shaped `cast` config still returns 201 and stores the supplied mapping
      (not an empty map), and that `{}` is still accepted.
- [x] 4.5 Assert `PATCH /api/pipeline-steps/:id` returns 422 for a mistyped config and leaves the stored
      config unchanged.
- [x] 4.6 Assert a legacy-shaped stored row still decodes unchanged through the read path (AC3, no
      migration regression).

## 5. Sweep, evidence, verification

- [x] 5.1 Re-run the sweep by enumerating the `decode(raw: String)` body of **all** files in
      `backend/src/main/scala/com/helio/domain/steps/`. Record in the PR: the exact command, its **raw
      unabridged output for all files**, and a classification of every hit. Do not report a confirmation of
      an expected count — the previous "exactly two files" claim was false and was refuted at the design
      gate (design Decision 6). Hits this change does not fix are recorded as known-remaining.
- [x] 5.1a DONE — filed as HEL-871 (HEL-870 was a same-minute duplicate, now canceled and marked duplicate-of HEL-871; executor has no Linear tool by design). File a follow-up ticket for the systemic gap: no step kind has a strict write-path config check,
      with `GroupByStep` (`{"groupBy":"region"}` silently collapsing all rows into one group;
      `stringOr(obj,"aggFunction","sum")` silently substituting an aggregation) called out as the
      highest-severity instance. Link it to HEL-860 and record the id in the PR.
- [x] 5.2 Re-check every acceptance criterion against the tree; correct any staleness inline rather than
      escalating (standing requirement 4).
- [x] 5.3 Audit design.md and proposal.md against the final code: every sentence claiming something is
      unchanged, preserved, or already handled must be re-verified (standing requirement 2).
- [x] 5.4 Capture red-on-revert evidence by reverting the **source** change and re-running the **final
      committed** tests, showing they fail. If any test changes after capture, recapture — stale evidence is
      not evidence (standing requirement 1).
- [x] 5.5 Verify the 422 reaches the caller surface with a readable message, not merely that a function
      returns a `Left` (standing requirement 3).
- [x] 5.6 Run `sbt test` and the frontend gates; ensure pre-commit hooks pass.
- [x] 5.7 Write `files-modified.md` with exactly **one full path per `-` bullet** (`squash-branch.sh` parses
      only the first backtick-quoted path per bullet; path shorthand on continuation lines blocked HEL-859's
      squash twice).
