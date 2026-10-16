## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `d179fe039cbd9b6e644f0faa94ba83a37bbe4d34`, on top of `d2081b3c7`, with the diff base at `83cbfc022`. This is a re-evaluation of the change requests in evaluation-1.md.

### Fresh gate runs (evaluator's own, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| lint / format:check / typecheck / frontend build / check:scala-quality | all exit 0 |
| `npm test` (2 workers, nice 19) | 524/524 root; 8348/8348 frontend (644 suites) |
| `sbt testOnly PipelineStepParitySpec ComputeExpressionFunctionsSeamSpec` | 681 succeeded, 0 failed |

The backend changes are test-only, so the full `testFull` was not re-run.

### Verification of each cycle-1 change request

**CR1, TimSort port: resolved and verified.**
- **Line by line.** I compared `javaTimSort.ts` against JDK 21 `java.util.TimSort` and found no deviation. The comparison covered:
  - `sort`, `minRunLength`, `countRunAndMakeAscending`, `binarySort`;
  - `mergeCollapse` with the post-JDK-8 two-level invariant check, and `mergeForceCollapse`;
  - `mergeAt`, `gallopLeft`/`gallopRight`, and `mergeLo`/`mergeHi`, including the adaptive `minGallop`;
  - the `len1 == 0` / `len2 == 0` contract-violation throws.

  The memmove-direction helper (`copyWithin`) handles the overlapping same-array copies correctly.
- **My cycle-1 probe, re-run against the port.** It uses JDK 21 `Arrays.sort` with the `WindowStep.compareValues`-shaped non-transitive comparator.
  - Inputs: sizes 31, 32, 40, 64, 200, 1,000 and 3,000, with 30 seeds × 3 text densities each.
  - Result: **630/630 orders identical**, including **38/38 cases where Java throws** "Comparison method violates its general contract!". The port throws in exactly those cases.
- **Stress test with random inconsistent comparators** (n = 50/300/1500, 8 seeds, 3 noise levels): **72/72 identical**, including 23 throws.
  - Evidence: `.concertino/runs/HEL-1581/evidence/eval2-timsort-port-probe.txt`.
- **Mutations.** Reverting `window.ts` to the native sort turns 4 window vectors red. Reverting `windowRolling.ts` to the native sort turns 2 red.
- **Error mapping.** The throw is a `StepConfigError`, so it surfaces as a non-internal step `error`. This matches Scala, where the `IllegalArgumentException` inside `evaluate` becomes a `StepExecutionException`. The 200-row `{error: true}` vector holds both sides.
- **Other Scala sort sites.** The executor's claim holds. The remaining sites all use consistent total orders, where any stable sort gives the same result:
  - `CastStep` `sortBy(_._1)`, a String sort;
  - `AggregateStep`/`FillNullStep` `Double` `sorted`;
  - `DedupeStep` `sortBy(_._1)`;
  - `JoinColumnNaming` `sorted`;
  - `WindowRolling` `sortBy((epochDay, idx))`;
  - `SortStep.sortWith`, a three-tier total order that becomes a consistent `Ordering.fromLessThan`.

  Routing `sort` through `javaSort` as well is harmless.

**CR3, unknown root: resolved.**
- `evaluatePipeline.ts` now returns `error` for a parentless step whose root has no frame, and the false Jest claim is gone.
- A new `pipelines.json` vector backs it with the oracle: `laneError` + `removed: [s2]`. The spec now checks that the violation message names a removed id, and the message is "unresolved … s2, s3".
- Mutation: restoring the first-root fallback turns the vector red.

**CR4, design.md amendments: partly resolved.**
- Resolved: the unknown-field per-row null (lines 86 and 332), the walk-vector shapes and placeholder (lines 260-265), and the Risks entries.
- Not resolved: the new rename amendment states a false premise (see CR2 below).

**CR5, dead code: resolved.** `minimalConfig` is removed.

**Non-blocking suggestions from cycle 1: done.** The `notRun` and `removed` assertions are in the Scala spec, and the `any` disable is justified.

**CR2, rename and integer-like keys: NOT resolved, and the premise is wrong.** See Phase 1.

### Phase 1: Spec Review — FAIL

Issue: **`rename` with four or fewer entries folds in sorted-key order on the JVM, not JSON text order.** The client therefore still returns wrong rows for ordinary configs it accepts. This violates the spec requirement "Client evaluation matches the server engine" and C3.

- **Root cause, from source.** `PipelineStepConfigCodec.decode` → `RenameConfig.decode` parses with spray-json 1.3.6.
  - spray-json's `JsonParser.object` builds every object into a **`TreeMap`** (`spray/json/JsonParser.scala:91-100`, `members(TreeMap.empty[String, JsValue])`).
  - `StepCodecUtil.stringMap`'s `o.fields.map {...}` then rebuilds that map through the unsorted `immutable.Map` factory:
    - with four or fewer entries, the result is `Map1`..`Map4` in **TreeMap (`String.compareTo`) order**;
    - with five or more, it is a `HashMap`.
  - This also explains why the existing ≥5 hash-order vectors pass.
  - The cycle-1 corpus never caught it, because every vector with four or fewer entries already listed its keys in alphabetical order.
- **Oracle probe.** In a scratch copy, I added three vectors and filled them from `executeTree` with `PARITY_REGEN=1`. I then ran the current client (a fresh `tsc` build of d179fe039) on the same configs.
  - `{"renames": {"b": "c", "a": "b"}}` on `[{a: 1.0, b: 2.0}]`:
    - Scala: `[{c: 1.0}]`.
    - Client: `clientEvaluable` → `ok`, and it returns `[{c: 2, b: 1}]`. Wrong.
  - `{"renames": {"z": "t", "m": "t"}}` on `[{z: "zv", m: "mv"}]`:
    - Scala: `[{t: "zv"}]`.
    - Client: `ok`, and it returns `[{t: "mv"}]`. Wrong.
  - `{"renames": {"9": "x", "10": "x"}}`:
    - Scala: `[{x: "n"}]`, because `"10"` sorts before `"9"`.
    - Client: declines with `integerLikeColumnName`.
  - Evidence:
    - `.concertino/runs/HEL-1581/evidence/eval2-rename-order-probe.txt`
    - `.concertino/runs/HEL-1581/evidence/eval2-rename-oracle-regen.txt`
- **Consequence.** The `integerLikeColumnName` decline rests on a false premise. The comment at `rowOps.ts:42-43` says "Up to four entries Scala folds in JSON text order". The design.md Risks entry says "loses JSON text order". The tasks.md "Cycle 2 amendments" and manifest note 7 say the same.
  - Once the client sorts keys by UTF-16 code unit, which equals `String.compareTo`, JS key enumeration order stops mattering. Integer-like keys then need no decline at all.
  - The orchestrator approved the reason. It is narrow and safe under C3, but it is unnecessary, and its documented rationale is false.

All other acceptance criteria and CONSTRAINTS C1, C2, C4 and C5 remain honoured.

### Phase 2: Code Review — PASS

The cycle-2 code is clean:
- the TimSort port is faithful, as verified above;
- the unknown-root branch is minimal;
- the decline is narrow as written. It fires only with four or fewer entries, a canonical array-index key, and a chain or a shared target.
- The audit of other key-order sites holds: `cast` entries are independent per field, and `union byName` and the combine sites are set-based.

The defect above is a semantic (spec) issue, not a code-quality one. The fix is in Change Request 1.

### Phase 3: UI Review — N/A

There is still no rendered surface, and nothing outside `evaluator/` imports it (C2).

### Overall: FAIL

### Change Requests

1. **Fold a `rename` of four or fewer entries in sorted-key order.** Location: `steps/rowOps.ts:30-34` and `scalaGroup.ts:176-177`.
   - In `scalaMapKeyOrder`, replace `if (keys.length <= 4) return [...keys];` with a sort by UTF-16 code unit (`[...keys].sort()`, which equals Java `String.compareTo`). Keep the CHAMP hash order for five or more.
   - Fix the doc comments that describe "insertion order up to four".
   - Add oracle-filled `rename.json` vectors, using the probes above as templates:
     - an unsorted non-integer chain `{"b":"c","a":"b"}`;
     - an unsorted collision `{"z":"t","m":"t"}`;
     - `{"9":"x","10":"x"}`.
2. **Remove the `integerLikeColumnName` decline, or re-justify it truthfully.**
   - Preferred: remove the decline (`rowOps.ts:17-18` and `:41-51`), the reason (`steps/types.ts:19-20`), the design.md Decision 2 bullet and Risks entry, tasks.md "Cycle 2 amendments" bullet 2, and manifest note 7. Then turn the two `clientDeclines: integerLikeColumnName` vectors into `rows` vectors filled by the oracle. Sorted order makes them exact.
   - If it is kept, every statement of its rationale must be replaced with the true mechanism (spray-json TreeMap → sorted order). Its necessity must also be re-argued, because with the CR1 fix it does not exist.
   - Either way, design.md must not keep the claim "Scala folds in JSON text order".
3. **Re-audit the other config objects the evaluator iterates by key**, assuming spray's sorted order rather than text order. I found only `cast` (`cast.ts:88`, independent per field, so no change is needed). Record the corrected statement in the design.md Risks entry, replacing "No other site depends on the key order of a row object".

### Non-blocking Suggestions

- `javaTimSort.test.ts`: consider adding one small fixed non-transitive case, such as the 40-row corpus column, with the expected index order. The port's equivalence to Java would then also be pinned outside the window vectors.
