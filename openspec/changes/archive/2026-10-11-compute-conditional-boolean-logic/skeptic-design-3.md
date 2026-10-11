## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `64e374bb7519262655370bc8c0e210dba930f251`. No code has changed yet; the only untracked item is `openspec/changes/compute-conditional-boolean-logic/`. This was a cold read of:
- the change dir: ticket.md, proposal.md, design.md, tasks.md and the spec delta;
- the live `domain/engine` sources: ExpressionParser, ExpressionEvaluator, ExpressionTypeInference, ExpressionInterpreter and ExpressionNumericContexts;
- ColumnSchemaInference.inferCompute, AnalyzeSchemaWarnings, PipelineAnalyzeReads, RunConfigGate and AutoRunTriggerService;
- the base spec `openspec/specs/compute-expression-language/spec.md` and `pipeline-analyze-schema-warnings/spec.md`.

### What I verified (with evidence)

- **Cwd guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/compute-conditional-boolean-logic/HEL-1070`.

**Round-2 CR1 (the legacy-deviation rule): CLOSED.**
- **The live mechanism.** Every fallback site keys on the strict parser's first error being exactly `DollarPrefixRequiredMsg`:
  - `parseProblem` (Evaluator:105-110), `validateTolerant` (:150-156) and `compile` (:206-214) all use `isDollarPrefixError(msg)` (Parser:197).
  - The strict `parseFactor` returns that message only from `case Token.Ident(_)` (Parser:118).
  - `validate`/`inferType` are strict-only, so a legacy expression already had a validationError on the pipeline compute step. Legacy matters only at run time, through `compile`.
- **I traced each pinned case through D2's grammar against the live parser:**

  | Expression | Strict parse under D2 | Result |
  |---|---|---|
  | `price * and` | fails on `price` with the `$`-prefix error | legacy `FieldRef*FieldRef` = 6, unchanged |
  | `true + price` | `BoolLit`, `+`, then fails on `price` with the `$`-prefix error | legacy `concatStr(VStr("x")) + numStr(2.0)` = `"x2"` (`numStr` drops `.0`, Interpreter:179), so the spec scenario value is right |
  | `True + price` | same, keywords are case-insensitive | unchanged |
  | `and + 1` | reserved-word error | no fallback, changed |
  | `not + price` | after `not`, factor sees `Plus` and gives "Unexpected token" | no fallback, changed |
  | `true`, `true * 2` | parses | changed |

  This matches D1, the spec's Boolean-operators requirement, the new "legacy expressions with other bare names still fall back" scenario, ticket AC exception (ii), and the pins in task 4.1.
- **Other cases I tried also come out as the rule predicts.** `price and qty`, `true price`, `true(price)`, `(true) * price` and `price * not(x)` all either fall back exactly as before or were errors before and are errors now.
- **`date_trunc`.** Its first-argument rewrite (Parser:107) only rewrites the `$`-prefix message. A reserved word there passes through as the reserved-word error. Correct.

**Round-2 CR2 (the stale `$`-prefix requirement): CLOSED.**
- I diffed the MODIFIED "Column references require a `$` prefix" block against the base (lines 10-79). Exactly two hunks:
  - the reserved-word carve-out, including the "also when immediately followed by `(`" clause;
  - one added scenario ("reserved words are not column references").
- Every base scenario is carried over verbatim.

**D6b (a boolean used as a number):**
- **Run behaviour does not change.** D6b is inference-only, and the interpreter's TypeError on a VBool operand (D4) yields the same per-row null that `VStr("true")` gave before.
- **Analyze/apply parity holds.** The error is surfaced through `inferCompute`'s existing `Left` arm (ColumnSchemaInference:71-75), which keeps the column at its hint type. HEL-1423's coalesce error uses the same path.
- **Run gating is not affected.** `RunConfigGate.stepConfigReasons` (used by the scheduler and auto-run) reads only the raw config through `stepConfigProblem`/`validateStepConfig`, never schema inference. A D6b error therefore cannot skip a scheduled run or block auto-run.
- **The analyze response is affected.** `PipelineAnalyzeReads.toCostVerdictResponse` (:186-192) adds a `step-config-invalid` reason and clears `canRun`/`autoRunnable` for ANY `validationError`, including inference ones. The UI then shows the denial block without "Run to update" (PipelineDetailFooter:144-157). The always-visible Run button remains. This is existing HEL-1423 behaviour and the same class as the already-disclosed `coalesce($flag, "x")`. See note 3.
- **The numeric-context warning stays consistent.** `numeric-op-on-text-field` is emitted only for steps with no validationError (AnalyzeSchemaWarnings:133; pipeline-analyze-schema-warnings spec:122). So D6b keeps the bare-`$flag` warning and replaces it with the error only for the new non-field boolean sub-expressions. No conflicting signals.
- **Old expressions that change under D6b.** The only old-grammar inputs D6b can newly reject are:
  - `true`/`false` legacy bare words, which are now literals and already pinned;
  - an all-boolean `coalesce(...)` in a numeric position. This used to warn only; see note 3.

**Other checks:**
- The proposal's Impact names `ComputeFieldConfig.tsx`, while design D8 names `ComputeFunctionReference.tsx`. Both files exist under `frontend/src/features/pipelines/ui/stepConfigs/`. This is not a contradiction.
- `NumericFunctions` = abs, ceil, floor, mod, round (Evaluator:78). This bears on note 2.

### Verdict: CONFIRM

Both round-2 change requests are closed against live code. The order-dependent fallback rule is now described accurately in all four places and pinned in both directions. D6b introduces no run-time change and no run-gating change. Its analyze-side effect follows the established HEL-1423 path. The notes below are polish for the executor and the PR, not blockers.

### Non-blocking notes

1. **Bare `not` message.** Under D2's `notExpr -> 'not' notExpr`, bare `not` consumes the keyword as an operator and then hits EOF, which gives "Unexpected end of expression". It never reaches factor position. Tasks 4.1 and the spec expect the reserved-word message, so the executor needs an explicit rule: `not` followed by a token that cannot start an operand reports `'not' is a reserved word ...`. Either message avoids the `$`-prefix error, so the legacy fallback is unaffected. This is only a hint so the 4.1 test isn't a surprise.
2. **D6b's "numeric-function argument" set is narrower than the warning's numeric contexts.** `ExpressionNumericContexts` also treats `add_days`'s day-count argument as numeric (and spec:122 says so). Suggestion: D6b should use the same set: the arguments of `NumericFunctions`, `add_days` argument 2, and the operands of `-`/`*`/`/`/unary `-`. Otherwise `add_days($ts, $a > 1)` stays a silent all-null with no analyze signal. `substring`'s index arguments are the same class and are optional.
3. **Disclose the analyze-verdict effect in Risks/PR.** An all-boolean `coalesce(...)` used in a numeric position moves from warning to validationError. Like every inference error, it then shows the `step-config-invalid` denial and hides "Run to update" in the analyze verdict. Scheduled and auto-run gating are unaffected. List it next to the `coalesce($flag, "x")` risk.
4. **`($s = "Done") + 1` silently gives `"true1"`.** It correctly infers `string`, so parity holds, but it is a plausible MySQL-style mistake. A one-line mention in the grammar doc next to the `if(cond, 1, 0)` recipe would help.
