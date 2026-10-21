## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at worktree HEAD e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7 (= origin/main named in AC2). The planning artifacts are untracked under the change dir. The cwd guard returned `READY`. I ran no heap probe. Everything below comes from reading the code at HEAD and HEL-1660's recorded evidence.

### What I verified (with evidence)

**Round-4 change requests**
- **CR1 (bimodal certification): fixed, with one residual hole (see Notes 1).**
  - D3 now requires at least 3 paired repeats of a no-wide-row BASELINE and the BOUNDARY shape in one forked `-Xmx768m` JVM. At least one baseline repeat must reach the high mode (>= 160 MB), or the probe is re-run.
  - Certification requires (i) every boundary repeat <= 192 MB, and (ii) the highest high-mode baseline plus the largest paired delta <= 192 MB. The margin left must be stated.
  - The cited figures match `archive/2026-10-19-bound-run-path-memory/evidence/heap-post-3900000.summary.txt`: `post-wide-4@3900000 real MB 164.3, 133.1, 164.4`, swing 31.3 MB.
- **CR2 (ruling-4 floor): fixed. Option (a) was taken.**
  - The floor is the rendered length of `{"v":"<1,048,576 unescaped chars>"}`.
  - The arithmetic checks: `{` + `"v"` + `:` + 2 quotes + `}` = 8 characters, so 1,048,584. The design writes the row with a space after the colon, but its count correctly omits it, as compactPrint does.
  - Escaped or many-column maximal rows may be refused, and that is stated as an accepted clean failure.
  - `SnapshotBatchMaxChars = min(1,048,576, MaxRowRenderChars)`. Since the floor is above 1,048,576, this is effectively always 1,048,576 unless the executor lowers it, which D2 allows. D2 and D3 are consistent.
- **Round-4 non-blocking notes:**
  - Dominance of the text-held probe is now stated in D6. The green UTF-16 heap evidence (`green-utf16-heap.summary.txt`) records `heavy-utf16` at ~102.3 MB real, below post-wide-4's 164.4 MB.
  - The D4 WARN count is now a `Long`.
  - The width check's own cost is now recorded in the green summary (D6).
  - The duplicate +1 heap probe is still listed. This is harmless and carried over.

**Code claims, re-derived at HEAD**
- `NodeSnapshotRepository.scala:134`: `SnapshotInsertBatchSize = 200`.
- `overwriteRowsActionRendering` renders each batch inside `DBIO.successful(()).flatMap(_ => insertBatch(batch))`, one `sqlu` per row.
  - The render is eager within a batch (`batch.map { render(row) ... }`), so one batch's text is alive at a time. D2's bound of max(budget, widest row) holds for "close when the next row would pass, at least one row".
- `RunLimits.scala`:
  - `MaxStringChars = 1048576`, `MaxLiveCells = 2600000`, `MaxPostWalkCells = 3900000`.
  - `postWalkCells` has no text term.
  - `CellWeight.textCells = len*2/46`.
- `PipelineRunExecutor.scala:259/277`: `refuseOverPostWalkBudget` runs only when `!isDry`, before any write, and throws the run-limit `StepExecutionException`. Dry runs write no snapshot, so this is consistent.
- `PipelineRunSucceededWrites.scala:~100-146`: the nodes written are the Output nodes in `nodeOutcomes`. The terminal reuses `jsRows`. So D3's "every retained Output frame and the terminal" covers every row that is rendered on the service path.
- Backfill: `PipelineRunBackfill.scala:123/145` calls `persistBackfilledRows` inside `flatMap` with `.recover { logExecutionFailure }`.
  - A synchronous refusal there becomes a failed Future and is logged, as D3 says.
  - `:157` builds the full `JsObject` conversion, which D3 says stays unpriced (follow-up).
- `NodePayloadHistoryRepository.scala:91-99` renders `JsArray(rows).compactPrint` before the byte compare, and the WARN uses `Int.box(bytes)`. This confirms D4's premise.
- `PayloadHistoryConfig.scala:70`: floor of 1, no ceiling. `PipelineRowJson.anyToJsValue` exists at `PipelineRowJson.scala:27`.
- `RunLimitsGuardSpec.scala:52`: AC6 pin `cost(16, Seq(11)) shouldBe 3900000L`.
  - No existing service-path test or heap shape has a row whose rendered JSON is over the floor. The only multi-megabyte case, `doubling-concat`, is already refused by the text cap at `d11`.
  - So "every HEL-1660 shape stays accepted" holds for any certified value >= the floor.
- Ticket evidence: HEL-1660 `skeptic-final-3.md:33-37` records `fewrows-utf16-200 real 294.7 / 294.0, dry 93.6`, as the design states.

**Feasibility of the D3 boundary shape**
- post-wide-4@3.9M is a 50,000 x 6 CSV through 7 `concat($a, $f)` steps.
  - Columns b-e are never touched, so the wide cell can go in an existing column. Adding a column would push `postWalkCells` from ~3.7M to the 3.9M limit.
  - The walk holds about 1.5-2.2M of the 2.6M live cells. A 3.5M-character UTF-16 cell costs about 152k cells.
- The joint-worst shape is therefore constructible within the other limits, as D3 claims.

**Spec delta vs tasks vs ACs**
- AC1: D6 shapes, task 2.8. A refusal counts as "at or under".
- AC2: task 1.1, red on e88acadb9.
- AC3: D5 mutations include eager render and batch-by-count-only, task 2.7.
- AC4: task 2.5 and the backfill scenario.
- The scenarios match D2-D4. I found no placeholder or TBD that blocks implementation.

### Owner-ruling coverage of the self-approvals
- **D3 `MaxRowRenderChars`: covered.** It applies ruling 3's 192 MB share through the ruled clean failure, the run-limit step error (backfill: its existing logged failure). It moves no ruled number, no existing constant and not the AC6 pin. It is the same kind of measured static limit as HEL-1660's `MaxPostWalkCells`.
  - The only owner-sensitive case is a certified value below the ruling-4 floor, which correctly triggers ESCALATE.
  - The executor should disclose one consequence in the hand-back: a run whose single Output or terminal row renders wider than the certified value (~3-4M characters, e.g. a whole large document left in one cell from a source) is newly refused. That is a clean failure, accepted under the rulings, but it is user-visible.
- **D4 (payload measured before rendering): covered.** Memory only; outcome and WARN unchanged.
- **The ruling-4 floor reading: covered.** Ruling 4 is worded as a cap on created text (HEL-1660 ticket), not as a promise that every such value is writable. Refusing escaped maximal values falls under "clean failures are accepted".

### Verdict: CONFIRM

The revised design is sound enough to implement. The two round-4 blocking items are fixed. Nothing from earlier rounds survives as a blocker. The notes below are refinements the executor can absorb under D3/D6's own measurement procedure. The final gate should check that they were applied.

### Non-blocking notes (executor-absorbable; the final gate should check them)
1. **Certification mode hole: require a high-mode boundary repeat too.**
   - Criterion (ii) uses the largest paired boundary-minus-baseline delta. If every boundary repeat lands in the low (~133 MB) mode while the baselines land high, each paired delta is negative or understated.
   - In that case (i) and (ii) both pass for a W that breaches the share whenever a boundary run lands in the high mode.
   - At the recorded 2:1 mode split, all 3 boundary repeats landing low has a probability of about 4%.
   - Apply D3's own re-run rule symmetrically: at least one BOUNDARY repeat must also land in the high mode (it sits in the upper of the two ~31 MB-apart clusters, or at or above the highest baseline). Otherwise re-run. A negative paired delta marks a mode-mismatched pair and is never used as the delta.
2. **Wide-cell character class: use the per-character worst for the write.**
   - The rendered row is held as UTF-16, about 2 bytes per character, and then encoded by the Postgres driver to UTF-8 for the `$jsonStr::jsonb` parameter.
   - A BMP CJK character (e.g. `中`) is 3 UTF-8 bytes, against 2 for the Cyrillic `ж` the HEL-1660 shapes use. At W ~3.5M, a `ж` probe under-measures a CJK row by about W bytes (~3.5 MB) of the 27.6 MB headroom.
   - Build the boundary shape's wide cell from a 3-byte-UTF-8 BMP character, or add W bytes to the stated margin.
3. **Response-path follow-up.** The HTTP response renders the whole terminal (`RunResultResponse`), including any row up to `MaxRowRenderChars`. It is out of scope and already listed as a follow-up (task 2.10). Name the boundary wide-row shape as a second reproducer there.
4. **Carried from round 3/4:** the +1 refused heap probe duplicates the deterministic `RunLimitsGuardSpec` boundary case. Harmless.
