## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 0f95ec499d15ef0504b80f7873d4bd01d62888ca. Change dir untracked, source unmodified
(`ExpressionEvaluator.scala` sha1 68845fc4..., 741 lines). Baseline bytecode: `javap -public` against the worktree's
own sbt-2 build `backend/target/out/jvm/scala-2.13.15/helio-backend/classes/` (CAS symlinks, 2026-10-09 12:52).

### What I verified (with evidence)

**CR A (fixed order, delta-5 touches exactly 7): fixed.** design.md L137-145 now prescribes (i) suffix
normalisation -> (ii) remove moved-member `$anonfun$`/`$$` lines from BEFORE -> (iii) delta-5 rewrite on the remaining
BEFORE `$anonfun$` lines, must touch exactly 7 -> (iv) ctor rewrite -> (v) empty diff. I simulated it on the baseline
dumps:
- `$$` lines in `ExpressionEvaluator$`: `$$DollarPrefixRequiredMsg`, `$$checkArity`, `$$evalExpr`, `$$valToJs`. All
  four name D2-moved members, so step (ii) removes them (including `$$evalExpr`, whose descriptor also names `Expr`).
- `$anonfun$` lines removed in step (ii): `tokenize$1` (+`$adapted`), `parse$1`, `parseLegacy$1`, `inferTypeOf$1..7`,
  `evalExpr$1..9`, `applyFn$1..4`. All are moved members per D2.
- Remaining `$anonfun$` lines: `validate$1`, `validateTolerant$1`, `checkRefs$1/3/2`, `inferType$1`, `evaluate$1`
  (in `ExpressionEvaluator$`), plus `eval$1` (in `CompiledExpression`). The two-string rewrite touches:
  - validate, validateTolerant, checkRefs x3, inferType = 6 lines (`ExpressionEvaluator$Expr`);
  - eval$1 = 1 line (`ExpressionEvaluator$Val`);
  - `evaluate$1` does not match: `ExpressionEvaluator$CompiledExpression` does not contain `ExpressionEvaluator$Expr`.
  That makes **exactly 7**, so the count holds.
- Mirror class `ExpressionEvaluator` has only the six public forwarders and nothing that names a moved type, so it is
  unaffected.

**CR B (class-file set): fixed.** design.md L146-153 names
`ExpressionEvaluator$$anonfun$com$helio$domain$engine$ExpressionEvaluator$$evalExpr$1`. I confirmed it is the only
synthetic class in the baseline `ExpressionEvaluator$*` set (`ls` of the classes dir). Source L598 is the
`collectFirst { case l @ Left(_) ... }` partial function inside `evalExpr`, as cited. The rule is:
- removals are restricted to moved private nested types, or to anonymous classes whose enclosing member moved;
- no anonymous class of a kept member and no non-private type may be removed;
- no new class may be added.

All other baseline `ExpressionEvaluator$*` classes are `Token*`, the AST cases, `StrictParser`/`LegacyParser`, `Val`/`V*`
(all moved), plus `ExpressionEvaluator$` and `$CompiledExpression` (kept).

**Is the check still non-vacuous?**
- The only non-`$anonfun$` rewrite is the single ctor line. Any kept-member signature or default change, any new
  `$$` accessor, or any `Compiled from` change survives as a diff. The red run (perturb `evaluate`) exercises this.
- A kept lambda that is gained or lost, or that changes its descriptor beyond the two exact strings, also survives.
- The rewrite is applied only to BEFORE, toward the exact AFTER names.
- I traced the kept code: `CompiledExpression.eval` calls the now-`private[engine]` `evalExpr`/`valToJs` on another
  object, so no new `$$` accessor arises in `ExpressionEvaluator$`. `checkRefs` stays local to `validate`.

**Earlier fixes still hold.**
- D1 import lists: confirmed against the source cross-references.
  - `checkArity` L230 reads `SupportedFunctions`.
  - `inferTypeOf` reads `unknownFieldMessage` and, at L500, `NumericFunctions`.
  - `isDollarPrefixError` L371 reads `DollarPrefixRequiredMsg`, which moves with it.
- Widening list (D3b): `Val` trait only; `VNum`/`VStr`/`VNull` stay private.
- Token cases are unmodified inside `object Token` (L64-78), so widening the trait plus its companion is sufficient.
- D2 spans match the member grep (L63/64, 84, 88, 202-207, 211/216, 221, 235, 314, 363-371, 477, 508, 518-521, 574-736).
- C5 ("five deltas") and tasks 3.2 are consistent with the revised D6b.
- The revision introduced no placeholders, no contradictions and no scope drift.

### Verdict: CONFIRM

### Non-blocking notes
- Step (iii) says the touched lines must be "the 7 lines named in delta 5", but those names carry suffixes that step (i)
  has already turned into placeholders. api-evidence.md should identify each line by member name plus descriptor
  (e.g. three `checkRefs` lines), not by the original `$N`.
- AC3 says "synthetic-filtered". D6b normalises and itemises instead of filtering, which is stricter.
  api-evidence.md should say so, so the evaluator does not read it as a deviation.
- Two items carry over from round 1:
  - the D2 source-order wording for `DollarPrefixRequiredMsg` (base L80-84) vs the AST (L202-207);
  - stale `PipelineAnalyzeService.inferCompute` citations at base L424/L470, which belong as follow-up candidates in
    files-modified.md.
