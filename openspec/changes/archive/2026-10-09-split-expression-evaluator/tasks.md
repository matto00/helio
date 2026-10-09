## Standing Constraints

- [C1] Zero diff under `backend/src/test`; total and D6c per-suite test counts equal the 0f95ec49 baseline.
- [C2] `ExpressionEvaluator` keeps every public and `private[engine]` member with an unchanged Scala signature; no caller outside `ExpressionEvaluator.scala` changes.
- [C3] `SupportedFunctions` and `NumericFunctions` are defined once, in `ExpressionEvaluator`, and read from there by the moved parser / type-inference code.
- [C4] Moved bodies are byte-identical apart from design D3's listed categories; defects found become follow-up candidates, not fixes.
- [C5] Normalised `javap -public` of the D6b classes differs from baseline only by the five deltas predicted in D6b, each listed.
- [C6] No ADT class or case object is renamed (D4); no grammar change (HEL-1403/HEL-1070 out of scope).

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt -J-Xmx3g testFull` backgrounded to a scratchpad log; record total + D6c per-suite counts
- [x] 1.2 Record `javap -public` of the D6b classes and the `ExpressionEvaluator$*` class-file list from the worktree's own baseline sbt build (`backend/target/out/jvm/scala-2.13.15/helio-backend/classes/`), never the main checkout's stale `backend/target/scala-2.13/classes`
- [x] 1.3 Write the D6a line inventory (every base line -> destination member span or D3 category)

### Backend

## 2. Split

- [x] 2.1 Create `ExpressionTokenizer.scala` (D2), members moved verbatim, D3(c) ArrayBuffer import; compiles
- [x] 2.2 Create `ExpressionParser.scala` (D2); compiles
- [x] 2.3 Create `ExpressionTypeInference.scala` and `ExpressionInterpreter.scala` (D2); compiles
- [x] 2.4 Reduce `ExpressionEvaluator.scala` to D1 with named imports; `node scripts/check-scala-quality.mjs` passes; inline-FQN grep (incl. inside `s"${...}"`) over every new/touched file is empty
- [x] 2.5 Update `domain/engine/README.md` Holds list to name the four new objects

### Tests

## 3. Evidence

- [x] 3.1 Write `move-evidence.md` (D6a): inventory, forward + positional reverse checker, allow-listed lines, two red runs, color-moved summary
- [x] 3.2 Write `api-evidence.md` (D6b): raw diff, every line classified into predicted deltas 1-5, normalised diff empty otherwise, class-file set comparison, red run
- [x] 3.3 D4 message pairs (DivisionByZero `BinOp(...)` text and `Unexpected token in expression: Ident(...)`) identical before/after
- [x] 3.4 Run `nice -n 19 sbt -J-Xmx3g testFull` again; counts equal baseline; write `test-count-evidence.md` (note any flake re-run)
- [x] 3.5 Confirm `git diff <base>...HEAD -- backend/src/test` is empty; pre-commit hooks pass on commit (check `free -g` >= 15 GB first)
- [x] 3.6 List any defects/oddities found during the move as follow-up candidates in `files-modified.md` (not fixed)
