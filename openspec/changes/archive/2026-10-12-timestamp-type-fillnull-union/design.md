## Context

HEL-1314's evidence (`openspec/changes/archive/2026-10-11-compute-datetime-functions/timestamp-paths-evidence.md`,
probe output `.concertino/runs/HEL-1314/evidence/probe-timestamp-paths.txt`) found two paths that put a
JSON number under a `timestamp` projection:

1. `fillnull` mean/median. `StepSchemaInference.inferOutputSchema` projects `fillnull` as identity
   (`StepSchemaInference.scala:27`). `FillNullStep.computeMean`/`computeMedian` coerce through
   `PipelineRowJson.toDouble`, which reads numeric strings, so an epoch-string timestamp column
   (`cast` to `timestamp` keeps `"1771286400"`) gets a `Double` fill. ISO-string timestamps do not
   coerce, so for them mean/median silently fills nothing.
2. `union`. `MultiInputSchemaInference.inferUnion` appends only secondary fields whose names are new,
   so the parent type wins a collision; a numeric secondary `ts` arrives under `ts: timestamp`.

Facts that constrain the fix (verified in the tree):

- Run time is untyped. `PipelineStep.evaluate(rows: Seq[Map[String, Any]], ctx)`; the execution
  context carries no schema. A run-time check cannot know a column is `timestamp`, and a numeric
  string is indistinguishable from an epoch timestamp (`TimestampParsing.parseInstant` reads epochs).
- The save path is schema-free. `PipelineStep.rawConfigProblem(kind, raw)` takes kind + raw config
  only; no write path has the step's input schema (only the data-dependent upsertsource check).
- An analyze `validationError` (from `PipelineAnalyzeService.checkEnabledStep` →
  `inferOutputSchema`) blocks via `PipelineAnalyzeReads.toCostVerdictResponse`: it adds a
  `step-config-invalid` reason and clears `canRun`/`autoRunnable`. Auto-run and the scheduler use the
  schema-independent `stepConfigProblem` by design (HEL-1280: schema-derived errors have false
  positives from stale stored schemas), so they are not gated.
- Precedent for a schema-type-dependent analyze error: `ColumnSchemaInference.inferCompute`
  (HEL-1437). Precedent for "validate, stay identity": `ReshapeSchemaInference.inferAssert`.
- The step card renders any step `validationError` generically (`StepCard.tsx`, `StepCardHeader.tsx`);
  no frontend change is needed.
- `timestamp` is the only date-like canonical `DataFieldType` (`date` canonicalises to it).

## Goals / Non-Goals

**Goals:** analyze no longer *silently* projects `timestamp` over cells the run fills/supplies with
numbers on these two paths (lane-kind union only, see the gap below): it reports a step error at the
step that introduces the disagreement. Each fix is proven by a parity test that is red on the pre-fix
code for the right reason.

**What this does NOT do (stated plainly for the owner):** it flags the disagreement, it does not
remove it. `canRun: false` only hides the editor's "Run to update" prompt
(`PipelineDetailFooter.tsx:149`); the Run pipeline and Dry run buttons ignore it
(`PipelineDetailFooter.tsx:317-331`); scheduled and auto runs are not gated (HEL-1280); the projected
type stays `timestamp` (the erroring step's output is its input schema), so a downstream `$ts + …`
is still inferred `string` while a run started anyway still produces a number. The ticket's literal
symptom therefore remains reachable, now with an error shown on the step that causes it.

**Non-Goals:** run-time refusal (no type information at run time); gating scheduler/auto-run on
schema-derived errors (HEL-1280 policy); **a union with a `source`-kind secondary input** (known gap,
see D2); other union type collisions (e.g. `string` vs `integer`,
parent `integer` vs secondary `string`); fillnull mean/median on a `string`-typed column holding
numeric strings (also writes a `Double` under `string`, a different mismatch class); the stale
"union analyze is a passthrough" requirement text in `pipeline-union-op` (pre-dates HEL-911).

## Decisions

### D1 (assumed product call, OWNER REVIEW): fillnull mean/median on a timestamp column is flagged as an analyze step error

Options: (a) reject at write time; (b) reject at analyze; (c) produce a timestamp (mean of instants as
ISO UTC).

- (a) is not possible without new schema plumbing into every write path (the write path has no input
  schema), and would break HEL-1416's "drafts stay saveable" rule.
- (c) needs the column's type at run time, which the engine does not have; a value-based guess cannot
  tell an epoch timestamp from a numeric string. It would also be a new semantic ("mean of instants")
  with no product ask behind it.
- (b) is reversible, uses the existing analyze-error channel, keeps the step saveable, and tells the
  user what to do instead.

Chosen: (b). New `inferFillNull(config, inputSchema)` arm in `StepSchemaInference` replacing the
`fillnull` entry in the identity arm: returns `(inputSchema, None)` unless strategy is `mean`/`median`
and at least one listed column has projected type `timestamp`, then `(inputSchema, Some(msg))`.
Decode with `FillNullConfig.decode` inside the existing tolerant pattern (a decode failure must not
produce a new error category: `validateStepConfig` already ran first and owns malformed configs; if
decode fails here, return `(inputSchema, None)`). Message (shared constant/function in
`FillNullStep` so tests and docs cite one source), e.g.:
`fillnull strategy 'mean' cannot fill timestamp column(s) 'ts': the run would write a number into a
timestamp column. Use forwardFill, mode or constant, or cast the column to a number first.`

### D2 (assumed product call, OWNER REVIEW): union timestamp-versus-numeric collision is flagged as an analyze step error

Options: (a) widen the projected type to `string`; (b) warn (non-blocking `AnalyzeSchemaWarnings`);
(c) reject at analyze.

- (a) removes the false `timestamp` claim but does not fix the reported symptom: a downstream
  `$ts + 1` on a `string` column is still inferred `string` (`ExpressionTypeInference`: `+` with a
  text-like side concatenates) while numeric rows still add at run time. It also silently changes the
  projected type of existing pipelines' downstream steps.
- (b) leaves the wrong projection in place; warnings are deliberately read by nothing.
- (c) states the disagreement where it happens and has a clear user fix (cast one side). It is
  scoped to exactly the bug class (timestamp on one side, `integer`/`float` on the other), so
  unrelated collisions are untouched.

Chosen: (c), symmetric in direction (parent timestamp vs secondary numeric, and parent numeric vs
secondary timestamp — the reverse puts timestamp strings under a numeric projection, the same
disagreement). Implemented inside `inferUnion`'s `Some(secondary)` branch: projection unchanged; error
when any collision qualifies. Only fires when the secondary schema is resolved.

**Known gap: source-kind secondary.** Analyze resolves a `source`-kind secondary's schema only for
`join`/`lookup` (`PipelineAnalyzeService.scala:196-201,247-251`); for `union` (whose default and
original shape is `source`-kind, `SecondaryInput.scala:25`) `secondarySchema` is always `None`, so this
check never fires there and the run still puts numbers under `timestamp`. Closing it means extending
the source-schema lookup to `union`, which changes the projected schema of every existing source-kind
union (secondary-only columns start appearing, and `AnalyzeSchemaWarnings`' secondary-only-column
warning for source unions changes) — a separate product call. Not done here; recorded in the spec
delta, the doc rewrite and the PR's OWNER REVIEW section, and filed as a follow-up ticket.

**Spec hygiene.** `pipeline-union-op`'s requirement "Union op analyze-inference is a documented
best-effort passthrough" pre-dates HEL-911 and already contradicts the shipped lane-kind projection;
this change MODIFIES it to the real behaviour (source-kind: passthrough; lane-kind: field union, parent
type wins, plus the D2 error). Message e.g.:
`union: field 'ts' is timestamp in this lane but integer in the secondary input, so the run would
mix numbers and timestamps in one column. Cast one side so the types match.`

### D3: Parity tests are pure unit specs, red first

A new pure spec (no DB, so `VerifiedEmbeddedPostgres` is not involved), modelled on
`CastRuntimeParitySpec` for analyze (`PipelineAnalyzeService.analyzeNodes` for the projection and
`validationError`) and on `InProcessPipelineEngineTreeWalkSpec` for the run: the run side uses
`InProcessPipelineEngine.executeTree` (the production tree walk, which resolves `lane`-kind
secondaries without a DB). NOT `executeWithStepCounts`: that flat test fold builds its context with
`resolveLane = _ => None` (`InProcessPipelineEngine.scala:698`), so a lane union would throw "Lane
reference not found for union" before any assertion and the test would be red for the wrong reason
before and after the fix. The fillnull case may use either; use `executeTree` for both for uniformity. For each path the test asserts: the run puts a number under the column
(characterises the run), AND analyze reports a `validationError` for that step (red pre-fix: analyze
reports none while projecting `timestamp`). The red run on the pre-fix code is captured as evidence
(`red-evidence.md` in the change dir), and that evidence must show **the failing assertion is the
analyze one and the run-side assertion passed** in the same test (e.g. run-side assertions first, or
separate run-only and analyze-only tests over the same fixture, with only the analyze tests red). Negative cases (other strategies, numeric columns, other
collisions) are GUARD tests and must be shown failable by mutation (e.g. widening the rule to all
strategies / all collisions turns them red).

## Risks / Trade-offs

- Existing pipelines with either shape newly show a step error and `canRun: false` in the editor;
  scheduled/auto runs continue as before. Reversible by removing the check. Called out in the PR's
  OWNER REVIEW section.
- A stale stored schema could misreport a column as `timestamp` (HEL-1280 class); the impact is an
  editor-only false error, never a blocked scheduled run.
- A step with a `validationError` makes its projection incomplete for `AnalyzeSchemaWarnings`
  (`AnalyzeSchemaWarnings.scala:106,133`), so non-blocking schema warnings downstream of a newly
  erroring fillnull/union step stop being reported until the error is fixed. Accepted (same as every
  other step error).
- An ISO-string timestamp column with mean/median currently fills nothing (no number written); it is
  also rejected by D1. That is intended: mean/median of a timestamp is undefined either way.

## Migration Plan

None (no schema or data change). Docs: rewrite `docs/compute-expression-grammar.md` "Known limitation:
a timestamp-typed column that carries a number" to say: analyze now reports fillnull mean/median on a
timestamp column, and a lane-kind union timestamp/numeric collision, as step errors; run time is
unchanged, runs are not blocked, and the projected type is still `timestamp`, so `+` downstream can
still disagree if the pipeline is run anyway; a source-kind union is not checked (known gap).
