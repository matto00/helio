## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `877169c712d291d4b56616a76521621cede5e940` against base `544bd79ea5879263fc05808ff15bee6cd7d6c430`
(the base was resolved live with `resolve-review-base.sh`). D1 is still an open owner escalation, so the change is
evaluated as editor-only (C2).

### Fresh gate runs (evaluator's own, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| frontend typecheck, `helio-mcp` typecheck | exit 0 |
| `npm test` (2 workers) | exit 0: root 61 suites / 524 tests, frontend 714 suites / 8,992 tests |
| `npm --prefix frontend run build` | exit 0 |
| `sbt testFull` (flocked, nice 19) | exit 0: 9,199 succeeded, 0 failed, 4 canceled (all four are measurement-gated `HELIO_MEASURE` cases). All 7 `SourceScopedSampleRoutesSpec` cases and the new `PipelineAnalyzeCanRunRoutesSpec` callerRole case ran and passed |
| `check:scala-quality`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths` | clean |
| Playwright `hel1648-*` and `hel1628-*` (1 worker, running app 7080/9987) | 4/4 passed; global teardown deleted 6 users |

Logs: `.../evidence/.concertino/scratch/HEL-1648/eval-npm-test.log`, `eval-e2e.log` (persisted). The sbt log is
`/home/matt/Development/helio/.concertino/scratch/HEL-1648/eval-sbt-testFull.log`.

### Phase 1: Spec Review — FAIL

- All ticket ACs are addressed: editor grantee 200, byte-identical 404s, limiter proof, schema extended in the same change (`callerRole`), and the client hook samples granted sources. Tasks are all ticked and match the diff.
- No scope creep. The owner path is unchanged. `canRun` is equivalent to before: `callerRole != "viewer"` is the same as owner-or-editor.
- Constraints C1 (dataset sources, status/body/content-type equality), C2 (editor-only) and C3 (no row logging, no `PipelineRunService`) are all honoured.
- **Issue (spec divergence):** `specs/source-sample-api/spec.md:13` says a non-owner of the source is served "only when ... the caller holds an `editor` grant on that pipeline". The implementation (`SourceSampleService.scala:84-86`), design D3 step 4 and the CLAUDE.md entry all also admit **the pipeline's owner** sampling a source they do not own (for example an editor's own source attached as a secondary). That behaviour is consistent with the run path, but the normative spec does not describe it, and no test exercises it. See CR 4.

### Phase 2: Code Review — FAIL

The security core verified clean, with my own evidence:

- **Check order.** `findByIdOwned` (caller RLS) runs first. Then `findByIdShared(P, Some(user))` proves the grant under the caller's `withUserContext`, then owner-or-`findGrantRole == editor`, then uses-check. `findByIdInternal` runs only after all of that. No branch reads the source before the check.
- **Byte-identical 404s, measured on the live stack** (md5 of the full header block minus `Date`, plus the body). These cases all hashed identically to an unknown id's (`404`, `application/json`, `{"message":"Data source not found"}`): unrelated source, no `pipelineId`, `pipelineId=not-a-uuid`, `pipelineId=%00`, malformed source id, viewer grant, source removed as a secondary (owner deleted the join step), and revoked grant (`DELETE .../permissions/:id`). The root and join secondary returned 200 before removal and revocation.
- **NOBYPASSRLS spec.** `SourceScopedSampleRoutesSpec` on `TwoUserRlsApiFixture` covers every negative the ticket names. The executor's mutation logs are genuinely red: dropping the role check turns "viewer" red, and dropping the uses check turns "unrelated source" and "undecodable legacy step" red.
- **Plausibility filter instead of UUID parse.** This is safe: `pipelines.id` is `TEXT` (`V22__pipelines.sql:2`), so a non-UUID value is a harmless no-match lookup. The NUL and control characters that would make Postgres raise are filtered out. A pipeline id over about 4k characters returns `414` from the HTTP server's URI limit, which every route shares, so it is not an oracle.
- **Defaulted-null `pipelineRepo`/`pipelineStepRepo`.** There is exactly one production construction (`ApiRoutes.scala:403`), and it passes both. If either were null, the `case _ => Future.successful(None)` arm denies, which means fail-closed and never a skipped check. Not a security issue (see suggestions).
- **Planting a source.** Live, an editor cannot get a foreign source into P. Adding a join on the owner's unrelated source, adding it as a root, and PATCHing the join step to it all return 404 (`secondarySourceOwnershipF` / root checks). Every step-write path (`StepReferenceChecks`, `PipelineCreateTransaction`, `DraftSaveService`, `PatchSetPipelineStepResolvers`) calls the writer-identity ownership check, which is the premise of D3's "no same-owner rule".
- **Logging.** The new code adds no log lines. The backend log contained zero occurrences of the seeded `secret-eval*` cell values after the live run.
- **Run guard.** No `PipelineRunService` or guard reference in the sample path. The limiter proof asserts that `pipeline_runs` and `pipeline_run_rate_window` are unchanged.
- **`usePipelineDetailPage.analyze.test` viewer fixture: no hidden regression.** I checked this in a throwaway detached worktree (removed afterwards):
  - Switching the fixture to `"owner"` gives 8/9/11 renders, against the pinned 7/8/10.
  - With the real `sourceSamples` reducer and the root source **owned** (a realistic owner page), `"owner"` and `"viewer"` both give the pinned 7/8/10.
  - So the +1 only appears when a non-owned source is captured through the scope, which is the intended editor capture. An owner's page is unaffected. The fixture comment ("A viewer samples nothing...") is accurate but terse.
- **hel1628 matcher `(\?.*)?$`.** This is correct and necessary, because every request now carries `?pipelineId=`, owners included (the server ignores it for owners). The "captures once on open" e2e still passes, so the second dispatch after analyze answers is deduplicated by the thunk `condition`.

Issues:

1. **[mechanical] CONTRIBUTING.md, Backend: "repositories and services accept value-class IDs only — never raw `String`".** `SourceSampleService.sample(..., pipelineId: Option[String])` (`SourceSampleService.scala:115-118`) takes a raw string and wraps it at `:75`. The route boundary is `DataSourcePreviewRoutes.scala:79`.
2. **[mechanical] CONTRIBUTING.md ACL triad: "`findByIdInternal` — every callsite MUST have a comment explaining why it is safe to bypass ACL".** The new callsite at `SourceSampleService.scala:92` has no callsite comment. Only the class doc (`:35`) mentions it.
3. **Tests meaningful.** In `SourceScopedSampleRoutesSpec.scala:133` the lookup secondary is seeded as **userB's own** source (`seedDataset(userB, "lookup-src-of-editor")`). B's request is therefore served by the owner path (`findByIdOwned`) and never reaches the scoped branch. The `lookup` arm of the uses-check is unproven: a regression in lookup secondary detection would leave this test green. Join and union are proven.

### Phase 3: UI Review — PASS

I checked this myself on the running app (canonical `start-servers.sh`, then `stop-servers.sh` afterwards), with throwaway owner/editor/viewer users that I deleted by exact id via `buildUserDeleteSql` (all three sessions return 401 afterwards):

- **Editor, desktop 1440, dark and light:** the source card reads "Static · 2 rows" with "Refresh sample of evalroot" (a focusable `<button>`, `tabIndex` 0, accessible name). Exactly one network request was sent, `GET /api/data-sources/<root>/sample?pipelineId=<P>`, and it returned 200.
- **Editor at 1100 / 768 / 360 (phone chip):** the label renders, `scrollWidth` equals the viewport at every width (no overflow), and phone dark shows the chip label.
- **Viewer, desktop dark and light, and phone:** zero `.source-sample-label` elements and zero `/sample` requests. The card shows only the source name.
- **Console:** the only error is `GET /api/pipelines/:id/schedule` 404 (no schedule set), which happens on base too and is unrelated.
- **The executor's screenshots look right on inspection:** editor desktop/phone in both themes show the label, viewer shows none, and the repro shows "Sample unavailable". Their file mtimes are all 14:05 (a copy/relocation), so I rely on content and on my own captures, not on ordering.

Evidence (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1648/evidence/.concertino/scratch/HEL-1648/eval-editor-desktop-dark.png`, `eval-editor-desktop-light.png`, `eval-editor-768-light.png`, `eval-editor-phone-dark.png`, `eval-viewer-desktop-dark.png`, `eval-viewer-desktop-light.png`.

### Overall: FAIL

### Change Requests

1. **`DataSourcePreviewRoutes.scala:79` / `SourceSampleService.scala:75,115-118`:** parse at the route boundary. Use `parameter("pipelineId".optional)` and map it with `_.filter(SourceSampleService.isPlausiblePipelineId).map(PipelineId(_))`. Change `sample(id, user, pipelineId: Option[PipelineId] = None)` and drop the string filter from `authorized`. Every empty or implausible value still becomes `None`, so the same 404 is preserved. The existing negatives in `SourceScopedSampleRoutesSpec` must stay green unchanged.
2. **`SourceSampleService.scala:92`:** add a callsite comment on `dataSourceRepo.findByIdInternal(id)` stating why bypassing ACL is safe here. The comment should say that the grant was proved under the caller's RLS (`findByIdShared`), the role is owner or editor, and P uses S.
3. **`SourceScopedSampleRoutesSpec.scala:133`:** seed the lookup secondary as `userA`'s (or `userC`'s) source so B's 200 goes through the scoped branch. Re-run the drop-uses-check mutation and confirm it still turns red, or add a lookup-specific red.
4. **`specs/source-sample-api/spec.md:12-15`:** state the implemented rule, which is that a non-owner of the source is served when they are **P's owner or hold an `editor` grant** on P and P uses S. Add a scenario "Pipeline owner samples a collaborator's secondary", and cover it in `SourceScopedSampleRoutesSpec`. The spec can keep a `userB`-owned lookup source for this: request it as `userA` with `?pipelineId=P` and expect 200 via the scoped path.

### Non-blocking Suggestions

- Make `pipelineRepo`/`pipelineStepRepo` required constructor params instead of `= null` defaults. Only `SourceSampleServiceSpec.scala:66,126` would need updating. A forgotten wiring would then fail compilation instead of silently 404ing every scoped request. It is not unsafe today, because it fails closed.
- `SourceSampleService.pipelineUses`'s `.recover { case NonFatal(_) => false }` also turns a transient DB failure on `listByPipelineInternal` into a silent 404. Consider narrowing it to the config-decode failure the comment describes.
- `usePipelineDetailPage.ts` (440 lines) and `PipelineDetailHeader.tsx` (415) are over the ~400-line mark. Per CONTRIBUTING, propose a split in the PR description.
- `SourceSampleLabel` `canRefresh` stays false for an editor while the sources list is still loading, even when the access state is `yes`. This is harmless, but it could key on `access === "yes"` alone.
- Pre-existing and outside this diff: `SourceSampleService.scala:150` logs `e.getMessage` for an encoding failure. Confirm it can never carry a cell value.
- C2 reminder: Delivery must wait for the owner's recorded D1 answer.
