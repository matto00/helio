## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `8e18ed5459814fdc43143f8411c04494ba36a8c2` (the change dir is the only untracked content, and there are no code edits yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/compute-numeric-warning-gaps/HEL-1455`.
- **Owner rulings:** main-checkout `.concertino/runs/HEL-1455/events.jsonl` line 5 is `escalation.answered` with `sub_answers ["warn","per-column","warn","warning"]` and `answer_source: human`. C1 and D5 keep 4b a non-blocking warning, as ruled. I raise no objection to that choice.
- **Round-1 CR1 (legacy pre-check): addressed and sound.**
  - `LegacyParser` (`ExpressionParser.scala:226-272`) has no unary, `not` or call productions. Its only recursion is `parseFactor`'s `LParen` (264-268). `parseExpr`/`parseTerm` loop iteratively.
  - So an iterative max-running-`LParen`-depth pre-check in `parseLegacy` bounds every legacy recursion without touching the frozen grammar.
  - The spec has the scenario "deep brackets on the legacy fallback are a parse error" (save and compile paths), and task 3.1 captures its red.
  - The false "never reached" sentence is gone from D6.
- **Every parse entry point goes through `parse`/`parseLegacy`:** `ExpressionEvaluator.scala` lines 121/123 (`parseProblem`), 156 (`validate`), 170/173 (`validateTolerant`), 203 (`inferType`), 209 (scan) and 232/235 (`compile`). The tokenizer is all `while` loops (`ExpressionTokenizer.scala:40-139`). A depth check inside those two functions therefore covers every consumer.
- **Round-1 CR3 (per-side key trust): addressed.**
  - D2 states that the left key is judged by `in.types && !in.untrusted(leftKey)` and the right key by `sec.flags.types && !sec.flags.untrusted(rightKey)`.
  - The spec delta MODIFIES "Join key type mismatch warns" and adds scenarios for (i), (ii), (iii) and (iv).
  - `Secondary` carries the full `Flags` (`AnalyzeSchemaWarnings.scala:50,96`), so the right-side set is available.
  - The join/lookup OUTPUT rule (`types = false` when the secondary's `untrusted` is non-empty) matches today's result. Today a computed secondary has `types = false`, which makes the output untrusted (`typesPreserved`, 124/127), so there is no regression.
- **Round-1 CR4 (literal positions): addressed and correct against the interpreter.**
  - `applyOp` (`ExpressionInterpreter.scala`, the `('+', a, b) if isTextual` arm) concatenates whenever either side is a `VStr`. So a `StrLit` under `+` always yields text, and that text then fails every numeric context.
  - `-`/`*`/`/` on any `VStr` fall to the TypeError arm.
  - `length`/`lower`/`upper`/`substring` reject a `VNum` first argument.
  - Only null-propagation can avoid the TypeError, and it still yields `null`, so "every row will compute null" holds in the counted positions.
  - Excluding `coalesce`, `if`, comparisons and NumLit-under-`+` is correct.
- **Round-1 CR5 (grammar doc): addressed.** D7 and task 2.3 name `docs/compute-expression-grammar.md`. Lines 262-264 hold the stale "only when the input schema's types are trusted" text.
- **Contract sites are complete:** `grep -rln numeric-op-on-text-field` (excluding archive/target/node_modules) lists 13 files. Every non-test site is in D7: PipelineAnalyzeProtocol, AnalyzeSchemaWarnings, the grammar doc, pipelineStep.ts, the three helio-mcp tools, types.ts, the base spec and the response schema. `helio-mcp/src/server.test.ts` is covered by task 2.2's "helio-mcp build and tests".
- **Spec delta hygiene:** for every MODIFIED requirement, I diffed the base scenario list against the delta. The result is additions only, with no base scenario dropped:
  - Join key: +5;
  - Numeric use: +5;
  - Analyze responses: unchanged;
  - inferType: +1.
- **Round-1 CR2 (flat chains): option (a) chosen. Its stated verification is falsified by measurement (see CR1 below).**
  - **Probe:** worktree classes at `backend/target/out/jvm/scala-2.13.15/helio-backend/classes` (HEAD 8e18ed545, no code edits), plus scala-library 2.13.15 and spray-json 1.3.6 from the coursier cache.
  - The driver is a scratch Java class. It calls `ExpressionEvaluator$.MODULE$`'s `parseProblem`, `validate`, `inferType`, `numericContextTextFields` and `evaluate` (empty field maps), each on a `new Thread(null, r, "p", stackBytes)`. It ran on JDK 21.0.12 with `nice -n 19`, one JVM per row.

    | Expression | Tree depth | Stack | Result |
    |---|---|---|---|
    | `1` + `+1`×499 | 500 | 256 KB | `validate` (BootstrapMethodError wrapping SOE), `inferType`, scan and `evaluate` all **StackOverflowError**. Reproduced 3 times. |
    | `1` + `+1`×200 | 201 | 256 KB | validate/infer/scan OK, `evaluate` **StackOverflowError** |
    | `1` + `+1`×150 | 151 | 256 KB | `evaluate` OK (151.0) |
    | `1` + `+1`×499 | 500 | 384 KB | `evaluate` **StackOverflowError** |
    | `1` + `+1`×499 | 500 | 512 KB | all OK (reproduced twice) |
    | `abs(`×100 `1` + `+1`×399 `)`×100 (within both proposed limits) | 500 | 512 KB | `evaluate` **StackOverflowError** |
    | same | 500 | 1 MB | all OK |
    | `1` + `+1`×2000 | 2001 | 1 MB | `evaluate` **StackOverflowError** |
    | `-`×100 `1`, `(`×100 `1` `)`×100, `abs(`×100 `1` `)`×100 | 101 or less | 256 KB | all OK (the 100-nesting limit itself is fine) |

  - No `-Xss`/thread-stack setting exists anywhere in the repo (grep over `*.sbt`, `*.conf`, Dockerfiles, `*.sh`, `*.yml`, `.jvmopts`/`.sbtopts`: zero hits). Production therefore runs on the JDK default (1 MB on Linux x64).

### Verdict: REFUTE

### Change Requests

1. **D6(c) and task 3.1 specify a headroom proof that cannot pass at `MaxTreeDepth = 500`.**
   - D6(c) says: "a test evaluates, infers and scans a depth-500 tree on a `Thread` created with a 256 KB stack, and it must not overflow". Task 3.1 says: "a depth-500 tree is OK on a 256 KB-stack thread".
   - Measured on this tree (table above), a depth-500 flat chain overflows `validate`, `inferType`, the scan and `evaluate` on a 256 KB stack, reproduced 3 times. `evaluate` already overflows at depth 201 on 256 KB.
   - The worst within-limits shape, 100 nested calls plus a 399-operator chain, overflows `evaluate` even at 512 KB. It survives only at the 1 MB JDK default, so the real margin over production is under 2x, not the 4x the 256 KB figure implies.
   - An executor following the plan as written will hit a red it cannot clear without improvising: silently lowering the limit, or loosening the test to pass. Neither is the planner's decision to leave open.
   - Required revision: re-derive the limit and the proof from measurement, and state both in D6(c):
     - (a) pick `MaxTreeDepth` and a test stack size, using the worst within-limits shape (nested calls plus a chain, through `evaluate`, `inferType`, the scan, `validate` and the new 4a/4b scans), for which the test actually passes with a stated margin below the 1 MB production default. For example, lower `MaxTreeDepth` so the worst shape passes on 512 KB, or keep 500 and prove it on a stack that gives a stated margin.
     - (b) record the production stack assumption: no `-Xss` is configured, so the JDK 1 MB default applies.
     - (c) update the spec's "nesting at the limits still works" scenario (`1` followed by 499 `+1` evaluating to `500`) and the 500 figures in the proposal and spec to match the chosen limit. Also add the worst-shape-at-the-limit case to task 3.1.
   - The proposal's "What Changes" also mentions only the 100-nesting limit. Add the tree-depth limit there.

### Non-blocking notes

- `backend/src/test/scala/com/helio/domain/engine/NumericOpOnTextFieldWarningSpec.scala:128` ("not warn for an unrelated column after a compute (trust is per step, design D5)") asserts the old per-step rule and will go red under D2 by design. Name it in task 3.2 as a deliberate inversion under owner ruling 2, so the evaluator does not read the edit as a fixture-changed-to-pass symptom.
- 4a mixed-trust siblings: D4 collects trusted numeric fields through `+`, `coalesce` and `if` branches when the argument infers numeric. With per-column trust, a sibling can now be an untrusted compute-written column, for example `length($n + $u)` or `length(coalesce($u, $n))`. If such a column's run-time value were text, the row would succeed while the warning claims "every non-null row will compute null". This is reachable only if a compute's inferred type disagrees with its run-time class, which the inferType spec forbids. So it is narrow, but worth either a test or requiring every field ref in the collected argument to be trusted.
- The boundary convention for tree depth (whether the leaf counts as a level) should be pinned in the implementation's comment and its test pair: N passes, N+1 fails.
- Carried over from round 1: the base spec claims warnings are sorted by field name, but the code sorts by message (`AnalyzeSchemaWarnings.scala:155`). This is pre-existing and out of scope.
