## Context

See proposal.md (Why). `ExpressionEvaluator.scala` (724 lines) holds the strict parser, `checkArity`, the shared
`SupportedFunctions`/`NumericFunctions` lists (HEL-1315 D7), `inferTypeOf`, and `evalExpr`/`applyFn`. `applyFn` starts
with `if (args.contains(VNull)) Right(VNull)` — every function is null-propagating, and `evalExpr`'s `Call` case
evaluates all arguments eagerly before dispatch. Runtime values are only `VNum`/`VStr`/`VNull`: a JSON boolean or a
timestamp string field is a `VStr` at run time. The only caller of `inferType` is `PipelineAnalyzeService.inferCompute`,
which today swallows a `Left` into the wire-type fallback (`.getOrElse(canonicalizeLegacyType(wireType))`).

## Goals / Non-Goals

**Goals:** `coalesce` per the spec delta; inferred type equals the runtime value class (HEL-1315 parity rule); minimal
growth of `ExpressionEvaluator.scala` (target ≤ ~40 net lines). **Non-goals:** see proposal (HEL-1070/1403/1404, Spark).

## Decisions

**D1 — Arity ≥ 2, parse error otherwise.** `checkArity` gains `case "coalesce" => if (argc >= 2) ... else
Left("coalesce requires at least 2 arguments")`. A one-argument coalesce is the identity and almost certainly a
forgotten fallback; rejecting it at parse time (save + analyze) is cheaper than a silent no-op. Alternative ≥ 1
(Postgres accepts 1) rejected for that reason. `SupportedFunctions` gains `"coalesce"` in alphabetical position, so the
unknown-function message becomes `... supported functions: abs, ceil, coalesce, concat, floor, length, lower, mod,
round, substring, upper` — the exact-match assertions in `ExpressionEvaluatorSpec` and the substring assertion in
`PipelineAnalyzeServiceSpec` (`"supported functions: abs, ceil, concat, floor"`) and the docs Errors example are updated.

**D2 — Lazy, short-circuit evaluation, special-cased before eager argument evaluation.** In `evalExpr`, a
`Call("coalesce", args)` is handled before the generic eager fold: evaluate args in order, return the first non-`VNull`;
propagate the first `Left`; all null → `VNull`. This is what makes it exempt from `applyFn`'s null guard (it never
reaches `applyFn`), and what makes an error in an unreached argument irrelevant (spec scenario). `applyFn` keeps an
unreachable `case "coalesce"` out of its match (falls to the existing unreachable default) — no change to `applyFn`.
Alternative: eager evaluation then pick — rejected: SQL `COALESCE` short-circuits, and an error in a fallback that is
never needed must not null a row.

**D3 — Common-type inference.** `inferTypeOf`'s `Call` case gets a `coalesce` branch over the argument types `ts`:
`ts.distinct.size == 1` → that type; all in `Numeric = Set("integer", "float")` → `"float"`; none in `Numeric` →
`"string"`; otherwise `Left(s"coalesce arguments must all be numbers or all be text; got ${ts.mkString(", ")} — wrap a
number in concat() to coalesce it as text")`. Rationale: numeric types are all `VNum` at run time (JSON number), every
non-numeric type is `VStr` at run time (JSON string), so each non-error result names the runtime class truthfully.
Identical types keep their precision (`coalesce($ts1, $ts2)` → `"timestamp"`) — same as a bare `$ts` today. The
workaround `concat($n)` already infers `"string"` and stringifies at run time (`concatStr`), so no new function is
needed. Owner ruling (HEL-1423 escalation, answer `analyze-error`) chose the error over widen-with-warning or
first-argument-wins.

**D4 — Surface the inference error at analyze.** `inferCompute`'s `Right(_)` branch becomes: `inferType` `Right(t)` →
`(schema :+ (column, t), None)`; `Left(msg)` → `(schema :+ (column, canonicalizeLegacyType(wireType)), Some(msg))`.
Today `inferType` can only fail with an unknown field, which `validate` has already rejected one line earlier, so this
branch is reached only by the new coalesce mixed-type error — no other existing behavior changes. The message renders
inline under the expression input exactly like a parse error (`ComputeFieldConfig` renders `validationError` verbatim).

**D5 — What the analyze error does and does not block (verified in code, per coordinator).**
- Save: unaffected. `ComputeStep.validateRawConfig`/`requiredConfigProblems` are parse-only (`parseProblem`), schema-blind.
- Scheduled runs and dataset-write auto-runs: **not blocked.** Both gate through `RunConfigGate.stepConfigReasons`
  (HEL-1384), which calls `PipelineAnalyzeService.stepConfigProblem(op, rawConfig)` — documented "schema-INDEPENDENT",
  never `inferCompute`; `RunConfigGate`'s header states analyze's schema-derived errors "can never gate" (HEL-1280).
  `AutoRunTriggerService` (line ~105) and `PipelineSchedulerService` (line ~268) both use it.
- Manual run: **not blocked.** `PipelineRunService` has no config/analyze gate; the footer Run button is disabled only
  on `runStatus` queued/running.
- Analyze response display: `PipelineService.toCostVerdictResponse` turns every analyzed `validationError` (schema-
  derived ones included) into a `step-config-invalid` reason with `autoRunnable=false, canRun=false`, so the pipeline
  detail page shows the denial notice and hides its secondary "Run to update" button. This is identical to how an
  existing schema-derived compute error (`Unknown field: x`) already behaves; it is display only and does not reach
  the server-side gates above. Not a new run-blocker, so no re-escalation.

**D6 — Parity/list tests (HEL-1315 pattern).** The numeric parity test's classification
`NumericFunctions == SupportedFunctions -- stringFns` gains `coalesce` as an explicitly-classified third kind (a
`PolymorphicFunctions`-style exclusion in the test, or a `Vector("coalesce")` constant beside `NumericFunctions`), so a
future function still cannot go unclassified. A coalesce parity test asserts, for each inference outcome (numeric mix →
`float` ↔ `JsNumber`; text mix → `string` ↔ `JsString`; same-type string/float only — same-type
integer/boolean/timestamp mirror a bare `$field` and are not parity-exact), that the evaluated value's JSON class matches. The
list↔dispatcher probes stay; `coalesce` in the candidate list now passes because it is listed.

**D7 — Red-first, end to end.** (a) Unit red: tests for `coalesce` written and run before the implementation — they
fail (`'coalesce' is not a recognized function`); a test pinning `concat($first, " ", $last)` → `null` on a blank row
passes on main and stays. (b) Pipeline-level: a spec loading the CSV through the real loader (`CsvLoadSupport`, HEL-1408)
and running a `compute` step, asserting the spec's CSV scenario values. (c) Live: on the worktree's dev server with a
throwaway user — upload a CSV with blank cells, create a pipeline with the concat-only compute and with the coalesce
compute, run, read `/api/outputs/:id/rows`; capture analyze for `coalesce($n, "n/a")` showing the validationError while
the step saves (2xx). On main the coalesce expression is rejected at save (parse error) — that is the live red.
Capture main's actual save status + message for the coalesce expression. Residue deleted by exact id; never `matt@helio.dev`.

**D8 — Docs.** `docs/compute-expression-grammar.md`: `coalesce` table row; worked example
`concat(coalesce($first, ""), " ", coalesce($last, ""))` with the CSV-blank motivation; the null-propagation paragraph
names `coalesce` as the exception; Errors example message updated; inference section gains the common-type rule and the
mixed-type error (and that it is analyze-only, D5 — the pipeline page's step-config-invalid notice is display only,
server-side runs still fire); Known limitations points conditionals at HEL-1070. No frontend
change (no function list/autocomplete exists; placeholder text unchanged). Re-grep helio-mcp and assistant prompts for a
compute-function enumeration (HEL-1315 found none); update any found.

## Risks / Trade-offs

- [Mixed-type coalesce saved anyway still runs, returning numbers in a column analyzed as the wire type] → analyze shows
  the error inline; runtime behavior documented. Accepted by the owner's ruling.
- [Growing a 724-line file] → ≤ ~40 net lines; the common-type helper is a small private function. HEL-1404 owns the split.
- [`integer`-typed field coalesced with itself infers `"integer"` while runtime emits a JSON number like `3.0`] →
  pre-existing for a bare `$int` reference; not introduced here.

## Planner Notes

- Self-approved: D1 arity ≥ 2, D2 short-circuit + error-in-reached-arg → row null (coordinator: reasonable; skeptic judges).
- Owner ruling: mixed-type → analyze error (D3/D4). D5 run-gating verified in code; not a run-blocker.
- Driver corrections: no frontend autocomplete exists; HEL-1315's "docs sync guard" is manual (D8) plus exact-message
  assertions, not an automated doc test.
- Overlap noted, not absorbed: HEL-1070 (`if`/boolean logic would subsume some coalesce uses), HEL-1403 (analyze-time
  type warnings for numeric functions — D3/D4 is the first analyze-time type *error* in compute; HEL-1403 should reuse
  D4's plumbing).
