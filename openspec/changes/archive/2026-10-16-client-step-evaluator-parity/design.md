## Context

HEL-1580's spike (`docs/live-draft-preview.md`, merged in 273c0b0c9) chose browser-side evaluation of pipeline steps over a cached
sample (section 3), with parity enforced by a shared corpus executed against both the Scala engine and the TypeScript evaluator (section 3.3,
owner ruling B `ts-evaluator-plus-corpus`). On 2026-10-16 the owner ruled `split-and-restate`, so this change is piece (a) of that design only.
The sample endpoint (HEL-1628), the atomic save (HEL-1629), the server fallback endpoint (HEL-1630), the draft UI (HEL-1631) and the Output
column (HEL-1632) are out of scope.

Facts this design starts from (read from the tree at 83cbfc022, and checked by the round-1 design gate, `skeptic-design-1.md`):

- **Step kinds.** 27 kinds are registered in `PipelineStep.Registry` (`backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:256-284`,
  public). Each step has `evaluate(rows, ctx)(implicit ec): Future[Seq[Row]]`.
- **The engine run path is not bare `evaluate`.**
  - `InProcessPipelineEngine.evalOneStep` (`:248-285`) first runs `companion.requiredConfigProblems(encodeConfig(config))` and fails the
    step on any problem. 17 companions override that check, and 14 of them are client or identity kinds.
  - Example: `ComputeStep.apply` returns all-null rows on a parse failure, but that path is unreachable on a real run, because
    `ComputeStep.requiredConfigProblems` fails the step first (`ComputeStep.scala:65-79,115-120`).
  - `executeTree` skips a disabled step, which is transparent: its input frame passes through (`:440-441`). This holds for every kind.
  - `executeTree` reads `position` for ordering and trunk selection.
  - It fails the **whole** walk on the first step failure (`StepExecutionException(stepId, …)`, `:455-482`), and on any lane violation
    before any step runs (`LaneReferenceError`, `:384-412`). Neither failure returns node frames.
- **Row values.** These are JVM objects: `null`, `Boolean`, `String`, `Double`, `Int`, `Long`, and a nested `Map` (image connector only).
  - A JSON number entering the engine becomes a `Double` (`PipelineRowJson.jsValueToAny`, HEL-893 D5). `cast` to `integer`/`long` produces
    `Int`/`Long`.
  - Several steps stringify with `Any.toString`. An example is `StringOpsStep.splitFn`, which uses `v.toString.split(Pattern.quote(sep), -1)`.
    There a `Double` renders the Java way (`3.0`, `1.0E7`).
  - The compute interpreter renders a whole number without `.0` (`ExpressionInterpreter.scala:268-269`).
  - `cast` to `date`/`timestamp` keeps a String only if `TimestampParsing.parseInstant` accepts it, and otherwise yields `null`. A non-String
    epoch renders as `Instant.toString` (`CastStep.scala:97-100`). Compute's `date_trunc`/`add_days` render through `ISO_INSTANT`
    (`ExpressionDateTimeFunctions.scala:90`).
- **Numeric parsing.** `PipelineRowJson.toDouble` uses Scala 2.13 `String.toDoubleOption` (sort, aggregate, fillnull, window, filter
  `=`/`!=`). Filter's ordered operators use `v.toString.toDouble` (Java `Double.parseDouble`, `FilterStep.scala:124-125`). These accept
  forms JavaScript `Number` rejects (`"1d"`, `"1f"`, `"0x1p3"`), and they reject forms JavaScript accepts (`"0x10"`).
- **Regex.** `stringops extractRegex` compiles a Java `Pattern` with no flags. It raises `StepConfigError` for an invalid pattern or a pattern
  without a capturing group, then uses `matcher.find()` and `group(1)`; a non-participating group is `null` (`StringOpsStep.scala:157-177`).
- **Function-list seam.** The compute function list, operators and literals already have a Scala-checked seam:
  `shared-test-fixtures/compute-expression-functions.json`, read by `ComputeExpressionFunctionsSeamSpec` (package `engine`, which can see
  the `private[engine]` `SupportedFunctions`).
- **Walk oracle.** `InProcessPipelineEngineTreeWalkSpec` drives `executeTree` over supplied root frames, with
  `new PipelineStepRepository(null)` / `new DataSourceRepository(null)`.
- **JDK.** CI runs JDK 21 (`.github/workflows/ci.yml:234`). Since JDK 19, `Double.toString` emits the shortest round-tripping digits, the same
  digits as JavaScript; only the formatting differs.

## Goals / Non-Goals

**Goals**

- A pure, synchronous TypeScript evaluator for the pinned kind and feature set (Decision 1). Over a given input frame it returns exactly
  what the Scala engine's **run path** produces.
- `clientEvaluable` declines everything outside that set, so the evaluator never guesses (Decision 2).
- Incremental recompute from an edited step downward, with a per-step cache (Decision 5).
- A corpus executed by the real Scala engine through its run path, and by Jest, so drift on either side fails CI, with failable agreement
  checks (Decision 4).
- A recorded latency measurement against the spike's < 50 ms budget (Decision 6).

**Non-Goals**

- **Any UI** (standing constraint C2: HEL-1631 and HEL-1632). Nothing in the app imports the evaluator yet.
- **Fetching rows.** The evaluator takes frames as arguments.
- **Out of scope here:** the server fallback (HEL-1630), assert verdicts, and AI steps (ruling F).
- **Error messages and column order.** Matching Scala's error **messages** is not a goal; only whether a step fails is a parity property.
  Output **column order** is not compared either, because Scala rows are unordered maps. Row **order** is compared.
- **Inferred column types** (Decision 5, schema).

## Decisions

### Decision 1: Pinned kind and feature set

Kind classes come from spike section 3.1. Every kind below is in scope at the kind level. Within a kind, **every** operation, function,
strategy and mode the Scala config accepts is in scope unless it is listed under "declined"; declined cases return `needsServer`
(Decision 2). **Every in-scope kind also ports its companion's `requiredConfigProblems` as a step `error`**, mirroring `evalOneStep`
(Decision 2).

| Kind | In scope | Declined |
| --- | --- | --- |
| `rename`, `select`, `limit`, `dedupe` (first/last), `unpivot`, `extractheadings`, `splittext` (paragraph/heading), `groupby` (sum/count) | all config | none |
| `filter` | operators `= != < <= > >= contains is null is not null`, `blank` handling, the AND/OR combinator. Coercion uses the ported parse primitives (Decision 3 obligation 6): `=`/`!=` use `toDoubleOption` only when the row value is numeric; ordered operators use `parseDouble` | none |
| `sort` | the three-tier comparator (finite numbers, including numeric strings via `toDoubleOption`; then lexicographic; nulls last), asc/desc, multi-key | none |
| `cast` | `string integer long float double number boolean date timestamp`, with Java/Scala parse semantics (`toInt`/`toLong`/`toBoolean`, plus the `toDouble.toInt` fallback) through the ported primitives. `date`/`timestamp`: a **String** is kept if the shared timestamp parser accepts it (read a numeric string with `epochOfString` (a port of `TimestampParsing.epochOf`'s String arm: Java `Long.parseLong` / `BigDecimal`, which accept Unicode decimal digits) and any other timestamp string with `parseChartInstant`, held to `TimestampParsing` by `chart-timestamp-parsing.json` for ASCII input only (the chart's ASCII-only epoch gap is pre-existing and a follow-up)), **else `null`**. A **non-String** follows `CastStep.scala:99` in order: `epochInstant(v)` rendered by `Instant.toString` (obligation 7), then `parseInstant(v)` keeping the stringified value, else `null`. The legacy unsupported-target passthrough keeps the original value | none |
| `aggregate` | `sum avg min max count median percentile count_distinct`, multi-key `groupBy`, null-key rules, `percentile` = `percentile_cont` | none |
| `datebucket` | `day week month quarter year`, UTC floor, output as Scala's `yyyy-MM-dd` date string (`DateBucketStep.scala:118`); unparseable input gives `null` | none |
| `fillnull` | `constant forwardFill mean median mode`, with Scala's tie-breaks and coercion | none |
| `pivot` | aggs `sum count avg min max first`; generated column names from the JVM stringification of the index value (obligation 3) | none |
| `window` | `row_number rank dense_rank running_sum lag lead rolling_avg rolling_sum rolling_min rolling_max rolling_count`, `partitionBy`, `orderBy` asc/desc, `offset`, `frameSize`, `frameUnit` `rows`/`days` | none |
| `stringops` | `trim` (Java `String.trim`: strips chars <= U+0020 only), `upper`, `lower`, `split` (literal separator, Java `split(quote(sep), -1)`), `concat`, and `extractRegex` **within the regex allowlist** (Decision 1a). The no-capturing-group config is an `error`, as in Scala | `extractRegex` with any pattern outside the allowlist, including every pattern Java would reject |
| `compute` | the full **strict** grammar in `docs/compute-expression-grammar.md`: literals, `$` references (dotted exact match), `+ - * /` (permissive `+`, strict others, `/0` gives null), unary minus, `= != < <= > >=`, `and or not` with three-valued logic, `if`, every function in `compute-expression-functions.json`, depth limits (100 nesting / 200 tree). A strict **parse problem** (bad syntax, depth limit, wrong arity, a non-literal `date_trunc` unit) is a step **`error`** (from `requiredConfigProblems`), never all-null rows. A **per-row** evaluation error gives `null`, **including a reference to a column the row lacks** (`requiredConfigProblems` only parses; the oracle showed this, amending the original text) | **legacy bare-identifier** expressions (a strict parse that fails with the `$`-prefix error) are declined. A function absent from the TypeScript table is declined (`unknownFunction`). Check 5 holds that decline set to the seam file |
| `join` (inner/left), `union` (byName/byPosition), `lookup` | a **lane** secondary (the client's already-evaluated frame) and a **source** secondary whose frame the caller supplies marked **complete**; `JoinColumnNaming` parity | a **configured** source secondary (non-empty `dataSourceId`) with no supplied frame, or with a supplied frame marked truncated. Precedence: an **empty or unconfigured** secondary (`dataSourceId` `""`, HEL-950's incomplete-draft default) is not a decline; it mirrors whatever the Scala run path does with it, as a vector |
| `assert` | identity: rows pass through; no verdicts | none |
| `upsertsource` | identity: rows pass through; nothing is written; the step is flagged `writesOnSave`. **Deliberate gap:** Scala's `checkTarget` can fail an `ExistingSource` target at run time (owner unknown, target missing or non-writable, `UpsertSourceStep.scala:45-55`); the client skips that check, and such a step can still fail at Save & run. Vectors use a `NewSource` target | none |
| `chunkbytokencount`, `convertformat`, `analyzewithai`, `generatetext` | none | always, when **enabled** (`needsServer`; the two AI kinds are `notPreviewed`, as is every step downstream of them, per ruling F). A **disabled** step of any of these kinds is transparent like any other disabled step (Decision 5) |

If the executor, reading Scala, finds an operation or option the table does not mention, it is **in scope by default** and is recorded in the
manifest's per-kind `features` list. If porting it faithfully needs a construct JavaScript cannot express, the executor escalates; it never
silently declines or approximates it (C3).

### Decision 1a: Regex allowlist

`extractRegex` is evaluated client-side only when the pattern tokenizes completely under the allowlist below. Any other token, any
tokenizer failure, or a translated pattern that `new RegExp(translated, "u")` rejects (a safety net) declines the step as `unsafeRegex`.
It never becomes `error` and never crashes.

**Invariant (precondition of decline-not-error):** every pattern the allowlist accepts is a valid Java `Pattern`. As a result:

- A Java-invalid pattern can never be evaluated client-side. It is declined, and the server reports the real Java error; either way the client
  produces no rows. Declining instead of erroring is necessary because a JS tokenizer cannot decide Java validity in general.
- Any allowlist entry later found to accept a Java-invalid pattern is an allowlist defect.
- Vectors cover `a{` and `([])`: Scala `error`, client `clientDeclines: unsafeRegex`.

**Translation.** Compile with the `u` flag (code-point semantics, as in Java) and no other flags. Outside a character class:

| Java token | JavaScript emitted |
| --- | --- |
| a literal character other than a metacharacter | the same character |
| `\.` `\*` `\+` `\?` `\(` `\)` `\[` `\]` `\{` `\}` `\|` `\^` `\$` `\\` `\/` | the same escape (all are valid `u`-mode identity escapes) |
| `\-` | a literal `-` (`\-` outside a class is a `u`-mode SyntaxError) |
| `\t \n \r \f` | the same |
| `\d \D \w \W` | the same (ASCII in both engines) |
| `\s` / `\S` | `[ \t\n\x0B\f\r]` / `[^ \t\n\x0B\f\r]` |
| `.` | `[^\n\r\u0085  ]` |
| `^` | `^` |
| `$` | `(?=(?:\r\n\|[\n\r\u0085  ])?$)(?!(?<=\r)\n$)` (see below) |
| `( ... )` capturing group | the same |
| `\|` alternation | the same |
| `* + ? {n} {n,} {n,m}` and their lazy forms, applied to a literal, an escape, `.` or a character class, with every bound at most 2147483647 (`Integer.MAX_VALUE`) | the same |

The `$` translation reproduces Java's `$` without MULTILINE: it matches at the end of input, or before a final line terminator, but not between
`\r` and a final `\n`. The round-2 gate verified it on `"abc\n"`, `"abc\r\n"`, `"abc\r"`, `"a\r"`, `"a\r\n"` and `"abc\n\n"`.

**Character classes** `[...]` / `[^...]`.

Allowed members:

- a literal character other than `]`, `[`, `\`, `&`, `^` in first position, and `-` except as a range operator;
- the escapes `\]` `\[` `\\` `\-` `\^` and the other escaped metacharacters above (all valid inside a `u`-mode class);
- `\t \n \r \f \d \D \w \W`;
- `\s`, emitted as its members ` \t\n\x0B\f\r`;
- a range whose **both** ends are a literal character or an escaped metacharacter.

Declined inside a class:

- an empty class (`[]`, `[^]`), which Java rejects;
- `]` as the first member;
- a class escape as a range end (`[\d-z]`);
- `\S` inside a class (it has no member expansion, and JavaScript's Unicode `\S` differs);
- a nested `[`;
- `&&`.

**Declined everywhere:**

- any quantifier applied to a **group** (`(a?)*`, `(ab)+`, `(x){2}`), because Java records an empty iteration and JavaScript does not;
- `\b` and `\B`: Java's `Pattern.Bound` treats a Unicode non-spacing mark after a letter or digit as a word character, while JavaScript's `\b` is ASCII-only (round-3 probe: `(\w+)\b` on `"cafés"` gives `"s"` in Java and `"cafe"` in JavaScript);
- any quantifier bound above 2147483647 (Java rejects it with "Illegal repetition range"; JavaScript accepts it);
- any quantifier applied to `^` or `$`;
- `(?`;
- `\p \P \Q \E \A \Z \z \G \R \h \H \v \V \X \e \a \c \0 \x \u \N \k`;
- back-references `\1`-`\9`;
- possessive quantifiers;
- a `{` that does not form a valid quantifier;
- every escape not listed above.

**Match semantics:** the first match (`exec`), group 1, and a non-participating group 1 (`undefined`) becomes `null`.

**Required vectors:**

- `\s` against U+00A0, U+2003 and a tab;
- `$` against `"abc\n"`, `"abc\r\n"` and `"abc\n\n"`;
- `(a\r)$` against `"a\r\n"` gives `null`;
- `.` against U+0085 and against an astral character;
- `(a\-b)` against `"a-b"`;
- a non-participating group;
- a lazy quantifier;
- the declined patterns, with Scala's outcome recorded and the client giving `clientDeclines: unsafeRegex`:
  - `([\d-z])`
  - `([]a])`
  - `([\S])`
  - `(a?)*`
  - `(^*a)`
  - `(\w+)\b` and `(a\b)`
  - the Java-invalid `(a{0,99999999999})`
  - the Java-invalid `a{`
  - the Java-invalid `([])`

### Decision 2: `clientEvaluable`, config errors and step status

`clientEvaluable(step, context)` returns either `{ ok: true }` or `{ ok: false, reason }`, where `reason` is one of:

- `serverKind`
- `aiStep`
- `legacyExpression`
- `unsafeRegex`
- `secondaryNotCached`
- `unknownFunction`
- `unknownKind`

It is pure and synchronous, and it is called only for **enabled** steps.

**Ordering.** For an accepted step the evaluator first applies the kind's ported `requiredConfigProblems`. Any problem makes the step's status
`error`. Only then does it evaluate the step, and a thrown evaluation failure is also `error`. This mirrors `evalOneStep`.

**Step statuses:**

- `ok` (rows, count, schema);
- `error`;
- `needsServer{reason}`;
- `notPreviewed` (an enabled AI step, or downstream of one);
- `blocked` (downstream of an `error` or `needsServer` step: not computed; the caller keeps the last good frame, if any);
- `disabled` (transparent: its frame is its input frame).

The evaluator **never** returns rows for a declined or erroring step.

### Decision 3: Value model

A frame is `ReadonlyArray<Readonly<Record<string, Value>>>` and is never mutated. `Value` reproduces the JVM classes whose differences show up
in output: `null`, `boolean`, `string`, a **double**, and an **integral** (Scala `Int`/`Long`). The representation is the executor's choice.

**Obligations:**

1. Corpus input numbers are doubles (mirroring `jsValueToAny`).
2. Scala paths yielding `Int`/`Long` yield integrals. Examples are `cast integer`/`long`, `count`, `row_number`/`rank`/`dense_rank`, `length`
   and `count_distinct`; the executor enumerates them from Scala, and the oracle confirms each one.
3. Every `Any.toString` site renders a double with Java `Double.toString` (`1.0`, `0.001`, `1.0E-4`, `1.0E7`, `-0.0`, `NaN`, `Infinity`) and an
   integral as a plain integer.
4. Inside compute, the interpreter's own whole-number rule applies (`ExpressionInterpreter.scala:268-269`).
5. Output to JSON follows `anyToJsValue`.
6. **Numeric parse primitives**, ported as named shared functions that every step uses instead of `Number()`/`parseFloat`/`parseInt`:
   - `toDoubleOption`: Scala 2.13 `StringOps.toDoubleOption`, behind `PipelineRowJson.toDouble`;
   - `parseDouble`: Java `Double.parseDouble`, behind `.toDouble`;
   - `toIntOption`/`toInt`, `toLongOption`/`toLong` and `toBooleanOption`, as `CastStep` uses them.
   - Exact acceptance sets come from the Scala/Java sources and are confirmed by the oracle.
7. **Instant rendering:** Java `Instant.toString` (ISO-8601 UTC, `Z`). Fractional seconds are omitted when zero and otherwise printed in groups
   of 3, 6 or 9 digits, as `DateTimeFormatter.ISO_INSTANT` does. This is used by `cast` date/timestamp, and compute's `date_trunc`/`add_days`.

**Corpus value encoding (both runners):**

- `{"$int": n}` and `{"$long": "n"}` encode integrals.
- `{"$double": "NaN" | "Infinity" | "-Infinity" | "-0.0"}` encodes non-JSON doubles.
- Every other JSON number is a double.

**Comparator, both directions:** numeric values must be equal **and** have the same class. An actual integral where the vector holds a plain
double fails, and so does the reverse.

**Long precision:** vectors stay within ±2^53. The limit is recorded in the manifest `notes` and is a known gap, deliberately left open.

### Decision 4: Corpus, runners and agreement checks

Layout of `shared-test-fixtures/pipeline-step-parity/`:

- `manifest.json`: `{ kinds: { <kind>: { class, minVectors, features[] } }, notes[] }`. It covers all 27 kinds.
  - `minVectors` is at least 3 for client kinds, at least 6 for client-star kinds and at least 2 for identity kinds.
  - `compute` has at least 40 vectors and `stringops` at least 15.
  - The compute function, operator and literal lists are **not** duplicated here. They are read from the existing
    `compute-expression-functions.json`, which `ComputeExpressionFunctionsSeamSpec` already checks against Scala.
- `<kind>.json` holds step vectors:
  - `{name, config, enabled?, inputRows, secondary?: {kind: "lane"|"source", rows, complete}, expect: {rows} | {error: true} | {clientDeclines: <reason>, scalaRows | scalaError: true}}`.
  - The `clientDeclines` vectors record the Scala run-path outcome, so a decline never hides a Scala-accepted config that the client should
    have handled. They also cover Java-invalid patterns, which give `scalaError`.
- `pipelines.json` holds walk vectors:
  - Shape: `{name, rootFrames: [{rootId, rows}], steps: [{id, kind, parentStepId, rootId, position, enabled, config}], scala: <oracle expectation>, client: {<stepId>: {status, rows?}}, edit?: {stepId, config}}`.
  - `scala` is one of:
    - `{frames: {<stepId>: rows}}` (the walk succeeds);
    - `{failsAt: <stepId>, framesWithout: {<stepId>: rows}}`;
    - `{laneError: true, removed: [<stepId>], framesWithout: {<stepId>: rows}}` (the engine reports only the first violation, so the violating ids are listed; the Scala spec checks the violation message names one of them);
    - `{notRun: [<stepId>], framesWithout: {<stepId>: rows}}` (enabled AI steps the oracle must not run; the spec checks each is an enabled AI kind).
  - In a `client` entry, `rows: "scala"` is a placeholder that regeneration replaces with the Scala-verified frame.
  - A failure vector has **exactly one** failing or violating step; with two, the rerun would fail at the second.
  - `framesWithout` is the frame set of a second `executeTree` run over the same tree **with the failing step and its transitive dependents
    removed**. Every `rows` in `client` must equal the matching Scala-verified frame from `frames` or `framesWithout`. The Jest runner asserts
    that, and the Scala runner asserts that every frame it is given was produced by the engine.

**Runner 1 (Scala oracle).** `PipelineStepParitySpec`, in `backend/src/test/scala/com/helio/domain/engine/` (package `engine`, beside the
tree-walk spec), drives **every** vector through `executeTree` (C5).

- A **step vector** becomes a one-root tree whose root frame is `inputRows`, holding the step under test with `enabled` (default `true`).
  - A lane secondary is a second root whose frame is the secondary rows, plus a `limit` step with `count 0`, which keeps every row
    (`LimitStep.scala:58`). The step under test's `secondaryInput.stepId` names that `limit` step.
  - A source secondary goes through a `DataSourceRepository` test double whose `findByIdInternal` returns a `DataSource` for the vector's id
    (`JoinStep.scala:101`), and whose row loading returns the vector's rows.
  - Source-secondary rows pass through JSON and can hold only doubles, so integral-key traps use a lane secondary.
  - Domain steps are built from (kind, raw config) through a test-local helper that matches all 27 kinds and fails loudly on a missing arm. It
    mirrors `PipelineStepRepository.rowToDomain` (`:1320`).
  - Assertions:
    - `expect.rows`: the step's node frame equals them under Decision 3's comparator.
    - `error: true`: the walk fails with `StepExecutionException` for that step.
- A **walk vector** runs `executeTree` over `rootFrames` and `steps`. Assertions:
  - `frames`: every node frame is compared.
  - `failsAt`: the walk fails with `StepExecutionException.stepId == failsAt`. The spec then reruns `executeTree` on the tree minus that step's
    dependent closure and asserts `framesWithout`.
  - `laneError`: the walk fails with `LaneReferenceError`. The spec then reruns `executeTree` with the violating step and its dependent closure removed, and asserts `framesWithout`.
- **AI steps.** A walk vector with an enabled AI step uses `framesWithout` semantics: Scala is run on the tree minus the AI step and its
  dependents, and asserts those frames. The client asserts `notPreviewed` for the AI step and its dependents.
- **Server kinds.** Server kinds mid-pipeline are evaluated by Scala normally (`frames`); the client asserts `needsServer`/`blocked` for them
  and their dependents, and Scala-verified rows for everything else.
- **Lane violations.** Scala fails the whole run, while the client marks the violating step `error` and its dependents `blocked`, and computes
  every other node. This is a deliberate, documented difference: the preview stays useful while the user fixes the reference, and Save & run
  will report the server's failure. The rows the client computes for unaffected nodes are held to a `framesWithout`-style rerun with the
  violating step removed.

**Runner 2 (Jest).** `pipelineStepParity.test.ts` in `frontend/src/features/pipelines/evaluator/` runs every step vector and every walk vector
(the `client` block) through the TypeScript evaluator.

**Agreement checks.** Each check is independently failable. Each mutation is run once on a scratch copy and its red output is recorded; no
mutation is committed.

1. **Scala:** the manifest kind set equals `PipelineStep.Registry.keySet`. Mutation: remove a manifest entry; the check turns red.
2. **Jest:** the evaluator's kind set equals the manifest's non-`server` set, and each non-server kind has a vector file with at least
   `minVectors` vectors. Mutation: delete the `dedupe` evaluator, or its vector file; red.
3. **Jest:** the TypeScript function, operator and literal tables equal `compute-expression-functions.json`, whose Scala side is
   `ComputeExpressionFunctionsSeamSpec` (unchanged). Mutation: drop `mod` from the TypeScript table; red.
4. **Vectors (both sides):** the spike's traps.
   - `round` as `Math.round` makes `round(-2.5)` → `-3` and `round(2.675, 2)` → `2.68` red.
   - `sort` as `a - b`, or as a plain string sort, makes the mixed column `[10, "9", "abc", null, "2", 3.5, "Abc", "10"]` red.
   - `cast integer` as `Number(s)` makes `"0x10"`, `"1.9"` and `"Infinity"` red.
   - Mutation: replace `toDoubleOption` with `Number()` in sort; red on the numeric-parse traps.
5. **Jest:** `clientEvaluable` declines a compute expression calling a function absent from the TypeScript table. Mutation: make it return
   `ok`; red.

**Required trap vectors.** These are in addition to the spike's three. Every expectation comes from the oracle.

- **Strings:** Java `trim` (U+00A0 and U+2003 survive); `split` on `.` and `|` with trailing empties.
- **Doubles through `Any.toString` sites:** `split` on a double field (`3.0`); a `pivot` column name from a numeric index; and `dedupe`/`join`
  keys mixing an integral `1` (after a cast) with a double `1.0`.
- **Compute string concatenation:** `1.0E7`, `1.0E-4`.
- **Numeric-parse traps** (`"1d"`, `"1f"`, `" 1 "`, `" 1"`, `"0x1p3"`, `"0x10"`, `"NaN"`, `"Infinity"`, `"+1"`) through `sort`, `filter` `>` and `=`, and
  `aggregate sum`.
- **`cast` date/timestamp:**
  - a whole-second epoch double;
  - a millisecond epoch;
  - a fractional epoch (Scala never treats a fractional number as an epoch, so it is not converted);
  - an ISO string kept;
  - an unparseable string giving `null`.
- **Compute, parse failures:** a depth-limit expression is `{error: true}`, and so is a wrong arity. An unknown field is a per-row `null`, not an error.
- **Compute, per-row errors:** a per-row type error gives `null`.
- **Compute, function semantics:**
  - `mod` with a negative divisor;
  - `substring` clamping;
  - `coalesce` short-circuit;
  - `if` with a null condition;
  - three-valued `and`/`or` with null;
  - `date_trunc("week")` landing on a Monday;
  - `add_days` with a fractional count;
  - the epoch-milliseconds threshold.
- **Aggregation and window functions:**
  - `percentile` interpolation;
  - the `fillnull mode` tie-break;
  - `window` `days` frames over unparseable timestamps;
  - `rank` with ties;
  - `lag` past the start of a partition.
- **Union, lookup and secondaries:**
  - `union byPosition` with unequal widths;
  - a `lookup` key collision;
  - an empty `dataSourceId` secondary.
- **Regex:** every vector in Decision 1a.
- **Seeds:** `window-rolling-seam.json` `input`/`expected` pairs, and `ExpressionEvaluatorSpec` cases.

### Decision 5: Incremental walk and per-step cache

`evaluatePipeline(definition, rootFrames, secondaryFrames, previous?: WalkResult, editedStepId?) -> WalkResult`.

- **Definition.** Each step carries `id, kind, parentStepId, rootId, position, enabled, config`.
- **Edges.** Dependency edges are the engine's own: `parentStepId`, plus the lane dependency (`laneDependencyOf`: the `secondaryInput.stepId` of
  `join`/`union`/`lookup`).
- **Order.** Evaluation order and trunk/tail selection follow `executeTree`'s rule, including `position`. This is held by walk vectors.
- **Disabled steps.** A disabled step of **any** kind is transparent: its frame is its input frame. It is never declined and never starts a
  `notPreviewed` cascade.
- **Incremental recompute.** With `previous` and `editedStepId`, only the edited step and its transitive dependents (through both edge kinds)
  are recomputed. Every other node's frame is reused **by reference**.
- **Schema.** The per-step schema is pinned as the **ordered list of column names**: a union over the output rows, in first-seen order (row
  order, then key order within a row). It carries no types and makes no Scala parity claim; type inference stays with the server's analyze
  (`StepSchemaInference`). A Jest unit test asserts it for: an empty frame, rows with differing key sets, and a `select` that reorders columns.

**Required walk vectors:**

- linear;
- a tail branch;
- the **HEL-970 rejoin**: a `join` whose lane secondary is a non-ancestor lane; editing that lane's step must recompute the join;
- an error at step k, with independent nodes still computed;
- a server kind mid-pipeline;
- an enabled AI step mid-pipeline;
- a **disabled** mid-pipeline step;
- a **disabled AI step** with steps below it, which must be computed;
- multi-root;
- lane self, dangling and ancestor violations.

**Property test (Jest).** For every walk vector and every step as `editedStepId`, the incremental result equals a full recompute, and the
frames of unaffected nodes are identical by reference.

### Decision 6: Latency evidence

A Node benchmark script in the HEL-1581 scratch directory (not in the repo) does the following:

- runs the evaluator over a 1,000-row `runs`-shaped frame with the board's three steps (filter `duration_s >= X`, sort, compute
  `$duration_s / 60`);
- runs 50 warm-up edits, then 500 measured filter edits;
- reports median, p95 and max, into `measurements.md` in this change, against a budget of median < 50 ms;
- runs a 10,000-row variant for information.

There is **no timing assertion in Jest**, because timing on one shared machine is not a reliable gate.

## Risks / Trade-offs

- **`Seq[Double].sum` and negative zero (final gate, round 1).** `IterableOnce.sum` reduces from the first element for a known-size collection (a Vector) and folds from `0.0` otherwise (a List), so a group of only `-0.0` sums to `-0.0` on a Vector frame and `0.0` on a List frame. Production source frames are Vectors; frames downstream of aggregate / groupby / pivot are Lists. The walk tracks `listFrame` and the corpus covers both (the oracle's root frames are Vectors; two walk vectors reach the List case).
- **Unicode-digit numeric timestamp strings** are epochs on the JVM; the evaluator ports that (see Decision 1, `cast`).

- **`window` and `sort` ordering is `java.util.TimSort`.** A faithful port (`javaTimSort.ts`) is used wherever Scala sorts with a Java object sort over a comparator that can be non-transitive (window `orderBy`), including the "Comparison method violates its general contract!" failure, which becomes a step `error`. The corpus holds 40-, 64- and 200-row mixed vectors, the last one making Java throw. Other sorts in Scala use consistent total orders, where any stable sort gives the same result.
- **Map-valued configs and key order.** spray-json parses every JSON object into a sorted `TreeMap`, so a `rename` fold runs in `String.compareTo` (UTF-16 code unit) order with four or fewer entries and in `immutable.HashMap` order from five. The evaluator reproduces both (`scalaMapKeyOrder`), so a JS object's own key order, including integer-like keys listed first, never matters and nothing is declined. Audit of every config object iterated by key: only `rename` is order-dependent; `cast` entries are independent per field; the remaining sites are set-based or explicitly sorted (join/lookup collision names). The corpus holds unsorted-chain, unsorted-collision and integer-like (`10` before `9`) vectors filled by the oracle.
- **A parentless step whose root has no frame** fails the Scala run (unresolved lane reference); the client marks it `error` and blocks its dependents.
- **Remaining documented gaps (manifest `notes`):** Long precision beyond 2^53; a full 32-bit improved-hash collision keeps first-seen group order; Unicode property data follows the host JS engine, not JDK 21.

- **Duplicated semantics drift.** This is bounded by the oracle-run corpus in CI. The residual risk is a behaviour no vector covers; the trap
  list and the per-kind minimums bound it but cannot eliminate it.
- **Regex coverage is narrower than Java's.** Patterns outside the allowlist go to the server. This is safe, at the cost of liveness for
  advanced patterns.
- **Large surface for one lane.** If the cycle budget runs out, unfinished kinds may move to `class: "server"`, where they are declined, which
  is safe. That is a scope change and needs an escalation, not a silent edit.
- **Lane-violation divergence.** This is deliberate, and documented in Decision 4.
- **Long precision beyond 2^53.** This is documented and left open.

## Migration Plan

None. This is new, unused code plus tests. Rollback is a revert.

## Open Questions

None for the owner. The 2026-10-16 rulings settle scope.
