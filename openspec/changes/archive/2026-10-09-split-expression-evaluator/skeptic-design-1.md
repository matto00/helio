## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 0f95ec499d15ef0504b80f7873d4bd01d62888ca (unmodified; change dir untracked). Source
`ExpressionEvaluator.scala` byte-identical to the main checkout (sha1 68845fc4...), 741 lines; Context spans in
design.md match the live file.

### What I verified (with evidence)

- **Baseline bytecode.** The main checkout's `backend/target/scala-2.13/classes` are dated Sep 24, older than the
  Oct 9 source (last commit e7470bc6), so they are NOT a valid baseline. I compiled the unmodified worktree instead
  (`nice -n 19 sbt -J-Xmx3g compile`, sbt-2 cache hit keyed on inputs) and ran `javap -public` on
  `target/out/jvm/scala-2.13.15/helio-backend/classes/com/helio/domain/engine/ExpressionEvaluator{,$,$CompiledExpression}`.
  Executor: use the sbt-2 output dir `target/out/jvm/scala-2.13.15/...`, never `target/scala-2.13/` (stale).
- **D6b.3 (expanded `$$` names):** the baseline `ExpressionEvaluator$` has exactly four:
  `$$DollarPrefixRequiredMsg`, `$$checkArity`, `$$evalExpr`, `$$valToJs`. All four name moved members, so the
  prediction "may disappear, none may appear" is correct. No module accessors for the private nested objects appear in
  `javap -public` of `ExpressionEvaluator$`. The static mirror `ExpressionEvaluator` holds only the six public forwarders
  (no forwarders for the `private[engine]` members); unaffected.
- **D6b.4 (ctor):** the baseline ctor is `ExpressionEvaluator$CompiledExpression(ExpressionEvaluator$Expr)`. The
  predicted change to `ExpressionParser$Expr` is correct and is the only NON-synthetic delta. But see CR1: it is not the
  only delta that survives D6b.2's normalisation.
- **D6b.2 (lambdas): incomplete. See CR1.** The baseline exposes kept-member lambdas whose descriptors name the moved
  types:
  - `ExpressionEvaluator$`: `$anonfun$validate$1(Set, ExpressionEvaluator$Expr)`,
    `$anonfun$validateTolerant$1(Set, ExpressionEvaluator$Expr)`,
    `$anonfun$checkRefs$1(ExpressionEvaluator$Expr, Set, BoxedUnit)`, `$anonfun$checkRefs$2(Set, Either, ExpressionEvaluator$Expr)`,
    `$anonfun$checkRefs$3(ExpressionEvaluator$Expr, Set, BoxedUnit)`, `$anonfun$inferType$1(Map, ExpressionEvaluator$Expr)`.
  - `ExpressionEvaluator$CompiledExpression`: `$anonfun$eval$1(ExpressionEvaluator$Val)`.
  These members stay in the entry point, so their lambdas stay too, but their parameter types become
  `ExpressionParser$Expr` / `ExpressionInterpreter$Val`. D6b.2 normalises only the numeric suffix and then says "the
  dumps must be identical". That check WILL fail on 7 lines. D6b does not predict this, even though its stated purpose is
  that deltas are "stated up front (not discovered after a PASS)". The HEL-1376 precedent this copies
  (`archive/2026-10-09-split-model-appearance-types/design.md` L84-85) also requires "identical types and order" after
  suffix normalisation. No such type change happened in HEL-1376. It does happen here.
  Side observation: lambda numbering in this file is per enclosing method (`$anonfun$checkRefs$1..3`,
  `$anonfun$inferTypeOf$1..7`), so kept members may not renumber at all. The normalisation is harmless either way.
- **"Keep the AST in the entry point" alternative (Risks bullet 1): the bytecode half of the rationale is false. See CR3.**
  `javap -public 'ExpressionEvaluator$Expr'` gives `public interface ...` and `ExpressionEvaluator$VNum` gives
  `public final class ...`. Scala-`private` nested types are already JVM-public. Widening them to `private[engine]` does
  not change `javap -public` of `ExpressionEvaluator$` (nested-type modifiers are not listed there) or of the type itself.
  Keeping `Expr`+cases and `Val` in the entry point would therefore produce zero descriptor deltas. Bytecode-wise it is
  strictly better. The decision is still correct, but only because the ticket's AC1 groups "strict + legacy parsers and
  the AST". That is the rationale the design should rest on.
- **D3(b) widening list: complete, but not minimal. See CR2.** I traced every cross-object reference against the live
  source:
  - entry point → parser: `parse`, `parseLegacy`, `isDollarPrefixError`, `Expr`, `NumLit/StrLit/FieldRef/BinOp/Call`
    (`checkRefs` L453-463, `CompiledExpression` L527)
  - entry point → inference: `inferTypeOf` (L475)
  - entry point → interpreter: `evalExpr`, `valToJs` (L529)
  - parser → tokenizer: `Token` + companion, `tokenize`
  - inference → parser: AST
  - interpreter → parser: AST
  - `Val` must be widened because it appears in the signatures of the widened `evalExpr`/`valToJs`. Otherwise it is a
    "private class escapes its defining scope" error.
  - `VNum`/`VStr`/`VNull` are referenced only inside the interpreter (`evalExpr`, `applyOp`, `applyFn`, `numericUnary`,
    `concatStr`, `typeName`, `valToJs`, all co-located per D2). Widening them contradicts D3(b)'s own rule ("exactly the
    members now referenced across objects").
  Nothing is missing from the list: `checkArity`, both parser classes, `DollarPrefixRequiredMsg`, `coalesceType` and the
  interpreter helpers are all same-object only.
- **D1/C3 single-sourcing: sound.** `SupportedFunctions` (L211) and `NumericFunctions` (L216) are already
  `private[engine]`, so their bytecode accessors on `ExpressionEvaluator$` stay. `checkArity` (L230) and `inferTypeOf`
  (L500) read them at call time. `ExpressionEvaluatorSpec` L722-723 and L748-768 read them through `ExpressionEvaluator.`,
  so there is no test diff. One omission: `inferTypeOf` L482 also calls `unknownFieldMessage` (entry point,
  `private[engine]`). D1 names only the two vals as the import from `ExpressionEvaluator`. See CR4.
- **D4 toString: sound.** A Scala 2.13 case class `toString` uses `productPrefix`, which is the simple class name
  regardless of the enclosing object (`BinOp(/,FieldRef(a),NumLit(0.0))`, `Ident(x)`; case object `EOF`). No rename is
  planned. Checked: no test asserts either string (grep for `Division by zero` / `Unexpected token in` / `BinOp(` /
  `Ident(` under `backend/src/test`: only type-level `DivisionByZero` matches at L314-317 and L685-686). So the scratch
  probe in D6d is the only evidence of these strings, and the design correctly requires it.
- **D5 init: sound.** The only val in the new objects is `DollarPrefixRequiredMsg`, a literal. The entry point's init
  reads nothing from the new objects.
- **Proof-standard parity:** at least as strict as both precedents. HEL-1385 filtered all synthetics; this design
  normalises only suffixes, like HEL-1376. It has forward and positional-reverse checks, two red runs, a javap red run,
  a class-file-set comparison, a zero test diff, and per-suite counts. Parity holds once CR1 is fixed, because the
  stricter no-filter standard is exactly what exposes the gap.
- **Size and scope:** projected sizes are roughly 230 (entry), 165 (parser), 135 (tokenizer), 40 (inference) and
  175 (interpreter) lines, all under budget. No grammar change and no caller edits. All ACs are covered by tasks 2.x/3.x.

### Verdict: REFUTE

### Change Requests

1. **design.md D6b: add a fifth predicted delta for kept-member lambda descriptors.** In `ExpressionEvaluator$`, the
   parameter type `com.helio.domain.engine.ExpressionEvaluator$Expr` becomes `com.helio.domain.engine.ExpressionParser$Expr`
   in exactly `$anonfun$validate$1`, `$anonfun$validateTolerant$1`, `$anonfun$checkRefs$1`, `$anonfun$checkRefs$2`,
   `$anonfun$checkRefs$3` and `$anonfun$inferType$1`. In `ExpressionEvaluator$CompiledExpression`,
   `ExpressionEvaluator$Val` becomes `ExpressionInterpreter$Val` in `$anonfun$eval$1`.
   - Define the normalisation precisely: after suffix normalisation, rewrite only these two type names on `$anonfun$`
     lines of kept members.
   - The rest must then be byte-identical in order.
   - Any other `$anonfun$` line that changes type is a failure.
   - Update the D6b.4 wording so it says the ctor is the only non-synthetic delta, not the only remaining delta.
   - Update C5 in workflow-state.md ("four deltas") to match.
2. **design.md D3(b): drop `VNum`/`VStr`/`VNull` from the widening list.** They are interpreter-internal. Widen `Val`
   alone, which is forced by `evalExpr`/`valToJs`'s signatures. Keep the existing escape hatch: if the compiler forces it,
   list it with the error.
3. **design.md Risks bullet 1: correct the false bytecode claim.** Scala-private nested types are JVM-public (javap above),
   so keeping the AST in the entry point would not perturb `javap -public` and would avoid CR1's deltas. State the real
   reason for the choice: AC1 explicitly groups the AST with the parsers, and the descriptor deltas are synthetic or
   package-private and predicted.
4. **design.md D1: complete the named import.** The type-inference object also imports `unknownFieldMessage` from
   `ExpressionEvaluator` (base L482). Enumerate the full import list per destination so "named import" is unambiguous:
   - parser: `SupportedFunctions`
   - inference: `NumericFunctions`, `unknownFieldMessage`
   - interpreter: none from the entry point (`EvaluationError` is top-level)
5. **tasks.md 1.2 / design.md D6b: pin the baseline class directory** to the sbt-2 output
   `backend/target/out/jvm/scala-2.13.15/helio-backend/classes/` built from this worktree. The main checkout's
   `backend/target/scala-2.13/classes/` is stale (Sep 24, predates current source) and must not be used.

### Non-blocking notes

- D2 lists the parser's members AST-first, but D3's "source order" puts `DollarPrefixRequiredMsg` (base L80) before the
  AST (L202). Source order should govern; worth one clarifying word.
- Follow-up candidate, not for this change: the object doc (L46) and `validate`'s doc (L424) still cite
  `PipelineAnalyzeService.inferCompute`, which is stale since HEL-1385 moved it to `ColumnSchemaInference`. List it in
  files-modified.md per D3.
- The new parser keeps `checkArity`/`DollarPrefixRequiredMsg` private while they are accessed from the nested parser
  classes. They will gain `$$` accessors on `ExpressionParser$`. That is expected and outside the D6b class set.
