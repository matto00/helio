## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed the planning artifacts in `openspec/changes/client-step-evaluator-parity/`: `ticket.md`, `proposal.md`, `design.md`, `tasks.md` and `specs/pipeline-client-evaluator/spec.md`. The worktree HEAD is `83cbfc0223ec64a1ea060cbe5110ca03e9b0d617`, and the change directory is untracked. I checked them against that tree and against `skeptic-design-1.md`.

All regex and numeric claims were probed in the real engines: JDK 21.0.12 `java.util.regex`, Scala 2.13.15 `StringOps` (the project's version, `build.sbt:4`), and Node 22 `RegExp` with the `u` flag. I ran every probe twice and got identical output both times.

Durable evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1581/evidence/skeptic-design-2/`:
- `probes-output.txt` (sha256 `8cbbb633…89b6f`);
- the probe sources `Re.java`, `re.mjs` and `Num.java`.

### What I verified (with evidence)

**Round-1 change requests**

| CR | Status | Ground truth |
| --- | --- | --- |
| 1 run-path oracle | Resolved | `evalOneStep` (`InProcessPipelineEngine.scala:248-285`) runs `requiredConfigProblems` before `evaluate`. The design now drives every vector through `executeTree` (C5, Decision 4 runner 1). Compute parse problems are `{error: true}` (Decision 1 compute row; trap list). |
| 2 walk oracle with failures | Mostly resolved; one gap (CR3 below) | `failsAt` + `framesWithout`, `laneError`, AI and server-kind handling are all stated. |
| 3 cast date/timestamp + Instant | Resolved | `CastStep.scala:97-100` `castTimestamp` matches the corrected row exactly: a String is kept if `parseInstant` accepts it, else `null`. A non-String becomes `epochInstant(raw).map(_.toString)`, then `parseInstant(raw).map(_ => str)`, then `orNull`. Obligation 7 is accurate: `fromEpoch` uses `ofEpochMilli`/`ofEpochSecond`, bounded to years 0001-9999 (`TimestampParsing.scala` `fromEpoch`), so no `+`-year rendering arises. Compute `add_days`/`date_trunc` use `DateTimeFormatter.ISO_INSTANT` (`ExpressionDateTimeFunctions.scala:90`). |
| 4 disabled/position | Resolved | `executeTree.evalNode` treats a disabled step as transparent. `structuralRank` sorts by `-position`. Both are in the schema and Decision 5, with the required vectors. |
| 5 regex allowlist | Structure resolved; translations factually wrong (CR1 below) | See below. |
| 6 check 3 | Resolved | `shared-test-fixtures/compute-expression-functions.json` has keys `functions` (15), `operators` (9) and `literals` (2), and is already Scala-checked. Check 3 is now Jest-only against it. |
| 7 numeric primitives | Resolved; claims confirmed | See the numeric probe below. |
| 8 schema | Resolved | Pinned as the ordered column-name union, with no types, and a Jest unit test in task 4.1. |

**Run-path oracle via `executeTree`: the lane-secondary trick.** This is sound.
- `LimitStep.apply` returns `rows` when `count <= 0` (`LimitStep.scala:58`).
- `LimitStep.requiredConfigProblems` flags only a non-Int-representable `count`, so `{"count":0}` passes.
- `executeTree`'s lane pre-check rejects only self, dangling and ancestor references (`:384-412`). A step in root A referencing a `limit` step in root B is legal.
- `isReady` waits for the lane dependency.
- `resolveLane` reads `nodeOutcomes(StepKey)`.

A root cannot be referenced directly, because lanes resolve `StepKey` only. That is why the `limit` hop is needed and why it is correct.

**The `DataSourceRepository` test double.** This is feasible.
- `class DataSourceRepository(ctx: DbContext)` is non-final, and `findByIdInternal` (`:156`) and `readDatasetRows` (`:920`) are both overridable `def`s.
- Join, union and lookup resolve a source through `ctx.dataSourceRepo.findByIdInternal`, then `ctx.loadSource` (`JoinStep.scala:101-108`, `UnionStep.scala:96-102`, `LookupStep.scala:124-130`).
- `loadSource` calls `loadRowsWithStats`. For a `DatasetSource` that calls `dataSourceRepo.readDatasetRows(id)`, then `parseStaticRows` (`InProcessPipelineEngine.scala:522-529`).

So "row loading" means overriding `readDatasetRows` to return a `{columns, rows}` object (see the non-blocking notes).

**`failsAt` / `framesWithout`.** These are sound for single-failure vectors.
- `executeTree` fails on the first failing step in `structuralRank` order, and no `nodeOutcomes` are returned.
- Per-node evaluation is a pure function of the parent and lane frames, so a rerun over the tree minus the failing step's dependent closure reproduces every unaffected frame.

There is a caveat for multi-failure vectors (see the non-blocking notes).

**Numeric-parse primitives.** I called `scala.collection.StringOps.toDoubleOption` from the 2.13.15 jar, plus `Double.parseDouble` and `Integer.parseInt`, against JavaScript `Number`. Results (`probes-output.txt`, Num section):

| Input | Scala and Java | JavaScript `Number` |
| --- | --- | --- |
| `"1d"`, `"1f"`, `"1D"` | `1.0` | `NaN` |
| `"0x1p3"` | `8.0` | `NaN` |
| `"0x10"` | `None` / error | `16` |
| `" 1"` | `None` / error | `1` (new trap; see notes) |
| `" 1 "`, `"+1"`, `"NaN"`, `"Infinity"` | accepted by both | accepted by both |

The design's claims at design.md:31-33 hold. `FilterStep.scala:110-125` matches the Decision 1 filter row:
- `=` and `!=` use `numericFieldValue` plus `value.toDoubleOption`;
- the ordered operators use `.toDouble`.

**Compute `round` trap.** `roundTo` is `BigDecimal.decimal(x).setScale(d, HALF_UP)` (`ExpressionInterpreter.scala:258-260`), so the spec's `-3` and `2.68` are right.

**Regex allowlist (Decision 1a), probed on both engines with the design's own translations.** These parts hold:
- `\s` → `[ \t\n\x0B\f\r]` rejects U+00A0, as Java does.
- `.` → `[^\n\r\u0085  ]` with `u` matches 😀 as one code point and rejects U+0085, as Java does.
- `\b` is ASCII-bounded on JDK 21, identical to JavaScript `u`-mode (`(\b\w+)` on `été` → `"t"` in both).
- A non-participating group gives `null` in both.

Several allowlisted constructs diverge (CR1). All rows below are stable across two runs, `probes-output.txt` lines 3-57.

| Pattern / input | Java (Scala oracle) | JavaScript per design translation |
| --- | --- | --- |
| `(\S+\s)$` on `"ab\r\n"` | no match → `null` | `"ab\r"` (rows that differ) |
| `(a\r)$` on `"a\r\n"` | no match → `null` | `"a\r"` |
| `(a?)*` on `"b"` | `""` | `null` (`undefined`) |
| `(a*)*` on `"b"` | `""` | `null` |
| `(a\-b)` (`\-` "the same escape") | matches `"a-b"` | SyntaxError: Invalid escape |
| `([\d-z])` on `"-"` | `"-"` | SyntaxError: Invalid character class |
| `([\S])` on U+00A0 | U+00A0 | no match → `null` |
| `([]a])` on `"]"` | `"]"` | SyntaxError |
| `([])` | **compile error** (Scala `StepConfigError`) | valid empty class, no match → `null` **rows** |
| `(^*a)` on `"a"` | `"a"` | SyntaxError: Nothing to repeat |

The causes:
- Java's `$` without MULTILINE does **not** match between `\r` and a final `\n`. The design's lookahead does.
- JavaScript rejects an empty iteration of a `*` loop, while Java records the empty capture.

**Judgment: declining Java-invalid patterns.** Declining a Java-invalid pattern as `needsServer`/`unsafeRegex` rather than marking it `error` is **sound in principle**:
- both outcomes produce no rows;
- the server reports the real Java error;
- a JavaScript tokenizer cannot decide Java validity in general.

It is sound only on one condition: every pattern the allowlist accepts must be Java-valid. `[]` is a counterexample. Under a literal reading of "simple character classes", the client compiles it and produces rows where Scala fails the step.

Separately, the spec scenario "Step failure agrees" (spec.md:98-100) says the client "marks that step as an error" for **any** config that fails on the server's run path. Decision 1a's decline contradicts it, and so does Decision 1's decline of a configured but uncached source secondary.

**Scope.** Every ticket AC still maps to a task. Nothing goes beyond piece (a), so there is no scope drift. No API, schema or migration delta is needed, and none is planned.

### Verdict: REFUTE

The design is close. CR1 is a factual-correctness defect of exactly the kind this corpus exists to prevent: an allowlisted pattern produces client rows that differ from the engine. CR2 and CR3 are small text fixes.

### Change Requests

1. **Fix the Decision 1a translations and close the allowlist holes** (evidence: `probes-output.txt`).
   1. Replace the `$` translation. The current one matches between `\r` and a final `\n`, where Java does not (`(a\r)$` on `"a\r\n"`: Java `null`, JavaScript `"a\r"`).
      - A form verified here against `"abc\n"`, `"abc\r\n"`, `"abc\r"`, `"a\r"`, `"a\r\n"` and `"abc\n\n"`: `(?=(?:\r\n|[\n\r\u0085  ])?$)(?!(?<=\r)\n$)`.
      - Add the vector `(a\r)$` on `"a\r\n"` → `null`.
   2. `\-` outside a class must emit a literal `-`, not `\-`, which is a `u`-mode SyntaxError. Re-check every entry in the "escaped metacharacter" row against `u`-mode identity-escape rules.
   3. Decline these forms, or translate them so that `u`-mode accepts them with Java's meaning:
      - a class escape as a range endpoint (`[\d-z]`);
      - `]` as the first member of a class;
      - an empty class `[]` or `[^]`, which Java rejects;
      - a quantifier applied to `^`, `$`, `\b` or `\B`.
   4. Decline `\S` **inside** a class. It has no member expansion, and JavaScript's Unicode `\S` differs: `[\S]` on U+00A0 gives Java U+00A0 and JavaScript `null`.
   5. Decline a quantified group whose body can match empty, or decline `*`/`?`/`{0,…}` on a capturing group outright: `(a?)*` on `"b"` gives Java `""` and JavaScript `null`.
   6. Add a safety net: if `new RegExp(translated, "u")` throws, the step declines as `unsafeRegex`, never as an error or a crash.
   7. State the invariant "allowlist ⊆ Java-valid" as the precondition of the decline-not-error rule.
   8. Add a vector for each item 1-5.
2. **Reconcile the spec with the decline rules.** `spec.md:98-100` "Step failure agrees" must allow either outcome: when the server fails the step, the client "marks that step as an error **or declines it**, and produces no rows for it". As written, the scenario contradicts Decision 1a, which declines Java-invalid patterns, and Decision 1, which declines a configured source secondary with no supplied frame where Scala fails because the source is not found.
3. **Give lane-violation walk vectors a place for verified frames.**
   - Decision 4's `scala` shape lists `{laneError: true}` with no frames.
   - But design.md:239-242, task 1.4 and the spec requirement "A failing step does not hide unaffected results" require the client's rows for unaffected nodes to be held to a rerun with the violating step removed.
   - Change the shape to `{laneError: true, framesWithout: {…}}`. State that the Scala runner asserts the `LaneReferenceError` **and** reruns `executeTree` on the tree minus the violating step and its dependent closure. Without this, the client rows in those vectors have nothing Scala-verified to match.

### Non-blocking notes

- **`datebucket` hedge.** `datebucket` does not render an Instant. It renders `LocalDate.toString`, `yyyy-MM-dd` (`DateBucketStep.scala:118`). Drop the "(if Scala renders an Instant there)" hedge from obligation 7 and the Decision 1 `datebucket` row.
- **Fractional epochs.** `epochOf` accepts only whole values (`wholeLong` requires `isWhole`), so a fractional-seconds epoch is never an epoch. The "if Scala's `epochInstant` admits one" trap therefore resolves to the non-epoch path. Cast-produced instants carry at most millisecond fractions, printed as 3 digits.
- **Source-secondary double.** Override `readDatasetRows` to return `{columns, rows}`. Those rows go through `jsValueToAny`, so a source secondary can only carry doubles: `$int` and `$long` cannot be expressed there. Use a lane secondary for integral-key join traps.
- **Multiple failures.** If a vector has two independent failing steps, Scala reports only the first in `structuralRank` order, and the `framesWithout` rerun would then fail at the second. Require failure vectors to have exactly one failing step, or make the runner iterate.
- **One more numeric trap.** Add `" 1"`: JavaScript `Number` gives `1`, while Scala and Java give `None`/error, because JavaScript whitespace trimming is Unicode.
- **Gate defect check.** No report under review disclosed unsound mtimes. No mtime-ordering claim was relied on: the evidence is content plus sha256.
