## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **Round-1 type-flow gap is closed.** Read the revised `design.md` Decision 1 ("Type-flow
   note (required, not optional)") and Decision 2: they now explicitly require that
   `SidebarBody.tsx`'s registry branch call `isUnstructuredDataType` over the full
   `pipelineOutputDataTypes: DataType[]` list to build a `Set<string>` of content-bearing ids
   *before* constructing `renderBadge`, and that `renderBadge` do an `item.id` lookup against
   that set rather than calling the helper on the callback's own `item` parameter. A type
   assertion/cast is explicitly disallowed. `tasks.md` 1.2/1.3 mirror this precisely ("NOT inside
   the `renderBadge` callback... No type assertion/cast on `item`"). Re-read
   `frontend/src/shared/chrome/SidebarItemList.tsx` in full: `SidebarItem` (line 13) is still
   `{ id: string; name: string }`, confirming the callback parameter would still be
   type-narrowed if called directly — the design's fix is necessary and sufficient. Re-read
   `frontend/src/shared/chrome/SidebarBody.tsx`'s registry branch (lines 118-139): it currently
   passes `items={pipelineOutputDataTypes}` (typed `DataType[]`) with no `renderBadge` yet
   (pre-implementation state, as expected at design gate) — consistent with the plan to add the
   `Set<string>` computation there.
2. **Supporting type facts re-verified.** `frontend/src/features/dataTypes/types/dataType.ts:4-27`:
   `DataTypeField.dataType: string`, `DataType.fields: DataTypeField[]`, `computedFields:
   ComputedField[]` — matches Decision 2's "only `fields`, not `computedFields`" scope.
   `selectPipelineOutputDataTypes` (`dataTypesSlice.ts:114-116`) returns `DataType[]`, confirming
   the `Set<string>` computation has the full shape available at the point design.md specifies.
3. **Layout note promoted correctly.** Round 1 flagged the `space-between` / third-flex-child
   issue as a non-blocking note; it's now Decision 5 + Task 1.2 (required, not optional).
   Re-verified `frontend/src/features/dashboards/ui/DashboardList.css:353-373`:
   `.dashboard-list__button` is still `display:flex; justify-content:space-between`, so the
   nested-flex-span mitigation is still necessary and accurately described.
4. **Token/color claims re-verified.** `frontend/src/theme/theme.css`: `--app-radius-pill:9999px`
   (line 67), `--app-accent-surface` (lines 103, 148, light/dark), `--app-info: var(--app-accent)`
   (lines 113, 157). `DESIGN.md` line 88 lists `--app-info` in the Intent-token row. Consistent
   with Decision 3.
5. **No existing helper/precedent overlooked.** Grepped `frontend/src` for
   `isUnstructuredDataType`/`string-body`/`binary-ref` outside tests: only the
   `analyzeSchema`-based precedents (`SplitTextConfig.tsx`, `ExtractHeadingsConfig.tsx`,
   `ChunkByTokenCountConfig.tsx`) and `TypeDetailPanel.tsx`'s field-type *options* — matches
   design.md's citations, no new helper was missed.
6. **Spec delta correctness re-verified.** `openspec/specs/type-registry-content-fields/spec.md`
   requirement list contains no existing "Type Registry list" UI requirement — `## ADDED
   Requirements` in the change's spec delta remains the correct operation.
7. **`openspec validate unstructured-type-indicator --type change --strict`** → `Change
   'unstructured-type-indicator' is valid`.

### Verdict: CONFIRM

### Non-blocking notes
- None beyond what's already tracked in design.md's Risks/Trade-offs section (computedFields
  content-type risk, render-prop misuse risk) — both are reasonable to leave as documented,
  accepted trade-offs rather than blocking revisions.
