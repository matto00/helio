## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `29a2d74f617142df94e39a981a135935729ac714` (change dir untracked). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/run-record-auto-run-trigger/HEL-1815`.

### What I verified (with evidence)

- **Enum gap is real.** `schemas/pipelines/pipeline-run-record.schema.json:119` is `["manual","scheduled","external"]`. `TriggerSource` (`backend/.../PipelineRunService.scala:382-387`) has four values, including `AutoRun = "auto-run"`.
- **Coverage of trigger-source listings.** I grepped `schemas/`, `frontend/src`, `helio-mcp/src`, `openspec/specs`, `e2e`, plus yaml/json for `triggerSource|trigger_source|"external"|auto-run`. Every listing is covered by the plan:
  - the run-record schema (enum on :119);
  - `pipelineStep.ts:805`;
  - `TimelineMark.tsx:27-32` (`auto` key, raw fallback);
  - `triggerSourceLabel.ts`, which is already correct.

  The other schemas type the field as `string`. helio-mcp `types.ts:315,562` are `string`. The helio-mcp tool text (`outputs.ts:334`) names the field but never enumerates its values. There is no OpenAPI yaml with the field. One gap: the schema's own `description` (:5) also enumerates three values. That is CR 4.
- **Label wording is not an unsettled product question.** `Auto-run` is already shipped in `triggerSourceLabel.ts:5`, tested in `RunHistoryModal.test.tsx:212` and `OutputHistoryModal.test.tsx:138`, and specified in `openspec/specs/output-history-scrubber/spec.md:113`. Reusing it on the home timeline adds no new wording.
- **Seam-test premise (would the spec be red, and for the right reason?).** This check fails. See CR 1.
  - `pipelineRunRecordFormat` is a default `jsonFormat11` (`PipelineProtocol.scala:426`), and global `NullOptions` is deliberately not mixed in (`HomeSummaryProtocol.scala:77` and others). So `completedAt`, `rowCount` and `errorLog` are **omitted** on the wire when they are `None`. The MCP type documents exactly this (`helio-mcp/src/types.ts:550-553`: "OMITTED on the wire when `None`").
  - The schema lists all three in `required` (:132-142) as `["T","null"]`.
  - `PipelineRunQueries.history` (:104-117) maps `errorLog = r.errorLog`. That is `None` for every non-failed run.
  - So the real route's record for an ordinary succeeded run fails the schema today, whatever its `triggerSource`. No existing test holds run-history to this schema: grep of `backend/src/test`, `frontend/src` and `e2e` for `pipeline-run-record` finds 0 hits. The only consumer is the MCP context-details seam, and it uses only `$defs/AssertionSummary`.
- **MCP consumer.** The only MCP read of run history is `helioApi.getPipelineRunHistory` (`helioApi.ts:386`). Its only caller is `context.ts:644`, which reads `history[0].assertions` for `lastRunAssertions`. No MCP tool surfaces a run record's `triggerSource`.
- **Frontend type vs wire.** `PipelineRunRecord` (`pipelineStep.ts:801-803`) types `completedAt`, `rowCount` and `errorLog` as `T | null` (required). The wire omits them, so a fixture-driven test will see the same divergence.

### Verdict: REFUTE

### Change Requests

1. **The seam spec cannot pass after only the enum fix. The design must decide how the route and the schema are reconciled.** The real route omits `errorLog` (every non-failed run), `completedAt` (queued/running) and `rowCount` (when `None`), but the schema requires them.
   - As written, the design leaves two outcomes. Either Decision 2's spec stays red after task 1.3, or the implementer seeds only rows with every Option set to `Some`. The second would make the test pass while the real contract break goes unnoticed: evidence that looks like proof but proves nothing.
   - Pick one approach and record it in design.md, proposal Impact and the spec delta:
     - (a) Relax `required` to match the wire. Both clients already treat these fields as optional: MCP `?:`, and the frontend's `normalizeRunRecord` precedent.
     - (b) Give `pipelineRunRecordFormat` an explicit-null writer, as `HomeSummaryProtocol` and `OutputHistoryProtocol` do. This contradicts the proposal's "no route change", and it is a wire change for both clients.
   - Whichever is chosen, the seeded runs must include at least one succeeded run with `errorLog = None` and one non-terminal or `rowCount = None` run, so the omitted-field shape is exercised.
2. **The red-first evidence must be attributable to `auto-run` (ticket AC 1).** Task 1.1 should assert two things on the current schema. First, the `manual`, `scheduled` and `external` records validate; this needs CR 1 resolved, or the red is about the old enum and the required-field defect at once. Second, the `auto-run` record's validation error names `/triggerSource` (enum). "The spec fails" alone does not show which defect caused it.
3. **The helio-mcp seam test is hand-waved ("whatever tool returns run history") and needs a concrete target.** Ground truth: no MCP tool returns a run's `triggerSource`. The only consumer is `context.ts:644` (`lastRunAssertions` from `history[0]`).
   - Either name that path: build workspace context against a fake run-history serving the shared fixture with an `auto-run` latest run, and assert `lastRunAssertions` is populated.
   - Or state in design.md that the MCP needs no change, because `triggerSource: string` with no narrowing satisfies AC 2, and drop task 4.3 as vacuous. A test asserting that JSON passes through unchanged would never fail.
4. **Task 1.3 must also update the schema's `description` (:5).** It currently enumerates "`manual` ..., `scheduled` ..., or `external`" and should add `auto-run` (dataset-write auto-run, HEL-1093).
5. **Task 4.1's "schema enum equals the `TriggerSource` list" cannot be built from a type-only union, because types are erased at runtime.** Specify the runtime source. For example, export `TRIGGER_SOURCES = ["manual","scheduled","external","auto-run"] as const` with `type TriggerSource = typeof TRIGGER_SOURCES[number]`, or export the `Record<TriggerSource,string>` label map and compare its keys. State it in Decision 4 and task 2.1/2.2. Also say whether `PipelineRunRecord`'s `completedAt`, `rowCount` and `errorLog` become optional in line with CR 1(a), since the fixture test will read the real omitted shape.

### Non-blocking notes

- `RunHistoryModal.css` has `--scheduled` and `--external` badge modifiers but no `--auto-run`. An auto-run badge therefore renders with the same muted base style as `manual`. This is not required by the ticket, and the colour would be a product/design choice, so leave it out or file a follow-up. Mention it in the PR.
- The delta cannot edit the capability's `## Purpose` line ("manual, scheduled, or external"). Consider correcting it at archive time.
- `.txt` red-output files under the change dir are fine. Persist them as evidence too.
