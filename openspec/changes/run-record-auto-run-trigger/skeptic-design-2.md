## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `29a2d74f617142df94e39a981a135935729ac714` (the change dir is untracked). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/run-record-auto-run-trigger/HEL-1815`. I verified everything below against the live tree. Prior reports were treated as claims.

### What I verified (with evidence)

- **Every listing of trigger sources is covered.** I grepped `schemas/`, `frontend/src`, `helio-mcp/src`, `e2e`, `openspec/specs`, `docs` and `backend/src/main` for `triggerSource`, `trigger_source`, `auto-run` and `scheduled.*external`.
  - Enumerating listings that lag the backend:
    - the schema enum (`pipeline-run-record.schema.json:119`) and its `description` (:5). Both are covered by D1 and task 1.3.
    - `pipelineStep.ts:805`. Covered by D4 and task 2.1.
    - `TimelineMark.tsx:27-35`. It has the bogus `auto` key and falls back to the raw value. Covered by task 2.3.
    - the provenance spec. Covered by the delta.
  - Listings that are already correct:
    - `triggerSourceLabel.ts:5`.
    - `openspec/specs/output-history-scrubber/spec.md:34`.
    - DB CHECK `V110:35-36` (four values).
    - `TriggerSource` object (`PipelineRunService.scala:382-387`).
  - `string`-typed listings, out of scope and correctly named as non-goals: `homeSummary.ts:10`, `outputHistoryService.ts:60`, helio-mcp `types.ts:315,562`.
  - V115/V116 `trigger_source` columns have no CHECK.
- **The schema/route reconciliation is correct.**
  - `pipelineRunRecordFormat` is a plain `jsonFormat11` (`PipelineProtocol.scala:426`), so `None` Options are omitted.
  - `PipelineRunQueries.history` (:104-117) maps `completedAt`, `rowCount` and `errorLog` straight from the row.
  - Dropping the three fields from `required` while keeping their `["T","null"]` property types describes the real wire. `additionalProperties:false` still holds, because the format emits exactly the 11 declared properties.
  - `check-schema-drift.mjs` compares property names only (no `required` logic), so it is unaffected.
  - The only other consumer of this schema, helio-mcp `contextDetailsSeam.test.ts:29` via `pipeline-context-details-response.schema.json:44`, refs `$defs/AssertionSummary` only and is unaffected.
- **The seam spec can exercise the real path with realistic records.**
  - `PipelineRunRepository.insertRunInternal` (:70) takes `triggerSource` and writes `queued` with all three Options `None` (:83-100). That gives the non-terminal shape.
  - `updateRunTerminalInternal` (:322) sets status, `completedAt`, `rowCount` and `errorLog`. That gives the succeeded-with-no-errorLog and failed-with-errorLog shapes.
  - The route is `PipelineRunHistoryRoutes.scala`. `JsonSchemaValidation.compile`/`validationErrors` exists and resolves `$defs` and `helio.local` refs offline.
  - The precedent works as described: `PipelineRunResponseCapSpec` writes the shared fixture under `../shared-test-fixtures/pipeline-run`, using `HEL1696_WRITE_FIXTURE`.
  - D2 and constraint C1 forbid filling every Option.
- **The red-first evidence is attributable to `auto-run`.** Red (ii) comes after the `required` relaxation and before the enum fix. At that point the only remaining defect is the enum, and the spec asserts the error location. So the AC 1 red names `triggerSource` and nothing else.
- **The frontend runtime list and normalisation are sound and safe.**
  - `TRIGGER_SOURCES as const` with a derived union answers the round-1 type-erasure problem. There is precedent for a jest test reading `schemas/*.json` at runtime: `chartTypes.guard.test.ts:41` and `referenceMarks.guard.test.ts:60`.
  - `normalizeRunRecord` (`pipelineService.ts:291`) is the only boundary for `PipelineRunRecord`. `fetchRunStatus` returns `RunStatusResponse`, a different type.
  - Downstream readers use `!= null` and truthiness (`RunHistoryModal.tsx:117,126,148`). `undefined` becomes `null` there, which only makes the declared `T | null` type honest and changes no behaviour.
  - Widening the union is safe for every `PipelineRunRecord` literal in tests, because the fields stay required `T | null`.
  - Swapping `TimelineMark` to `triggerSourceLabel` only changes output for `auto-run`, which goes from raw text to `Auto-run`. The backend never writes `auto`, and no home test or e2e asserts the old wording.
- **The "no helio-mcp change" claim holds.**
  - `PipelineRunRecordResponse` (`types.ts:548-564`) already types the three fields as `?:` and `triggerSource: string`.
  - The only run-history call is `context.ts:644` (`helioApi.ts:386`), and it reads assertions only.
  - No narrowing and no fallback exist, so a pass-through test would be vacuous. D5 drops it, which is correct.
- **The label wording is settled.** `Auto-run` already ships (`triggerSourceLabel.ts:5`), is specified (`output-history-scrubber/spec.md:34`), and is reused on the home timeline. It is not a product question.
- **The spec delta is well-formed.** The MODIFIED requirement names match `openspec/specs/pipeline-run-provenance/spec.md` exactly, and the existing scenarios are carried over intact.
- **Round-1 change requests:**
  - CR 1 (reconciliation) is resolved by option (a) plus seeded shapes.
  - CR 2 (attributable red) is resolved by the ordered (i)/(ii) evidence.
  - CR 3 (MCP) is resolved by D5's no-change rationale.
  - CR 4 (`description`) is resolved in task 1.3.
  - CR 5 (runtime list) is resolved in D4 and task 2.1.

### Verdict: CONFIRM

### Non-blocking notes

- **`Record<TriggerSource, string>` cannot be indexed by a plain `string` under `strict`** (task 2.2). Add a small `isTriggerSource(s): s is TriggerSource` guard, built from `TRIGGER_SOURCES.includes`, before the lookup. Do not use an `as` cast.
- **The fixture comparison will fail until task 1.3 writes the fixture.** Keep it in a separate test case from the schema-validation case, or write the fixture in 1.1. That way red (ii)'s committed output shows only the `auto-run` `triggerSource` failure.
- **networknt messages use the `$.triggerSource` path form, not `/triggerSource`.** Assert on whichever the validator actually emits (or on `instanceLocation`). Do not loosen the assertion to "any failure".
- **D2's claim is stronger than the mechanism.** It says "a fifth backend value with no schema change fails". A Scala `object` of `val`s cannot be enumerated, so the spec's source list is hand-written. Either soften the claim in the PR, or put the four constants in one `Seq` beside `TriggerSource` in the spec and note that a new value must be added there too.
- Carry-overs from round 1: correct the `## Purpose` line at archive time; persist the red `.txt` files with `persist-evidence.sh`; mention the missing `--auto-run` badge colour in the PR as a possible follow-up.
