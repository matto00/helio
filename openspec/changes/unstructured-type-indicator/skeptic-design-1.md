## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Wire-shape claim (design.md, Context / proposal.md "What Changes").**
   Confirmed `DataField.dataType: String` in
   `backend/src/main/scala/com/helio/domain/model.scala:270-275`, and
   `DataTypeResponse.fromDomain` (`DataTypeProtocol.scala:42-52`) passes `f.dataType` straight
   through (no re-mapping at that point — it's already a string by the time `fromDomain` runs).
   The actual `DataFieldType.asString` call that produces `"string-body"`/`"binary-ref"` happens
   upstream, at `DataField` construction time in the services layer (e.g.
   `ContentSourceSupport.scala:39`, `SourceService.scala:64/121/194/210`,
   `DataSourceService.scala:162/533`). So design.md's claim that "`DataTypeResponse.fromDomain`
   ... maps each field's `DataFieldType` through `DataFieldType.asString`" is imprecise (the
   mapping doesn't happen in `fromDomain`), but the **conclusion is correct**: `DataFieldResponse
   .dataType` does carry `"string-body"`/`"binary-ref"` on the wire today, no backend change
   needed. Non-blocking inaccuracy, not a design flaw.

2. **`SidebarItemList` sharing claim.** Read
   `frontend/src/shared/chrome/SidebarBody.tsx` in full — confirmed `sources`, `pipelines`, and
   `registry` sections all render `<SidebarItemList>` (lines ~70/98/122), and DESIGN.md §6
   (line 179) lists `SidebarItemList` as a canonical shared chrome primitive ("reuse, don't
   reinvent"). The reuse framing is accurate.

3. **Design-token claims.** Confirmed in `frontend/src/theme/theme.css`: `--text-xs` (line 26),
   `--weight-medium` (line 36), `--app-radius-pill: 9999px` (line 67), `--app-accent-surface`
   (lines 103, 148 — light/dark), `--app-info: var(--app-accent)` (lines 113, 157). Confirmed
   `.pipeline-status` recipe in `PipelinesPage.css:132-155` (`border-radius: 999px` literal,
   `--text-xs`, `--weight-medium`) — design.md's choice to use the `--app-radius-pill` token
   instead of the literal 999px is a real improvement over the source pattern, not an invented
   deviation. DESIGN.md §3 (line 141) confirms `--app-radius-pill` is the canonical pill-radius
   token.

4. **Gap check — is there already a better place to reuse?** Confirmed
   `TypeDetailPanel.tsx:132-133` already lists `"string-body"`/`"binary-ref"` as field-type
   *options* (HEL-217), not a content-classification badge — proposal.md's non-goal ("no change
   to TypeDetailPanel") is consistent with what's actually there; no existing reusable
   classification/indicator was overlooked. Confirmed `dataTypesSlice.ts` has no existing
   `isUnstructuredDataType`-like selector. Confirmed the `analyzeSchema`-based `f.type ===
   "string-body"` precedent design.md cites (`SplitTextConfig.tsx:33`,
   `ExtractHeadingsConfig.tsx`, `ChunkByTokenCountConfig.tsx`) is real and correctly distinguished
   from the `DataType.fields`-based check this change needs.

5. **Spec delta format.** Read the base `openspec/specs/type-registry-content-fields/spec.md` —
   it contains only backend/field-editor requirements (DataFieldType variants, round-trip
   parsing, category classification, `binary_refs` table, `TypeDetailPanel` options). The new
   "Type Registry list indicates unstructured DataTypes" requirement is genuinely new, not a
   rewording of an existing one, so `## ADDED Requirements` is the correct delta operation.

6. **`openspec validate` re-run.** `openspec validate unstructured-type-indicator --type change
   --strict` → `Change 'unstructured-type-indicator' is valid`.

### Technical soundness issue found (not covered by the above checks, and not caught by
`openspec validate`, which only validates structure)

Read `frontend/src/shared/chrome/SidebarItemList.tsx` in full. `SidebarItem` (line 13, not
exported) is `{ id: string; name: string }`, and `SidebarItemListProps.items: SidebarItem[]`.
Design.md Decision 1 specifies adding `renderBadge?: (item: SidebarItem) => ReactNode` — i.e. the
callback's parameter type is pinned to `SidebarItem`, which has no `fields`. Task 1.3 says "pass
`renderBadge` using `isUnstructuredDataType`" where `isUnstructuredDataType(dt: DataType): boolean`
(Decision 2) requires `dt.fields`. If `SidebarBody.tsx`'s registry branch calls
`isUnstructuredDataType(item)` *inside* the `renderBadge` callback as the task's phrasing most
directly suggests, `item` is contextually typed as `SidebarItem` there (TypeScript infers the
callback's parameter type from the prop's declared function signature, not from the wider runtime
type of the array elements actually passed in `items={pipelineOutputDataTypes}`). That is a
compile error (`Property 'fields' does not exist on type 'SidebarItem'`), even though at runtime
the object does have `fields` (since `pipelineOutputDataTypes: DataType[]` is structurally
assignable to `SidebarItem[]`, TS only narrows the *type*, not the object). Verified
`selectPipelineOutputDataTypes` (`dataTypesSlice.ts:114`) returns `DataType[]`
(`frontend/src/features/dataTypes/types/dataType.ts:18-27`, with `fields: DataTypeField[]`), so
this is a real conflict, not a hypothetical.

There is a clean fix that stays entirely within the file the Impact section already names
(`SidebarItemList.tsx`/`SidebarBody.tsx` — no scope change): in `SidebarBody.tsx`, compute a
`Set<string>` of unstructured ids by calling `isUnstructuredDataType` over the full
`pipelineOutputDataTypes` list (where the full `DataType` shape is in scope), then have
`renderBadge` do an id-based lookup (`item.id`) rather than calling `isUnstructuredDataType(item)`
directly on the type-narrowed callback parameter. But **design.md and tasks.md do not say this**
— they describe passing `renderBadge` "using `isUnstructuredDataType`," which reads as directly
invoking the helper on the callback's `item`, and that literal reading will not compile. This is
exactly the kind of ambiguity a competent implementer could read two ways (the version that
compiles vs. the version implied by the prose), and it's cheap to close now.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 1/2 and `tasks.md` 1.2/1.3** — resolve the type-flow gap between
   `renderBadge?: (item: SidebarItem) => ReactNode` (item typed `{id, name}` only) and
   `isUnstructuredDataType(dt: DataType)` (needs `fields`). Specify explicitly that
   `SidebarBody.tsx`'s registry branch computes classification over the full
   `pipelineOutputDataTypes: DataType[]` list (e.g. a `Set<string>` of content-bearing ids) and
   `renderBadge` looks the current row up by `item.id` — not that it calls
   `isUnstructuredDataType(item)` on the badge callback's own (type-narrowed) parameter. This
   avoids both a compile error and any temptation toward an unsafe type assertion/cast to route
   around it.

### Non-blocking notes

- `design.md` Context section states the `"string-body"`/`"binary-ref"` wire-string mapping
  happens in `DataTypeResponse.fromDomain` via `DataFieldType.asString`. In the actual code, the
  string is already produced upstream at `DataField` construction (services layer); `fromDomain`
  just forwards the already-stringified field. The end conclusion (no backend change needed) is
  correct — worth a one-line correction for accuracy but not blocking.
- `.dashboard-list__button` is `display:flex; justify-content: space-between` with (today) two
  children (`dashboard-list__name`, optional `dashboard-list__active-dot`). Inserting a badge as a
  third flex child "next to `dashboard-list__name`" (per design.md's phrasing) will not visually
  sit adjacent to the name under `space-between` — the executor will likely need to wrap
  `name` + badge in a nested flex span. Worth a one-line implementation note in tasks.md 1.4 so
  this isn't a surprise during CSS work.
