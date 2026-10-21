## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at worktree HEAD e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7. The planning artifacts are untracked under the change dir. The cwd guard returned `READY`. I ran no heap probe. The findings below rest on HEL-1660's recorded measurements and on reading the code.

### What I verified (with evidence)

**Round-3 CRs:**
- **CR1 (calibration state): addressed in substance, with one part dropped.**
  - D3 now calibrates `MaxRowRenderChars` at the joint worst: `post-wide-4@3.9M`'s retained state plus one untouched long UTF-16 source cell in its walk headroom.
  - D6 now has the matching must-succeed boundary probe and its +1 refused probe.
  - The ~3-4M planning estimate and the below-floor case (ESCALATE) are stated.
  - The dropped part: round 3 asked to keep the text-held variant as a second boundary probe, and D6 no longer lists it. I am not blocking on this. HEL-1660 measured the text-held state at about 102 MB real, against 164 MB for post-wide-4, so the joint-worst probe dominates it.
- **CR2 (planner note): fixed.**
  - The note now calls `MaxRowRenderChars` a self-approved, measurement-sized run limit.
  - Escalation is reserved for a new env var, a change to an existing constant or the AC6 pin, or a value below the ruling-4 floor.

**Code claims checked at HEAD:**
- `NodeSnapshotRepository.scala:134` has `SnapshotInsertBatchSize = 200`.
- `overwriteRowsActionRendering` (`:146-187`) renders each batch lazily in `DBIO.successful(()).flatMap(_ => insertBatch(batch))` (`:183-184`), one `sqlu` per row. `overwriteRowsWith` goes through the same action. Run reaches it at `PipelineRunSucceededWrites.scala:119/146`, backfill at `PipelineRunBackfill.scala:159`. AC4 is reachable as claimed.
- `NodePayloadHistoryRepository.writeAction:91-93` renders `JsArray(rows).compactPrint` before comparing UTF-8 bytes with `maxBytes`, as D4 says.
- `PayloadHistoryConfig` reads `maxBytes` with a floor of 1 and no ceiling.
- `RunLimits.scala`:
  - `MaxStringChars = 1048576` (`:15`) is documented as ruling 4: "characters in any one text value a step creates".
  - `MaxLiveCells = 2,600,000`, `MaxPostWalkCells = 3,900,000`, `RowCostCells = 6`.
  - `postWalkCells` (`:35-40`) has no text term. Confirmed.
  - `refuseOverPostWalkBudget` is at `PipelineRunExecutor.scala:277`.
- HEL-1660 ticket.md:26 words ruling 4 as a cap ("Cap on any one text value a step creates in a run: 1,048,576 characters"). It is not a guarantee that such a value is writable.

**Calibration evidence** (`openspec/changes/archive/2026-10-19-bound-run-path-memory/evidence/heap-post-3900000.summary.txt`): `post-wide-4@3900000 real MB 164.3, 133.1, 164.4`. The file states "largest swing between repeats of one shape: 31.3 MB (repeats: 3)".

### Owner-ruling coverage of the self-approvals

- **D3 (`MaxRowRenderChars`) is covered.** It enforces ruling 3's 192 MB share through the ruled clean failure (the run-limit step error, and backfill's existing logged failure). It moves no ruled number and no existing constant, and the AC6 pin is unchanged. No owner ruling is needed, provided the constant really is calibrated to the share (CR1 below).
- **D4 (payload measured before rendering) is covered.** It changes memory only, and the outcome and WARN are unchanged.
- **The ESCALATE-below-floor trigger is the right instinct, but it is mis-specified** (CR2 below).

### Verdict: REFUTE

### Change Requests

1. **D6's boundary-probe acceptance (">= 2 repeats, at or under 192 MB") cannot certify the constant, because the calibration shape is bimodal by more than the headroom.**
   - D3 picks `post-wide-4@3.9M` as the joint-worst retained state. Its recorded real peaks are 164.3, 133.1 and 164.4 MB, a 31.3 MB swing.
   - The headroom the wide row may use is 192 - 164.4 = 27.6 MB.
   - If both boundary-probe repeats land in the low (~133 MB) mode, the probe passes with a row whose render adds up to ~59 MB. That row breaches the share whenever the run lands in the high mode, which is the measured common case (2 of 3).
   - The Risks bullet cites a "~23 MB" swing and says "margin stated" but sets no margin rule. Its figure is also below the 31.3 MB recorded for this exact shape.
   - Required: amend D6/D3 so the constant is certified against the high mode. For example:
     - at least 3 repeats of the boundary probe;
     - the same run records the probe's no-wide-row baseline (`post-wide-4@3.9M` alone), and calibration is valid only if a baseline repeat reaches its high mode (at or above ~160 MB, i.e. the recorded 164 MB within run-to-run noise);
     - `MaxRowRenderChars` is the largest W whose every repeat stays at or under 192 MB.

     Equivalently, derive W from the row's measured increment over the high-mode baseline. State the margin actually left.

2. **The ruling-4 floor compares rendered row characters with raw created-text characters, so it does not deliver its stated rationale, and the ESCALATE trigger is aimed wrong.**
   - D3 says the floor exists because "a step may create one text value that long, so a row holding one must stay writable". But `MaxRowRenderChars` is checked against the row's rendered JSON (`JsonTextLength`).
   - A row holding one 1,048,576-char created value renders longer than 1,048,576: quotes, its key, every other column, and up to ~6x for control characters, which D1 itself notes print as `\uXXXX`.
   - So a measured value of, say, 1.1M passes the floor (no escalation) yet refuses ordinary rows holding a ruling-4-maximal value. That is the outcome the floor was written to escalate.
   - Required: pick one and make D3 say it.
     - (a) The floor is the render of a defined ruling-4 row, e.g. `JsonTextLength` of a row with one 1,048,576-char escape-free value plus a stated allowance for other columns. Escalate below that. Say explicitly that escaped (control-char) maximal values may be refused; that is a clean failure, which is accepted.
     - (b) Drop the writability rationale and state the floor only as the batch-budget coupling (`SnapshotBatchMaxChars <= MaxRowRenderChars`). In that case, justify not escalating when a ruling-4 value becomes unwritable.

   Keep `SnapshotBatchMaxChars = min(1,048,576, MaxRowRenderChars)` consistent with whichever you pick. The AC6 claim ("a row at or under 1,048,576 rendered characters can never trip it") remains correct under either.

### Non-blocking notes

- **Round-3 CR1's text-held second boundary probe was dropped.** HEL-1660's numbers show it is dominated (about 102 MB vs 164 MB), so this is acceptable. Say so in D6 rather than leave it silent.
- **D4's WARN passes `Int.box(bytes)` today.** With `JsonTextLength` returning `Long`, a 1,000-row payload of wide rows can exceed `Int.MaxValue` bytes. Keep the count `Long` in the WARN, not a truncating `.toInt`.
- **The +1 refused heap probe in D6 still duplicates the deterministic guard.** This is harmless (carried from round 3).
- **Record the D3 per-row `anyToJsValue` check's own cost in the green measurement.** This round-3 note is not yet reflected in D6.
