## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Owner ruling 1 (surface on BOTH toast AND pipeline page):** confirmed. `design.md` D3 (toast) and D5
  (`PipelineDetailFooter.tsx` denial block) both implement this; `specs/run-to-update-affordance/spec.md`
  has separate ADDED Requirements for each surface.
- **Owner ruling 2 (extend `RowWriteResponse`, not a separate read):** confirmed. `design.md` D1 folds
  `EvaluatedPipeline` results into `RowWriteResult`/`RowWriteResponse`; `specs/dataset-write-auto-run/spec.md`'s
  MODIFIED requirement states the write response itself must carry the denial data.
- **Owner ruling 3 (server-computed `canRun`, reason visible to any viewer):** confirmed for the
  `pipeline-analyze-api` surface — `PipelineService.analyze` uses `findByIdShared` (viewer-visible) at
  `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:925`, and `canRun` is a new,
  distinct field (task 1.6) computed via the owner-or-editor check, matching `PipelineRunService.submit`'s
  own ACL (`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:226-229`,
  `:579-580`). See Change Request 1 below for where this ruling's "visible to any viewer" framing breaks
  down on the *write* surface, which has no equivalent viewer-grant check at all.
- **`AutoRunTriggerService.triggerAutoRun` really returns `Future[Unit]`, fire-and-forget today:**
  confirmed — `backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala:48-51`,
  called via `DataSourceService`'s private `triggerAutoRun` helper
  (`DataSourceService.scala:80-84`) which itself discards the result with `.recover`. Denial is logged and
  discarded exactly as `design.md`'s Context claims (`AutoRunTriggerService.scala:74-83`).
- **`PipelineCostEstimator` really produces the ten reason codes `design.md` D6 lists:** confirmed by
  grep of `PipelineCostEstimator.scala` — `no-roots`, `row-estimate-unavailable`, `rows-above-threshold`,
  `steps-above-bound`, `ai-step`, `writeback-step`, `content-conversion`, `unclassified-op`, `remote-fetch`,
  `unclassified-source` — exactly ten distinct codes, matching both `design.md` D6 and the
  `pipeline-analyze-api` spec delta's enumeration.
- **`schemas/sources/row-write-response.schema.json` really has `additionalProperties: false` today:**
  confirmed (file read in full). Confirmed shared by both `POST`/`PUT /api/data-sources/:id/rows` and,
  transitively, `POST /api/panels/:id/submit` (`RowWriteResult` is used by `appendRows`, `appendFormRow`,
  and `replaceRows` alike in `DataSourceService.scala:780,810,837`).
- **Toast system (D3/D4/D6 reliance):** confirmed in `toastsSlice.ts` — `isEvictionExempt` exempts
  `duration === 0` or `action !== undefined` (lines 45-52); `pushToast`'s reducer coalesces identical
  `variant`+`message` pairs by dropping-and-re-pushing (lines 68-75), which is what makes D4's "ten
  clicks, one toast" claim true without new code. Confirmed in `Toast.tsx` that `variant: "warning"`
  routes to the polite (`aria-live="polite"`) live region, not assertive (lines 124-130), matching D3's
  stated rationale. `CostVerdictResponse` today is `jsonFormat4` (no `canRun`) — confirmed at
  `PipelineAnalyzeProtocol.scala:233-238,417` — matching the claim that `canRun` doesn't exist on the wire
  yet.
- **`PipelineDetailFooter.tsx` currently renders no `costVerdict`/`reasons`, and its "Dry run"/"Run
  pipeline" buttons are unconditional:** confirmed by grep (only "Dry run"/"Run pipeline" strings and an
  explanatory comment at line 14 that they "stay plain, always-visible buttons").
- **Standing Constraints carryover:** all 12 `[C1]`–`[C12]` bullets in `tasks.md` have a matching entry in
  `workflow-state.md`'s `CONSTRAINTS` array — carryover check should pass.
- **Task ordering:** Backend (1.x) → Frontend (2.x) → Tests (3.x), no interleaving, as required.

### Verdict: REFUTE

The wire-shape/permission/dual-surface architecture is sound and unusually well-grounded — every
citation I spot-checked against the live tree was accurate, which is not something I can say for every
design doc. But I found two specific, unaddressed gaps that should be resolved before execution starts,
not discovered mid-implementation or waved through at final review.

### Change Requests

1. **Cross-tenant information disclosure on the write path is new, unbounded, and undiscussed.**
   `AutoRunTriggerService`'s own doc comment (`AutoRunTriggerService.scala:22-26`) and
   `PipelineRootRepository.listPipelineIdsForDataSourceInternal`'s doc comment
   (`PipelineRootRepository.scala:62-68`) both establish that a downstream pipeline reading a data source
   "may be owned by a DIFFERENT user" than the writer — a pipeline root's data source need only have been
   owned by whoever *added* that root (an editor grantee "in the general case"), which can drift from the
   writer's own current grant on that pipeline. Today, none of this is exposed anywhere: the denial is
   logged server-side only, and I found no existing API (`grep` for `listPipelineIdsForDataSource`,
   `downstreamPipelines`, `consumingPipelines` under `backend/src/main/scala/com/helio/{api,services}`
   returns only `AutoRunTriggerService.scala` itself) that lets a data-source writer discover which
   pipelines, owned by whom, read their data.

   `design.md` D1's `EvaluatedPipeline.denied(pipelineId, name, reasons, canRun)` and the
   `dataset-write-auto-run` spec delta's scenario "A denied pipeline the writer cannot run still reports
   its reason" together mean: **any user who can write to a shared dataset source now learns the name of
   every downstream pipeline that denied, and the full rule-specific reason text (including internal step
   ids/op names, e.g. "Step 'stepXYZ' uses AI op 'GenerateText'") — even when that writer holds zero grant
   on the pipeline at all.** `canRun` only gates the *action button*; it gates none of this disclosure.

   Owner ruling 3's "deny reason text itself is visible to any viewer" reads naturally for the
   `pipeline-analyze-api` surface, where `findByIdShared` already requires the requester to be a viewer,
   editor, or owner grantee before any of this is returned — i.e., "any viewer" presupposes an existing
   grant. The write-path surface has no equivalent check at all; "viewer" doesn't apply because the writer
   is not a grantee of the pipeline in any sense the system currently models. This is a materially
   different exposure than what the owner ruled on, and `design.md` doesn't note the distinction or ask for
   it explicitly. Resolve one of:
   - Redact pipeline name/detailed reasons in the write response when the writer holds no grant at all on
     the denied pipeline (distinguish "no grant" from "viewer/editor/owner" — a generic "N downstream
     pipeline(s) could not auto-run" suffices for AC purposes, since the AC's "names the specific rule"
     requirement is naturally satisfiable once *some* grant exists), or
   - Take this specific question back to the owner rather than resolving it by omission — it's a real,
     previously-unconsidered scope question the escalation didn't cover.

2. **`replaceRows` shares the exact write-response wire type and trigger helper but is silently excluded
   from scope, with no documented rationale.** `DataSourceService.replaceRows`
   (`DataSourceService.scala:837-856`) calls the identical private `triggerAutoRun` helper
   (`DataSourceService.scala:80-84`) and returns the identical `RowWriteResult`/`RowWriteResponse`
   type as `appendRows`/`appendFormRow` — `DataSourceRoutes.scala:164` wires `PUT
   /api/data-sources/:id/rows` through `RowWriteResponse.fromDomain`, the same conversion function
   `POST` uses. `design.md` D1 and `tasks.md` 1.3 only await/fold denied entries for
   `appendFormRow`/`appendRows`; `replaceRows` is never mentioned in `design.md`, `proposal.md`'s Impact
   section, or `tasks.md`. Left as-is, a `PUT`-replace write that genuinely denies a downstream pipeline
   will silently report `deniedPipelines: []` (or omit the field/default it) on a schema that, post-change,
   is capable of representing the denial — reproducing exactly the "does nothing visible" bug this ticket
   exists to fix, just on one of the three call sites sharing the identical helper and wire type instead of
   two. The `dataset-write-auto-run` spec delta's MODIFIED requirement text ("The write response SHALL
   include...") doesn't scope itself to append-only either, so the spec delta and the task breakdown
   disagree with each other on this point right now. Since `replaceRows` is presently unreached by any
   frontend caller (`grep` for `replaceSourceRows` outside `dataSourceService.ts` and tests returns
   nothing — it appears to be an API/agent-native-only capability today), this doesn't need to block on
   product urgency, but the design needs to explicitly decide and document one of:
   - Extend task 1.3 to also await `triggerAutoRun` in `replaceRows` (trivial given the shared helper —
     symmetric with the other two call sites), or
   - Explicitly scope the `dataset-write-auto-run` MODIFIED requirement text and `design.md`'s Non-Goals to
     append-only writes, with the "unreached via UI today" fact stated as the rationale, so a future
     `replaceRows` caller doesn't inherit a silent regression of this ticket's own fix.

### Non-blocking notes

- The a11y requirement (C4) for the *pipeline page* denial block isn't detailed in `design.md` beyond
  "reuse the same copy module" — for the toast this is inherited for free from the existing
  `ToastViewport` live-region pattern (verified), but the pipeline-page block's accessible-name/description
  wiring is left to the executor's judgment. Not blocking (ordinary static text is normally in the
  accessibility tree without extra ARIA), but worth the executor treating `costVerdict.canRun`'s absence
  from a button as more than just "don't render the button" — confirm no orphaned/disabled control is left
  in a confusing state for AT users.
- `design.md` D2's latency-measurement instruction is scoped only to `appendFormRow`/`appendRows`'s
  existing 5-pipeline fixture; if Change Request 2 is resolved by extending to `replaceRows`, the
  measurement task (3.4) should note whether replace-path latency was also measured, for consistency.
