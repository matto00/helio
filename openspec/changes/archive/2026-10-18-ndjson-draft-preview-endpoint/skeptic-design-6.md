## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed tree: `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` (branch `feature/ndjson-draft-preview-endpoint/HEL-1630`; the change dir is untracked planning output). I did not re-open rulings A, F, C1, C2 or C4. I did not re-raise round 1-4 items; none regressed.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.
- **Round-5 CR1 (extractheadings): resolved.**
  - `extractheadings` now appears in the emit-while-counting set in D7 (with the cite `ExtractHeadingsStep.scala:79-85`), in the spec requirement "A node's output is bounded", in C4, in task 2.3 and in the 5.8 case list.
  - Live code check: `ExtractHeadingsStep.apply` at `:74-88` is `rows.flatMap` with one row per heading, and the cite matches.
  - I re-checked `ConvertFormatStep.apply` (`:54-55`, `rows.map`) and `AssertStep` (only counts). Neither multiplies rows, so the inventory has no sixth kind.
- **Round-5 CR2, the messages part: resolved.**
  - D7 now gives the backstop its own message: "node produced N rows, over the draft preview limit of 20,000". The guard message is "<kind> would produce more than 20,000 rows (draft preview limit)".
  - 5.8 asserts the exact guard message, so "remove the check -> backstop message -> red" is now a real red.
- **Round-5 CR2, the early-stop part: resolved for splittext, chunkbytokencount, extractheadings and unpivot. Not resolved for join (see CR1).**
  - **splittext** (`SplitTextStep.scala:82-97`), **chunkbytokencount** (`:112-128`) and **extractheadings** (`:74-88`): each step's `evaluate` is just `Future.successful(apply(rows, config))`, and `apply` makes a single `rows.flatMap` pass with no pre-pass over the input.
    - A test-side counting `Seq` sees the full input consumed under "check after the flatMap", and only part of it under a correct emit-while-counting guard. That proof can fail.
  - **unpivot** (`UnpivotStep.scala:76-85`): the up-front check `rows.size x valueVars.length` iterates no elements, while the flatMap mutation iterates all of them. This can fail too, provided the wrapper counts the elements it yields and not calls to `length` (see the notes).
- **Round-5 non-blocking notes: applied.**
  - The join cite is now `JoinStep.scala:75-87`, which matches the live inner/left `flatMap`.
  - D7 has the per-cell transient sentence and the union "2 x 20,000" sentence.
- **No new defect elsewhere in the revision.**
  - The engine lane-check cites `:403-415` and `:404-406` match the live `laneViolation` block.
  - Spec, tasks and design agree on the five guarded kinds, the backstop routing through `onNodeError`, and the `None` default for runs and the saved preview.

### Verdict: REFUTE

One narrow revision. It is the join half of round-5 CR2, which that CR named explicitly. It needs no new ruling.

### Change Requests

1. **D7 (the "Early-stop proof is external to the step" sentence) and 5.8: as specified, the join early-stop proof cannot fail under its named mutation (C3).**
   - **The code:** `JoinStep.apply` (`JoinStep.scala:61-87`) fully consumes both inputs before any merge:
     - `rightRows.groupBy(...)` at `:62-63` reads the whole right side;
     - `JoinColumnNaming.resolve(rows.flatMap(_.keys), rightRows.flatMap(_.keys), ...)` at `:67` reads the whole left side and the whole right side again;
     - only then does the `flatMap` at `:75-87` merge rows.
   - **Counting the correct implementation:** an up-front size check has to look up each left row's key in `rightIndex`. A counting wrapper on the input `Seq` therefore sees left = L (mapping) + L (sizing) = 2L, and the right side read in full.
   - **Counting the mutation** ("move the check after the flatMap"): left = L (mapping) + L (flatMap) = 2L, and the right side read in full.
   - **Result:** the two counts are identical, so the proof stays green under its own mutation. The phrase "that no output was materialised, via the same wrapper on the right/input side" names something an input-row wrapper cannot observe.
   - **Why it matters:** this is the kind with the 10^8-row exposure. Nothing else would catch a misplaced join check:
     - the 150 x 150 message case passes under that mutation;
     - the 5.10 heap shape uses a join producing exactly 20,000 rows, which is under the limit;
     - the "Fan-out join" 10,000 x 10,000 scenario is not in 5.8.
   - **Required change:** name a test-side observable that does differ under the mutation. Two options:
     - (a) Right-side rows are a fixture-side counting `Map` subclass that counts its own iteration. The merge path calls `JoinColumnNaming.renameRightRow` (`JoinColumnNaming.scala:52-53`, `row.flatMap`) once per merged pair, so the mutation adds roughly L x matches iterations. The correct check adds none beyond the `.keys` pass in `resolve`. Assert the count stays at the value from the pre-merge passes.
     - (b) The up-front sizing sum stops as soon as it passes the bound. The fixture is shaped so the bound is passed well before the last left row, and the assertion is that left-side yields are below 2L.
   - **Either way:** state the chosen mechanism in D7 and in 5.8, and keep the mutation "move the join check after the flatMap -> red". The red log must show that mutation failing this exact assertion.

### Non-blocking notes

- **Fixture size for the emit-while-counting kinds.** The phrase "just over the limit" is in tension with "not every input row was consumed". For example, 201 rows x 100 emitted rows passes the bound only on the last row, so the correct code consumes every row too. The green run would expose this, so it is self-correcting rather than a false green. Still, sizing those fixtures so the bound is passed well before the last row (say 400 rows x 100) avoids a wasted cycle.
- **Unpivot counting wrapper.** It must count elements yielded through `iterator`/`foreach`, not calls to `length`/`size`. Otherwise the correct up-front `rows.size` would register as consumption.
- **Task 2.3 inventory.** Round 5 asked that each kind's line state which guard it gets. Task 2.3 says only "multiplying or not, file:line". D7 already lists the guard for each multiplying kind, so adding "and its guard" to 2.3 would close the loop.

### Gate-defect check (CON-160)

No evaluator report exists yet. No mtime-ordering evidence was used, so there is no gate defect to record.
