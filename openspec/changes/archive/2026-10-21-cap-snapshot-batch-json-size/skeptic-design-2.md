## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed worktree HEAD e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7. The planning artifacts are untracked under the change dir.
The cwd guard returned READY.

### What I verified (with evidence)

- **Round-1 CRs:**
  - CR1 is addressed. The D3 term is now `textCells(max(0, W - SnapshotBatchMaxChars)) x f`, which is zero within the
    batch budget. The AC6 pin is stated as unchanged, and task 2.5b covers it.
  - CR2 is addressed. The width comes from a transient per-row `PipelineRowJson.anyToJsValue` conversion, and the D1 spec
    gains an engine-row equality case.
  - CR3 is addressed with option (a). Tasks 1.4b and 2.5 apply the check in `persistBackfilledRows`. Both backfill arms
    have a `.recover` -> `logExecutionFailure` after the flatMap that reaches `persistBackfilledRows`
    (`PipelineRunBackfill.scala` ~128-131 and ~148-150), so a throw before `overwriteRows` writes nothing and is logged,
    as claimed.
  - CR4 is addressed. The proposal and the spec scenario both say "never rendered".
  - CR5 is addressed. D4 now states that the configured `maxBytes` has no ceiling.
- **D2's premise is real.**
  - `NodeSnapshotRepository.scala:134` has `SnapshotInsertBatchSize = 200`.
  - `:172-185` renders each whole batch inside its deferred `flatMap`, so text held ahead of the inserts is bounded only
    by row count today.
  - Size-capped grouping, at least one row per batch, bounds that text to <= max(budget, widest row).
- **Write paths:**
  - Run: `PipelineRunSucceededWrites.scala:108-119` converts each node to `JsObject` (strings shared) and calls
    `overwriteRows`.
  - Backfill: `persistBackfilledRows` -> `overwriteRows`.
  - Both reach `overwriteRowsActionRendering`, so AC4 is reached by D2.
- **The post-walk price has no text term.** `RunLimits.scala:31` costs a row as `size + 6`, and `postWalkCells` (`:35-41`)
  never looks at string length. `MaxPostWalkCells = 3,900,000`. `CellWeight.textCells(n) = n*2/46`
  (`StringBudget.scala:13`), so 3.9M cells is about 179 MB, essentially the whole 192 MB share.
- **D4:** `NodePayloadHistoryRepository.scala:91-92` renders and then measures, as described. The WARN carries `bytes`
  as an Int. Measuring first changes no outcome.
- **spray-json is 1.3.6** (coursier cache). Its CompactPrinter escapes `"`, `\`, and chars < 0x20. The D1 equality spec
  is the right drift guard.

### Owner-ruling coverage of the self-approvals

- **D4 is covered.** It is a memory-only reordering with the same outcome and the same WARN. No ruling is needed.
- **D3 is covered in kind** by ruling 3 (192 MB share) and "accept clean failures". It refuses only runs that would
  breach the share, through the existing run-limit step error, and backfill fails like its other failures. No owner
  escalation is needed, provided the threshold really is calibrated to the share. As written it is not (CR1 below). That
  is a design defect for the executor and planner to fix, not a decision for the owner.

### Verdict: REFUTE

### Change Requests

1. **D3's calibration does not bound the share, and the D6 probe would not detect it.**
   - The term prices only the render overhead of the widest row's excess, through a factor defined as "StringBuilder
     growth plus the toString copy". It is compared against `MaxPostWalkCells` (~179 MB), which alone already spends
     nearly the whole share.
   - Two other costs are live during that render and priced nowhere:
     - the retained frame's own text, because `postWalkCells` has no text term and the walk let it through at up to
       `MaxLiveCells` (about 59M UTF-16 characters in one node);
     - the head 1M characters, because of the `max(0, ...)`.
   - Worked example with the honest StringBuilder factor f ~= 3 (growth peaks at old + new capacity, then the toString
     copy):
     - D3 accepts W up to about 1M + 3.9M x 46 / 2 / 3 ~= 31M characters.
     - That render peaks at about 3 x 62 MB ~= 185 MB.
     - The retained 62 MB frame is still held on top of it.
     - The result is about 250 MB or more against the 192 MB share. This is exactly the class of unseen post-walk shape
       HEL-1679's ticket note warns about.
   - D6 will not catch it. The probe is "a widest accepted single-row shape sized just under the walk limits ... (expected:
     within 192 MB or refused by D3)". At the walk limits (~59M characters) D3 refuses, so the probe can pass via
     "refused" and never measure the largest width D3 actually accepts.

   Required revisions:
   - (a) Define the factor's calibration target end to end: the largest W that D3 accepts must measure <= 192 MB peak with
     the retained frame live. Alternatively, price the widest row's full text (frame copy + render), not only its excess
     render overhead, and say which.
   - (b) Replace the D6 single-row probe with two probes. One sits at the largest W D3 accepts (computed from the final
     constants) and must succeed at <= 192 MB over >= 2 repeats. One sits just above it and must be refused with the
     run-limit step error.
   - (c) Align the spec scenario "retained frames plus the widest row's rendered JSON text cost more than the post-walk
     limit" with whatever formula is chosen. Today it reads as the full render, while D3 prices only the excess.
   - (d) State backfill's exact comparison: the term alone, or term + `cost(rows)` + its JsObject copy against
     `MaxPostWalkCells`. "The same widest-row check" can be read either way.
   - (e) Add a mutation to `mutations.md` that weakens the factor (for example f = 1) and turns the boundary probe or a
     guard red. Otherwise the calibration is unguarded in CI, because the heap spec is opt-in. A deterministic
     `RunLimitsGuardSpec` case must pin the computed boundary W: accepted at W, refused at W+1 step.

### Non-blocking notes

- D1 says "allocation-free", but number lengths need `toString` (a small allocation). Use "no text built". Also include
  lone surrogates in the adversarial set: `getBytes(UTF_8)` encodes them as `?` (1 byte), which a naive UTF-8 counter
  gets wrong.
- Accumulate per-node byte and char lengths as `Long`. Ints suffice at today's limits, but the scan should not be the
  thing that overflows.
- Task numbering: 2.9 is listed before 2.8.
- Filing the follow-up for the response-path render (`RunResultResponse(jsRows, ...)`) is now delegated to the driver
  through the hand-back (task 2.9). That is acceptable. Make sure it names the 200-row long-text shape as the
  reproducer.
