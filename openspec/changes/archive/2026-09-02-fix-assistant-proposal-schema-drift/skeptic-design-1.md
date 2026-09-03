## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Drift #1 (missing `enabled`) confirmed in ground truth.**
   - `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala:147-166` — `PipelineProposalStepSchema`'s `properties` block has no `enabled` key (only `clientId`, `type`, `config`, `parentStepId`, ...).
   - `schemas/pipelines/create-pipeline-transactional-step-request.schema.json` — `properties.enabled` = `{"type": ["boolean", "null"]}`, and `enabled` is not in the schema's `required` array (`["clientId", "type", "config"]`), matching the design doc's claim it's optional.
   - The ticket's prescribed fix (`JsObject("type" -> JsArray(Vector(JsString("boolean"), JsString("null"))))`) is an exact type-shape match to the JSON Schema.

2. **Drift #2 (missing `"output"` in EditTarget kind enum) confirmed in ground truth.**
   - `AssistantProposalToolSchemas.scala:272-279` — `EditTargetSchema.kind` = `enumSchema("panel", "dashboard", "dataSource", "pipeline", "pipelineStep")` — no `"output"`.
   - `schemas/patch-sets/patch-set.schema.json` — `$defs.EditTarget.properties.kind.enum` = `["panel", "dashboard", "dataSource", "pipeline", "pipelineStep", "output"]`.
   - `enumSchema` (line 432-433) is a plain varargs helper (`values: String*`); appending `"output"` to the call site is a trivial, unambiguous edit with no structural risk.

3. **`check-schema-drift.mjs` allowance verified to match exactly what the fix removes.**
   - `scripts/check-schema-drift.mjs:623-632` — `KNOWN_PRE_EXISTING_DRIFT` has exactly two entries, `PipelineProposalStepSchema <-> create-pipeline-transactional-step-request.schema.json` (`missingInScala: {"enabled"}`) and `EditTargetSchema.kind enum <-> ...` (`missingInScala: {"output"}`) — a 1:1 match to the two drifts the ticket names. Removing both entries (task 1.3) will cause the checker at line 636-637 to fall back to an empty `allowed` set for these two surfaces, so the fix must land in the same change or the very next commit fails — this is correctly called out in the design's Risks section and mitigated by "both edits land in the same commit."

4. **No placeholders, hand-waving, or deferred decisions.** The design doc explicitly and correctly claims "no design ambiguity" — verified: both fixes are pure literal copies of already-existing JSON Schema shapes, no new types or decisions to invent.

5. **Tasks trace 1:1 to acceptance criteria.** Ticket ACs (add `enabled`, add `output`, remove allowance entries, extend spec coverage) map directly to tasks 1.1-1.3, 2.2-2.3. Task 2.1 (`npm run check:schemas` should pass with zero exceptions) and 2.4 (`sbt test`) give concrete verification signals — "how would we know this is done" is answered.

6. **No scope drift.** Impact section lists exactly the three files touched by the ticket; no unrelated refactor is proposed. Non-goals correctly exclude service-layer/validation changes (already confirmed unnecessary — service layer already accepts `enabled`/`output` per the ticket's own framing, which is consistent with this being a hand-rolled-schema-only drift).

7. **No missing contract updates.** This change deliberately does NOT touch `schemas/**` (the JSON Schema is already correct and is the target `AssistantProposalToolSchemas.scala` must match) — correctly scoped as Scala-only + drift-checker-only.

### Verdict: CONFIRM

### Non-blocking notes
- None of substance. The plan is minimal, exactly bounded to the two named drifts, and both fixes were independently re-derived from the raw JSON Schema files rather than trusted from the ticket's prose — they match exactly.
