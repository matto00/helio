## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed tree: `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` (branch `feature/ndjson-draft-preview-endpoint/HEL-1630`; the change dir is untracked planning output). I did not re-open rulings A, F, C1, C2 or C4 (`row-budget`, `escalation.answered`, `answer_source: human`, events.jsonl line 13).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.
- **Round-4 CR2 (disabled steps): resolved.**
  - D1 now swaps every disabled step for a disabled identity step with the same id and parent. Seeds are enabled steps only, and the closure walks through disabled steps.
  - Engine check: `laneDep` comes from `laneDependencyOf` (`InProcessPipelineEngine.scala:123-128`), which returns `None` for anything that is not a Join, Union or Lookup. So the swap removes the lane reference that the lane check (`:397-411`) and `isReady` (`:453-455`) would otherwise trip on.
  - `evalNode` (`:441-442`) passes the frame through for a disabled node, so its children still get their input.
  - Both failing cases from round 4 now have spec scenarios ("Disabled step below an AI step", "Disabled join with an unsupplied lane") and task 3.1 unit cases.
- **Round-4 CR3 (join mutation fixture size): resolved.**
  - 5.8 now uses 150 x 150 on one key, which produces 22,500 rows.
  - With the pre-check removed, `JoinStep`'s inner `flatMap` (`JoinStep.scala:75-80`) builds 22,500 merged maps (small), and the post-node backstop then fires. So the red stays in-heap.
  - The other new cases are also sized "just over the limit".
- **Round-4 non-blocking abort wording: applied.** The spec scenario now says "evaluates exactly one step", which matches D4 and 5.9.
- **Round-4 CR1 (row multiplication): mostly resolved, with one kind still missing.**
  - D7 and the spec now guard join and unpivot up front and splittext and chunkbytokencount while emitting, with a post-node backstop. The guard is draft-only through `maxNodeRows: Option` (`None` for runs and the saved preview).
  - **Missing kind:** I inventoried all 27 kinds registered at `PipelineStep.scala:257-283`. A fifth kind multiplies rows: `extractheadings`. See CR1.
- **The rest of the inventory (no multiplication):**
  - **Lookup:** one-to-one.
  - **Union:** additive. A node of up to 20,000 rows plus a lane of up to 20,000 is at most 40,000, which is bounded, and the backstop catches it.
  - **Pivot:** fewer rows than its input, and its value columns are sparse per group (`PivotStep.scala`, `byPivotValue`).
  - **One row out per row in:** StringOps `:125`, DateBucket `:117`, Window `:235`/`:299`, FillNull, Cast `:62`, Compute `:69`/`:78`.
  - **Never more rows than in:** Dedupe and Limit only remove rows, and the reducing kinds (GroupBy, Aggregate) only shrink the frame.
  - **Never evaluated here:** the AI kinds are seeds, and upsertsource is swapped for an identity step.
- **C3 mutation reachability of the new 5.8 cases:** see CR2. The backstop message is not specified to differ from the guard message, so the named red is not guaranteed.

### Verdict: REFUTE

Two narrow, mechanical revisions. Both concern the row-budget rule the owner already ruled on (C4), so neither needs a new ruling.

### Change Requests

1. **D7, the spec requirement "A node's output is bounded", tasks 2.3 and 5.8: `extractheadings` multiplies rows and is not guarded.**
   - **The code:** `ExtractHeadingsStep.apply` (`ExtractHeadingsStep.scala:79-85`; registered at `PipelineStep.scala:268`) is an eager `rows.flatMap` that emits one row per ATX heading line in the cell. Its own scaladoc calls it a "flatMap (many→more) transform".
   - **Without a join:** a 4 MiB body of `# a\n` lines gives about 10^6 rows from one cell.
   - **With a join:** the round-4 case applies. A join below the 20,000-row cap can duplicate one 2 MiB cell 10,000 times, which yields about 5x10^9 rows before the post-node backstop can run. This is the same exposure as `splittext`.
   - **Why the plan does not cover it:** the spec says "any other node over it SHALL be that step's error". So the plan explicitly routes `extractheadings` to the backstop, which runs only after the whole `Seq` exists. That contradicts D7's own general rule ("every kind that can emit more rows than its input checks it before or while materialising").
   - **Required changes:**
     - Add `extractheadings` to the emit-while-counting set in D7, the spec requirement and task 2.3.
     - Add a just-over-the-limit 5.8 case with the mutation "remove the extractheadings check -> backstop message -> red".
     - Have task 2.3's inventory line for each kind state which guard it gets.
2. **D7 and task 5.8 (C3): the guard message and the backstop message must be told apart, and the in-emission stop must be observable.**
   - **The messages:**
     - Every 5.8 guard case names its red as "remove the check -> backstop message".
     - D7 specifies the guard message ("<kind> would produce more than 20,000 rows (draft preview limit)") but not the backstop's.
     - If the executor reuses that same text for the backstop (the natural move), every one of those mutations stays green.
     - Required: give the backstop its own distinct message (for example "step output exceeded 20,000 rows (draft preview limit)"), and have each case assert the exact guard message.
   - **The early stop:**
     - The memory property is "before or while materialising". A guard placed after the step's own `flatMap` (`val out = rows.flatMap(...); if (out.size > max) throw`) passes every message assertion while bounding nothing.
     - Required: for `splittext`, `chunkbytokencount` and `extractheadings`, the 5.8 case also asserts the early stop from outside the step. For example, use an input where every row emits 100 rows and assert, with a test-side counting wrapper over the input rows (a counter in the fixture, not in the code under test), that fewer than all input rows were consumed. Name the mutation "move the check after the flatMap -> red".
     - For `join` and `unpivot`, the up-front check can be shown the same way: no merged row or melted row is built when the check fires.

### Non-blocking notes

- **Stale join line citation:** D7 cites the join `flatMap` at `JoinStep.scala:85-100`. In the live tree it is at `:75-87`, and `:101` is the source-secondary branch.
- **Per-row transient memory:** "count while emitting" bounds the output rows, but not the per-row segmenter. `chunkTokens`, `splitParagraphs`/`splitHeadings` and `extractHeadings` each build one cell's full segment list before the outer count sees it. That list is bounded by one cell (at most 4 MiB), so a few tens of MB per request in the worst case. That is acceptable, but worth one sentence in D7 so the 5.10 heap figure is read correctly.
- **Union:** it can transiently build up to 40,000 rows before the backstop. That is bounded and fine; stating it in D7's "union is additive" sentence would make the bound explicit.

### Gate-defect check (CON-160)

No evaluator report exists yet. No mtime-ordering evidence was used, so there is no gate defect to record.
