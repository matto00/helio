## Context

`selectPipelineOutputDataTypes` in `frontend/src/features/dataTypes/state/dataTypesSlice.ts` is a
plain function returning `state.dataTypes.items.filter((dt) => dt.sourceId === null)`. `.filter`
allocates a new array every call, so `useAppSelector(selectPipelineOutputDataTypes)` yields a new
reference on each render even when nothing changed. React-Redux warns and re-renders unnecessarily.
The selector is consumed read-only in at least seven places (bound editors, Type Registry, sidebar,
panel-creation modal, `App.tsx`).

## Goals / Non-Goals

**Goals:**

- Return a referentially stable array while `state.dataTypes.items` is unchanged.
- Preserve the exact derivation, signature, and return type so no call site changes.

**Non-Goals:**

- No changes to consumers or to other selectors.
- No change to output contents or ordering.

## Decisions

- **Use reselect's `createSelector`.** `@reduxjs/toolkit` re-exports `createSelector`, and reselect is
  already installed transitively — no new dependency. Input selector: `(state) => state.dataTypes.items`;
  result function: `(items) => items.filter((dt) => dt.sourceId === null)`. reselect's default
  reference-equality on the input memoizes the result: unchanged `items` reference → cached array.
  - _Alternative considered:_ hand-rolled memo caching last input/output. Rejected — reselect is the
    codebase-standard tool and less error-prone.
  - _Import source:_ prefer importing `createSelector` from `@reduxjs/toolkit` to match existing slice
    imports rather than adding a direct `reselect` import.
- **Keep the exported name and type `(state: RootState) => DataType[]`.** A `createSelector` result is
  callable with `(state)`, so all `useAppSelector(selectPipelineOutputDataTypes)` sites are unaffected.

## Risks / Trade-offs

- [reselect cache size 1 — alternating distinct `items` references would thrash the cache] → Not a real
  concern: `items` only changes on fetch/update/delete, which are exactly the times a recompute is
  wanted. Steady-state renders reuse the same `items` reference.
- [Mutating `items` in place would break memoization] → The slice already replaces `items` immutably
  (RTK/Immer produces new references), so input reference-equality is a sound cache key.

## Planner Notes

- Self-approved: no external dependency, no API/contract change, scope limited to one selector plus its
  test. No escalation warranted.
