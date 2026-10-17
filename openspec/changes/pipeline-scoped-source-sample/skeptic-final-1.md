## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `faf36fc4b8f9535f8ad81e0d021cbbd4b6b9ab03`. The base was resolved live with `resolve-review-base.sh`: `544bd79ea5879263fc05808ff15bee6cd7d6c430`, 65 files. I was a fresh spawn, the cwd guard printed `READY`, and D1 is judged as editor-only, per C2.

### What I verified (with evidence)

**Security claim: a grant on P allows sampling S only if P uses S.** I read `SourceSampleService.scala` in full. The order of checks is:

1. `findByIdOwned` (caller RLS). The owner path is unchanged.
2. If there is no `pipelineId`, return None.
3. `findByIdShared(P, Some(user))`. The grant-exists check runs under `withUserContext(caller)`.
4. The caller must be the owner, or `findGrantRole` must equal `editor`.
5. `pipelineUses` checks roots plus `secondarySourceIdOf` over every step, through the privileged reads.
6. Only then does `findByIdInternal` run.

Every None is the single `NotFound("Data source not found")`. The engine read after that is the unchanged `Internal` path.

I attacked the "P uses S" rule, since it has no same-owner test. If any write path let a pipeline owner attach a foreign source, an attacker could create their own pipeline Q and sample anyone's source. I checked every write path:
- Root attach goes through `PipelineRootWrites.attachRoot` → `dataSourceRepo.findByIdOwned(dsId, user)`.
- Single-call create is `PipelineRepository.createAction`. Its doc says it takes "already-ACL-checked" pairs, and its caller `findByIdOwned`-checks them.
- Secondary writes all go through `StepReferenceChecks.secondarySourceOwnershipF` with the caller's identity:
  - step create/update/duplicate
  - `PipelineCreateTransaction:124`
  - `DraftSaveService:137` (the new HEL-1629 path)
  - `PatchSetPipelineStepResolvers:259`

The read-side extractor (`PipelineAnalyzeService.secondarySourceIdOf`) and the write-side one (`PipelineStepConfigCodec.secondaryDataSourceId`) cover the same set: join/union/lookup, `SecondaryInput.Source` only, non-empty. So the use-set cannot include a source that the write check never validated.

`pipelines.id` and `resource_permissions.resource_id` are both `TEXT` (V22 and the permissions DDL), and the query is bound through Slick. A malformed id without whitespace therefore matches nothing, rather than raising an error.

**Fresh gate runs (mine):**
- `sbt testOnly` of `SourceScopedSampleRoutesSpec`, `SourceSampleRoutesSpec`, `SourceSampleServiceSpec`, `PipelineAnalyzeCanRunRoutesSpec` and `PipelineAnalyzeRoutesSpec`: exit 0, 57 succeeded, 0 failed. Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1648/skeptic-final-sbt.log`.
  - `SourceScopedSampleRoutesSpec` runs on `TwoUserRlsApiFixture` (NOBYPASSRLS), and all 8 cases passed.
  - For each denial it compares the full tuple (status, body, content type) against B's unknown-id answer and asserts no `secret-` row text. The denials are: unrelated source, no/empty/unknown/malformed `pipelineId`, secondary removed, root removed, revoked grant, viewer, and stranger.
  - Positive cases pass for root, for join/union/lookup secondaries including a third user's source and a disabled step's source, and for the pipeline owner reading a collaborator's secondary. That last case also 404s without the scope.
- The limiter proof uses C's own bucket: 29 scoped requests, then 1 `/preview`, then a 31st request that returns 429 with `Retry-After`. Owner A's request still succeeds afterwards. `pipeline_runs`, `pipeline_run_rate_window` and the `request_count` sum are all unchanged.
- Run guard: `grep PipelineRunService` in `SourceSampleService.scala` matches only doc comments. No logging was added; the two existing log lines are pre-existing.
- Jest (2 workers): 29 suites and 493 tests passed. This covers the `SourceSampleLabel`, `useSourceSamples`, `useSourceSampleAccess`, `usePipelineDetailPage.sourceSamples`, `dataSourceService` and `sourceSampleScoped.contract` (seam) suites, plus the pipeline detail suites. Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1648/skeptic-final-jest.log`. `npm run typecheck` and `eslint --max-warnings=0` on the touched trees both exit 0.

**`callerRole`:**
- It is computed once, as owner, or `findGrantRole` = editor, otherwise viewer, before the config-validity AND. `canRun` is now `callerRole != "viewer"`, which is the same predicate as before.
- The schema adds `callerRole` to `required` with an enum of three values. `helio-mcp` mirrors the type.
- `PipelineAnalyzeCanRunRoutesSpec` validates each response against the committed schema. With a broken step it asserts owner/editor/viewer as `(owner,false)`, `(editor,false)` and `(viewer,false)`.
- There is a single `PipelineAnalyzeResponse(` construction site, so the proposal/concise shapes are unaffected.

**Client:**
- `sampleAccessOf` implements the three-state D6b rules: owner/editor role wins; then a failed list gives unavailable; pending gives unknown; owned gives yes; viewer gives no; a failed analyze gives unavailable.
- `useSourceSamples` sends non-owned ids only when `canSampleShared`.
- The label's refresh dispatches with the label's own `pipelineId` prop. That prop comes from `currentPipeline.id` (header) or `pipelineId` (spine) on the current page, and nothing is remembered per entry. So the refresh is scoped to the current page.

**Live app** (started and asserted through `scripts/concertino`, ports 7080/9987, then stopped: `STOPPED ports=7080,9987`):
- I ran `hel1648-*` plus `hel1628-*` with 1 worker against this HEAD: 4/4 passed, and teardown deleted the 6 throwaway users. Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1648/skeptic-final-e2e.log`.
- The run shows the following:
  - Unscoped requests get 404 and the editor's scoped request gets 200.
  - The viewer's scoped request gets 404, with a body identical to the unscoped one.
  - The editor's label reads `Static · 3 rows` on desktop and phone, in both themes.
  - A refresh sends exactly one request carrying `?pipelineId=P`.
  - The viewer gets zero `/sample` requests and no label.

**Visual judgment.** I looked at the screenshots captured in my run. The persisted copies listed below are the same files: the editor card is the same pixels before and after copying, with sha256 prefix `ff5cd09247d62ec0`.
- `/home/matt/Development/helio/.concertino/runs/HEL-1648/evidence/e2e-evidence/HEL-1648/editor-desktop-dark.png`
- `.../editor-desktop-light.png`
- `.../editor-phone-light.png`
- `.../viewer-desktop-light.png`

The editor's label is the shared `SourceSampleLabel`, using the shared `IconButton` and `ICON_SIZE.sm` with no new CSS. It sits in the same place as the owner's label, has the same muted type, and looks the same in light and dark. The viewer's card collapses cleanly to the name and menu, with no orphaned gap. There are no new tokens and no one-off styles. I found nothing off-pattern.

### Verdict: CONFIRM

Every AC traces to code plus a fresh passing test:
- An editor gets the sample: scoped spec root/secondary cases, and the e2e run.
- A non-grantee or an unrelated source gets a byte-identical 404: the `assertDenied` tuple on NOBYPASSRLS.
- The limiter proof exists, keyed to the caller.
- The schema was extended in the same change and is validated on the server, the client and in the seam test.
- The client hook samples granted sources.

C1, C2 (editor-only) and C3 all hold.

### Non-blocking notes

- C2 still applies: do not deliver until the owner's D1 ruling is recorded.
- Pre-existing, not in this diff: `SourceSampleService.scala:152` logs `e.getMessage` on an encoding failure. This is HEL-1628 code, but an encoder message could contain a cell value. Consider logging the class name only, as line 155 does.
- Pre-existing, not this change: on the viewer's page the header still shows "Run pipeline" and "Dry run". Both the viewer and editor views also show the "source type we don't yet recognize" banner, because the source is not in the caller's own list. These are worth a follow-up ticket, but they are outside HEL-1648.
- Persisting my screenshots overwrote the same-named files under `runs/HEL-1648/evidence/e2e-evidence/HEL-1648/`, which the evaluator had captured earlier from an identical e2e run. Copies of mine are also in `SCRATCH_DIR` as `skeptic-final-*.png`.
- These evaluator nits stand: `ownS` is seeded but never asserted; `canRefresh` could be simplified; `usePipelineDetailPage.ts` and `PipelineDetailHeader.tsx` are over 400 lines.
- A single undecodable step makes `listByPipelineInternal` fail. That denies every secondary on the pipeline, not just the bad step's. It fails closed and is acceptable.
