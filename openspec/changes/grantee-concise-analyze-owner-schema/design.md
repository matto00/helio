## Context

Premise checked on main 2f6d44104 (`.concertino/runs/HEL-1799/evidence/premise-validation.md`):

- `analyzeConcise` is in the backend (`PipelineAnalyzeReads.scala:249-295`), reached via
  `PipelineRoutes` `analyze?concise=true`. helio-mcp `helioApi.analyzePipeline(id, true)` calls that route.
- It shares the class and the step/root/secondary/upsert reads with `analyze`, but resolves root schemas only with
  `findByIdOwned(dsId, user)` and has no owner-view pass. For a grantee every root schema is empty, so a compute step
  naming a root column gets a "column not found"-style `validationError`.
- `PipelineAnalyzeConciseResponse` carries `{path, op, validationError?, warnings?}` per node. No schema, no cost
  verdict, no row count.

## Decisions

### D1. One shared owner-view validity helper

Extract from `analyze` (lines 83-88 and 139-146) two private members of `PipelineAnalyzeReads`:

- `ownerRootSchemas(rootDataSourceIds, pipeline, callerIsOwner): Future[Option[Map[String, Vector[SchemaField]]]]` -
  `None` for the owner, else the owner's root schemas via `dataSourceRepo.findByIdOwnedByInternal(dsId,
  pipeline.ownerId)` (empty vector when absent). Same read as today's `ownerSchemas`.
- `nonOwnerValidity(callerView: Map[String, AnalyzedStep], nodeInputs, ownerSchemas, secondarySchemas,
  upsertProblems): Map[String, AnalyzedStep]` - keyed by step id like the `projections` map both call sites already
  hold. With `None` returns `callerView` unchanged; with `Some(byRoot)` runs `analyzeNodes` over the owner's schemas
  with the same upsert overlay and maps every caller-view step's `validationError` through the existing
  `nonOwnerValidationError`. Only `validationError` changes; every other field of each `AnalyzedStep` is the
  caller-view one.

`analyze` calls both in place of its inline code (then takes its enabled steps from the returned map, as today) (behaviour byte-identical; HEL-1661's spec stays green unmodified).
`analyzeConcise` adds the `ownerRootSchemas` read to its `rootFetch`, builds the caller-view projections as today, then
takes each enabled node's `validationError` from the mapped result instead of the caller-view one. Rationale: the AC
says "the same reads as the REST route"; one helper makes divergence a compile-level change rather than a copy.

Both call sites pass the same map shape, so they cannot drift; a disabled step emits no entry in either mode.

### D2. What stays caller-view

`path`, `op` and `warnings` in concise stay computed from caller-view projections, exactly as `analyze` keeps
`warnings` caller-view (HEL-1661 ruling: no new schema data to a grantee). For the owner nothing changes at all
(`ownerRootSchemas` returns `None`, no extra read).

### D3. Grantee text rules

A grantee's concise `validationError` is exactly what the full route would give the same grantee for the same step:
the schema-independent config problem, the caller-view error when identical to the owner's, or
`PipelineAnalyzeReads.NeutralStepError`. It never contains an owner-view inference message (which can name owner
column types). There is no row count in concise; none is added.

### D4. Stranger

Unchanged: `findByIdShared` returns `None` and `analyzeConcise` returns `ServiceError.NotFound("Pipeline not found:
<id>")`, the same message as today, before any root read.

## Test plan (red first)

New `Hel1799GranteeConciseAnalyzeSpec` on the two-role `helio_app_test` harness copied from
`Hel1661GranteeAnalyzeVerdictSpec` (app pool `SET ROLE helio_app_test`, privileged pool for seeding), callers
owner / editor / viewer / stranger, pipelines owned by one owner:

1. [PIN] app pool `current_user = helio_app_test`, `rolbypassrls = false`, `rolsuper = false`.
2. [DEFECT] CSV root `amount,flag` + compute `$amount * 2` (valid for owner): owner concise has no `validationError`;
   editor and viewer concise has no `validationError` on any node. Red on main.
3. [DEFECT] dataset root (rows) + compute `$amount * 2`: same as 2 for editor and viewer.
4. [PIN/DEFECT] compute `$flag AND $amount` (invalid for owner): owner keeps its typed message (contains "boolean"/
   "float"); editor and viewer get a defined error that contains none of `float`, `boolean`, `amount`, `flag`.
5. [PIN+DEFECT] grantee concise serialized JSON (spray `toJson.compactPrint`): contains none of the root column names or
   types (`amount`, `flag`, `float`, `boolean`), no source name, and no key other than `nodes`/`path`/`op`/
   `validationError`/`warnings` (so no row-count field);
   `warnings` equal the literal value main produces for that grantee (asserted literally, written down from a main run
   recorded in the red commit).
6. [PIN] stranger: `Left(ServiceError.NotFound("Pipeline not found: <id>"))`, exact message.
6a. [PIN] warnings leak guard (kills m3): CSV root `amount,flag` + an enabled `sort` (or `filter`/`select`) step on
   an absent field `nope`, which is a non-blocking `field-not-in-input-schema` warning whose owner-view message lists
   the input columns. Owner concise: that node's warnings name `amount` (baseline proving the fixture produces the
   leak-shaped warning). Editor and viewer concise: warnings equal the literal caller-view value main produces and
   contain none of `amount`, `flag`, `float`, `boolean`. Use `sort` with
   `{"sortBy":[{"field":"nope","direction":"asc"}]}` first (error-free; `select` goes through `inferSelect`).
   Concise `warnings` stay computed from the unmapped caller-view `projections`, never the `nonOwnerValidity` result.
   The executor confirms on main that the step carries no
   `validationError` for the owner; if it does, switch to whichever of sort/filter/select gives a warning and no error.
7. [DEFECT] full-route agreement (including the 6a fixture): for each grantee and fixture, concise `validationError` per step equals the full
   `analyze` step `validationError` for the same caller.

Mutations, each must turn a named test red: (m1) concise ignores owner schemas (revert); (m2) concise uses owner-view
error without `nonOwnerValidationError` mapping (owner text leaks, test 4); (m3) concise computes `warnings` from owner
projections (test 6a); (m4) stranger short-circuit removed / different message (test 6). Existing
`Hel1661GranteeAnalyzeVerdictSpec`, `PipelineAnalyzeConciseByteBudgetSpec`, `PipelineAnalyzeSchemaWarningsSpec`,
`PipelineAnalyzeRoutesSpec` stay green unmodified.

## Gate-Chain Implications

No `.husky/**` or hook-invoked script is touched.

## Risks

- One extra privileged read per root for a non-owner concise call. Same cost the full route already pays.

## Implementation note (test labels)

Tests 5 and 7 are labelled DEFECT in the spec, not PIN: both are red on unchanged main, because a grantee's concise
`validationError` there is the caller-view text (`Unknown field: amount` / `Unknown field: flag`), which names a root
column and differs from the full route's. Test 5's key-shape, source-name and no-warnings assertions are the PIN part
(green on main); its column/type scan is the DEFECT part. See `red-run.txt`.
