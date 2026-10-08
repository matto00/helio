# HEL-1179: Consolidate the duplicated prefersReducedMotion() helpers into one shared utility

## Description

origin_kind: followup
origin_ticket: HEL-566

HEL-566 added an exported `prefersReducedMotion()` in `frontend/src/utils/chartAppearance.ts` (~line 85). A near-identical private copy exists in `frontend/src/shared/ui/Toast.tsx` (~line 18), and the lane reports a third in `useIsNarrowerThan.ts`. Consolidate them into one shared utility (SSR/`matchMedia`-absent guard included) and point every caller at it.

## Acceptance criteria

* Exactly one implementation remains; all callers import it.
* Existing reduced-motion tests still pass. Behaviour-preserving refactor, no visual change.

## Premise validation note (orchestrator, 2026-10-08)

Verified against the tree at f3113ed45: the chartAppearance.ts (line 89, exported) and Toast.tsx (line 18, private) copies are real and byte-for-byte equivalent in behaviour. The "third in `useIsNarrowerThan.ts`" is NOT a reduced-motion helper — that hook is a reactive `(max-width: N-1px)` hook that only shares the `typeof window` / `typeof window.matchMedia` guard shape and names Toast's helper in its doc comment. Verdict: minor-staleness. See `.concertino/runs/HEL-1179/evidence/premise-validation.md`.
