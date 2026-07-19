## 1. Frontend

- [x] 1.1 Import `createSelector` from `@reduxjs/toolkit` in `dataTypesSlice.ts`
- [x] 1.2 Rewrite `selectPipelineOutputDataTypes` as a `createSelector` with input `state.dataTypes.items` and result `items.filter((dt) => dt.sourceId === null)`, keeping the exported name and return type

## 2. Tests

- [x] 2.1 Add a test asserting the selector returns the same reference (`===`) across repeated calls with unchanged `dataTypes.items`
- [x] 2.2 Add a test asserting reference stability holds across an unrelated state change, and that a new `items` array triggers recompute
- [x] 2.3 Run `npm test -- --testPathPattern=dataTypesSlice`, `npm run lint`, and `npm run build` to confirm gates pass
