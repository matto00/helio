## Why

Two identical `prefersReducedMotion()` implementations exist: an exported one in `frontend/src/utils/chartAppearance.ts` (HEL-566) and a private one in `frontend/src/shared/ui/Toast.tsx` (HEL-535). Two copies of the same guard + media query can drift (e.g. one loses the `matchMedia`-absent guard and starts throwing under jsdom). HEL-1179 is the follow-up HEL-566 filed to collapse them.

## What Changes

- Add one shared module `frontend/src/utils/prefersReducedMotion.ts` exporting `prefersReducedMotion(): boolean` — the same one-shot read, same `typeof window` / `typeof window.matchMedia` guard, same `(prefers-reduced-motion: reduce)` query as both current copies.
- Remove the implementation from `chartAppearance.ts` (it imports the shared one for `applyHoverEmphasis`'s default parameter) and the private copy from `Toast.tsx` (imports the shared one).
- Retarget `features/panels/ui/buildChartOption.ts` to import `prefersReducedMotion` from the new module.
- Move the helper's unit tests out of `chartAppearance.test.ts` into a new `prefersReducedMotion.test.ts`, adding a `matchMedia`-absent case.
- Update doc comments that point at the old locations (`chartAppearance.ts`, `useIsNarrowerThan.ts`) and `frontend/src/utils/README.md`.
- `useIsNarrowerThan.ts` is NOT a reduced-motion copy (different query, reactive hook) — its code is unchanged; only its doc comment's pointer is updated.

No behaviour change, no CSS change, no visual change.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
<!-- none — pure refactor; `.openspec.yaml` sets `skip_specs: true` -->

## Impact

Frontend only: `frontend/src/utils/{prefersReducedMotion.ts,prefersReducedMotion.test.ts,chartAppearance.ts,chartAppearance.test.ts,README.md}`, `frontend/src/shared/ui/Toast.tsx`, `frontend/src/shared/ui/toast.css` (comment only), `frontend/src/features/panels/ui/buildChartOption.ts`, `frontend/src/hooks/useIsNarrowerThan.ts` (comment only). No API, schema, backend, or dependency change.
