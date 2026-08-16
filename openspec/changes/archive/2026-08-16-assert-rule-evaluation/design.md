## Context

`AssertStep.evaluate` (HEL-454) is a pure identity pass-through: `(rows, ctx) => Future.successful(rows)`.
`PipelineStep.evaluate`'s signature is shared by all 22 step kinds and cannot change per-kind. The
engine (`InProcessPipelineEngine.executeWithStepCounts`) is a thin `foldLeft` over `step.evaluate` that
already threads one non-row output (a `Map[String, Long]` step-id → row-count map) alongside rows —
this ticket generalizes that exact "thread a result out via the engine, not the rows" pattern to
assertion outcomes, per the ticket's own explicit suggestion.

`PipelineRunService.executeRun` calls `engine.executeWithStepCounts(sourceRows, steps, dataSourceRepo)`
then branches on `Future` success/failure (`runFuture.transformWith`) to persist a terminal
`pipeline_runs` row either way. `pipeline_runs` has indirect-owner RLS via `pipelines.owner_id`
(`V35__rls_owner_only_tables.sql`); grantee (shared-pipeline) reads bypass RLS via
`PipelineRunRepository.listByPipelineInternal` after `PipelineRunService.history` confirms sharing
access through `PipelineRepository.findByIdShared` — the ACL check lives in the service layer, not RLS,
for grantees.

## Goals / Non-Goals

**Goals:**
- Real pass/fail evaluation for all six v1 rule kinds, one `AssertionResult` per rule (not per row).
- Persist results whenever a run reaches a terminal state — succeeded, failed, or dry-run — without
  losing whatever was evaluated before a mid-pipeline failure.
- Keep `PipelineStep.evaluate`'s row-in/row-out contract intact for every step kind, `AssertStep`
  included.

**Non-Goals:**
- Blocking behavior / fail policy (419-C) — this ticket only records pass/fail.
- Any new HTTP route, protocol type, or frontend surface — AC3 asks for "a repository method," not an
  endpoint; Run History UI / panel surfacing is 419-D.

## Decisions

**1. `AssertionResult` and a new `AssertionSink` accumulator live in a new file,
`domain/AssertionResult.scala`** (not inside `domain/steps/AssertStep.scala`). The engine
(`InProcessPipelineEngine`, in `domain` directly) needs to reference both types to extend
`PipelineExecutionContext` and `executeWithStepCounts`'s signature; `domain.steps` already imports
*from* `domain` (never the reverse — see every existing step file's import block), so placing these
types in `domain` keeps that import direction intact rather than introducing a new
`domain` → `domain.steps` dependency. `AssertStep.scala` imports `AssertionResult`/`AssertionSink` from
`domain` exactly like it already imports `PipelineExecutionContext` from there.

**2. One `AssertionResult` per rule, aggregated across the whole row set — not one per row.** The
ticket's own shape (`AssertionResult(stepId, kind, field, severity, passed, observed, message)`) has no
row identifier, and the acceptance criteria describe rule-level outcomes ("a `notNull` rule fails when
the field has a null," "`rowCountMin` fails when the row count is below the threshold") — a single rule
evaluates to a single pass/fail judgment over the current row set, with `observed` summarizing the
aggregate (e.g. a failing-row count or the first offending value) and `message` present on failure.

**3. Per-kind evaluation semantics** (pure function, e.g. `AssertStep.evaluateRules(rows, rules):
Vector[AssertionResult]`, callable independent of `evaluate` so it's unit-testable directly):
   - `notNull(field)` — fails if any row's `field` is null or absent.
   - `unique(field)` — fails if any two rows share the same non-null `field` value. Null values are
     excluded from the duplicate check (mirrors PostgreSQL's own `UNIQUE` constraint semantics: NULL is
     never considered equal to another NULL for uniqueness purposes) — a documented, self-approved
     choice, not stated explicitly in the ticket.
   - `range(field, params.min?, params.max?)` — fails if any row's numeric `field` value (coerced via
     `FilterStep`'s existing `v.toString.toDouble` pattern) falls outside the given bound(s); a row
     whose value doesn't coerce to a number is treated as a failure for this rule (can't prove it's in
     range).
   - `rowCountMin(params.count)` / `rowCountMax(params.count)` — dataset-level, `field` never
     consulted (matches HEL-454 design.md Decision 4's field-requiring split, reused here).
   - `regex(field, params.pattern)` — fails if any row's `field` value doesn't match `pattern`. Match
     semantics and null-handling mirror `StringOpsStep.extractRegexFn`'s existing, directly-relevant
     precedent (`domain/steps/StringOpsStep.scala`'s `extractRegex` operation) rather than inventing a
     new convention: `pattern` is compiled with `java.util.regex.Pattern` and matched via `find()`
     (partial match anywhere in the value — not `matches()`/full-string), and a null or absent `field`
     is guarded explicitly (`if (v == null) null else v.toString...`) before calling `.toString`, since
     `.toString` on a null `Any` throws `NullPointerException` in Scala — a null/absent field under a
     `regex` rule is treated as a rule failure (can't prove a match), never an uncaught exception. This
     null-guard requirement generalizes to `notNull`'s own check too (already implicit there, since
     `notNull` is testing for exactly this condition) but is called out explicitly here because
     `regex`'s `.toString` call is the one line in this rule set actually capable of throwing if
     unguarded — caught at the design gate's first round, which required this precedent to be verified
     against `StringOpsStep`'s actual source directly, not just asserted.
   A rule whose `params` is missing a required key (e.g. `range` with neither `min` nor `max`) or whose
   `kind`/`severity` fails HEL-454's own analyze-time allow-list check is skipped at evaluation time
   with a `passed = false`, `message` naming the malformed shape — evaluation never throws for a
   malformed rule, mirroring `AssertConfig.decode`'s own never-throws contract (HEL-454 design.md
   Decision 2) extended to the evaluation path.

**4. `AssertionSink` is a caller-supplied, mutable output parameter — not part of the engine's returned
`Future` tuple.** This is the one deliberate departure from this codebase's otherwise-immutable
Future-chaining style, and it exists for a concrete reason: the ticket requires persisting results for
"both succeeded and — where evaluated — failed runs." If assertion results were only returned inside a
successful `Future`'s tuple (the row-count map's own pattern), a failure partway through the pipeline
(an exception in a step *after* the assert step) would discard every result already recorded, since a
failed `Future` carries only its exception, not a partial value. Instead, `executeWithStepCounts` gains
a 4th, optional parameter, `assertionSink: AssertionSink = new AssertionSink`, threaded into
`makeContext`; existing callers (`previewStep`, `execute`) don't pass one and get a fresh, silently
discarded sink (zero behavior change for them — assert steps still evaluate their rules during a
preview, the same computation as before, just unread). `PipelineRunService.executeRun` constructs the
sink explicitly *before* calling the engine and reads `sink.results` in both branches of
`runFuture.transformWith` (`Success` and `Failure`), so a mid-pipeline failure still surfaces whatever
was evaluated up to that point — **except for a failed dry run**, an exception this decision must state
explicitly (found at the design gate's second round): a dry run's `pipeline_runs` row is inserted only
on *success* (`onDryRunSuccess` → `insertDryRun`); `preExec` skips inserting one upfront for a dry run
(`PipelineRunService.scala:266-272`), and the existing `Failure` branch already no-ops its own
persistence when `isDry` (`PipelineRunService.scala:295`, `if (!isDry) { ... } else Future.successful(())`)
for exactly this reason — there is no parent row yet to attach anything to. The new
`insertAssertions` call in the `Failure` branch MUST be nested inside that same `if (!isDry)` guard, not
called unconditionally, or a failed dry run with prior assert-step results would attempt an FK-violating
insert against a `run_id` with no `pipeline_runs` row, turning today's graceful
`Left(ServiceError.UnprocessableEntity(...))` response into an unhandled failed `Future`.
*Alternative considered*: extending the engine's success-tuple to `(rows, counts, assertions)` — the
"more functional" option, and the one that changes zero method signatures beyond adding one field to a
tuple. Rejected because it cannot satisfy the "record partial results on failure" requirement at all —
a failed `Future` has no tuple to extend.

**4a. Every `insertAssertions` call site is wrapped in `.recoverWith { case _ => Future.successful(()) }`
— found at the design gate's third round, a distinct case from Decision 4's dry-run guard.**
`PipelineRunRepository.insertRun`/`insertDryRun` are confirmed, tested silent no-ops for a caller who
does not own the parent pipeline (`PipelineRunRepositorySpec.scala`'s CS2 tests, lines 269/276) — and
this is reachable *live*, not hypothetically: `PipelineRunService.submit`'s grantee branch
(`PipelineRunService.scala:93-98`) lets an editor grantee trigger a run (real or dry) via
`POST /api/pipelines/:id/run`, using the grantee's own identity, not the owner's. For that run, no
`pipeline_runs` row is ever created — `insertRun`/`insertDryRun` no-op silently — yet the pipeline still
executes via `runPipeline`/`executeRun` regardless (the no-op only skips persistence, not execution).
`insertAssertions` (Decision 6, `withSystemContext`, no ownership gate of its own) has no way to know
this happened and would attempt an FK-violating insert against a `run_id` with no parent row, in the
`Success` branch, the real-run `Failure` branch, and `onDryRunSuccess` alike — turning a silent,
long-shipped no-op into an unhandled failed `Future` for a live sharing feature. The fix is exactly the
pattern `insertRun`/`deleteOldRuns` (`PipelineRunService.scala:271`) and
`insertDryRun`/`deleteOldDryRuns` (`PipelineRunService.scala:334`) already use for this identical
class of problem: treat `insertAssertions` as best-effort persistence, wrapped in
`.recoverWith { case _ => Future.successful(()) }` at every call site (the `Success` branch for both real
and dry runs, and the real-run `Failure` branch) — not a new invention, the same precedented guard
already sitting two lines away in the same file.

**5. Persist assertion results for dry runs too, without special-casing.** `onDryRunSuccess` and
`onRunSuccess` already share the same `runFuture` (the engine execution is identical either way; only
the post-execution persistence branches). A dry run already gets its own `pipeline_runs` row
(`status = 'dry_run'`, via the existing `insertDryRunInternal` path), so `pipeline_run_assertions`'s FK
is satisfiable for a dry run exactly as for a real one. The ticket's acceptance criteria don't call out
dry runs specifically; the simplest, least-special-cased reading is to persist uniformly for every
terminal `pipeline_runs` row this ticket's own engine execution produces, real or dry — a user
dry-running a pipeline benefits from seeing whether their assertions would currently pass, before
committing to a real run. Note for the executor: `onDryRunSuccess` inserts the dry run's own
`pipeline_runs` row itself (`insertDryRunInternal`) — unlike the real-run path, where `insertRun`
already ran during pre-execution — so `insertAssertions` must be sequenced *after* that insert
completes, not before, or the FK to `pipeline_runs(id)` has nothing to reference yet.

**6. `pipeline_run_assertions` migration mirrors `pipeline_runs`' own indirect-owner RLS pattern one
level deeper** (`V35__rls_owner_only_tables.sql`'s `pipeline_runs_owner` policy, EXISTS-subquery style):
```sql
CREATE POLICY pipeline_run_assertions_owner ON pipeline_run_assertions
  USING (
    EXISTS (
      SELECT 1 FROM pipeline_runs r
      JOIN pipelines p ON p.id = r.pipeline_id
      WHERE r.id = pipeline_run_assertions.run_id
        AND p.owner_id = current_setting('app.current_user_id')::uuid
    )
  );
```
`insertAssertions` always runs via `withSystemContext` (mirroring `insertRunInternal`'s privileged
pattern — the run-completion path has no meaningfully-different-from-`insertRun` ownership check to
perform, since the run itself was already inserted owner-scoped). `listAssertionsByRun` gets both an
owner-scoped variant (RLS-gated, for direct callers) and a `listAssertionsByRunInternal` variant
(system-context, for a future grantee-aware caller — 419-D's job to actually wire up, per AC3's "RLS-safe
for owner + grantees" phrased as a capability this ticket must provide, not a route this ticket must
expose).

**7. Migration number re-checked at execution time**, same discipline HEL-454's design.md Decision 7
established (and HEL-454's own final gate caught a real collision from concurrent epic work) — the
executor must re-list `backend/src/main/resources/db/migration/` immediately before writing the file,
never trusting a number from this document or the ticket text.

## Risks / Trade-offs

- [`AssertionSink` mutability is a stylistic outlier in an otherwise-immutable codebase] → scoped
  tightly (one small new file, one new optional engine parameter, never exposed outside
  `PipelineRunService`/`InProcessPipelineEngine`); the alternative (Decision 4) cannot meet the
  ticket's own failure-path requirement, so the trade-off is accepted and documented rather than hidden.
- [Six rule kinds' evaluation semantics are this ticket's own judgment call, not fully specified by the
  ticket] → each is grounded in an existing precedent (`FilterStep`'s numeric coercion, HEL-454's
  field-requiring split, PostgreSQL's own NULL-uniqueness convention) and stated explicitly for the
  final-gate skeptic and evaluator to check against the ScalaTest acceptance-criteria examples.

## Planner Notes

- Self-approved Decisions 2, 3, 4, 5, 6 — each is an ordinary implementation judgment call resolving an
  ambiguity the ticket left open (aggregation granularity, per-kind semantics, how to survive a Future
  failure, dry-run scope, RLS shape), grounded in an existing pattern already in this codebase, not
  invented from scratch. None changes existing behavior for any caller that doesn't opt into the new
  `assertionSink` parameter.
