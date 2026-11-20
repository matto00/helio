## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `19cfc7384c5fe2035c8feab13c6d518299d8038b` against base `31094b15440b7016e4bfac7f1e5fb7631d22a414`
(resolved live with `resolve-review-base.sh`). The diff is backend-only plus openspec artifacts. No `frontend/**`, `schemas/**`,
`openspec/specs/**` or `ApiRoutes.scala` changes.

### Phase 1: Spec Review — FAIL

The ACs are met. FAIL is for planning-artifact drift only (see the Change Requests).

- AC1 (step create): `PipelineStepWriteChecks.checkAdd` holds type, raw config, decode, access/editor, secondary ownership,
  lane (ancestor/descendant via the same `resolveCreateAnchor` anchor), upsert target, placement and `rejectIfReparents`.
  `addStepReporting` calls it (PipelineStepCreate.scala:28) and so does `resolvePipelineStepCreate`. Errors carry the
  `edit N: ` prefix (`prefixedWithEdit`, which now also handles `Forbidden`). PASS.
- AC2 (step update): `checkUpdate` is called by `updateStep` (PipelineStepWrites.scala:36) and the resolver. The inventory
  (section 2) lists every check with a dry-run or apply-only classification and a reason. PASS.
- AC3 (data sources): `resolveDataSourceCreate` calls `validateStatic(req, DatasetMaxRows)`. The new `validateUpdate` is called
  first by `DataSourceService.update` and by the resolver. PASS.
- AC4 (roots-only create): the inline-root dry run runs at preview (`ctx.chargeFetches`). AC4 is preview-scoped, so it is met. PASS.
- AC5 (parity, red, mutation, apply unchanged):
  - The parity spec is unchanged since the red commit `fd65407b2` (`git diff fd65407b2 HEAD` on the spec is empty).
  - The red log shows 41 of 57 failing on main. The mutation logs M1 to M7 show 19/11/6/2/5/2/10 red, which matches `mutations.md`.
  - The harness runs on the non-BYPASSRLS `helio_app_test` role, as design D9 requires (PatchSetPreviewWriteParitySpec.scala:96-110).
- Apply-visible shifts, judged against AC5 and C9:
  1. HEL-1265 upsert refusal: apply now refuses at resolve with `422 edit 1: ...`. Before, it reported the failure in a 200
     response and rolled back the earlier edit. The same input is refused, earlier, before any write. The test still checks
     that nothing was renamed and no step was created. Acceptable.
  2. Stale and lane-cyclic: `PatchSetApplyService.apply` runs `resolveAll` before `staleTargets` (PatchSetApplyService.scala:87-91),
     so the resolve-time lane 400 now wins over the 409. The edit is still refused and nothing changes. Acceptable. The rewritten
     test now pins the new precedence, and the old precedence no longer exists to test, so this is not a weakened assertion.
  3. Preview wording and precedence: preview now uses the service's own messages and order. The inputs refused are the same set.
     Acceptable.
- D7 (same-set graph edits): it skips only lane, placement and re-parent checks, and only when an earlier edit touched the
  pipeline. I looked for a non-graph check that an earlier edit could turn from reject to accept; I found none:
  - `$ref` substitution covers only panel `outputId`.
  - Pipeline update changes only the name.
  - `pipelines.id` is TEXT, so a differently-cased id cannot alias the same pipeline.
  - The two D7 sets apply end to end and stay green.
- No scope creep. Undo files are untouched (C8). No migration.
- Edited existing specs: Grant (exact `Forbidden("edit 0: Forbidden")`), ApplyService, StaleCheck, Deferral (1 to 2 reads, which
  design D1 accepts), ExistenceNotLeaked (counts, with a classification for each) and OutputContext (derived field). Each change
  is a real expectation move. None of them weakens an assertion.
- Issue (artifact drift): `design.md` D5 still says the roots-only resolver "runs `rootSchemas()`" whenever preflight returns
  `Right(None)`, with charging gated on `chargeFetches`. The implementation runs the dry run ONLY when `ctx.chargeFetches`
  (preview). Apply skips it (PatchSetPipelineResolvers.scala:163). The deviation is recorded in `findings.md` and
  `check-inventory.md`, but the decision record that gets archived still describes behaviour that did not ship.
- Issue (inventory gap): `resolvePipelineStepUpdate` now checks patch presence BEFORE step existence/visibility
  (PatchSetPipelineStepResolvers.scala:45-48). A missing patch on an unknown or invisible step is now 400; before it was 404.
  This does not leak anything: the 400 does not depend on whether the step exists. But it is a precedence flip, and
  `check-inventory.md` section 6 does not list it, although it lists the matching data-source flip.

### Phase 2: Code Review — PASS

Gates, run fresh by me:
- `cd backend && sbt testFull` in 10 shards (`HELIO_TEST_SHARD_INDEX=0..9`, `HELIO_TEST_SHARD_COUNT=10`), with
  `SBT_OPTS=-J-Xmx3g`, `nice -n 19` and `ANTHROPIC_API_KEY` empty.
- Every shard exited 0 with `[hel1468-guard] failed=0 aborted=0`. Totals: 10,144 tests succeeded, 0 failed, 5 canceled
  (pre-existing assumption cancels).
- Confirmed present in the run: PatchSetPreviewWriteParitySpec (57 tests), PatchSetStaleCheckRoutesSpec, PatchSetApplyServiceSpec,
  PatchSetPipelineStepGrantSpec, StepReferenceCheckDeferralSpec, ExistenceNotLeakedRoutesSpec, PatchSetInlineRootRollbackSpec,
  and every PatchSetUndo* spec. This covers the whole `api.*` package, not just the two specs the executor re-ran.
- Logs: `/home/matt/Development/helio/.concertino/scratch/HEL-1722/eval-shard{0..9}.log`.
- `npm run check:scala-quality`: clean. The new parity spec gets a soft-budget warning at 412 lines, alongside 285 pre-existing ones.
- `check:openspec` and `check:spec-structure`: clean.

Review:
- The refactor preserves behaviour. `checkAdd` and `checkUpdate` are line-for-line moves of the old bodies, with the same
  messages and the same order.
- The new `rejectIfReparents` pre-check uses the repository's own `ReparentRejected` message, with the ids sorted. The repository
  keeps its own check under the lock, and that check stays authoritative.
- The duplicate resolver copies were deleted, so this is DRY. `prefixedWithEdit` is now shared in one place.
- No mechanical CONTRIBUTING violation that this diff introduces (imports at the top, no inline FQNs). A pre-existing uncommented
  `findByIdInternal` call moved; see the suggestions.

### Phase 3: UI Review — N/A
No UI-trigger paths changed.

### Overall: FAIL

### Change Requests
1. `openspec/changes/patchset-preview-step-datasource-checks/design.md` D5: amend the decision to what shipped. The roots-only
   inline-root dry run runs at PREVIEW only (`ctx.chargeFetches`). Apply skips it at resolve and keeps the inline-root checks
   inside `PipelineService.create`'s forward write. Give the reason already recorded in `check-inventory.md`: a second live
   rest/sql fetch per apply, and apply services built without a `SourceService` would become `unavailable`. State that this is
   C9-conservative.
2. `openspec/changes/patchset-preview-step-datasource-checks/check-inventory.md` section 6 "Precedence flips": add the step-update
   flip. A `pipelineStep` update with no patch is now `400 edit N: patch is required for a pipelineStep update` before the step's
   existence and visibility are checked (was 404 for an unknown or invisible step). Note that it is preview and apply alike, and
   that it does not depend on whether the step exists.

### Non-blocking Suggestions
- `PatchSetPipelineStepResolvers.resolvePipelineStepUpdate` calls `ctx.pipelineStepRepo.findByIdInternal(stepId)` only to choose
  `GraphChecks`, and `checkUpdate` then repeats the same lookup. CONTRIBUTING's ACL triad requires a safety comment on every
  `findByIdInternal` call site. Add one saying the result only keys the D7 skip and the visibility masking happens in `checkUpdate`,
  or have `checkUpdate` take a `PipelineStep => GraphChecks` so the step is read once.
- `PipelineStepWriteChecks.fromRepos` builds `PipelineServiceSupport(..., null)` (PipelineStepWriteChecks.scala:179). Add a
  one-line comment that the checks never audit, so the audit service is never touched.
- `checkAdd` with a lane secondary input now reads the step list twice before `persistNewStep`'s own read (`laneScopeF` and then
  `placementCheck`). One shared read for both would hold design D1's "one extra read" for lane creates too.
