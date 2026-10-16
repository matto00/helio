## Skeptic Report — final gate (round 2, skeptic-final-2.md)

I reviewed HEAD `80725c3f881ceb6a9972a5b4e2dad17f23cf2da8`. The working tree was clean and HEAD did not change during the review.

`resolve-review-base.sh` returned `0d8bd55cf23a8c2a867614d7182d748ab6dde912` (exit 0). The round-1 fix is the diff `3b79f2f4c..80725c3f8`: 24 files, +994/-61.

The spawn guard (`assert-cwd.sh`) returned `READY ambient=/home/matt/Development/helio branch=feature/client-step-evaluator-parity/HEL-1581`.

### What I verified (with evidence)

**Scope and C2**
- Every changed file versus base is under `frontend/src/features/pipelines/evaluator/`, `shared-test-fixtures/pipeline-step-parity/`, `backend/src/test/scala/com/helio/domain/engine/` or the change dir. The one exception is the existing `frontend/src/features/pipelines/README.md` paragraph.
- Nothing outside the evaluator imports it. There are no UI changes, so the visual step (§4) does not apply.
- `evaluation-3.md` is now committed.

**The corpus was not laundered**
- I compared every vector at `3b79f2f4c` with HEAD after JSON parsing.
- 0 existing vectors changed or were removed. The `-` lines in `compute.json` and `filter.json` are numeric reformatting only (`1.0e7` became `10000000.0`; the values are equal).
- Every change is an added vector.

**Gates (fresh runs of my own)**

| Gate | Result |
| --- | --- |
| Jest over `src/features/pipelines/evaluator` (2 workers, nice 19) | 7 suites, 794/794 passed, exit 0 |
| `sbt testOnly PipelineStepParitySpec` (under the sbtfull flock) | 702 succeeded, 0 failed, hel1468-guard `failed=0`, exit 0 |
| `npm run typecheck` | exit 0 |
| `eslint --max-warnings=0` on the evaluator directory | exit 0 |
| `prettier --check` on the evaluator and the fixtures | clean |

**CR1 (Unicode-digit epochs): resolved, checked against the oracle and not just against the vectors**
- I read `TimestampParsing.scala:106-168` against `instants.ts:30-90`. `epochOfString` ports the String arm of `epochOf`:
  - `Long.parseLong`, or a whole `BigDecimal` with |scale| ≤ 40 and `toLongExact`;
  - Nd digits through `Character.digit`, in the mantissa and the exponent;
  - the ±9999999999 seconds/millis threshold;
  - the 0001-9999 bound.
- It feeds `cast.ts:41,135` and `expression/dateFunctions.ts:22`. `datebucket` and window days reach it through the same `parseInstantString`.
- **Out-of-range case:** Scala's `epochInstant(...).orElse(parseNonEpochInstant)` falls through to the non-epoch parser, while the TS returns `undefined`. No string matched by the decimal grammar can also be a non-epoch instant, so the outcome is the same.
- **Oracle check.** My own probe set ran through the real oracle (`executeTree`) and the `tsc`-built client:
  - Inputs: 364 epoch strings in ASCII, Arabic-Indic, Extended Arabic, Devanagari, fullwidth, Thai, Bengali, mixed-script and supplementary-plane math-bold digits.
  - Forms covered: the BigDecimal forms (`.5e1`, `1.`, `1e+3`, scale 40/41, `1e9999999999`), the threshold and bound edges, Long overflow, and U+00A0/U+3000 padding.
  - Configs: 8 per string (cast timestamp and date, datebucket day and month, compute `add_days`, `seconds_between` and `date_trunc`, and a window days frame).
  - Result: **0 divergences**. 152 of the 305 non-ASCII datebucket probes parse as epochs in Scala, so the probe set is not vacuous.
- `design.md` Decision 1 (the `cast` row) and the `instants.ts` header are corrected. The chart's ASCII-only gap is recorded as a follow-up in `tasks.md` and the manifest.

**CR2 (`-0.0` sums): resolved by porting, and the List/Vector model holds on the production path**
- **Production frame types.** I read the engine:
  - `loadRowsWithStats` builds dataset frames as Vectors (`PipelineRowJson.scala:146-153`), CSV frames as Vectors (`InProcessPipelineEngine.scala:802-812`), and REST/SQL frames as `FetchOutcome.rows: Vector`. So production source frames are Vectors, as the oracle's are.
  - aggregate, groupby and pivot end in `Map.map(...).toSeq` (a List), and the aggregate empty-input branch is `Seq(aggMap)` (a List).
  - Every other kind preserves the outer collection type: `map`, `filter`, `flatMap` (including splittext and extractheadings, whose `toIndexedSeq` is inner), `take`, `sortWith`, `zipWithIndex.map`/`collect`, and left-hand `++` for union.
  - Group items come from `rows.groupBy`, so they share the input frame's type.
- **Oracle walks.** I ran about 50 oracle-backed walks with `-0.0` data:
  - every row-preserving kind after a List, after a Vector, and disabled;
  - union byPosition and byName, with a List left / Vector lane and a Vector left / List lane;
  - join inner and left in both directions;
  - lookup;
  - groupby followed by fillnull mean;
  - a single-element List;
  - pivot followed by pivot;
  - an empty-input aggregate;
  - aggregate followed by splittext;
  - window running_sum.
- The oracle discriminates on these: union with a Vector left and a List lane gives `-0.0`, while a List left gives `0.0`. The client matches all of them.

**Regression fuzz:** I re-ran round 1's generator (seeds 11 and 12, 3,000 probes).
- same 2918, both-error 79, diffs 3.
- All 3 diffs are `cast long` saturation, which is the documented ±2^53 gap.
- No `-0.0` or Unicode-digit diffs remain.

**Fixes are guarded (red first).** I applied TS mutations in a scratch copy of the frontend (control 794/794 green):

| Mutation | Result |
| --- | --- |
| sum always folds from 0 | 7 failed |
| sum always reduces | 2 failed |
| `epochOfString` call removed | 9 failed |
| Nd digits ignored | 9 failed |

**Round-1 non-blocking notes:**
- The hash-collision manifest note is reworded (first-seen order is Scala's own behaviour).
- A vector with three NaN keys was added for groupby and aggregate.

**C1–C5:** C1 and C5 hold. The oracle is `ParityRunner.run` → `executeTree`. Lane secondaries are a second root plus `limit 0`, so they pass through and stay Vectors, matching the client. C3 holds, because no new approximation was introduced. C4 was respected by this review.

Evidence (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1581/evidence/.concertino/scratch/HEL-1581/skeptic3/skeptic-final-2-probes.md`
- `gen3.py`, `cmp3.py`, `probes3.json`, `ts3.out`, `probes3.json.scala.out` and `cmpfz.txt`, alongside it.

No conclusion here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- The chart `parseChartInstant` ASCII-only epoch gap is recorded only in `tasks.md` and the manifest notes. File it as a Linear follow-up so it is not lost when the change is archived.
- `Long` saturation (`cast long` of `"Infinity"`/`"1e400"`/`1e21`) is still the most commonly hit known gap in fuzzing. The manifest's ±2^53 note could name those inputs explicitly.
- The `listFrame` flag is a correct model today only because every non-producer kind preserves the outer collection type. A future Scala step that calls `.toVector`/`.toList` on its output would silently break it. A one-line comment at `LIST_PRODUCERS` naming that invariant would help.
