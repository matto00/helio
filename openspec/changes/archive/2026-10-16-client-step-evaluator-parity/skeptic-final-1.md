## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `3b79f2f4c1af32ed09d582d3685b63a8cd512702`, a merge of origin/main into d2081b3c7 / d179fe039 / db8ade2f2. HEAD did not change during the review. The diff base was resolved live with `resolve-review-base.sh` as `0d8bd55cf23a8c2a867614d7182d748ab6dde912` (exit 0). The diff covers 88 files.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/client-step-evaluator-parity/HEL-1581`.
- **Scope and C2.**
  - Every changed file is under `frontend/src/features/pipelines/evaluator/`, `shared-test-fixtures/pipeline-step-parity/`, `backend/src/test/scala/com/helio/domain/engine/` (test-only) or the change directory. The one exception is a 4-line paragraph in `frontend/src/features/pipelines/README.md`.
  - A grep for imports of `pipelines/evaluator` from outside that directory finds none. No main backend file changed.
  - `evaluation-3.md` is untracked (`git status`). Commit it with the change.
- **Gates, fresh runs of my own.**
  - Jest over `src/features/pipelines/evaluator` (2 workers, nice 19): 7 suites, 770/770 passed, exit 0.
  - `sbt testOnly PipelineStepParitySpec` (under the sbtfull flock): 680 succeeded, 0 failed, exit 0.
  - `npm run typecheck`: exit 0. `eslint --max-warnings=0` on the evaluator directory: exit 0.
- **The corpus is oracle-backed through the run path (C1/C5).**
  - `ParityRunner.run` builds every step through `PipelineStepConfigCodec.decode` (`ParityStepBuilder`) and runs `engine.executeTree`. A step vector is a one-root tree; a lane secondary is a second root plus `limit 0`.
  - `diff` compares row order, value and class in both directions. Jest's `diffFrames` does the same.
  - A walk vector's `client.rows` must equal a Scala-verified frame on both sides.
- **My own mutations** (scratch copies only; the worktree was never touched):
  - **TS:** removing Unicode-digit support from `parseJavaInt` turns 3 tests red. The cast-integer Unicode-digit vectors exist.
  - **Scala:** changing `StringOpsStep` `trim` to `strip` in a byte-identical scratch oracle gives `PipelineStepParitySpec` 679 ok / 1 FAILED, on the U+00A0 trim vector. Drift on the Scala side fails CI.
  - The executor's 21 mutations (`mutation-summary.md`) are consistent with this.
- **Walk and AC4.**
  - `pipelines.json` has 22 walk vectors, including the HEL-970 rejoin, the error at step k, server, AI, disabled and disabled-AI steps, multi-root, and four lane violations.
  - `evaluatePipeline.test.ts` property-tests incremental against full recompute for every step of every walk vector, with reference identity for unaffected frames. That suite is green.
- **AC5 latency, re-run by me.**
  - 1,000 rows: median 0.33 ms, p95 0.621 ms, max 1.28 ms.
  - 10,000 rows: median 4.4 ms.
  - This matches `measurements.md` (0.32–0.43 ms) and is far inside the 50 ms budget.
- **Hunt for JVM-vs-JS differences.** I ran a differential fuzz through the real oracle:
  - Setup: a scratch `SkepticProbeSpec` calls `ParityRunner.runStepVector`, so it uses the same `executeTree` path as the parity spec. On the client side, a `tsc` build of the evaluator at HEAD calls `evaluateStep`.
  - Volume: 12,516 probes over 19 kinds (random mixed rows and configs), in three independent sbt runs.
  - Result: every difference falls into exactly three classes, checked with `relaxed.py` (`unexplained: []`). Two of the classes are not in the corpus, not declined and not in the manifest `notes`; the third is documented:
    1. **Unicode decimal-digit epochs (blocking).** See CR1.
    2. **`-0.0` sums.** See CR2.
    3. **`Long` saturation at 9223372036854775807.** Already documented in the manifest as the ±2^53 gap.
  - Everything else matched exactly, including NaN group keys (3 probes with two or more NaN keys), TimSort window orders, the rename fold, Java trim/split, regex, Double rendering and Instant rendering.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1581/evidence/skeptic-final-1-probes.md`. The harness and raw outputs are in `.../evidence/skeptic-final-1-harness/`.

### Verdict: REFUTE

The port is unusually faithful, but the fuzz found one oracle-confirmed divergence in accepted configs that is not covered, declined or documented. It can flip a step's status from `ok` to `error`. That breaks C3 ("never approximated") and the premise of design Decision 1 that `parseChartInstant` is "held to `TimestampParsing`". A second, smaller divergence needs a port or a recorded gap.

### Change Requests

1. **Port `TimestampParsing.epochOf`'s String arm faithfully. Unicode-digit epochs diverge today.**

   **Scala behaviour.**
   - `TimestampParsing.scala` `epochOf` does `Try(s.trim.toLong)`, which is `Long.parseLong`. That accepts any Unicode Nd digit through `Character.digit`.
   - It then tries `BigDecimal(s.trim)`, which is `java.math.BigDecimal` and also accepts Nd digits.
   - The client's `instants.ts:28` `parseInstantString` delegates to `parseChartInstant`, whose `wholeEpoch` (`chartTimeAxis.ts:71`) is ASCII-only.

   **Oracle-confirmed results:**

   | Probe | Scala | Client |
   | --- | --- | --- |
   | `datebucket day` over `[{"t":"٣"}]` | rows `[{"t":"1970-01-01"}]` | **status `error`** ("none of 1 row(s) ... could be parsed") |
   | `datebucket` over `"１７００００００００"` (fullwidth) | `2023-11-14` | `error` |
   | `cast timestamp` over `"１７００００００００"` | keeps the string | `null` |
   | `cast date` over `"١٧٠٠٠٠٠٠٠٠"` | keeps the string | `null` |
   | compute `add_days($t, 1)` over `"１７００００００００"` | `2023-11-15T22:13:20Z` | `null` |
   | `seconds_between` | numbers | `null` |
   | window `rolling_sum` with `frameUnit: days` over a fullwidth epoch | `o = 3.0` for both rows | `o = null` / `2` |

   The BigDecimal forms `"１.０"` and `"１e３"`, plus Devanagari `"१२"`, are also epochs in Scala and `null` in the client.

   **Required:**
   - Put a faithful `epochOf(String)` in `instants.ts`, in front of the `parseChartInstant` delegation. It must do:
     - `javaTrim`;
     - `parseJavaLong`, which is already Nd-aware;
     - otherwise the Java `BigDecimal(String)` grammar with Nd digits, then `isWhole`, the |scale| ≤ 40 bound and `toLongExact`;
     - then the same seconds/millis threshold and the 0001–9999 bound.
   - This one function feeds `cast`, `datebucket`, `expression/dateFunctions.ts:22` and `windowRolling.ts:73`.
   - Add oracle-filled vectors:
     - `cast` date and timestamp;
     - a `datebucket` where every row is such a string (Scala ok, so the client must not error);
     - compute `add_days` and `seconds_between`;
     - a window `days` frame;
     - at least the Arabic-Indic, fullwidth and BigDecimal-form inputs.
   - Correct design.md Decision 1 (the `cast` row's "held to `TimestampParsing` by `chart-timestamp-parsing.json`") and the header comment in `instants.ts:1-5`.

   The chart's own `parseChartInstant` has the same gap against the backend. That is pre-existing and outside this ticket, so record it as a follow-up rather than fixing it here.

2. **Reproduce, or record as a gap, Scala's `Seq[Double].sum` `-0.0` behaviour.**
   - scala-library 2.13.15 `IterableOnce.sum` (`IterableOnce.scala:1057-1062`) is `reduce(num.plus)` when `knownSize > 0`, and the oracle's frames are Vectors.
   - So a group whose numeric values are all `-0.0` (CSV `"-0"`, `"-0.0"`, or an underflowing `"-1e-400"`) sums to `-0.0` on the JVM.
   - `steps/numeric.ts` `sum` folds from `0`, so the client gives `0.0`.
   - Oracle-confirmed:

     | Probe | Scala | Client |
     | --- | --- | --- |
     | `aggregate sum`/`avg` over `[{"k":"x","v":"-0.0"}]` | `-0.0` / `-0.0` | `0.0` / `0.0` |
     | `groupby sum` | `-0.0` | `0.0` |
     | `pivot sum` | `-0.0` | `0.0` |

     About 30 fuzz probes hit this.
   - It becomes visible downstream at every `Any.toString` site (pivot names, `cast string`, `stringops`, `filter contains`: `"-0.0"` against `"0.0"`). `fillnull mean` uses the same `sum`.
   - **Either:**
     - mirror `knownSize` semantics: start from the first element when it is non-empty; first confirm the frame collection type on the production `executeTree` path, because a `List` frame folds from `0.0`;
     - and add oracle vectors for `aggregate`, `groupby` and `pivot`;
   - **or** add it explicitly to the manifest `notes` and design Risks as a known gap.

### Non-blocking notes

- **A manifest note may describe a gap that does not exist.** The note says "Full 32-bit improved-hash collisions keep first-seen order (a known, vanishingly rare gap)". In scala-library 2.13.15, `mutable.HashMap.getOrElseUpdate` goes through `put0`, which inserts after existing equal-hash nodes (`HashMap.scala:238-249`). So Scala keeps first-seen order too.
  - NaN group keys always collide, so the case is not rare. They are also not covered by a groupby/aggregate vector with two or more NaN keys, although all 3 fuzz probes of that shape matched.
  - Consider rewording the note, and adding one oracle vector with two or more NaN group keys.
- **`Long` saturation is a realistic input.** `cast long` of `"Infinity"` or `"1e400"` gives Long.MaxValue in Scala and 2^63 as a double in the client. This is within the documented ±2^53 gap, but the note could mention that input specifically.
- **Commit `evaluation-3.md`.** It is currently untracked.
