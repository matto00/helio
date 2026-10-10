## Why

HEL-1156 fixed one copy of the "the registry is the single source of truth; adding a kind only requires updating
the registry" claim (`Panel.scala`). The same false claim survives in `PipelineStep.scala` (five scaladoc blocks),
the `PipelineService.scala` header, `PanelSpec`'s test name and `PanelConfigCodec`'s header. A reader adding a
pipeline op or panel kind who trusts them misses most of the real wiring (≈30 hand-enumerated sites for a step
kind on the 2026-10-09 tree). Separately, `schemas/panels/create-panels-batch-request.schema.json` carries a
panel-kind enum that `check-schema-drift.mjs` never compares (HEL-1149), and nothing stops the next such schema from
being missed the same way, because the checked list is hand-kept.

## What Changes

- Rewrite the overclaiming scaladoc in `PipelineStep.scala` (file header, `Companion`, `Registry`, `PipelineStepKind`
  object, `PipelineStepKind.All`) and the one-line repeat in `PipelineService.scala`'s header to HEL-1156's standard:
  state what the registry really feeds, name the known hand-enumerated layers, call the list a snapshot, give a
  re-derive command, and say what the known gate does not catch. Comment-only.
- Rename `PanelSpec`'s "be the single source of truth for all 6 panel kinds" to what it asserts. Test-name only.
- Rewrite `PanelConfigCodec`'s header (no "single source of truth"; 6 kinds not 7; names the other kind-matching sites).
  Comment-only.
- `scripts/check-schema-drift.mjs`: add the batch-create enum as a parity surface, and add a derived coverage check:
  every `enum` under `schemas/` that holds ≥2 canonical panel kinds must be a checked surface or an explicit, reasoned
  exemption. Pure helpers live in new `scripts/lib/panelKindEnumCoverage.mjs`; new selftest cases prove them failable.
  Covers HEL-1149 fully.

## Capabilities

### New Capabilities

- `schema-drift-panel-kind-coverage`: `check:schemas` parity-checks every schema panel-kind enum (incl. batch create)
  and fails on any panel-kind enum under `schemas/` that is neither checked nor explicitly exempted.

### Modified Capabilities

(none)

## Non-goals

- Fixing any hand-enumerated site or adding a gate for pipeline step kinds / non-schema panel-kind sites.
- Other stale comments found while verifying (listed as follow-ups in design.md): `PipelineStepSpec`'s
  "sealed-trait exhaustiveness" comment, `PipelineStepConfigCodec`'s stale "upsertsource is NOT in Registry" note,
  the stale kind list/count in `domain/steps/README.md`, and the `configValue` "single source of truth" (a different
  claim, about HEL-814's shared predicate).

## Impact

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` (scaladoc only)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` (scaladoc only)
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` (scaladoc only)
- `backend/src/test/scala/com/helio/domain/model/PanelSpec.scala` (one test-name string)
- `scripts/check-schema-drift.mjs`, new `scripts/lib/panelKindEnumCoverage.mjs`, `scripts/check-schema-drift.selftest.mjs`
