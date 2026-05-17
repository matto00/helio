# Design — Frontend decomposition closeout

## D1 — `PanelCreationModal` per-subtype decomposition target

```
features/panels/ui/
  PanelCreationModal.tsx        (shell <400L: modal state machine + step orchestration + buttons)
  creators/
    MetricCreatorFields.tsx     (was lines 112–151 + helpers)
    ChartCreatorFields.tsx      (was ChartTypeField, lines 152–181)
    ImageCreatorFields.tsx      (was ImageConfigField, lines 182–206)
    DividerCreatorFields.tsx    (was DividerConfigField, lines 207–237)
    creatorTypes.ts             (shared props interface for creators)
```

Pattern mirrors CS2c-3c's `editors/` and `renderers/`. Each creator owns its config field rendering + the data-shape it returns; modal shell composes them via a dispatch like the editors.

Helpers `hasNonEmptyTypeConfig` and `isDataBound` stay in shell OR move to `creatorTypes.ts` depending on shared usage. Executor judgment.

## D2 — `models.ts` decomposition mapping

Per ticket.md mapping table. Cross-cutting `ResourceMeta` stays at `types/models.ts`; if that's the only resident after the move, executor may collapse it into a different cross-cutting location (e.g. delete `types/models.ts` and put `ResourceMeta` next to the other cross-cutting `httpClient.ts` in `services/`, or create `types/common.ts`). Document the decision.

The re-export blocks (`export type {…}` from domain modules) get deleted; consumers update their imports to pull from the domain module directly.

## D3 — `StepCard` per-kind split decision tree

1. Read `features/pipelines/ui/StepCard.tsx` body
2. If the render path has a per-kind switch/dispatch (similar to how PipelineDetailPage's old structure had per-kind config), extract per-kind sub-components into `features/pipelines/ui/stepCards/<Kind>StepCard.tsx`
3. If the render is uniform across kinds with kind only affecting data, leave as-is and document why
4. Either outcome accepted — document in executor report

## D4 — Test rename

`features/panels/ui/ComputedFieldPicker.test.tsx` actually exercises `PanelDetailModal`. Rename to a name that reflects subject:
- `PanelDetailModal.computedFields.test.tsx` (subject + scope)
- OR `PanelDetailModalComputedFields.test.tsx` (single name)

Executor judgment; either form acceptable.

## D5 — Drive-by extractions

Per CS3 precedent (design D5 there): drive-bys allowed IF behavior-preserving and the only path under cap. Expected use in cycle 2 if `PanelCreationModal` shell remains over cap after the 4 creator extractions — likely additional shell-level extractions (e.g. type-select grid, template-select panel, datatype-select step).

## D6 — Behavior preservation

Test suite is the gate. After every commit group, `npm test` must be green at exactly the test count as main (664 tests, 58 suites). Any test file movement / rename adjusts counts predictably — document if so.

## D7 — `models.ts` survives policy

If after extracting all domain types, `models.ts` contains only `ResourceMeta` (the only obvious cross-cutting type today), the executor decides:
- (a) Keep `types/models.ts` as a 1-export file naming the cross-cutting concern
- (b) Move `ResourceMeta` into `types/resourceMeta.ts` and delete `models.ts`
- (c) Move `ResourceMeta` somewhere else entirely (e.g. `services/`)

Recommendation: (a) — keeps backward-compatible import path for the survivor with minimal churn; future cross-cutting types have an obvious home.
