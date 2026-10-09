## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `0107213f4a78a4fd78a9a3223825a09ac584cd00` against the live-resolved base
`0f95ec499d15ef0504b80f7873d4bd01d62888ca` (`resolve-review-base.sh`, exit 0). I wrote every check below myself, in my
own scratch dir (`scratchpad/skeptic-final-hel1404-cold/`). I did not reuse the executor's or evaluator's scripts,
builds or logs. The executor's and evaluator's reports were treated as claims to verify.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/split-expression-evaluator/HEL-1404`.
- **Scope:** `git diff --name-only BASE...HEAD` outside `openspec/` lists only the 5 engine `.scala` files and
  `domain/engine/README.md`. No caller was edited, and `grep` finds no reference to the four new objects outside their
  own files (C2). origin/main has moved 2 commits since the base (HEL-1429, HEL-1399). Neither touches
  `ExpressionEvaluator`/`engine/Expression*`.
- **AC5 / C1, zero test diff:** `git diff 0f95ec499...HEAD -- backend/src/test | wc -c` returns `0`.
- **AC1, split along the four concerns:** Tokenizer is 139 lines (Token ADT + `tokenize`). Parser is 175 (AST,
  `DollarPrefixRequiredMsg`, `checkArity`, Strict/Legacy parsers, `parse`/`parseLegacy`/`isDollarPrefixError`).
  TypeInference is 48 (`inferTypeOf`, `coalesceType`). Interpreter is 183 (`Val`, `evalExpr`…`valToJs`). The entry
  point is 227. Each new object is a `private[engine] object` in `com.helio.domain.engine`.
- **AC2 / C4, byte-identical move, my own checker** (`mycheck.py`, a difflib alignment of the base against each new file
  with autojunk off):
  - The only normalisation is `private[engine] ` → `private ` plus the single D3(c) `ArrayBuffer` de-qualification.
  - Result: every base line is claimed except 9 blank lines. Four base lines show as "unclaimed" only because my
    normaliser rewrote lines that were already `private[engine]` at base. Those are `SupportedFunctions` (L211),
    `NumericFunctions` (L216), `unknownFieldMessage` (L407) and the `CompiledExpression` ctor (L527). I confirmed each
    by `diff` to be byte-identical to `ExpressionEvaluator.scala:68/73/109/181`.
  - No non-trivial base line is claimed twice. The only exceptions are `package` and `import spray.json._`, which are
    D3(a) scaffolding.
  - Every unmatched new line is D3 scaffolding: imports, the one-line header comment per object, and the object openers.
  - The widened members are exactly D3(b)'s list: Token trait+companion, `tokenize`, `Expr`+5 cases, `parse`,
    `parseLegacy`, `isDollarPrefixError`, `inferTypeOf`, `Val`, `evalExpr`, `valToJs`. `VNum/VStr/VNull`, `checkArity`,
    the parser classes, `DollarPrefixRequiredMsg`, `coalesceType` and the interpreter helpers stay `private`.
  - **Red run:** changing `VNum(`→`VNun(` at Interpreter:57 in a scratch copy produced `UNMATCHED Interpreter:57` plus
    `base 615` unclaimed (both directions fire).
  - The double blank line after `object ExpressionEvaluator {` is base text (base L61-62), verified with `cat -A`.
  - Positional words (`above`/`below`) remaining in the 5 files all refer to same-file text and are still true.
  - Inline-FQN grep over the 5 files, outside `package`/`import` lines: 0 hits.
- **AC4 / C3, single-sourced lists:** `val SupportedFunctions` and `val NumericFunctions` are each defined once, at
  `ExpressionEvaluator.scala:68` and `:73`. They are read via named imports at `ExpressionParser.scala:3` (used at :34 in
  `checkArity`) and `ExpressionTypeInference.scala:3` (used at :32). `ExpressionEvaluatorSpec:722-773` (unchanged) still
  reads them from `ExpressionEvaluator`.
- **AC3 / C5, D6b javap, fixed order:**
  - **Baseline build:** a pristine `git archive 0f95ec499 backend` extracted into my scratch dir and built with
    `nice -n 19 sbt -J-Xmx3g compile` (rc=0). sbt 2 served it from its content-addressed disk cache, which is keyed by
    source content.
  - **After build:** the worktree's HEAD classes. Re-dumped after my own testFull rebuild, `diff -r` reports them
    identical ("STABLE").
  - **Classes checked (13):** `ExpressionEvaluator`, `ExpressionEvaluator$`, `ExpressionEvaluator$CompiledExpression`,
    `EvaluationError`, `EvaluationError$`, and `EvaluationError$X` / `EvaluationError$X$` for each of the 4 X.
  - **Raw diff:** 11 classes are 0 lines, so no `Compiled from` change (delta 1). `ExpressionEvaluator$` is 40 lines.
    `CompiledExpression` is 4 lines.
  - **(i)** I applied the `$anonfun$<name>$N` suffix normalisation to both dumps. No renumbering actually occurred.
  - **(ii)** Removed from BEFORE: 28 lines, all moved members. That is 4 `$$` accessors (`DollarPrefixRequiredMsg`,
    `checkArity`, `evalExpr`, `valToJs`), plus lambdas of `tokenize` (+`$adapted`), `parse`, `parseLegacy`,
    `inferTypeOf`×7, `evalExpr`×9 and `applyFn`×4. None belongs to a kept member.
  - **(iii)** The delta-5 rewrite touched exactly 7 lines: 6 in `ExpressionEvaluator$` (`validate`, `validateTolerant`,
    `checkRefs$1/2/3`, `inferType`) and 1 in `CompiledExpression` (`eval$1`).
  - **(iv)** The ctor rewrite changed `ExpressionEvaluator$Expr` → `ExpressionParser$Expr` on 1 line.
  - **(v)** Normalised diff is EMPTY for both classes (21 = 21 lines for `ExpressionEvaluator$`).
  - **Red run:** mutating `evaluate(java.lang.String,` → `evaluate(java.lang.Object,` in the after dump gives a 1-line
    diff, rc=1.
  - **Class-file set:** every class removed from `ExpressionEvaluator$*` is a moved private nested type (Token*, AST,
    Strict/LegacyParser, Val/V*) or the single `$$anonfun$...$$evalExpr$1`, which reappears as
    `ExpressionInterpreter$$anonfun$evalExpr$5`. No `ExpressionEvaluator$*` or `EvaluationError*` class was added.
- **Behaviour / D4, my own probe** (`probe/src/SkProbe.java`, plain `java` against both class dirs):
  - Inputs: 43 expressions × 6 entry points (`evaluate`, `parseProblem`, `validate`, `validateTolerant`, `inferType`,
    `compile(...).eval`) on a row with int, float, string and null columns.
  - Coverage: all 11 functions, arity errors, an unknown function, type errors, `mod` by 0, legacy bare identifiers,
    empty/whitespace input, tokenizer errors, `coalesce` mixes, and an unknown field.
  - Result: 258 lines, `sha256` identical before and after (`f32e312c…df7ed`). No exceptions.
  - D4 strings are unchanged: `DivisionByZero(BinOp(/,NumLit(1.0),NumLit(0.0)))` and
    `Unexpected token in expression: Ref(y)`.
- **C6:** no class or case object simple name changed. The class-file listing shows the same simple names under the
  new owners. There is no grammar change: the move is byte-identical, and the probe output is identical.
- **Gate, own run:** `nice -n 19 sbt -J-Xmx3g testFull` on HEAD, backgrounded and polled with `await-sentinel.sh`:
  ```
  [info] Total number of tests run: 6445
  [info] Suites: completed 463, aborted 0
  [info] Tests: succeeded 6445, failed 0, canceled 4, ignored 0, pending 0
  [info] All tests passed.
  ```
  The D6c per-suite counts I computed from my log are ExpressionEvaluatorSpec 117, ComputeCoalesceCsvSpec 2,
  PipelineAnalyzeServiceSpec 134, AnalyzeSchemaWarningsSpec 56, ComputeStepSpec 9,
  WorkspaceContextServiceComputeColumnStatsSpec 35 and WorkspaceContextServiceComputeJoinHintsSpec 12. These equal the
  baseline the executor and the evaluator each claim from their separate baseline runs. The total of 6445 equals the
  evaluator's independent pristine-archive baseline. I did not run a baseline testFull of my own. With zero test diff,
  the per-suite counts cannot move unless suites failed to run, and that is excluded by 463 completed, 0 aborted. No
  flake fired, so no re-run was needed.
- `node scripts/check-scala-quality.mjs`: clean, with soft warnings only.
- **UI:** N/A. This is a backend-only change, and no `frontend/**` file changed.
- **Mtime evidence:** none relied on. Every claim above rests on content diffs, line counts or checksums.

### Verdict: CONFIRM

### Non-blocking notes
- `openspec/changes/split-expression-evaluator/evaluation-1.md` is untracked in the worktree (`git status --short`).
  The orchestrator should commit it with the delivery artifacts.
- The branch is 2 commits behind origin/main. Neither commit overlaps this change, but the merge/rebase is the
  orchestrator's step.
- The follow-up candidates in `files-modified.md` are sound and worth filing: the stale `PipelineAnalyzeService.inferCompute`
  citations, the duplicate `"float"` branches, the no-op `s""` interpolators, and `ExpressionEvaluatorSpec` at 852 lines.
- `move-check/dump_javap.sh` hardcodes a worktree path. It is evidence tooling only and has no effect on shipping.
