## Evaluation Report — Cycle 5 (evaluation-5.md)

Reviewed commit: `dc43a2059c64200fc4dcb1cfb6b06ab40355a797` (on `efc559af4`). The base `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` was
resolved live. The worktree was clean at the start and the end (`git status --short` was empty, and HEAD was unchanged).

Evidence is persisted under `E = /home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.concertino/scratch/HEL-1630/eval5/`.
`E/run.py` applied each mutation or probe, held the sbt lock, and restored or removed each file afterwards. The restores are by bytes
and checked by sha256 (`E/chain.out`, `E/chain2.out`).

**C8 is verified.** In `.concertino/runs/HEL-1630/events.jsonl`:
- Line 61 is `escalation.raised`, id `HEL-1630-1792312960462-410af6`.
- Line 62 is an `answer_discarded`.
- Line 63 is `escalation.answered` with `answer: extend-one-more-cycle-narrow-fix`, `answer_source: human`, channel `chat`. Line 64 is the
  dashboard copy.
- `workflow-state.md` has `EXECUTION_CYCLES: 5`, so this is the final cycle.

### Phase 1: Spec Review — PASS

**Evaluation-4 CR1, within C8's scope: met.**
- **(a) splittext, extractheadings and chunkbytokencount.** Each one's `evaluate` now passes `ctx.stringBudget`, and each charges every
  segment, title or chunk inside the `RowBudget.flatMap` emission (`SplitTextStep.scala:99`, `ExtractHeadingsStep.scala:95`,
  `ChunkByTokenCountStep.scala:135`). The old `apply` overloads delegate with `None`.
- **(b) convertformat.** Each converted text is charged as it lands (`ConvertFormatStep.scala:69`). `csv -> json` is pre-checked
  (`:164`); see the deviation below.
- **(c) cast.** A non-String value's cast result is charged (`CastStep.scala:70`). A String cast to "string" returns
  `v.toString`, which is the same object, so leaving it uncharged is correct.
- **(d) The two shapes are in `DraftPreviewHeapSpec`** (split-fan-out, headings-fan-out), with their own assertion: `steps == 1`,
  `errors == 1`, the "Draft preview text limit" message, and never "step execution failed".
- **(e) The design.md "Residual" note** is closed and replaced by "Executor notes (cycle 5)", with an inventory of the kinds left
  uncharged. One entry in that inventory is wrong; see the separate finding.

**Evaluation-4 CR2 (MC): met.** `InProcessPipelineEngineDraftSeamSpec`, "the node's text headroom", holds 600 cells against a
`maxLiveCells` of 605. Its numbers are correct: 100 rows x (2 cells + 4 text cells), and the second 200-byte text passes 5 x 46 = 230 bytes.

**The executor's claims, checked one by one:**

| Claim | Verdict | My evidence |
|---|---|---|
| Ten-shape max of 74.5 MB (74.4 MB in a 768 MB JVM) | **True.** The second full `testFull` run gave 74.5. Run alone in a 3 GB JVM the max is 74.6 (select-held), so the 0.1 MB is noise. Either way floor(192 / 74.6) = 2 = `DefaultMaxInFlight`. In my 3 GB run split-fan-out and headings-fan-out are both 2.5 MB, with the text-limit message. | `E/gate-sbt-testFull-2.log`, `E/run-heap3g.log` |
| Both new shapes red against `efc559af4` in a 768 MB JVM | **True.** The executor's `red-c8-cycle4-code-heap-768m.log:264-276` shows both at "step execution failed", with `maxMemory MB: 768`. My evaluation-4 probe ran the exact same bodies against `efc559af4` and got the same result independently (heap-pool peaks 967 and 885 MB). My mutation MD reproduces it again here. | eval4 `probe-768m.log`; `E/run-md.log` |
| Every mutation red | **True for every log.** All 18 `red-c8-*.log` files report at least one failing test. Three spot-checks of my own are below. | `E/run-m{c,d,e}.log` |
| Deviation: csv -> json uses a length lower-bound pre-check instead of a capping writer | **Sound.** See below. | |

My mutation spot-checks (C3):
- **MC: the node's headroom ignores what is held** (`InProcessPipelineEngine.scala:492`, `budget - tally.held` changed to `budget - 0L`).
  **Red:** `InProcessPipelineEngineDraftSeamSpec.scala:129`, "Draft preview memory limit reached … would hold more than 605 cells … did not
  include substring 'Draft preview text limit'" (`E/run-mc.log`). Evaluation-4's survivor is now caught.
- **MD: extractheadings is not wired** (`ExtractHeadingsStep.evaluate` passes `None`). Run in a **768 MB** JVM, it is red:
  `DraftPreviewHeapSpec.scala:259`, and headings-fan-out returns "step execution failed" (a swallowed OOM) with `maxMemory MB: 768`
  (`E/run-md.log`). In the same run, split-fan-out stays green at 768 MB.
- **ME: the convertformat charge is removed** (`ConvertFormatStep.scala:69`). **Red:** `StringBudgetSpec.scala:131`, "Expected exception
  StepConfigError … but no exception was thrown" (`E/run-me.log`).

**Why the csv -> json deviation is sound.**
- `csvToJson` writes every value as a JSON string (`obj.put(k, v: String)`), so with no escapes the real output length is
  `sum(lower bound per row) + 1`. The `[`, `]` and the array commas cover the missing trailing comma in each object, so the bound is a true
  lower bound, and escapes only make the output longer.
- The pre-check therefore refuses, before any tree is built, any expansion whose unescaped size is over 262,144 characters.
- Only escaping can push an output over the cap after the pre-check passes. The worst case is control characters written as `\uXXXX`,
  about 6x, giving roughly 1.6M characters. That one value is then refused by the post-build `chargeValue`, and `charge` throws on the
  first value over `maxChars`, so the node stops at that row. That is a bounded overshoot of one value, as design.md states.
- A capping writer that no mutation can fail would breach C3, so removing it is the right call.

**Runs and the saved preview are unchanged.**
- No engine file changed in cycle 5.
- `ctx.stringBudget` is still built only when both draft fields are set (cycle-4 `nodeContext`, unchanged).
- Each changed step's legacy `apply(rows, cfg[, maxRows])` delegates with `None`, which means every `budget.foreach` is a no-op and
  `csvToJson(…, None)` skips the pre-check.
- The `StringBudgetSpec` per-kind cases also assert that the no-budget path builds all 1,000 rows (and the `> 5000`-character csv -> json
  output).
- The walk-order pin and every run, preview and engine spec are green in the full suite.

**C1-C8 hold, and nothing earlier regressed.** The full `testFull` is green, covering:
- C1/C2: the access and never-read-sources specs;
- C3: every proof here was shown red;
- C4: `RowBudgetSpec` and the caps specs;
- C5: `DefaultMaxInFlight == formula == 2`, plus the admission and reading-pool specs;
- C6/C7: the ten-shape max is ≤ 96, the fresh-chain and doubling assertions pass, and so do `LiveCellTallySpec` and `StringBudgetSpec`;
- C8: as above.

The evaluation-3 CR2/CR3 fixes are intact (the tree stayed clean through every run).

The spec delta adds the two scenarios: "Text copied per row inside one node" and "Headroom is what the request has left". tasks.md
group 9 is ticked and matches the diff.

### Phase 2: Code Review — PASS

Gates, run fresh by me in `WORKTREE_PATH` at `dc43a2059`:
- **`sbt testFull`** (under `flock`, nice 19, `-J-Xmx3g`, so the forked JVM had 3 GB):
  - Run 2: 9312 succeeded, 0 failed, 4 canceled (the existing `HELIO_MEASURE` specs). "All tests passed", exit 0
    (`E/gate-sbt-testFull-2.log`).
  - Run 1 is kept as `E/gate-sbt-testFull.log`. It failed 3 `DraftPreviewHeapSpec` cases on `TimeoutException: Future timed out after
    [15 seconds]`. That run overlapped my own `npm test` and build. The comb shape took 15.4 s there, against 14.2 s in run 2 and about
    10 s when run alone. This is a timing margin, not a regression; see Non-blocking.
- **`npm run`** `lint`, `format:check`, `typecheck`, `check:scala-quality`, `check:openspec`, `check:spec-structure` and `check:schemas`:
  all exit 0.
- **`npm test`** (`HELIO_JEST_MAX_WORKERS=2`): root 61/61 suites and 524 tests; frontend 730/730 suites and 9124 tests.
- **`npm --prefix frontend run build`**: exit 0.

Code quality of the cycle-5 diff:
- No CONTRIBUTING [mechanical] violations: there are no inline FQNs, imports are unchanged, and `check:scala-quality` is green.
- The change is small and follows the established `budget: Option[StringBudget]` overload pattern from `ComputeStep`/`StringOpsStep`.
  That keeps it DRY: it reuses `StringBudget` and adds no new abstraction.
- Every proof has a red (C3).
- No dead code.

### Phase 3: UI Review — N/A

There is no UI wiring (HEL-1631 does that) and no frontend diff in cycle 5. The jest suite and the build are green.

### Overall: PASS

Everything inside the owner's C8 scope is met, measured and failable. The adversarial shape below falls outside that scope, so it is
reported separately, as directed.

### Separate finding (outside the owner's C8 scope; for the orchestrator to put to the owner): `pivot` builds unpriced per-row text inside one node

The adversarial shape went against a kind that is still uncharged. design.md's cycle-5 inventory says `pivot` creates "short derived
labels or keys (column names)", not a per-row copy of a cell's text. **That is false when the pivot column carries text.**
- `PivotStep.scala:116` builds `colName = s"${values}_$pivotValue"`, a fresh String per (index group, distinct pivot value).
- It uses that String as a **map key** of the output row.
- `LiveCellTally.addRow` prices `row.valuesIterator` only, so map keys are never priced, not even after the node.

**Probe** (`E/EvalTmpPivotSpec.scala`, the same method as evaluation-4's probe and `DraftPreviewHeapSpec`):
- One root row with a 100,000-character `pad`, and a lane of N rows with the same key, as in the heap spec's fan-out.
- `s0` is the lane join. `t1` is `pivot {index: ["side"], column: "pad", values: "i", agg: "first"}`, so there is one group per lane row,
  and each builds `"i_" + pad`.
- The body is 479,305 bytes, well under the caps: 2 steps, and 10,000 rows ≤ 20,000.

| N | JVM | Outcome | Numbers |
|---|---|---|---|
| 10,000 | 768 MB (prod heap) | `{"message":"step execution failed"}`, a swallowed `OutOfMemoryError` at `:297` | heap-pool peak **895.9 MB**; the boundary sample reads 4.3 MB (`E/run2-probe768.log`) |
| 10,000 | 3 GB | `outcome=completed`: no memory-limit or text-limit refusal at all. The node holds about 10,000 x 100,002 bytes ≈ **954 MB** of keys (arithmetic, Latin-1). The stream then carried 100k-character column names, which my test client's Jackson parser refused ("Name length … exceeds 50000") | `E/run-probe3g.log`, `E/run2-probe3g.log` |
| 2,000 | 768 MB | `outcome=completed`, about **191 MB** of unpriced keys held (arithmetic), about 2x the 96 MB per-request bound, with no refusal | `E/run-probe768.log`, `E/run2-probe768.log` |
| control: splittext over the same 10,000-row fan-out | 768 MB / 3 GB | text-limit `error` (the cycle-5 fix working) | heap-pool peak 203.5 / 208.1 MB |

- **Classification:** an uncharged kind with a genuine in-node OOM. This is outside C8's list (splittext, extractheadings,
  chunkbytokencount, convertformat, cast), so it does not fail this cycle.
- **Severity:** comparable to the gap evaluation-4 blocked on. It takes a 479 KB, 2-step body. It is worse in one respect: the post-node
  budget never prices keys, so even a heap that survives the node holds the frame uncounted, and streams it.
- **Narrow fix, for the owner to scope.** Either one of these closes it:
  - in drafts, charge `colName` against `ctx.stringBudget` in `PivotStep` (and `checkLength` it);
  - make `LiveCellTally` price String keys the way it prices values.

  Also correct design.md's inventory sentence about `pivot`.
- The other uncharged kinds I read only make transient per-row copies, or share existing Strings:
  - transient: `datebucket`'s `toString.trim`, and `filter`'s `toString` on a String (the same object);
  - shared: join renames are resolved once per join, not per row.

  I did not probe these.

Not findings, by the owner's direction: the run path has the same exposure, and `InProcessPipelineEngine.scala:297`'s catch-all
`Throwable` turns these OOMs into "step execution failed". Both belong to HEL-1660.

### Non-blocking Suggestions
- **`DraftPreviewHeapSpec`'s 15 s route timeout leaves a thin margin.**
  - The comb shape's request takes 10-14 s, and it took 15.4 s under my concurrent `npm test` load. That caused 3 timeout failures in my
    first `testFull` run.
  - CI runners are slower than this desktop (MISTAKES.md: CI is the first real timing measurement).
  - Consider an explicit, larger `RouteTestTimeout` for that spec. This was already the case at `efc559af4` (14.8 s in evaluation-4's
    gate) and is not new in cycle 5.
- **`csv -> json` still parses the whole input** (`parseCsvRows`) before the pre-check. A 4 MiB CSV text of tiny cells means about 100 MB
  of transient `Vector[String]` per row, and that happened before cycle 5 too. It is transient and per row, so it is not an OOM in a
  768 MB heap, but it exceeds the 96 MB figure for a moment. Worth noting in the HEL-1660 follow-up.
- **Charging an unchanged String costs the request headroom without allocating anything.** `splittext` gets back the original String
  from `String.split` when there is no match and nothing to trim. This is conservative and acceptable, the same as evaluation-4's note on
  `compute`.
- **For HEL-1660 (as directed, not a finding):** the run path shares every shape above, including pivot, and `:297`'s `Throwable` catch
  hides the OOM.
- **The evaluation-2 carry-overs are still open:**
  - the `DraftPreviewAdmissionSpec` latch is not released in a `finally`;
  - `parentFrame`'s fallback is silent;
  - a stream with no terminal line is not rejected.
