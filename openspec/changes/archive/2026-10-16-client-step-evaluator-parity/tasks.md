## Standing Constraints

- [C1] The parity corpus is executed by a Scala spec through the real PipelineStep.Registry decode+evaluate (and executeTree for walk vectors) as the oracle AND by a Jest spec through the TS evaluator; a TS-vs-fixture-only check never satisfies parity.
- [C2] No UI wiring beyond what the evaluator needs: no draft UI, no removal of per-edit PATCH, no Output column (owned by HEL-1631/HEL-1632). Nothing in the app imports the evaluator yet.
- [C3] Any kind, config or expression feature outside the design-pinned set is declined by clientEvaluable (needsServer), never approximated; anything found in Scala but missing from design Decision 1 is in scope by default, and if it cannot be ported faithfully the executor escalates.
- [C4] House rules: scratch only /home/matt/Development/helio/.concertino/scratch/HEL-1581/; jest at most 2 workers (HELIO_JEST_MAX_WORKERS=2) under nice -n 19; full sbt testFull wrapped in `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock`, full Playwright in `.../e2e.lock`; check /proc/loadavg first (1-min > 10: wait 60 s, up to 30 min); never kill/pkill/pgrep/killall; stop servers only via scripts/concertino/stop-servers.sh; long Bash calls timeout 600000.
- [C5] The Scala oracle follows the engine run path (requiredConfigProblems before evaluate, enabled/position honoured), via executeTree; bare decode+evaluate never certifies a vector.

## 1. Corpus scaffolding and Scala oracle

- [x] 1.1 Create `shared-test-fixtures/pipeline-step-parity/manifest.json`: all 27 kinds with class, minVectors and features, plus `notes`, including the ±2^53 Long limit. Do NOT duplicate the compute function list: it is read from `compute-expression-functions.json` (design Decision 4).
- [x] 1.2 Write `PipelineStepParitySpec` in `backend/src/test/scala/com/helio/domain/engine/` (C5). It drives every vector through `executeTree`:
  - check 1 (manifest vs `Registry.keySet`);
  - a test-local (kind, raw config) to domain step builder covering all 27 kinds, failing loudly on a missing arm;
  - step vectors as one-step trees (lane secondary = second root + `limit` `count 0`; source secondary through a `DataSourceRepository` double);
  - walk vectors with `frames` / `failsAt` + `framesWithout` rerun / `laneError`;
  - the Decision 3 encoding (`$int`, `$long`, `$double`) and a two-way class comparator;
  - `clientDeclines` vectors asserted against `scalaRows`/`scalaError`.
- [x] 1.3 Author step vectors per kind, meeting the minimums from 1.1, including every required trap vector in design Decisions 1a and 4, plus seeds from `window-rolling-seam.json` and `ExpressionEvaluatorSpec`. Expected values come from the Scala runner's actual output, and are committed only once the Scala spec is green on them.
- [x] 1.3a Design-gate round-4 notes:
  - implement the quantifier-bound cap by numeric value, not digit count;
  - add the leading-zero over-max decline vector `a{0000000000002147483648}`;
  - add one `extractRegex` vector over a double field (`3.0`).
- [x] 1.4 Author `pipelines.json` walk vectors (design Decision 5's required list, including disabled steps, a disabled AI step and lane violations as `laneError` + `framesWithout`, and exactly one failing step per failure vector), with both the `scala` and `client` blocks.

## 2. TypeScript value model and expression engine

- [x] 2.1 Value model (`frontend/src/features/pipelines/evaluator/value.ts`):
  - double vs integral;
  - Java `Double.toString` and `Any.toString` rendering;
  - Java `Instant.toString` / `ISO_INSTANT` rendering;
  - the numeric parse primitives (`toDoubleOption`, `parseDouble`, `toInt`/`toLong`/`toBoolean` families);
  - JSON output per `anyToJsValue`;
  - corpus encoding decode.
- [x] 2.2 Port the strict compute grammar:
  - tokenizer;
  - parser, with depth limits;
  - interpreter;
  - the functions, with the function, operator and literal tables held to `compute-expression-functions.json` (check 3, Jest);
  - a strict parse problem is a step `error` via the ported `requiredConfigProblems`, and a per-row error gives `null`;
  - a `$`-prefix strict failure declines as `legacyExpression`;
  - an unknown function declines (check 5).

## 3. Step evaluators

- [x] 3.1 Client kinds: rename, select, limit, filter, groupby, dedupe, unpivot, extractheadings and splittext. Each ports its companion's `requiredConfigProblems`.
- [x] 3.2 Client* kinds: sort, cast (date/timestamp per design Decision 1), aggregate, datebucket, fillnull, pivot, window, stringops (Java trim/split; the Decision 1a regex allowlist translator) and compute. Each ports `requiredConfigProblems`.
- [x] 3.3 join, union and lookup with lane secondaries and complete source secondaries (`JoinColumnNaming` parity). Decline a configured source secondary that is missing or truncated. An empty secondary mirrors Scala.
- [x] 3.4 Identity kinds:
  - `assert`: pass-through, no verdicts.
  - `upsertsource`: pass-through, `writesOnSave`, with the documented `checkTarget` gap.
  - Enabled server kinds always decline.
  - Enabled AI kinds are `notPreviewed`.
- [x] 3.5 `clientEvaluable(step, context)` with the reasons in design Decision 2.

## 4. Incremental walk

- [x] 4.1 `evaluatePipeline` over parent and lane edges, following `executeTree`'s order (including `position`), with:
  - disabled steps transparent;
  - a per-step cache: rows by reference, schema (the ordered column-name union, per design Decision 5, asserted by its own Jest unit test), count and status;
  - statuses `ok`, `error`, `needsServer`, `notPreviewed`, `blocked`, `disabled`;
  - lane violations as `error` on the step, with dependents `blocked`.
- [x] 4.2 Incremental recompute from `editedStepId`. Jest property test: for every walk vector, with every step as the edited step, the incremental result equals a full recompute, and unaffected frames are identical by reference.

## 5. Jest parity runner and agreement checks

- [x] 5.1 `pipelineStepParity.test.ts` runs every step vector and every walk-vector `client` block through the TS evaluator. Every `client` rows value must equal a Scala-verified frame in the same vector. Includes check 2.
- [x] 5.2 `npm --prefix frontend run typecheck`, lint (zero warnings) and format all pass.

## 6. Evidence

- [x] 6.1 Run each mutation in design Decision 4 on a scratch copy, and record each red output in `/home/matt/Development/helio/.concertino/scratch/HEL-1581/mutations/`:
  - manifest entry removed;
  - `dedupe` evaluator or vector file deleted;
  - `mod` dropped from the TS table;
  - `Math.round`;
  - `a - b` sort and plain string sort;
  - `Number(s)` cast;
  - `Number()` in sort;
  - `clientEvaluable` forced to `ok`.

  Copy the summary to `.concertino/runs/HEL-1581/evidence/`. Revert every mutation; none is committed.
- [x] 6.2 Latency benchmark (design Decision 6), as a scratch Node script. Record median, p95 and max for 1,000 and 10,000 rows in `openspec/changes/client-step-evaluator-parity/measurements.md`.
- [x] 6.3 Full gates: the targeted Scala spec, plus full `sbt testFull` under the sbtfull flock, full frontend Jest (2 workers, nice), typecheck and lint. List the changed files in `files-modified.md`.

## Implementation notes

Where the oracle (the real Scala run path) disagreed with, or went beyond, the design text, the oracle won and the vectors record it:

- **An unknown `$field` is a per-row `null`, not a step error.** `requiredConfigProblems` only parses the expression (it has no schema), so a reference to a column the row lacks evaluates to `null` for that row (`EvaluationError.UnknownField`). The step errors only for parse problems (bad syntax, depth limits, wrong arity, a `date_trunc` unit that is not a literal).
- **A call to an unknown function is a parse error in Scala, but declines (`unknownFunction`) in the client**, so a function added to Scala and forgotten in the TypeScript table cannot be silently mis-evaluated (check 5). The same goes for a `$`-less identifier: Scala retries a legacy grammar, the client declines `legacyExpression`. A parenthesised bare identifier, `(price) * 2`, is a Scala error (the bracket error replaces the `$` error) and is an error here too, not a decline.
- **Group order is part of the output.** `groupby`, `aggregate` and `pivot` iterate Scala's `immutable.HashMap` (scala-library 2.13.15 `groupBy`), so the evaluator reproduces `MurmurHash3` of the key Vector and CHAMP trie order (`scalaGroup.ts`); `rename`'s fold over its `renames` map follows the same order beyond four entries. Without it the vectors with five or more groups go red.
- **Walk-vector shapes.** `scala` is `{frames}`, `{failsAt, framesWithout}`, `{laneError: true, removed: [ids], framesWithout}` (the violating step ids are listed because the engine reports only the first violation) or `{notRun: [ids], framesWithout}` (an AI step the oracle must not run). A `client` entry's `rows: "scala"` placeholder is replaced by the Scala-verified frame at regeneration.
- **Known gaps, recorded in the manifest `notes`:** Long precision beyond 2^53; a full 32-bit improved-hash collision keeps first-seen group order; Unicode data versions (`\p{L}`, `\p{Nd}`) follow the host JS engine, not JDK 21.

## Cycle 2 amendments

- **Window ordering:** `javaTimSort.ts` is a faithful port of `java.util.TimSort`, used for window `orderBy` (and sort); the contract-violation throw is a step `error`. Oracle vectors: 40/64-row mixed columns and a 200-row column on which Java throws. Other Scala sorts (`sortBy` tuples, Double and String `sorted`) use consistent total orders, where any stable sort is identical.
- **Rename key order:** spray-json parses objects into a sorted TreeMap, so a rename of four or fewer entries folds in `String.compareTo` order (hash order from five); `scalaMapKeyOrder` reproduces both and no decline is needed (the cycle-2 `integerLikeColumnName` decline was withdrawn as unnecessary). Audit: only `rename` is order-dependent; `cast` is independent per field; other sites are set-based or sorted.
- **Unknown root:** a parentless step whose `rootId` has no frame is an `error` (executeTree fails the run), dependents `blocked`, oracle-backed by a walk vector.

## Final-gate round 1 amendments

- **Unicode-digit epochs:** `instants.ts` `epochOfString` ports the String arm of `TimestampParsing.epochOf` (Nd digits via `Character.digit`, whole `BigDecimal`, the same thresholds and bounds); it feeds cast, datebucket, the compute date functions and window day frames. `parseChartInstant` and chart code are unchanged (follow-up: the chart parser has the same ASCII-only gap).
- **Negative-zero sums:** `Seq[Double].sum` reduces on a Vector and folds from 0.0 on a List; the evaluator reproduces it with a `listFrame` flag the walk propagates (aggregate / groupby / pivot output is a List). Oracle vectors: step vectors on Vector frames and two walk vectors for the List case.
- Shared parse primitives checked: `Integer.parseInt` / `Long.parseLong` accept Unicode digits (already ported); `Double.parseDouble` / `toDoubleOption` are ASCII-only (oracle vectors added for filter, sort, aggregate and cast).
- One oracle vector with three NaN group keys (groupby and aggregate); the hash-collision manifest note is corrected (first-seen order is Scala's behaviour, not a gap).
