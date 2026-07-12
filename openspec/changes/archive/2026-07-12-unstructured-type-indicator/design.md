## Context

The Type Registry "list" is the sidebar list rendered by `SidebarBody.tsx`'s `registry` branch
(`frontend/src/shared/chrome/SidebarBody.tsx:118-139`), which delegates to the shared
`SidebarItemList` component (`frontend/src/shared/chrome/SidebarItemList.tsx`). The same
component also renders the `sources` and `pipelines` sidebar lists — it is generic over
`{ id, name }` items and must stay that way (DESIGN.md §6 lists `SidebarItemList` as a canonical
shared primitive: "reuse, don't reinvent").

The wire shape already carries what we need: `DataFieldResponse.dataType` (backend) /
`DataTypeField.dataType` (frontend, `frontend/src/features/dataTypes/types/dataType.ts`) is a
plain string. The `DataFieldType.asString` mapping that produces `"string-body"` / `"binary-ref"`
(`model.scala:236-244`, HEL-217) happens upstream at `DataField` construction time in the services
layer (e.g. `ContentSourceSupport.scala`, `SourceService.scala`) — `DataTypeResponse.fromDomain`
(`DataTypeProtocol.scala:42-52`) just forwards the already-stringified value. Either way, no
backend or schema change is needed — classification is a pure frontend derivation from data
already on the wire. Existing precedent for this exact comparison lives in `SplitTextConfig.tsx`,
`ExtractHeadingsConfig.tsx`, and `ChunkByTokenCountConfig.tsx` (`f.type === "string-body"`),
though those consume `analyzeSchema`, not `DataType.fields`, so the comparison is written fresh
here rather than shared with those.

The existing local badge/pill pattern is `PipelineListTable.tsx`'s `StatusBadge` +
`.pipeline-status` / `.pipeline-status--<variant>` CSS (`PipelinesPage.css:132-155`): an inline
`<span>` with a modifier class, `border-radius: 999px`, `--text-xs`, `--weight-medium`, and an
intent-color background/foreground pair. This is the recipe to match (DESIGN.md §3 "Radius" lists
`--app-radius-pill` as the token form of that same 999px value — use the token, not the literal).

## Goals / Non-Goals

**Goals:**
- Sidebar Type Registry list row shows a small badge when the DataType has ≥1 content field.
- No visual change to sources/pipelines sidebar lists (same shared component).
- No backend/API/schema change.

**Non-Goals:**
- No change to sort/filter/search behavior of the registry list.
- No new shared `Badge` component — this is one more local pill pattern, matching
  `.pipeline-status`, not a design-system addition.
- No indicator inside `TypeDetailPanel` (out of scope; ticket is about the list).

## Decisions

**1. Extend `SidebarItemList` with an optional `renderBadge?: (item: SidebarItem) => ReactNode`
prop**, rendered inside the row next to `dashboard-list__name`, rather than forking a
registry-specific list component. Alternative considered: build a separate `TypeRegistryList`
component — rejected, duplicates filter/delete/empty-state/keyboard behavior already correct in
`SidebarItemList`, and DESIGN.md explicitly names it a canonical primitive to reuse. `onSelect`/
`onDelete`/`deleteWarning` are already optional per-usage props on this component, so `renderBadge`
follows the established extension pattern.

**Type-flow note (required, not optional):** `SidebarItem` is `{ id: string; name: string }` —
the `renderBadge` callback's `item` parameter is contextually typed to `SidebarItem` only, even
though the actual array passed via `items={pipelineOutputDataTypes}` is `DataType[]` at runtime.
Calling `isUnstructuredDataType(item)` directly inside `renderBadge` will not compile (`item` has
no `fields` in its declared type). The registry branch of `SidebarBody.tsx` MUST instead classify
over the full `pipelineOutputDataTypes: DataType[]` list *before* constructing the callback — e.g.
build a `Set<string>` of ids for which `isUnstructuredDataType` is true — and have `renderBadge`
look the current row up by `item.id` against that set. Do not use a type assertion/cast to force
`item` to `DataType` inside the callback.

**2. Classification helper lives with the `DataType` type**, e.g.
`frontend/src/features/dataTypes/types/dataType.ts` (or a colocated `dataTypeClassification.ts`
if the executor prefers to keep `dataType.ts` to pure interfaces) —
`isUnstructuredDataType(dt: DataType): boolean` checks
`dt.fields.some(f => f.dataType === "string-body" || f.dataType === "binary-ref")`. Only
`fields` are checked, not `computedFields`: computed fields are expression outputs, and no
current compute op produces a content-typed result — confirmed by grep, no `"string-body"` /
`"binary-ref"` handling exists in the compute-expression path. Called once, over the full list, in
`SidebarBody.tsx` per the type-flow note above — not inside the `renderBadge` callback itself.

**3. Badge intent/color: reuse `--app-info` (aliases `--app-accent` per `theme.css`) for
foreground, `--app-accent-surface` for background** — the same accent-derived pairing
`--app-accent-surface`/`--app-accent-dim` already uses for selection washes (DESIGN.md §3). This
is a categorical (not success/warning/error) signal, so `--app-info` is the correct intent token
per the DESIGN.md color table ("Intent" row lists `--app-info` alongside success/warning/error).
Alternative considered: neutral `--app-surface-raised` + `--app-text-muted` (matching
`.pipeline-status--never`) — rejected, that recipe reads as "absence of a value," which is the
opposite of what this badge signals.

**4. Badge label + icon are an implementation/copy decision left to the executor** (e.g. text
"Content" or a FontAwesome icon like `faFileLines`) as long as it (a) is visually distinct at a
glance, (b) has an accessible name (DESIGN.md §8), and (c) follows the pill recipe in Decision 3.

**5. Layout note:** `.dashboard-list__button` is `display:flex; justify-content: space-between`
with today's two children (`dashboard-list__name`, optional `dashboard-list__active-dot`).
Inserting the badge as a third flex child will not sit adjacent to the name under
`space-between` — wrap `dashboard-list__name` + the badge in a nested flex span (leaving the
active-dot as the second top-level flex child) so the badge reads as part of the name, not pushed
to the row's far edge.

## Risks / Trade-offs

- [Risk] Adding a render prop to a shared primitive could tempt future misuse for unrelated
  per-item decoration → Mitigation: keep the prop narrowly typed (`ReactNode`, no layout
  slots/positions) and document it as registry-specific in the prop's JSDoc, matching the
  existing doc style for `deleteWarning`.
- [Risk] `computedFields` could in the future produce a content-typed value, silently making the
  classification incomplete → Mitigation: not a concern until a compute op emits content types;
  noted here so a future op PR can revisit.

## Planner Notes

- Self-approved: no Flyway migration, no backend change — confirmed via direct inspection of
  `DataTypeProtocol.scala` and `model.scala` (see Context). This is well within "self-approvable"
  territory (no new external dependency, no architectural change, no breaking API change).
