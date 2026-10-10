# HEL-1412: Same "single source of truth / only requires updating Registry" overclaim in PipelineStepKind.All, PanelSpec test name, PanelConfigCodec; batch-request schema kind enum outside drift check

## Description

origin_kind: followup
origin_ticket: HEL-1156

HEL-1156 (PR matto00/helio#862) corrected the PanelKind/Panel.Registry scaladoc that claimed adding a kind "only requires updating Panel.Registry". It now points to a re-derive command instead of claiming the list is complete. The same overclaim lives elsewhere (verify each):

1. `PipelineStep.scala` ~:321-323: the `PipelineStepKind.All` scaladoc says adding an op "only requires updating [[PipelineStep.Registry]]". The pipeline-op wiring checklist (apply/infer parity, routes allowedOps, Flyway op CHECK constraint, frontend config component, StepCard dispatch) says otherwise. Rewrite it to HEL-1156's standard: no completeness claim, name the known layers, give a re-derive command.
2. `PanelSpec.scala` ~:59: the test name "be the single source of truth for all 6 panel kinds" repeats the claim. Rename it to what the test actually asserts.
3. `PanelConfigCodec.scala` ~:8-14 header makes its own "single source of truth" claim. Check it and correct it.
4. `create-panels-batch-request.schema.json`'s panel-kind enum is not among `check-schema-drift.mjs`'s parity surfaces (0 references; see HEL-1149). Add it, red-first with a kind dropped from the enum.

Comment/test-name changes are behaviour-free; item 4 is a guard. A Haiku executor is suitable for 1–3 with a fully pinned plan.

## Acceptance Criteria (derived from the items above)

- AC1: No scaladoc in `PipelineStep.scala` (nor the `PipelineService.scala` header that repeats it) claims the registry is the single/only source of truth or that adding a kind only needs the registry. The `PipelineStepKind.All` scaladoc names the known hand-enumerated layers (as they exist on the current tree, re-derived — not the stale checklist names), says the list is a snapshot, and gives a re-derive command.
- AC2: `PanelSpec`'s registry test is renamed to what it asserts (the registry's exact key set).
- AC3: `PanelConfigCodec`'s header no longer claims single source of truth / centralised enumeration; it states what it dispatches and that other sites match on kind by hand.
- AC4 (also HEL-1149's AC1–AC4): `npm run check:schemas` observes `create-panels-batch-request.schema.json`'s kind enum; a mutation dropping a kind is shown passing before and failing after; every `schemas/` enum carrying panel kinds must be a checked surface or an explicit, reasoned exemption (coverage is derived by scanning `schemas/`, not by a hand list); selftest cases prove the coverage check failable.
- AC5: Every factual sentence added to a comment is backed by a verification command whose real output is in the evidence / PR body.

## Driver context (claims, verified in premise-validation.md)

- "routes allowedOps" no longer exists; the step-type allow-list is `PipelineStepKind.All` itself.
- "StepCard dispatch" now lives in `StepOpEditor.tsx` (+ `stepNarrowing.ts`, `useStepCardState.ts`).
- HEL-1149 to be closed by reference if item 4 covers it fully.
