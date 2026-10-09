## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 0f95ec499d15ef0504b80f7873d4bd01d62888ca. The change dir is untracked and the source is unmodified:
`ExpressionEvaluator.scala` sha1 68845fc4..., 741 lines. Baseline bytecode was read with `javap -public` from the
worktree's own sbt-2 build at `backend/target/out/jvm/scala-2.13.15/helio-backend/classes/` (CAS symlinks, dated
2026-10-09 12:52, after the 12:47 source).

### Round-1 change requests, checked against ground truth

- **CR1 (delta 5): fixed in substance.** design.md L128-139 adds delta 5. I re-ran javap on the baseline
  `ExpressionEvaluator$` and `ExpressionEvaluator$CompiledExpression`. Exactly seven kept-member lambdas name a moved
  type:
  - `ExpressionEvaluator$`: `$anonfun$validate$1`, `$anonfun$validateTolerant$1`, `$anonfun$checkRefs$1`, `$2`, `$3`
    and `$anonfun$inferType$1`, all with `ExpressionEvaluator$Expr`.
  - `CompiledExpression`: `$anonfun$eval$1(ExpressionEvaluator$Val)`.

  No kept-member `$adapted` bridge exists. The only `$adapted` is `$anonfun$tokenize$1$adapted`, a moved member, so
  "7" is correct. `$anonfun$evaluate$1(Map, ExpressionEvaluator$CompiledExpression)` stays unchanged, and the rewrite
  string `ExpressionEvaluator$Expr` does not match `ExpressionEvaluator$CompiledExpression`.

  D6b.4 now says "the one non-synthetic delta" (L126) and C5 says "five deltas" (tasks.md L7). **But the
  normalisation's order of operations contradicts its own count. See new CR A.**
- **CR2 (D3(b) widening): fixed.** `VNum`/`VStr`/`VNull` now stay `private` (L76), and only the `Val` trait is widened.
  I re-checked kept entry-point code (L395-572): none of it references `VNum`/`VStr`/`VNull`. The only `Val` use in kept
  code is the lambda inside `CompiledExpression.eval`, through `valToJs`'s signature. A sealed `private[engine]` trait
  with `private` same-object subclasses compiles, and no kept code pattern-matches on `Val`.
- **CR3 (Risks bullet 1): fixed.** L154-158 now states that private nested types are already public in bytecode, and
  that the AC1 grouping is the sole reason the AST is moved.
- **CR4 (D1 imports): fixed and complete.** I grepped the cross-references in the live source:
  - parser: `checkArity` reads `SupportedFunctions` (L230). `DollarPrefixRequiredMsg` is read only by `StrictParser`
    (L298) and `isDollarPrefixError` (L371), and both move with it.
  - inference: `inferTypeOf` reads `unknownFieldMessage` (L482) and `NumericFunctions` (L500). `coalesceType` is local.
  - interpreter: no `SupportedFunctions`/`NumericFunctions`/`checkArity`/`unknownFieldMessage` reference in L574-740
    (L706 is a comment only). It needs nothing from the entry point.
  - entry point: uses `parse`, `parseLegacy`, `isDollarPrefixError`, the AST cases (`checkRefs` L453-463, ctor L527),
    `inferTypeOf` (L475), `evalExpr` and `valToJs` (L529). This matches the D1 lists at L41-49.
- **CR5 (baseline dir): fixed.** tasks.md 1.2 pins `backend/target/out/jvm/scala-2.13.15/helio-backend/classes/` and
  forbids the stale `target/scala-2.13/classes`.

### Is the D6b rule now non-vacuous, and does it still fail on a real change?

- **It still fails on a real signature change.** No type rewriting is applied to non-`$anonfun$` lines except the
  single `CompiledExpression` ctor line. So any change to a public or `private[engine]` kept method descriptor, an added
  `$default$` method, or a changed `Compiled from` line survives normalisation as a non-empty diff. The red run (change
  a parameter type or default on `evaluate`) exercises this path.
- **Lambdas are covered too.** A kept member that gains a lambda produces an after-line that no rule removes, so it
  fails. A kept member that loses one produces a before-line whose `<name>` is not a moved member, so it fails. A kept
  lambda whose descriptor changes in any way other than the two exact string rewrites also fails.
- **I found no vacuous path.** The rewrite runs on the BEFORE dump only, toward the exact after-names, so it can only
  make matching lines equal.
- **It is internally inconsistent in two places** (CR A, CR B). Neither makes it vacuous. Both force an executor to
  improvise a relaxation of the rule mid-execution, which is the "re-word the check until it passes" failure mode.
  They are cheap to fix now.

### Verdict: REFUTE

### Change Requests

A. **design.md D6b.5 / L137-139: fix the order of operations so the count of 7 holds.**
   - **The problem.** As written, delta-5 type rewriting is applied to the BEFORE dump's `$anonfun$` lines (L133-135),
     and the summary at L137-139 applies it before moved-member lines are removed. In the baseline `ExpressionEvaluator$`
     that rewrite touches 17 lines, plus `$anonfun$eval$1` in `CompiledExpression`, for 18 in total. The 11 extra lines
     belong to moved members:
     - `$anonfun$inferTypeOf$2`, `$4`, `$5`
     - `$anonfun$evalExpr$1`, `$2`, `$3`, `$4`, `$6`, `$7`, `$8`
     - `$anonfun$applyFn$1`

     That contradicts "the count must be exactly 7", and renumbering does not explain the difference.
   - **The fix.** State the pipeline explicitly:
     1. Apply suffix normalisation.
     2. Remove the before-lines whose `$anonfun$<name>` / `$$<name>` names a moved member, each listed.
     3. Apply the delta-5 two-string rewrite to the remaining `$anonfun$` lines of the BEFORE dump. It must touch
        exactly the 7 named lines.
     4. Apply the delta-4 ctor rewrite.
     5. Require an empty diff.

     Alternatively, scope the delta-5 rewrite by name to the seven listed kept-member lambdas.
B. **design.md D6b class-file-set paragraph (L141-143): predict the synthetic anonymous class.** The baseline set also
   contains `ExpressionEvaluator$$anonfun$com$helio$domain$engine$ExpressionEvaluator$$evalExpr$1.class`. It is the
   partial-function class scalac emits for `collectFirst { case l @ Left(_) => l; case r @ Right(v) if v != VNull => r }`
   in `evalExpr` (base L598).
   - It leaves the `ExpressionEvaluator$*` set with the move, but it is not a "moved private nested type".
   - It will reappear under an `ExpressionInterpreter$$anonfun$...evalExpr$1` name. The `$$...$$` expansion will likely
     drop, because `evalExpr` becomes `private[engine]`.
   - Name it in the expected-removed list and state the rule: synthetic `$$anonfun$<...><member>$N` classes may be
     removed only if `<member>` is a moved member.

### Non-blocking notes

- AC3 says "synthetic-filtered". D6b does no filtering and instead normalises and itemises, which is stricter. That is
  fine. api-evidence.md should say so explicitly, so the evaluator does not read it as a deviation.
- The round-1 notes still apply: the source-order wording for `DollarPrefixRequiredMsg` versus the AST in D2, and the
  stale `PipelineAnalyzeService.inferCompute` citations at base L424/L470 (two sites, not one) as a follow-up candidate.
- Projected file sizes, the D4 toString reasoning and the D5 init analysis are unchanged from round 1 and still hold.
