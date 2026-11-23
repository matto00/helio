## Context

`GET /api/pipelines/context-analyze` (HEL-1625, `PipelineContextAnalyzeReads`) prefetches every source the shared
`PipelineAnalyzeProjection.fetch` will ask for (roots and upsert targets owner-scoped in one statement, secondaries
privileged in one statement), then answers the projection's per-id lookups from those maps. Per-pipeline `/analyze`
(`PipelineAnalyzeReads`) answers the same lookups with `findByIdOwned` / `findByIdInternal`, which compare the raw id
against `data_sources.id`, a `TEXT` primary key (V4; never converted to uuid). The batch currently:

- prefetches `validIds(raw)` = only ids `UUID.fromString` accepts, rewritten to `UUID.toString` (lower-case canonical);
- resolves each lookup with `map.get(DataSourceId(UUID.fromString(raw).toString))`, which lower-cases a valid id and
  THROWS on a malformed one, failing that pipeline so it is omitted from the response.

So for an upper-case id of an existing source the batch resolves the source where `/analyze` finds none, and for a
malformed id the batch omits the pipeline where `/analyze` answers normally. The API cannot store such an id through
its validated write paths today (step configs are validated on write), but stored configs are JSON with no FK, and
the parity requirement is unconditional.

On the MCP side, `context.ts` does `mapAnalyzedSteps(batched ?? await api.analyzePipeline(id))` inside a try/catch:
a batch item present but lacking `steps` throws in `analyzed.steps.map` and the pipeline gets
`stepsError: "Cannot read properties of undefined..."` instead of the per-pipeline answer.

## Goals / Non-Goals

**Goals:**
- Batch source lookups identical to `/analyze`'s: raw id, text comparison, never throwing on the id's shape.
- Correct the wrong "compares as uuid" comments.
- An MCP batch item without a `steps` array is treated as absent (per-pipeline analyze), payload unchanged.
- A committed red run of the statement-count spec under a genuine N+1 mutation.

**Non-Goals:**
- Changing `/analyze`, any API/JSON shape, the committed schema, or the goldens.
- Normalising or validating stored source ids anywhere else; any migration.
- Redeploying the hosted MCP (source change only; noted in the PR for the next release).

## Decisions

**D1. Raw text lookup in the batch.** Prefetch the raw id strings the projection will request (no `UUID.fromString`,
no malformed-id filter) via `findByIdsOwned` / `findByIdsInternal` (`inSet` over a `TEXT` column with bound
parameters: any string is safe). The resolver becomes a plain `map.get(raw)`, keyed by the id as stored, so an exact
text match is required, as in `/analyze`. A malformed or non-canonical id simply misses (`None`), as in `/analyze`.
Keep resolver failures asynchronous (design skeptic note 1): keep the `Future.fromTry(Try(...))` wrapper (or wrap the per-pipeline `project(...)` in `Future.delegate`), so a throwing lookup on any path still omits one pipeline rather than failing the response with a 500. The `UUID` import goes if unused. Rejected: keeping the UUID
filter and adding case-folding to `/analyze` (changes the route this read must equal, not the batch).
The ids collected by `sourceIdsOwned` / `secondarySourceIds` / `upsertTargetIds` must be exactly the values the
shared fetch later passes to the resolver (same extraction helpers); the executor verifies this (for example any
trimming in `secondarySourceIdOf` or `UpsertTargetAnalysis.targetIdsOf`) and the parity tests below catch a miss.

**D2. Comments.** `findByIdsOwned`'s doc says the column is `TEXT` and ids are compared as text (any string is
accepted); `findByIdsInternal` likewise if it repeats the claim; the batch's "Only well-formed UUID ids" comment and
the resolver's "a malformed id fails that pipeline" comment are removed or rewritten to match D1.

**D3. MCP: a batch item without `steps` is absent.** In `fetchContextAnalyze`, only items whose `steps` is an array
enter the map. Such a pipeline then takes the existing absent path: it is analyzed per pipeline and counted in the
existing single "omitted N of M pipelines" stderr line. No new stderr line, no new code path in the per-pipeline
mapping. Rejected: checking inside the per-pipeline try (would duplicate the fallback and bypass the absent count).
`warnings` missing stays tolerated as today (`?? []`).

**D4. Red-first tests.**
- Backend (item 1): new cases in the context-analyze routes spec (or a new spec beside it) seeding, through the
  repository/fixture (the API rejects such ids), pipelines whose join or lookup secondary and whose `upsertsource`
  existing-source target name (a) the UPPER-CASE form (cover BOTH join and lookup secondaries, each naming a source with a non-empty `inferredSchema`, else the case passes vacuously; skeptic note 3) of an owned source id (the fixture's real dataset / schema'd
  source, so resolving it changes the analysis), and (b) a non-UUID string. Assert each pipeline's item is present and
  its `steps`/`warnings` deep-equal `/analyze`'s for the same caller. Must be red on current code (the upper-case case
  because the batch resolves what `/analyze` does not; the malformed case because the item is omitted), recorded and
  committed as `.txt` before the D1 fix.
- MCP (item 2): in `contextRequestBudget.test.ts`, a new golden-loop path (full and concise) whose
  `contextAnalyzeBody` drops `steps` from one non-failing pipeline's item, plus a request-count/stderr assertion that
  exactly the steps-less pipeline and the already-omitted failing pipeline get one `/api/pipelines/:id/analyze` each, with one "omitted 2 of 55" stderr line (model it on the existing `missing-one` test, skeptic note 2). Red on current code
  (`stepsError` in the payload), recorded and committed before D3. Goldens are never edited.

**D5. N+1 mutation evidence (item 3).** Temporarily replace one batched read in `contextAnalyzeForOwner` (for
example `listByPipelineInternalBatch(idSet)`) with one repository call per pipeline (`Future.traverse` over `ids`),
run the full `PipelineContextAnalyzeQueryCountSpec`, and commit the red output as `.txt` in this change directory
(showing the 10-vs-200 equality assertion failing with the statement counts). Revert the mutation; re-run green. The
mutation is never committed as code.

## Risks / Trade-offs

- [A huge `inSet` of ids] → unchanged in size from today (same id set, minus nothing material); bound parameters.
- [A malformed id now reaches SQL] → it is a bound text parameter against a text column, exactly what `/analyze`
  already sends; no cast, so no statement failure.
- [Behaviour change for the omitted-on-malformed case] → intended: the item is now present and equals `/analyze`.
  The MCP's final payload is the same either way (it previously fell back per pipeline).
- [HEL-1713 in flight touches helio-mcp] → it touches httpApp/oauth/test harness only; no overlap with `context.ts`.
