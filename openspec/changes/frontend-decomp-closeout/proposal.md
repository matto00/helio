# Proposal — Frontend decomposition closeout

## Why

CS3 evacuated `components/` into feature folders and decomposed two BLOCKER files (`PipelineDetailPage`, `AddSourceModal`). Three pieces remained:

1. `PanelCreationModal.tsx` 716L — the only file in the frontend still over the 400L hard cap. Deliberately deferred from CS3 because per-subtype decomposition is the natural fit and matches CS2c-3c's editors+renderers pattern. This is CS4's primary target.
2. `types/models.ts` 372L re-export shim — 85 consumer files import from here for both cross-cutting and domain-owned types. Decomposing collapses the indirection and makes each consumer's intent explicit. The mechanical churn (~85 file edits) was too big to bundle into CS3.
3. Two cleanups — `StepCard.tsx` 323L per-kind split if natural; `ComputedFieldPicker.test.tsx` misnamed.

CS4 closes the HEL-236 chain. After this lands, every soft-cap is either deliberate or genuinely justified, and the frontend structure mirrors the backend ADT discipline end-to-end.

## What

- **Primary**: Extract `PanelCreationModal`'s 4 per-type config field components into `features/panels/ui/creators/<Kind>CreatorFields.tsx`. Modal shell stays in `PanelCreationModal.tsx` <400L.
- **Mechanical**: Decompose `types/models.ts` by moving domain-owned types into their feature folders; collapse re-export shim; retain only cross-cutting types (likely just `ResourceMeta`). Update all 85 import sites.
- **Cleanups**: Investigate `StepCard.tsx` for natural per-kind extraction; rename `ComputedFieldPicker.test.tsx`.

Behavior-preserving structural refactor. No logic changes, no API changes.

## Impact

- `PanelCreationModal.tsx` 716L → <400L; 4 new files in `features/panels/ui/creators/`
- `types/models.ts` 372L → likely <100L or retired; types redistributed across 6 feature folders
- ~85 import sites updated
- `StepCard.tsx` 323L → <250L if split natural, else unchanged
- 1 test file renamed

## How (cycle plan)

- **Cycle 1** — `models.ts` decomposition + test rename. Pure mechanical moves; ~85 import-path updates. Mirrors CS3 cycle 1 in nature.
- **Cycle 2** — `PanelCreationModal` per-subtype decomposition + `StepCard` per-kind split investigation. Mirrors CS2c-3c cycle 2 frontend lockstep in nature.

## Risks

- **Import-path churn** in cycle 1 — 85 files. Mitigation: atomic commits per source-domain (e.g. one commit per move-target feature's types arrival + consumer updates).
- **Hidden circular imports** surfaced by models.ts split — was the re-export shim hiding cycles? Mitigation: `npm run build` after each commit group; resolve before next.
- **PanelCreationModal coupling** — modal state machine may be tightly coupled to the per-type fields. Mitigation: read the file's flow first; if coupling forces behavior-equivalent refactor (e.g. lifted state, prop drilling), accept it and document.
- **StepCard split may not be natural** — if so, accept 323L and document.
