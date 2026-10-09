## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: HEAD `0107213f4a78a4fd78a9a3223825a09ac584cd00` against the live-resolved base `0f95ec499d15ef0504b80f7873d4bd01d62888ca` (`resolve-review-base.sh`, origin/main). The worktree was clean (`git status --short` empty) before and after review.

All evidence below is my own fresh run. I did not reuse the executor's builds or logs. The baseline is a pristine `git archive 0f95ec49` extraction into scratch (never edited), built and tested independently of the executor's worktree.

### Phase 1: Spec Review — PASS
- AC1: four focused objects in `com.helio.domain.engine`: `ExpressionTokenizer` (139 lines), `ExpressionParser` (175: AST + strict/legacy parsers), `ExpressionTypeInference` (48), `ExpressionInterpreter` (183: evaluation + function dispatch). Entry point is 227 lines.
- AC2 / C4: byte-identical move, checked independently (see Phase 2).
- AC3 / C5: the normalised `javap -public` diff is empty and only D6b deltas 2-5 appear (see Phase 2).
- AC4 / C3: `SupportedFunctions` and `NumericFunctions` are each defined only at `ExpressionEvaluator.scala:68` and `:73`. They are read through named imports at `ExpressionParser.scala:3` (`checkArity`) and `ExpressionTypeInference.scala:3` (`inferTypeOf`). `ExpressionEvaluatorSpec` still reads them from `ExpressionEvaluator` (9 references; the spec is unchanged and compiles).
- AC5 / C1: `git diff 0f95ec49...HEAD -- backend/src/test` has 0 lines. Totals and all 463 per-suite counts equal the baseline (see Phase 2).
- C2: the only changed non-openspec files are the five engine `.scala` files plus `domain/engine/README.md`. No caller was edited. Every public and `private[engine]` member of `ExpressionEvaluator` keeps its signature, which the javap check below confirms.
- C6: no ADT class or case object was renamed (class names under `ExpressionParser$*` / `ExpressionTokenizer$*` / `ExpressionInterpreter$*` keep the same simple names). There is no grammar change.
- All tasks are marked `[x]` and match the diff. No scope creep: the README Holds-list update is task 2.5. Defects found during the move are listed as follow-up candidates in `files-modified.md` and were not fixed.

### Phase 2: Code Review — PASS
Gates. These are backend-only changes, so `sbt testFull` is the gate, run with `nice -n 19 sbt -J-Xmx3g testFull`, backgrounded and polled with `await-sentinel.sh`:
- Baseline (pristine 0f95ec49 archive): 6445 run, 463 suites, 0 failed, 4 canceled, "All tests passed".
- After (worktree HEAD 0107213f): 6445 run, 463 suites, 0 failed, 4 canceled, "All tests passed".
- Per-suite counts for all 463 suites (ANSI-stripped `[info] <Suite>:` / `[info] +- ` counter, sum 6449): baseline and after are identical. The D6c suites are ExpressionEvaluatorSpec 117, ComputeCoalesceCsvSpec 2, PipelineAnalyzeServiceSpec 134, AnalyzeSchemaWarningsSpec 56, ComputeStepSpec 9, WorkspaceContextServiceComputeColumnStatsSpec 35, WorkspaceContextServiceComputeJoinHintsSpec 12.
- No flakes in either run (HEL-1439/HEL-1445 did not fire), so no re-run was needed.
- `node scripts/check-scala-quality.mjs`: clean (soft warnings only, none in the changed files).

Executor's baseline process disclosure (it edited sources while the baseline testFull was still running). I checked whether this makes the baseline untrustworthy: it does not. My independent baseline, built from an unedited archive of 0f95ec49, produces a per-suite count file byte-identical to the executor's `base-counts.txt` (`diff` empty, all 463 suites). It also produces the same 42 `ExpressionEvaluator$*` class files the executor reported. In principle the mid-run edit was a risk, but it did not affect the result, and the claim no longer depends on the executor's run.

Move check, done independently. I wrote my own run-matching checker; it is separate from the executor's `check_move.py`:
- Every non-blank line of the 741-line base file is claimed exactly once by a contiguous run in one of the five files. The only unclaimed base lines are 9 blank separators.
- Every new-file line outside a run is scaffolding: `package`, imports, the one-line header comment per new object, the object opener/closer, and blank lines.
- The only edits are the 17 listed D3 edits: 16 D3(b) `private` → `private[engine]` widenings (Token trait + companion, `tokenize`, `Expr` + 5 cases, `parse`, `parseLegacy`, `isDollarPrefixError`, `inferTypeOf`, `Val` trait, `evalExpr`, `valToJs`) and 1 D3(c) `ArrayBuffer` de-qualification. This matches design D3(b)'s list exactly. `VNum`/`VStr`/`VNull`, `checkArity`, both parser classes, `DollarPrefixRequiredMsg`, `coalesceType` and the interpreter helpers stay `private`.
- The double blank line at `ExpressionEvaluator.scala:64-65` is base text (base L61-62), preserved verbatim.
- Red runs of my checker: changing one token in a moved body (`"lower"` → `"lowr"` at Interpreter:100) produced an UNMATCHED line plus an unclaimed base L658. Inserting a duplicated line produced an UNMATCHED line.
- The executor's own `check_move.py` passes on HEAD (`PASS forward + reverse (28 members, 17 edits, 30 allow-listed lines)`) and fails on both of my red copies: forward failure on the token change, reverse failure on an inserted `val buf = ArrayBuffer.empty[Token]` outside any member.

D6b javap, fixed order, against my pristine baseline build (13 classes):
- 11 classes have a 0-line raw diff. No `Compiled from` line changed (delta 1).
- `ExpressionEvaluator$` raw diff is 40 lines:
  - Step (ii) removed only lines of moved members: 4 `$$` accessors (`DollarPrefixRequiredMsg`, `checkArity`, `evalExpr`, `valToJs`) plus lambdas of `tokenize` (+`$adapted`), `parse`, `parseLegacy`, `inferTypeOf` ×7, `evalExpr` ×9 and `applyFn` ×4.
  - Step (iii) touched exactly 6 lines here: `validate`, `validateTolerant`, `checkRefs` ×3, `inferType`.
- `ExpressionEvaluator$CompiledExpression`: step (iii) touched 1 line (`eval`), for 7 delta-5 lines in total. Step (iv) rewrote 1 line (the constructor, `ExpressionEvaluator$Expr` → `ExpressionParser$Expr`).
- Step (v): TOTAL normalised diff is 0 lines.
- Red run on the normaliser: a mutated `validate` signature in a copy of the after dump gave a 2-line normalised diff and exit 1.
- After the after-testFull rebuild, the after dumps were re-taken and are identical (`diff -r` empty).
- Class-file set: everything removed from `ExpressionEvaluator$*` is a moved private nested type or the single `$$anonfun$...$$evalExpr$1` anonymous class, which reappears as `ExpressionInterpreter$$anonfun$evalExpr$5`. Nothing was added under `ExpressionEvaluator$*`.

D4 and behaviour, broader than the executor's probe. I wrote a Java probe over 37 expressions × 5 entry points (`evaluate`, `parseProblem`, `validate`, `validateTolerant`, `inferType`), run against both the baseline and after class dirs. Coverage includes:
- all 11 functions, arity errors, unknown function, type errors, `mod` zero / negative, `round` digits
- `coalesce` mixed types
- legacy bare identifiers
- empty and whitespace input, tokenizer errors, `1.2.3`, unterminated string

The 185 output lines are identical before and after. This covers both D4 message forms: `DivisionByZero(BinOp(/,NumLit(1.0),NumLit(0.0)))`, and `Unexpected token in expression: Ref(y)` / `RParen` / `FnName(...)` / `Comma`.

Inline FQNs, checked by eye plus a grep over all five files for `scala.|java.|javax.|spray.|com.|org.|cats.|akka.|pekko.` outside `package`/`import` lines, string interpolations included: 0 hits. `math.max`/`math.floor` etc. at `ExpressionInterpreter.scala:89-90,118-120,126` are the base's existing `scala.math` package-object idiom, moved verbatim and not a top-level FQN. The one inline FQN in moved code, `scala.collection.mutable.ArrayBuffer`, is now a top-of-file import (`ExpressionTokenizer.scala:3`).

Comments: every remaining positional word ("above"/"below") refers to text in the same file and is still true (`ExpressionEvaluator.scala:31,80,217`; `ExpressionTokenizer.scala:71,101,119`). No D3(d) edit was needed.

DRY, modularity, type safety, error handling, dead code: unchanged by construction. This is a verbatim move with no new logic. The imports are named and minimal, and each new object is `private[engine]`.

### Phase 3: UI Review — N/A
Backend-only change. No file matches `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `move-check/dump_javap.sh` hardcodes this worktree's absolute `classes` path, so it will not run as-is after archive. Taking the classes dir as an argument (as `norm_javap.py` already does with its inputs) would make the committed evidence reproducible.
- The follow-up candidates in `files-modified.md` are sound and worth filing:
  - stale `PipelineAnalyzeService.inferCompute` citations at `ExpressionEvaluator.scala:49,125,170`
  - the identical `"float"` branches at `ExpressionTypeInference.scala:21-22`
  - the no-op `s""` interpolator in both parsers
- Evaluator process disclosure: my scratch artifacts went into `scratchpad/eval/`, a directory that already existed in the shared session scratchpad (it held other files from 12:24). Several of my file names there (`base.scala`, `base.log`, `base.done`, `counts.py`, `run.sh`, `dump.sh`, `after/`, `red1/`, `red2/`) may have overwritten same-named files from an earlier session's agent. Nothing in this worktree or any evidence file of this change was affected.
