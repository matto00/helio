# Files modified — cycle 5 (trunk/tail position ruling + round-2 tail findings)

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — implements the human's
  binding position-renumbering ruling: normalizes EVERY `pipeline_steps.position` (root included)
  to `0` immediately after the `parent_step_id` backfill, before any tail is attached; adds a
  `seq = 0` guard to the `computed_fields` → `compute`-step migration (section 8/12) so the first
  hop off a pipeline's trunk-last step never lands at position `0` (mirrors the pre-existing
  aggregate-tail guard, section 5).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` —
  `trunkOf` now requires an EXACT `position == 0` match (`find`, not `headOption` on the
  ascending-sorted sibling list); `tailsOf` now filters on `position != 0` (not `drop(1)`). Both
  changes close the actual round-1 gap: `headOption`/`drop(1)` picked/dropped the LOWEST-position
  child regardless of its value, silently mis-walking into a tail whenever a trunk-last node's only
  child was a migration-created tail.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` —
  rewrites the "position untouched" assertion to the new "step order via parent_step_id preserved,
  raw position renumbered to 0" assertion; updates the compute-step test's `position shouldBe 0`
  to `if (seq == 0) position should be >= 1 else position shouldBe 0`; adds two new test groups
  proving the ruling against the real fixture: (1) `trunkOf`'s full, original-order walk for all 15
  real multi-step pipelines, (2) all 5 real aggregate tails at `position >= 1` and unreachable via
  `trunkOf` (but reachable via `tailsOf`). Mutation-tested by hand this cycle (temporarily reverting
  the migration's position-0 normalization reproduced the exact trunk-truncation defect, confirmed
  red, then restored to green — not left in the diff).
- `openspec/changes/outputs-model-migration/design.md` — new "position renumbering ruling" decision:
  full writeup of the spec conflict, why round 1's fix didn't close it, the ruling itself, and the
  non-negotiable proof requirement.
- `openspec/changes/outputs-model-migration/ticket.md` — narrows scope item 1's "Do NOT reset
  position" constraint to the ruling's actual rule (order via `parent_step_id` preserved; raw
  `position` number is not).
- `openspec/changes/outputs-model-migration/tasks.md` — same narrowing applied to task 2.2's
  completion note.
- `openspec/changes/outputs-model-migration/specs/panel-data-freshness/spec.md` — both requirements
  converted to `## REMOVED Requirements` (the `findLastRunAtByOutputDataTypeId` lookup and its only
  caller were removed outright in task 4.1; `dataAsOf` is retained on the wire but always `null`
  now) — the round-2 skeptic's specific worked example for the sed-corruption sweep.
- `openspec/changes/outputs-model-migration/specs/patch-set-apply/spec.md`,
  `patch-set-preview/spec.md`, `patch-set-undo/spec.md`, `pipeline-analyze-api/spec.md`,
  `pipeline-list-api/spec.md`, `pipeline-proposal-analyze-api/spec.md`,
  `pipeline-proposal-contract/spec.md`, `resource-tagging/spec.md`,
  `workspace-context-assembly/spec.md` — reverses the 31 mechanical sed-substitution corruptions
  found across these files (`outputOutput/node*` → `outputDataTypeName`/`outputDataTypeId`;
  `Output/nodeResponse` → `DataTypeResponse`; `the Output's config` → `metricId`; `the
  pipeline/Output services` → `DataTypeService`/`OutputRepository` per context; `OutputPanel` →
  `MetricPanel` where the surrounding text names `metricId`). `metric-crud-api/spec.md`'s "the
  Output's config.format" occurrences were checked and confirmed to be legitimate prose (not
  corrupted), left unchanged.
- `schemas/patch-sets/patch-set-preview-response.schema.json`,
  `schemas/patch-sets/patch-set-apply-response.schema.json` — remove the stray `"dataType"` `kind`
  enum value / `DataTypeResponse` mention (already removed from the sibling `patch-set.schema.json`
  in a prior round; these two were missed).
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` —
  removes `"dataType"` from the `EditTargetSchema`'s `kind` enum (line 224) and its tool
  description (line 375), matching `PatchSetProtocol.recognizedKinds` (which never included it).
