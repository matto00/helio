## Evaluation Report — Cycle 2

### Phase 1: Spec Review — PASS
Issues: none. No production Scala changed this cycle (`git diff 8c42667c..HEAD` touches only
`schemas/workspace-context.schema.json`, `backend/build.sbt` (Test-scope dep),
`WorkspaceContextServiceSpec.scala`, and bookkeeping/openspec files) — cycle 1's Phase 1 PASS
stands unchanged. `files-modified.md` has a dedicated "Cycle 2" section accurately describing the
schema fix, the new test dependency, and the strengthened tests.

### Phase 2: Code Review — PASS
Issues: none — evaluation-1.md's single blocking finding (schema `required` vs. spray-json's
omit-`None` wire behavior) is fixed correctly:

- Read `git show 9c31b8c3 -- schemas/workspace-context.schema.json` directly: exactly the claimed
  change — `tag`/`sourceId`/`validationError`/`lastRunStatus`/`lastRunAt`/`lastRunRowCount`/
  `stepsError` removed from each `$defs` object's `required` array, left in `properties` still
  typed `["T","null"]`, each with a description documenting the omit-not-null behavior. All
  non-Optional fields remain required; `additionalProperties: false` is untouched — the schema was
  not loosened beyond the exact fields evaluation-1.md flagged.
- **Independently re-verified against a live response** (the most important check this cycle —
  see Phase 3 below for detail): fixed schema validates real traffic; the pre-fix (cycle-1)
  schema, re-run against the exact same live JSON, reproduces the same class of `required`
  property failures evaluation-1.md reported. This confirms the fix is real and not a
  self-referential artifact of the new Scala test.
- Read the new 4.6b tests in `WorkspaceContextServiceSpec.scala` (not just their names): the first
  creates a tagged source (`tag = Some("prod")`) and asserts `sourceEntry.tag shouldBe Some("prod")`
  and `companionEntry.sourceId`/`tag` are `Some(...)` before validating — genuinely exercises the
  field-present branch. The second builds a broken-pipeline entry via the `buildPipeline` seam
  (delete-after-`listSummaries` race, same technique as 4.5), asserts `stepsError shouldBe defined`,
  then validates the merged response — genuinely exercises the `stepsError`-present branch. Neither
  is a false-coverage trap.
- `backend/build.sbt`: `com.networknt % json-schema-validator % 1.0.87` added Test-scope only, with
  a comment explaining why (Jackson already on the classpath, this adds only the validation
  engine). Proportionate, no unexpected transitive surface for prod.
- Fresh gates, all green: `sbt test` 2217/2217; `npm run lint`, `npm run format:check`,
  `npm run check:schemas`, `npm run check:scala-quality` all clean (scala-quality's 74
  informational soft-budget warnings include `WorkspaceContextServiceSpec.scala` at 431 lines —
  non-blocking per the script's own classification and the standing agreement not to split
  mid-bugfix-cycle; noted as a spinoff-candidate below).
- Cycle-1's other PASSING findings (owner-scoping across all four resource kinds, scoped-PAT `403`,
  `pipelineOutput` classification both directions, per-pipeline analyze-degrade, D2 route-wiring)
  spot-checked intact — no production Scala changed this cycle so there was no mechanism for
  regression; `WorkspaceRoutes.scala` re-read and matches the wiring evaluation-1.md verified.

### Phase 3: UI Review — N/A
Backend-only ticket, no `frontend/**`/`ApiRoutes.scala` route surface change/`schemas/**`-consuming
UI touched this cycle either.

**Live ground-truth verification (this cycle's primary check):** started the backend via
`scripts/concertino/start-servers.sh` (reused an already-healthy instance — no Scala code changed
this cycle so no restart was needed for correctness), authenticated as the dev account, and called
`GET /api/workspace/context`. Created a tagged data source (`tag: "eval-cycle2"`, exercising
`DataSourceEntry.tag` present, `DataTypeEntry.tag`/`sourceId` present) and a tagged pipeline
(`tag: "eval-cycle2-pipe-tag"`, exercising `PipelineEntry.tag` present) via the live API to force
the present-branch coverage live data didn't otherwise exhibit; the account's existing 34
sources / 88 types / 21 pipelines already exercised the absent-branch (untagged) case plus the
present branch for `lastRunStatus`/`lastRunAt`/`lastRunRowCount` (11 previously-run pipelines).
Validated the raw response with `ajv` (v8, `Ajv2020`, `strict: false` — same tool class cycle 1
used) against the committed `schemas/workspace-context.schema.json`: **valid: true**. Re-ran the
identical live JSON against the pre-fix (cycle-1) schema (`git show 9c31b8c3~1:...`) as a control:
**valid: false**, with the exact `must have required property 'tag'` class of error evaluation-1.md
reported. Cleaned up the two eval-created resources (`DELETE /api/pipelines/:id`,
`DELETE /api/data-sources/:id`, both `204`) after validation.

### Overall: PASS

### Non-blocking Suggestions
- `WorkspaceContextServiceSpec.scala` (431 lines) is past `check:scala-quality`'s informational
  soft-budget (~250 lines/file) — carried forward from evaluation-1.md, already agreed not to
  split mid-bugfix-cycle; worth a follow-up spinoff ticket to split (e.g. extract the schema-
  validation harness into a shared test helper) since it grew further this cycle.
- A stray leftover `validate.mjs`/`ctx.json` pair was found in the evaluator scratchpad directory
  from what appears to be cycle 1's own live-validation work — harmless (outside the repo, not
  committed), just noting for awareness in case future cycles rely on scratchpad state persisting
  unexpectedly.
