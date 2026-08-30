## Context

`ComputeStep.apply` calls `ExpressionEvaluator.evaluate(expr, jsRow)` once per row and maps `Left` to `null`. `expr` is loop-invariant, so a parse failure is identical on every row. The observed production symptom is 1000 rows, 1000 nulls, a green run, and no error anywhere.

Two pieces of machinery already exist and must be composed with, not duplicated. HEL-814 (`8f3756eb`) put a two-tier contract on `PipelineStep.Companion`:

| Hook | Tier | Wired at |
| --- | --- | --- |
| `validateRawConfig(raw): Option[String]` | shape, **write** path — plus analyze | `PipelineService:494` (create), `PipelineService:670` (update), `PipelineProposalService:187`, `PatchSetApplyResolvers:240`, **`PipelineAnalyzeService:128`** |
| `requiredConfigProblems(raw): Vector[String]` | semantic, **run/analyze** path | `InProcessPipelineEngine:145`, `PipelineAnalyzeService:141` |

The split is deliberate: an unconfigured draft must be *saveable* but not *runnable*. HEL-859 supplies the run-path error shape — `InProcessPipelineEngine` throws `IllegalArgumentException`, and `StepExecutionException.from` attributes it to the step's id and kind.

## Goals / Non-Goals

**Goals.** Reject a statically unparseable expression at every write surface; fail the run (naming step id, kind, reason) for one stored before this change; keep genuine per-row failures as `null`; keep an empty expression saveable; add no third validation mechanism.

**Non-Goals.** Field-reference validation on the write path (Decision 2). Any change to the read path (Decision 5). Any change to `ExpressionEvaluator`'s grammar, to `parseLegacy`, or to what `evaluate` accepts. Auditing other step kinds' expression handling — `filter` is HEL-889's surface and is already merged; no other kind takes a free-form expression. Also out of scope: `ExpressionEvaluator.evaluate`'s two callers outside the pipeline step path — `SourceService.applyComputedFields` and `DataTypeService` (via `validateTolerant`). `DataTypeService` hard-blocks on validation and is safe; `SourceService`'s computed-field path may carry the same discard-the-`Left` shape. If it does, that is a spinoff ticket, not scope here — it is a different capability with a different write surface.

## Decisions

### Decision 1 — "Statically invalid" means *unparseable under the same grammar `evaluate` uses*, not "fails strict `validate`"

The ticket says to reuse `ExpressionEvaluator.validate`, the strict checker `PipelineAnalyzeService.inferCompute` already runs. Reading the code, using `validate` on the write path would be a live regression, and this is the single most load-bearing decision in the change.

`evaluate` is legacy-tolerant:

```scala
def evaluate(expr: String, row: Map[String, JsValue]): Either[EvaluationError, JsValue] =
  parse(expr) match {
    case Right(ast) => evalExpr(ast, row).map(valToJs)
    case Left(msg) if isDollarPrefixError(msg) =>
      parseLegacy(expr) match { ... }
    case Left(msg) => Left(EvaluationError.ParseError(msg))
  }
```

`validate` is not — it is `parse(expr).flatMap(checkRefs(_, fieldNames))`, strict, and its own doc comment says a bare identifier "is always rejected, even if it matches a known field name." The `pipeline-compute-op` spec makes the asymmetry a shipped requirement: the legacy fallback exists "so existing persisted compute steps continue to produce their pre-existing output without modification, with no data rewrite," and applies "only to row-execution (`evaluate`) — schema-inference and live validation use the strict grammar only."

So a bare-identifier expression like `price * qty` fails strict `validate` while evaluating perfectly at run time. Gating the write path on `validate` would 422 every such expression on its next edit — breaking working pipelines to fix a bug about broken ones.

**Decision:** the write-path and run-path predicate is *parseability*, defined as exactly the condition under which `evaluate` returns `ParseError` for every possible row. Add:

```scala
def parseProblem(expr: String): Option[String] =
  parse(expr) match {
    case Right(_)                              => None
    case Left(msg) if isDollarPrefixError(msg) => parseLegacy(expr).left.toOption
    case Left(msg)                             => Some(msg)
  }
```

This is `evaluate`'s parse arm with the evaluation removed. It cannot diverge from run-time behaviour by construction, and it needs no schema.

The acceptance criterion "with the evaluator's own message" is met: the message is `parse`/`parseLegacy`'s own, the same string `validate` would surface for a parse failure. The criterion asks for the evaluator's message rather than a generic one; it does not require the strict field-checking `validate` additionally performs.

*Why the production case is still caught.* Traced through the code rather than assumed. `"stats.adp_ppr - stats.pts_ppr"` fails in the **shared tokenizer**, before either parser runs: `stats` lexes via the bare-identifier branch, which deliberately admits no dots, so it emits `Token.Ident("stats")`; the following `.` then enters the number branch, which consumes only the `.` and fails with `Invalid number literal: .`. HEL-867's dotted-reference support lives in that same shared tokenizer's `$`-branch and its friendlier dotted-ref message is gated on the previous token being a `Token.Ref` — here it is a `Token.Ident`, so that message is skipped. Because `Invalid number literal: .` is not `DollarPrefixRequiredMsg`, `isDollarPrefixError` is false and **`parseLegacy` is never invoked at all**; `evaluate` falls straight to `Left(ParseError(msg))`. There is one lexer, not a strict one and a legacy one, so the legacy grammar could not have accepted this expression either. `parseProblem` therefore returns `Some("Invalid number literal: .")`. This is a code reading and must still be measured — task 1.2.

### Decision 2 — No field-reference checking on the write path

`validate` needs a `fieldNames` set. At step create the upstream output schema is not known without running analyze, and an unknown field is genuinely data-dependent (a `lookup` or `union` upstream can introduce a field only at run time). Unknown-field therefore stays a per-row `null`, exactly as the current spec says. Only parseability — which needs no schema and cannot vary by row — is promoted. This keeps the change to the one defect that is provably row-independent.

### Decision 3 — Write path: override `validateRawConfig`, composed with `super`

```scala
override def validateRawConfig(raw: String): Option[String] =
  super.validateRawConfig(raw).orElse {
    val expr = ComputeConfig.decode(raw).expression
    if (expr.trim.isEmpty) None
    else ExpressionEvaluator.parseProblem(expr).map(m => s"compute: invalid expression: $m")
  }
```

Shape errors still win, and one override reaches all four write surfaces. The empty-expression short-circuit is hazard 2 in the ticket and is load-bearing: production holds a `compute` with both `column` and `expression` empty (`NFL Player Season Projections`), and HEL-814 deliberately made emptiness a run-time rather than save-time problem. `.trim.isEmpty` rather than `.isEmpty` so a whitespace-only draft behaves like an empty one instead of 422ing on a parse error about an empty input.

### Decision 4 — Run path: extend `requiredConfigProblems`, and get run + analyze + preview from one hook

```scala
override def requiredConfigProblems(raw: String): Vector[String] = {
  val cfg  = ComputeConfig.decode(raw)
  val base = StepCodecUtil.missingRequired(Kind, "column" -> cfg.column, "expression" -> cfg.expression)
  if (base.nonEmpty) base
  else ExpressionEvaluator.parseProblem(cfg.expression).map(m => s"invalid expression: $m").toVector
}
```

The existing missing/empty check runs first, so an empty expression still reports "missing expression" rather than a confusing parse message. `InProcessPipelineEngine:145` already turns a non-empty result into `IllegalArgumentException`, which `StepExecutionException.from` attributes to step id and kind — acceptance criterion 2 in HEL-859's style, with no new error plumbing. `PipelineRunService.previewStep` calls `engine.executeWithStepCounts`, the same fold, so preview surfaces it too rather than showing a column of blanks.

**Analyze arrives by the write-path override, not this one.** `PipelineAnalyzeService` calls *both* hooks, and `shapeRejection` short-circuits: `if (shapeRejection.nonEmpty) shapeRejection else { ...requiredConfigProblems... }` (`:128-132`). Once Decision 3 lands, an unparseable expression is caught at `:128` by `validateRawConfig`, and the `requiredConfigProblems` branch is never reached on the analyze surface. So analyze still reports the parse problem — the acceptance criterion holds — but through Decision 3's string, carrying its `"compute: invalid expression: "` prefix, rather than Decision 4's `"invalid expression: "`.

The same defect therefore surfaces with two different prefixes depending on surface (analyze/write vs. run/preview). This is accepted deliberately rather than discovered at test time: both messages carry the parser's own description, which is what the acceptance criterion asks for, and forcing them to match would mean either dropping the kind prefix the write path uses for every other rejection, or adding an indirection between the two hooks purely for cosmetic parity. Recorded so no test asserts the wrong prefix.

The naming is admittedly a stretch — a *present but broken* expression is not literally "required config missing." The alternative is a third hook, which HEL-814's own ticket warned against and which would have to be wired into both the engine and analyze separately, with the standing risk that the two disagree. Sharing the hook makes divergence impossible. Recorded as a deliberate trade.

### Decision 5 — Nothing on the read path

`ComputeConfig.decode` and `PipelineStepRepository.rowToDomain` are untouched. `rowToDomain` converts any decode failure into an `IllegalStateException` backing every read, so validating there would 500 the pipeline editor for precisely the steps a user needs to open in order to fix them. Both new checks take `raw`/`configValue` and are called only from write and run surfaces. Task 4.3 asserts this by loading a stored bad step through the read path and getting a step object back.

### Decision 6 — `apply` parses once; its per-row semantics are unchanged

```scala
def apply(rows: Seq[Row], cfg: ComputeConfig): Seq[Row] = {
  val column = cfg.column
  rows.map { row =>
    val value = ExpressionEvaluator.evaluate(cfg.expression, PipelineRowJson.rowToJsMap(row)) match { ... }
```

becomes a single pre-parse, then a per-row eval of the parsed AST. This requires exposing an AST-level eval on `ExpressionEvaluator` (`evaluateParsed`, or a `parse`-then-eval pair) alongside the existing string entry point, which stays for other callers.

`apply` remains total and never throws: if the expression does not parse it still yields `null` for every row, exactly as today. That fallback is now unreachable from run, preview and analyze because Decision 4's gate rejects the step first — but keeping it means a direct caller of the pure function sees no behaviour change, and it is the reason this change cannot regress per-row semantics. Acceptance criterion 3 (divide-by-zero, null operand → `null`, run still succeeds) falls out unchanged, because those are `Left` values from *evaluation*, never from parse.

If exposing an AST-level entry point turns out to widen `ExpressionEvaluator`'s public surface more than is comfortable, the fallback is to keep `apply` calling `evaluate` per row and drop only the performance half of this decision. The correctness half — Decisions 3 and 4 — does not depend on it.

## Risks / Trade-offs

- **Previously-storable configs now 422.** Intended, and narrow: only expressions that could never produce a value under either grammar. The empty and whitespace-only cases are explicitly exempted, and Decision 1 exempts bare-identifier expressions that still evaluate.
- **Previously-green runs now fail.** Intended (acceptance criterion 2). The run was producing a column of nulls; failing loudly is the ticket. Callers see HEL-859's attributed message.
- **`requiredConfigProblems` is carrying a second meaning** — Decision 4, accepted to avoid a third mechanism.
- **A config-less update still works on a bad step.** `PipelineService:657-670` runs `validateRawConfig` only when `req.config` is present, so reordering, enabling, disabling or deleting a pre-existing step with an unparseable expression is unaffected by Decision 3. Existing steps are not bricked — they can be moved out of the way or removed without first being repaired.
- **`parseProblem` must track `evaluate`.** If someone later changes `evaluate`'s parse arm without changing `parseProblem`, the write gate and run behaviour drift. Mitigated by a test that drives both over the same expression set (task 1.3) and by a comment on each pointing at the other.

## Migration Plan

None. No schema change, no data rewrite, no config. Steps already stored with an unparseable expression keep loading fine (Decision 5) and start failing at run (Decision 4) instead of silently nulling.

## Open Questions

None outstanding. Decision 1 resolves the one real fork (strict `validate` vs. parseability) against the shipped `pipeline-compute-op` requirement.
