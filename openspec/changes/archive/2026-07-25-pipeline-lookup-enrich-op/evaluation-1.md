## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs are addressed in the backend/protocol/analyze/migration/MCP layers, matching
  design.md's decisions exactly (config shape, single-key match, first-match-wins, null-fill,
  column-collision-favors-reference, descriptive execute-time errors).
- `inferLookup` is a genuinely dedicated `PipelineAnalyzeService.inferOutputSchema` dispatch case
  (`backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala:87`), NOT folded into the
  `"filter" | "limit" | "sort" | "dedupe" | "fillnull" | "union"` identity-passthrough group at
  line 73 — confirmed by direct read, not just the task checkbox.
- `lookupCheckF` is present and correctly chained (after `unionCheckF`) in BOTH `addStep`
  (`PipelineService.scala:294-301`) and `updateStep` (`PipelineService.scala:405-412`).
- Flyway `V72__add_lookup_op.sql` is the correct next-free number (main-side migrations stop at
  V71 on this stacked branch's parent commit; re-derived independently via `ls
  backend/src/main/resources/db/migration | sort`), and the CHECK constraint's re-added value list
  includes every prior op plus `'lookup'`.
- All 25 tasks.md items check out against actual code/tests, not just checkbox claims — spot-checked
  every backend test against its corresponding spec.md scenario (match/no-match/multi-match/
  collision/only-named-columns/missing-and-unresolvable-reference-source, additive-analyze,
  codec round-trip, kind-parity, POST/PATCH cross-user-404) and all assertions match the spec's
  scenario language precisely.
- No scope creep — diff (`ad3fb28c..7564b178`, the correct scoped diff since this branch stacks on
  prior op branches not yet on `main`) touches only the files listed in files-modified.md.
- No regressions: full `sbt test` (1922/1922) and `npm --prefix frontend test` (1360/1360) pass
  fresh, independently re-run (not trusting the commit's self-reported numbers, which match).
- Planning artifacts (proposal/design/tasks/spec.md) accurately reflect the final implementation.

### Phase 2: Code Review — PASS
Issues: none blocking.

- `check:schemas`, `check:scala-quality` (0 new soft-budget warnings — none of the 64 pre-existing
  warnings reference a lookup file), `format:check`, and `lint` (zero-warnings policy) all pass,
  independently re-run.
- `check:openspec` correctly fails with only the expected "complete but not archived" hygiene note
  — confirms the commit's `-n` bypass claim (see Pre-commit hygiene note below).
- DRY / readable / modular: `LookupStep.scala` mirrors `UnionStep.scala`'s resolution shape
  directly, no duplication introduced; naming and scaladoc are clear and reference the specific
  design.md decisions they implement.
- Type safety: no untyped escape hatches; `Vector[String]` columns, tolerant `decode` mirrors
  sibling ops exactly.
- Security: the `lookupCheckF` ACL check closes the cross-tenant gap the ticket flagged — but see
  Phase 3 for a live-verified functional defect in how the check interacts with the frontend's
  default-config creation flow.
- No dead code / no leftover TODOs.
- No inline fully-qualified names (grepped the new/changed files).

### Phase 3: UI Review — FAIL
Issues:

1. **[BLOCKING] Adding a `lookup` step via the "+ Add transformation step" picker silently fails
   and the step never persists** — live-reproduced in the browser (dev_port 5559 / backend_port
   8466) against `union-eval-pipeline`
   (`/pipelines/e3c19110-ab84-4dd5-af84-22f0e8d8bf8a`):
   - Clicking "Lookup / enrich" in the picker fires `handleAddStep`
     (`frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:279-293`), which immediately POSTs
     `defaultConfigFor("lookup")` = `{referenceDataSourceId: "", sourceKey: "", lookupKey: "",
     columns: []}` (`frontend/src/features/pipelines/state/stepNarrowing.ts:194-200`).
   - The backend's `lookupCheckF` in `PipelineService.addStep`
     (`backend/src/main/scala/com/helio/services/PipelineService.scala:294-301`) unconditionally
     calls `dataSourceRepo.findByIdOwned(DataSourceId(""), user)` for ANY `LookupConfig`, which
     resolves to `None` for the empty-string default → `Left(NotFound(...))` → the POST returns
     `404`. Confirmed via the browser network tab: `POST
     /api/pipelines/.../steps => 404 Not Found`.
   - The frontend's catch block (`PipelineDetailPage.tsx:290-292`, "Keep temp step if POST fails")
     leaves a client-side-only temp step displayed with a fake `step-N` id and no user-visible
     error. Any subsequent PATCH (e.g. selecting a reference-source in the picker) 404s too
     (`PATCH /api/pipeline-steps/step-1 => 404`), because there is no real backend row.
   - Reloading the page makes the step disappear entirely — it was never persisted.
   - **Root-cause isolation**: PATCHing a step that already has a real id (seeded outside the
     picker flow, e.g. the pipeline's pre-existing `Union / append rows` step with
     `otherDataSourceId: "A-source3"`) works correctly — `PATCH
     /api/pipeline-steps/725ecf2e-... => 200 OK` when toggling its mode. The defect is isolated
     precisely to the ACL check firing on the picker's own empty-string default at creation time,
     not to `LookupConfig.tsx`'s editor logic or the PATCH mechanics themselves.
   - This directly falsifies the ticket AC "Frontend StepCard renders a working editor; config
     PATCHes round-trip" and spec.md's scenario "Editing the reference-source picker updates the
     step config" (`specs/pipeline-lookup-op/spec.md:106-110`) — that scenario is unreachable via
     the primary UI flow, since the step can never be created in the first place.
   - Note: this exact defect pattern already exists in `unionCheckF` (added by the parent HEL-384
     commit this branch stacks on, same file, lines 285-292) — confirmed by reproducing the
     identical 404 when adding a fresh `Union / append rows` step via the same picker. It is not
     new to this ticket's code, but `lookup`'s Decision 8 (mirroring union's OP_TYPES exposure)
     ships the exact same broken pattern for a brand-new op, and this ticket's own AC/spec claim
     the editor "works" — which, per this live reproduction, it does not on first creation.
   - No user-visible error toast/state is shown when the creation POST fails — a silent failure
     (also flags the Phase-2 "error handling" checklist item: `PipelineDetailPage.tsx:290-292`'s
     bare `catch {}` swallows the failure with only a code comment, no user feedback).

2. `lookup` correctly appears in the `OP_TYPES` add-step picker menu (verified live) — this part of
   the AC is genuinely satisfied; the defect is specifically in what happens after selecting it.

3. No other console errors were observed outside the reproduced 404s above; the pre-existing
   `/schedule` 404 on this pipeline is unrelated (no schedule configured, not caused by this
   change).

Not reached (blocked by the above): full round-trip verification of `sourceKey`/`lookupKey`/
`columns` field editing against a real persisted step, and breakpoint checks — the primary
happy-path (create → edit) never reaches a persisted step via the UI, so these are moot until the
creation-time defect is fixed. The rendered editor markup itself (fields, labels, add/remove
column rows) was visually confirmed present and correctly wired to `analyzeSchema`.

### Overall: FAIL

### Change Requests
1. Fix the creation-time ACL check so a `lookup` step can actually be added via the "+ Add
   transformation step" picker. In `backend/src/main/scala/com/helio/services/PipelineService.scala`,
   guard `lookupCheckF`'s `LookupConfig` arm (both `addStep` line 295 and `updateStep` line 406)
   so an empty `referenceDataSourceId` is treated as "no reference selected yet" (skip the
   ownership check, matching the existing `case _ => Future.successful(Right(()))` fallback) rather
   than "not found" — e.g. `case lc: LookupConfig if lc.referenceDataSourceId.nonEmpty => ...`. This
   is consistent with design.md Decision 1's own philosophy ("an empty `columns` list is a no-op
   enrichment, not an error") extended to the reference-id field, and with Decision 6, which
   already scopes the "missing/invalid reference id" failure to *execute* time (handled correctly
   today by `LookupStep.evaluate`'s `None` case) — the creation-time ACL pre-flight should not
   duplicate that as a hard 404 against the picker's own default seed value.
2. Add a regression test exercising this exact path — a `PipelineStepRoutesSpec` case: "POST with
   lookup type and default/empty `referenceDataSourceId` succeeds (201), with the reference source
   unset" — this exact case was untested (the existing "own reference-source returns 201" test
   only exercises a populated id) and is precisely what the "+ Add transformation step" picker
   sends on every lookup-step creation.
3. Add a user-visible error surface (or at minimum log the failure loudly enough to be caught in
   review) when `handleAddStep`'s POST fails in
   `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:290-292` — silently keeping an
   unpersisted temp step with no error toast let this defect ship past manual review.
4. (Advisory, not blocking this ticket's file scope) `unionCheckF`
   (`PipelineService.scala:285-292`) has the identical defect for the already-existing `union` op
   — flag for a follow-up fix in that op's own lineage, since it wasn't caught during HEL-384's
   review either and shares the same root cause.

### Non-blocking Suggestions
- `frontend/src/features/pipelines/ui/LookupConfig.tsx`'s `columns` row list uses `key={rowIndex}`
  for the add/remove row list — matches `UnpivotConfig.tsx`'s existing precedent, so not a new
  pattern, but worth revisiting codebase-wide at some point (index keys can misbehave on
  reorder/remove-from-middle interactions with focus retention).
