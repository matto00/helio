## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed commit: `efc559af4bc04622739a7e77677e3b2824d630f2` (on `1efc6e521`). The base `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` was
resolved live. The worktree was clean at the start and at the end (`git status --short` was empty).

My evidence is persisted under `E = /home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.concertino/scratch/HEL-1630/eval4/`.
`run.py` (in `E`) added each probe and mutation. It refuses an ambiguous match, holds the sbt lock, and afterwards removed or restored each
file byte for byte. I checked the restores by sha256 against `orig.sha` after the last run.

**C7 is verified.** In `.concertino/runs/HEL-1630/events.jsonl`:
- Line 52 is `escalation.raised`, id `HEL-1630-1792308276010-f2cff5`.
- Line 53 is an `answer_discarded` 9 ms later (stale, not the owner's).
- Line 54 is `escalation.answered` with `answer: extend-one-cycle-fix-here`, `answer_source: human`, channel `chat`. Line 55 is the dashboard
  copy.
- `workflow-state.md` has `EXECUTION_CYCLES: 4`, so this is the final cycle.

### Phase 1: Spec Review — FAIL

**Evaluation-3 CR1 (a)-(d), within C7's letter: all four are met.**

- **(a) Text is priced by length, in drafts only.**
  - `LiveCellTally` (new, 58 lines) replaces the cell sum. A text costs `CellWeight.textCells(len) = len x 2 / 46` once per distinct String
    object, reference-counted across the retained frames.
  - It is added in `memoryViolation` via `tryAdd`, and for a disabled node at `InProcessPipelineEngine.scala:544`. It is removed in
    `retainOnly`'s partition.
  - Every touch is gated on `ctx.maxLiveCells.isDefined`.
- **(b) The byte cap is enforced while text is produced.**
  - `nodeContext` builds a per-node `StringBudget(maxChars = 262,144, limit = (budget - held) x 46 bytes)` only when both
    `maxLiveCells` and `maxStringChars` are set. Only `DraftPreviewStandIns.scala:43-44` sets them.
  - `ComputeStep` and `StringOpsStep` charge every value they write.
  - `ExpressionInterpreter` checks `+` and `concat` before building (`checkLength`, `:155-158`).
  - A breach is a `StepConfigError` with its own "Draft preview text limit" message.
- **(c) Red, then green.** The fresh-chain, doubling-5, doubling-6 and fan-out-text shapes are in `DraftPreviewHeapSpec`'s max, with their
  own assertions. The executor's red against the cycle-3 code in a 768 MB JVM (`red-c7-cycle3-code-heap-768m.log`) reads:
  - max 384.0 MB;
  - fresh-chain at 42 steps and 326 MB;
  - doubling-5 at 382.5 MB with no error;
  - doubling-6 and fan-out-text as `step execution failed`.

  That turns green: in my own `testFull` (3 GB) the max is 74.5 MB, fresh-chain stops at 6 steps with the text-limit message, and the
  doubling shapes are clean refusals.
- **(d) The wording is corrected.** "Structural" is now "enforced and measured, not proven for every request the caps allow". This is in
  design.md D7, `DraftPreviewConfig.scala:19-23`, the `DraftPreviewHeapSpec` header and `CLAUDE.md:71`. The `maxNodeRows` claim is corrected
  (design.md, step-line-order note), and the spec requirement is rewritten with two new scenarios.

**The executor's claims, checked one by one:**

| Claim | Verdict | Evidence |
|---|---|---|
| Eight-shape heap max of 74.6 MB, so `floor(192/74.6) = 2` | **True.** My fresh `testFull` measured 74.5 MB (select-held). The other seven shapes are lower: chain 69.9, comb 53.8 (49/49 steps, 0 errors), lane-held 55.9, fresh-chain 60.8, doubling-5 30.7, doubling-6 30.8, fan-out-text 2.5. `DefaultMaxInFlight == formula == 2`. | `E/gate-sbt-testFull.log:43104-43116` |
| Green in a 768 MB JVM | **True.** `maxMemory MB: 768`, max 74.3 MB, all assertions green. | `green-c7-heap-768m.log:248-260` |
| Red logs for six mutations plus the cycle-3 code | **True.** Each fails for the stated reason (see the table below). | |
| A walk-order pin showing runs keep `structuralRank` | **True.** `InProcessPipelineEngineDraftSeamSpec:88-109` gives `a, a1, b` with no budget and `b, a, a1` with one. My evaluation-3 M3 (`if (true)`) is exactly the red it names. | `red-c7-leaf-first-also-for-runs.log:21-22`: "Vector(b, a, a1) was not equal to Vector(a, a1, b)" |
| An acknowledged residual gap | **True, and it is worse than "a follow-up": see finding 1.** | |

Executor red logs:
- `red-c7-string-weight-removed`: 327.3 MB > 96; fresh-chain at 42 steps; tally spec.
- `red-c7-running-byte-cap-removed`: `StringBudgetSpec:63`, `:79`; in 768 MB, doubling gives "step execution failed".
- `red-c7-in-expression-cap-removed`: `StringBudgetSpec:49`, `:55`.
- `red-c7-node-budget-not-wired`: in 768 MB, "step execution failed" (`HeapSpec:237`).
- `red-c7-released-frames-never-removed`: chain 9 < 30; the realistic draft errors.
- `red-c7-leaf-first-also-for-runs`: as in the table above.

**Runs and the saved preview are unchanged, by code and by test.**
- `maxStringChars`/`stringBudget` default to `None`. `nodeContext` returns `ctx` itself unless both draft fields are set.
- `ComputeStep.apply(rows, cfg)` and `StringOpsStep.apply(rows, cfg)` delegate with `None`, giving `eval(row, Int.MaxValue)` and no charge.
- `StringBudgetSpec` builds a 400,000-character `upper` and a 160k-character nested concat with no budget.
- The walk-order pin covers the order.
- The full suite is green, including every run/preview/engine spec.

**C1-C5 hold, and nothing earlier regressed.** The full `testFull` is green, covering the cycle-1/2/3 stream, limiter/auth, RLS, caps, abort,
admission, reading-pool, seam and budget-trip specs. The realistic draft still runs at a tenth of the budget. The evaluation-3 CR2/CR3 fixes
are intact: `heap-measurement.txt` was not rewritten by my runs (the tree stayed clean), and `DraftPreviewRoutes.scala:69` is unchanged.

**What fails:**

1. **Spec divergence from C6, which C7 did not retire (and from the owner's stated aim for this cycle, "a breach is an error line, not an
   OOM").** A request far inside the caps (479 KB body, 2 steps) still exhausts a prod-sized heap inside one node. It does so through a
   text-copying kind that has no in-node budget.

   **The mechanism (from code):**
   - `LiveCellTally` prices a text once per String object. A join fan-out of one large text is therefore nearly free:
     - 10,000 rows share one `pad` (fan-out-text's boundary delta is 2.5 MB);
     - the join's up-front check counts rows (10,000 ≤ 20,000), not bytes.
   - The next node then makes a fresh copy of that text per row. The copy points:
     - `SplitTextStep.scala:110` (`.map(_.trim)`, a copy when the text has edge whitespace) and `:126` (`mkString`, heading mode, always
       a copy);
     - `ExtractHeadingsStep.scala:111` (`title.trim` of a regex group);
     - `ChunkByTokenCountStep.scala:155` (`encoding.decode`);
     - `ConvertFormatStep.scala:54-64` (`rows.map`; `textToMarkdown` `:243-262` always builds a new `StringBuilder`).
   - None of these steps sees `ctx.stringBudget`. The three `RowBudget.flatMap` kinds check rows only, while `convertformat` has no
     in-node guard at all. So the node allocates rows x text length before the post-node `tryAdd` can refuse it.

   **The probe** (`E/EvalTmpResidualSpec.scala`) uses the heap spec's method: the production engine and limits, gc x2 before the request
   and at every node boundary, plus the heap pools' peak usage. The shape is one root row whose `pad` is a 100,000-character text, a lane of
   10,000 rows with the same key, `s0` = lane join, and `t1` = the kind under test.

   | `t1` | 768 MB test JVM (prod heap) | 3 GB control | Heap-pool peak, 768 MB / 3 GB |
   |---|---|---|---|
   | `splittext` (paragraph; text ends in a space) | `{"message":"step execution failed"}` = `OutOfMemoryError` swallowed by `:297` | memory-limit `error` (the post-node refusal, after the node allocated ~1 GB) | 967 MB / 1,208 MB |
   | `extractheadings` (`# ` + 99,998 x) | `step execution failed` | memory-limit `error` | 885 MB / 1,352 MB |
   | control: `compute concat($pad, $i)` | text-limit `error`, "more than 77.0 MB" | the same | 260 MB / 219 MB |

   Logs: `E/probe-768m.log:248-254` and `E/probe-3g.log:246-252`. The control shows C7's mechanism doing its job where it is wired. The two
   residual kinds do the same in-node exhaustion as evaluation-3's doubling-6, but cheaper: 479 KB and 2 steps, against 4 MiB and 7 steps.
   At 120 requests a minute per principal, one editor can repeatedly exhaust an instance's heap, and every other request on the instance
   shares that window.

   **Classification: blocking for this endpoint.**
   - C6 ("one request stays <= 96 MB … keeps C5 accept-2 as a guarantee") is still binding, and this is the same defect class evaluation-3
     blocked on and the owner chose to fix here.
   - The fix is narrow and reuses the mechanism C7 just built (see CR1).
   - A ship-with-follow-up scope is given under Critical Path, because no cycle is left and the choice is the owner's.

   Not a finding, by the owner's direction: the run path has the same exposure, and `InProcessPipelineEngine.scala:297`'s catch-all
   `Throwable` is what turns the OOM into "step execution failed". Both belong to HEL-1660.

2. **C3: one cycle-4 SHALL has no failable proof** (non-blocking on its own, but it is a group-5 proof rule).
   - spec.md and design.md say the node's running text total is capped at "what the request has left under the budget"
     (`(budget - held) x 46`).
   - My mutation MC replaced `budget - tally.held` with `budget - 0L` (`InProcessPipelineEngine.scala:492`). **It survived**:
     `StringBudgetSpec`, `InProcessPipelineEngineDraftSeamSpec` and `DraftPreviewHeapSpec` were all green, 26/26 (`E/red-eval4-mc.log:372`).
     The only visible change was fan-out-text's message, which said "79.0 MB" instead of "77.0 MB".
   - With the mutation, a node starting next to about 80 MB of retained frames could emit about 79 MB more text before stopping. Nothing
     pins the headroom subtraction.

### Phase 2: Code Review — FAIL (findings 1 and 2 above; the gates are green)

Gates, run fresh by me in `WORKTREE_PATH` at `efc559af4`:
- `sbt testFull` (under `flock`, nice 19, `-J-Xmx3g`; the forked JVM at 3 GB): 9304 succeeded, 0 failed, 4 canceled (the existing
  `HELIO_MEASURE` specs). "All tests passed", exit 0. Log: `E/gate-sbt-testFull.log`.
- `npm run lint`, `format:check`, `typecheck`, `check:scala-quality`, `check:openspec`, `check:spec-structure` and `check:schemas` all
  exit 0 (`E/gate-*.log`).
- `npm test` (`HELIO_JEST_MAX_WORKERS=2`): root 61/61 suites and 524 tests; frontend 730/730 suites and 9124 tests
  (`E/gate-npm-test.log`).
- `npm --prefix frontend run build`: exit 0.

My mutation spot-checks (C3):
- **MA: the in-expression cap is removed for `+` only** (`ExpressionInterpreter.scala:127`), with `concat` left capped. Red:
  `StringBudgetSpec:55`, "Expected exception StepConfigError … but no exception was thrown" (`E/red-eval4-ma.log:15-16`).
- **MB: `removeRow` never gives text weight back** (`LiveCellTally.scala:310`). Red: `LiveCellTallySpec:41` "20 was not equal to 0" and
  `:49` "5020 was not equal to 20" (`E/red-eval4-mb.log:15-18`).
- **MC: the node's headroom ignores what is held.** It survived; see finding 2.

Code quality:
- No CONTRIBUTING [mechanical] violations in the cycle-4 diff. Imports are at the top of the file (`java.util.IdentityHashMap`,
  `java.util.Locale`), there are no inline FQNs, and `check:scala-quality` is green.
- `StringBudget` and `LiveCellTally` are small and single-purpose. Throwing `StepConfigError` out of the `Either`-typed interpreter is
  deliberate: a `Left` would become a silent `null` in `ComputeStep`.
- Nits are under Non-blocking.

### Phase 3: UI Review — N/A

There is no UI wiring (HEL-1631 does that) and no frontend diff in cycle 4. The jest suite and the build are green.

### Overall: FAIL

### Change Requests
1. **Give the other text-copying kinds the same in-node text budget, in drafts only** (finding 1). This is narrow: about 15 lines plus a
   spec.
   - (a) `SplitTextStep`, `ExtractHeadingsStep` and `ChunkByTokenCountStep`: pass `ctx.stringBudget` from `evaluate` into `apply`, and
     inside the `RowBudget.flatMap` emission call `budget.foreach(_.chargeValue(segment))` for each segment, title or chunk before building
     its row. A run passes `None`, exactly as `ComputeStep` does.
   - (b) `ConvertFormatStep.evaluate`/`apply`: charge `converted` per row. For `csv -> json`, also call
     `budget.foreach(_.checkLength(...))` on the output before `writeValueAsString`, or accept a one-value overshoot and say so.
   - (c) `CastStep`: charge each `"string"` cast result. String to string is the same object; this covers a non-String value's `toString`.
   - (d) Add the two probe shapes from `E/EvalTmpResidualSpec.scala` (`splittext` and `extractheadings` over a 10,000-row fan-out of one
     100,000-character text) to `DraftPreviewHeapSpec`. Each should assert the "Draft preview text limit" message and never
     "step execution failed". Show them red against `efc559af4` in a 768 MB JVM and green after.
   - (e) Narrow design.md's "Residual" note to whatever stays uncovered.
2. **Pin the headroom subtraction** (finding 2). Add a `StringBudget`/seam test that fails when `nodeContext` ignores `tally.held`. For
   example, run the walk with a small `maxLiveCells` and a large retained parent, then assert that a `compute` text node is refused by the
   text limit at the reduced headroom. Show MC (`budget - 0L`) red.

### Critical Path (final cycle, `EXECUTION_CYCLES` = 4)
- **The one blocking issue is CR1.** Everything evaluation-3 asked for under C7 is done, measured and failable:
  - text priced by length;
  - the in-node cap for `compute`/`stringops`;
  - the fresh-chain and doubling shapes, red then green;
  - an eight-shape max of 74.5-74.6 MB, so 2;
  - corrected wording and the walk-order pin.

  C1-C5 hold, and runs and the saved preview are unchanged.
- **The gap is narrower than C7's, but cheaper to hit.** A 479 KB, two-step draft (lane-join fan-out, then `splittext` or
  `extractheadings`) gets "step execution failed" in a prod-sized 768 MB heap, which is a swallowed `OutOfMemoryError`. So C6's
  "<= 96 MB, accept-2 as a guarantee" does not hold for every request within the caps.
- **Recommendation for the human:** one more narrow pass (CR1 a-d, plus CR2) before merge. It reuses `StringBudget` unchanged.
- **If the owner instead ships and defers, the ticket scope to hand the coordinator is:**
  - *Title:* "Draft preview: in-node text budget for splittext, extractheadings, chunkbytokencount, convertformat and cast-to-string
    (HEL-1630 residual)".
  - *Problem:* `LiveCellTally` prices a shared text once, so a join fan-out (≤ 20,000 rows) of one large text is nearly free. These five
    kinds then copy that text per row inside one node, with no byte check until the frame lands. Measured: 10,000 x 100,000 characters
    gives `step execution failed` (a swallowed OOM) in a 768 MB heap, from a 479 KB body (evaluation-4, `E/probe-768m.log`). `convertformat`
    `csv -> json` can also expand one value well past `MaxStringChars` with no fan-out.
  - *Scope:* draft only (`ctx.stringBudget` is `None` for runs and the saved preview). Charge every emitted text against the node's
    `StringBudget`, as `ComputeStep`/`StringOpsStep` do. Add the two fan-out shapes, at 768 MB, to `DraftPreviewHeapSpec`. Pin the headroom
    subtraction (CR2).
  - *Out of scope:* the run path and the `:297` catch-all (HEL-1660).
  - *Until it ships,* C6 should be amended to read "bounded for compute/stringops; other text-copying kinds bounded in rows only".

### Non-blocking Suggestions
- `ComputeStep` charges a value even when it is an existing String returned unchanged (for example `$pad`, or `coalesce($pad, …)`). That
  allocates nothing, but over a large fan-out it can be refused. This is conservative and acceptable; worth a comment.
- `checkLength` runs with `Int.MaxValue` in runs. A run whose `+`/`concat` would pass 2^31 characters now throws "Draft preview text limit
  reached" instead of a JVM error. That case is unreachable in practice, but the message would mislead; consider keying the message on a
  draft budget being present.
- For HEL-1660 (as directed, not a finding): the run path shares every shape above, and `:297`'s `Throwable` catch hides the OOM.
- The evaluation-2 carry-overs are still open: the `DraftPreviewAdmissionSpec` latch should be released in a `finally`, `parentFrame`'s
  fallback is silent, and a stream with no terminal line is not rejected.
