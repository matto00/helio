## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I reviewed worktree HEAD e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7. The planning artifacts are untracked under the change dir. The cwd guard returned `READY`. I ran no heap probe: the finding below rests on HEL-1660's recorded measurements and on code reading.

### What I verified (with evidence)

**Round-2 CRs:**
- (a) is addressed in form. D3 is now a separate constant, `MaxRowRenderChars`, sized end to end by measurement.
- (b) is addressed. D6 has a boundary probe that must succeed and a +1 probe that must be refused.
- (c) is addressed. The spec now reads "a fixed, measured row-render limit".
- (d) is addressed. Backfill's comparison is exact: `rows.exists(JsonTextLength(anyToJsValue row) > MaxRowRenderChars)`.
- (e) is addressed. `RunLimitsGuardSpec` gets a tripwire on the constant, accept-at-limit and refuse-at-+1 cases, and mutations for the comparison and for skipping a frame.

**The round-2 notes are folded in:** "no text built", lone surrogates, `Long` accumulation, task order, and a follow-up naming the reproducer.

**Hook points exist as described:**
- `PipelineRunExecutor.scala:259` calls `refuseOverPostWalkBudget(outcome.rows, outcome.nodeOutcomes, retain, steps)` for `!isDry` only. The terminal and every retained Output frame are reachable there.
- `PipelineRunBackfill.scala:123/145` reach `persistBackfilledRows` (`:155`) inside flatMaps that are followed by `.recover` -> `logExecutionFailure` (`:124-125`, `:147-148`). A throw before `overwriteRows` (`:159`) writes nothing and is logged, as claimed.
- `PipelineRowJson.anyToJsValue` (`PipelineRowJson.scala:27`) is the shared conversion, so the D3 check can use the same path as the write.

**Constants (`RunLimits.scala`, `StringBudget.scala:13`):**
- `MaxLiveCells` is 2,600,000 and `MaxPostWalkCells` is 3,900,000.
- `MaxStringChars` is 1,048,576 and applies to created text only. Source text is not capped by it.
- `textCells(n) = n*2/46`.

**CSV limits (`CsvLimits.scala:17-19`):** 15 MB, 50,000 rows, 300,000 cells. There is no per-cell length cap.

**HEL-1660's recorded post-walk peaks** (`openspec/changes/archive/2026-10-19-bound-run-path-memory/evidence/heap-post-3900000.summary.txt`, real runs):

| Shape | Peak (MB) |
|---|---|
| post-wide-4@3.9M | 164.3, 133.1, 164.4 |
| post-tall-2 | 149.4 |
| ac6-ordinary | 150.4 |

The text-heavy shapes peak at about 100 MB dry and 102 MB real in skeptic-final-3's probe (`heavy-utf16`). So the heaviest retained state the limits allow today is the post-walk-cell-heavy one, about 164 MB, not the text-held one.

### Owner-ruling coverage of the self-approvals

**D4 is covered.** Measuring before rendering changes memory only. The outcome and the WARN are unchanged, so no ruling is needed.

**D3 is covered in kind.** It enforces ruling 3 (the 192 MB share) through the ruled mechanism: a clean run-limit step error, and backfill's existing logged failure. Its threshold is a measurement-sized constant, like `MaxLiveCells`/`MaxPostWalkCells` were in HEL-1660. The owner does not need to be woken, provided two things hold:
- the constant really is calibrated to the share (CR1);
- the planner note stops contradicting D3 (CR2).

### Verdict: REFUTE

### Change Requests

1. **D3's calibration state is not the worst state the limits allow, so the measured constant would not bound the share.**

   D3 (design.md:133-136) and D6 (design.md:173-175) calibrate `MaxRowRenderChars` against "the walk's retained frames at the worst the limits allow (the live-cell budget's text held)". The planning estimate is "~(192 - ~120 MB frames)", i.e. 8-12M chars. That is the text-heavy state. The recorded heaviest state is different: post-walk-cell-heavy frames with their JSON copies, measured at 164.4 MB (post-wide-4@3.9M real, above).

   A row near `MaxRowRenderChars` can coexist with that state:
   - post-wide-4 holds about 1.85M live cells (terminal + parent, 50,000 x 13/12 columns). That leaves about 750k cells of walk headroom, which is about 17M UTF-16 chars.
   - The long text need not be created, so `MaxStringChars` does not apply. One example: the same 50,000 x 6 CSV (exactly 300,000 cells, at the cap) with row 0's column `b` holding about 6.5M Cyrillic characters (about 13 MB, under the 15 MB cap) in a column the `concat($a, $f)` chain never touches.
   - `D3` adds almost nothing to `postWalkCells` for that row (`size + 6`), so only `MaxRowRenderChars` stands between it and the write.
   - At the estimated 8-12M limit, that row renders at about 3 x 2W bytes on top of its retained 2W, so roughly 60-100 MB over 164 MB. That is about 230-260 MB against the 192 MB share.
   - Under the design as written, the boundary probe measures the text-held state, passes, and certifies this constant.

   This is the same class of unseen post-walk shape that HEL-1660's three final rounds and this ticket's note warn about.

   Required (pick one, and say which):
   - (a) Define D3/D6's calibration state as the joint worst. That means the post-walk-heaviest retained frames (post-wide-4/post-tall-2 at `MaxPostWalkCells`) plus one row at exactly `MaxRowRenderChars` inside a retained frame, using untouched source text so the walk's limits do not refuse it. Add that shape to D6 as the must-succeed boundary probe, with its +1 counterpart. Keep the text-held variant as a second boundary probe. The constant is the largest W for which every such probe stays at or under 192 MB over at least 2 repeats.
   - (b) Make the refusal a joint condition. Refuse when `W > MaxRowRenderChars` OR when post-walk cells plus the row's render, in a measured cells-per-char unit, exceed `MaxPostWalkCells`. Do this without moving the AC6 pin (the round-1 constraint). Probe both edges.

   Either way, the joint-worst estimate is about (192 - 164) / (about 8 bytes per char), roughly 3-4M chars. State what happens if measurement puts it under `SnapshotBatchMaxChars` (1,048,576). D3 says the constant is "always >= SnapshotBatchMaxChars", so the batch budget would have to come down with it. Both constants must then move together, and the AC6 and `post-*` shapes stay accepted.

2. **The planner note contradicts D3 and invites a spurious escalation.**

   design.md:190-192 says "D3 is an accounting fix of the existing post-walk limit, not a new limit" and "If the executor finds it needs a NEW owner-visible limit ... that is an ESCALATION". D3 itself (design.md:129-137) now adds a new constant, `MaxRowRenderChars`, independent of `postWalkCells`, which refuses runs with a step error. Read literally, the note tells the executor to escalate D3 itself, with the owner asleep.

   Reword the note to match D3. `MaxRowRenderChars` is a new measurement-sized run limit enforcing ruling 3's share through the ruled clean-failure mechanism, the same kind as HEL-1660's `MaxPostWalkCells`. That makes it self-approved. Escalation is reserved for:
   - a limit not derivable from the 192 MB share;
   - a change to `MaxLiveCells`, `MaxPostWalkCells`, `MaxStringChars` or the AC6 pin;
   - a new env var.

### Non-blocking notes

- D6's "one row ... just above it (must be REFUSED)" heap probe duplicates the deterministic +1 case in `RunLimitsGuardSpec`. That is harmless. The joint-worst probe in CR1 is where the heap measurement earns its keep.
- D3's per-row check converts every row of every retained frame through `anyToJsValue`. On 100,000-row frames that is one transient `JsObject` per row. Record the check's own cost in the green measurement, so it is not mistaken for write cost.
- The spec scenario "retained frames are at the walk's worst" should name the joint state once CR1 picks one.
