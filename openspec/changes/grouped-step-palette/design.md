## Context

See proposal.md — Why. Ground truth verified at base `abe2a8fa` (see
`.concertino/runs/HEL-1136/evidence/premise-validation.md`):

- `PipelineStep` is a NOT-sealed trait whose abstract members are all instance-level (`id`, `position`,
  `config`, `evaluate`). Kind-level metadata lives on `PipelineStep.Companion`, and
  `PipelineStep.Registry: Map[String, Companion]` (27 entries) is the single source of truth the codec,
  `PipelineStepKind.All`, and the protocol union all derive from.
- There is NO existing endpoint that enumerates step kinds. `OP_TYPES` in
  `frontend/src/features/pipelines/state/stepNarrowing.ts` (25 entries) is the entire enumeration today, with
  its inclusion rules stated only in frontend comments. `KNOWN_UNLISTED_KINDS = {join, groupby}` in
  `stepNarrowing.test.ts` is the frontend's private exception list.
- `GET /api/pipeline-shapes` (`PipelineShapeRoutes` → `PipelineShapeService.catalog()` →
  `PipelineShapeCatalogEntryResponse` → `schemas/pipelines/pipeline-shape-catalog.schema.json` →
  `pipelineService.getPipelineShapeCatalog()`, no Redux slice) is the established registry-projection pattern.
- `OpDropdown` is rendered at FOUR sites: `PipelineRiverView` gap insert (`onInsertStep(opType, index)`),
  empty-state append and bottom-row append (both `onAddStep`, sharing one `addStepButtonRef`/`dropdownOpen`),
  and `BranchAffordance` (`onSelect`). That is THREE distinct insert contexts.
- `OpType` is `{ id, label, icon: LucideIcon }` — the icon is a React component reference.

## Goals / Non-Goals

**Goals:** make group/description/authorability backend-owned and server-ordered; render the palette purely
from that data; retire the frontend's enumeration-of-record and its private exception list; preserve all three
insert contexts and the F-040/F-189 accessibility fixes in their new form.

**Non-Goals:** persisting group per step row; emitting per-group metrics; changing step editors or the
create/reorder endpoints; resolving whether `groupby` should remain registered.

## Decisions

**D1 — Group/description/authorability are declared on `PipelineStep.Companion`, not on the case classes.**
The catalog must enumerate kinds for which NO instance exists, so an instance-level member on the
`PipelineStep` trait is not merely less tidy — it is unreadable by the catalog without fabricating a row. The
`Companion` is already the kind-level metadata holder that `Registry` maps to, and already has zero DB or
instance coupling. Each of the 27 companions gains `group: Option[StepGroup] = None`,
`catalogDescription: String`, and `authorable: Boolean = true`. *Interpretation flagged for the design gate:*
the owner ruling says "declare on the backend step classes via `PipelineStep`", offering latitude ("e.g. an
abstract member or a group trait each step mixes in"). Declaring on the companion — which lives inside each
step's own file — satisfies the ruling's stated intent (backend-owned, per-step, API-exposed, enabling
per-group metrics) and is the only form that the catalog can actually read. Alternative rejected: a `group`
on the case class plus a parallel kind→group table, which would recreate the very mapping being deleted.

**D2 — A new endpoint, `GET /api/pipeline-step-catalog`.** Nothing exists to extend (see Context), so this
fills the same gap `pipeline-shapes` filled for shapes rather than distorting an existing response. A distinct
top-level prefix (not nested under `pathPrefix("pipelines")`) avoids `PipelineRoutes`' unvalidated
`path(PipelineIdSegment)` matcher swallowing a literal segment — the same reason `pipeline-shapes` is
top-level (HEL-391 Decision 6). Authenticated, mounted in the same `authenticatedUser` tree. Alternative
rejected: extending the analyze response, which describes *instances in a pipeline*, not available kinds.

**D3 — The response is an object of two ORDERED ARRAYS: `groups` and `steps`.** spray-json sorts `JsObject`
keys, so nothing order-bearing may be expressed as object keys. `groups` carries `{id, label}` in declared
display order, which deletes the client's need for any ordering table — explicitly NOT repeating
`ShapePickerModal`'s client-side `SHAPE_DISPLAY_ORDER` habit. `StepGroup`, a sealed ADT, declares its own
display order in one place.

**D4 — Absent, not null, for an ungrouped step.** `group: Option[StepGroup]` and spray-json's `None`-dropping
mean the field is simply absent. This is the wire contract, not an accident of the serializer, so it is
specified and must be tested with the field ABSENT — a test asserting `group: null` would pass against a
serializer that emits null and prove nothing about the real payload. The frontend type is therefore
`group?: string`, and "ungrouped" is `group === undefined`.

**D5 — Registered-but-unauthorable ops are returned, flagged, and not offered.** `join` and `groupby` are
registered and executable but have no editor. Two ACs pull against each other here: "All lists every
registered step" versus an unauthorable op must not "appear as a broken choice". Reconciliation: the catalog
returns EVERY registered kind (so nothing can vanish server-side) with `authorable: Boolean = true` by
default; the palette offers only authorable entries; and the failable check asserts every registered kind is
either present in "All" or explicitly declared unauthorable. A newly registered kind defaults to authorable,
so it must appear or the check goes red. This moves the exception list from a frontend test constant into a
backend declaration, which is what makes it reviewable. Alternative rejected: omitting them from the catalog,
which would make "every registered kind appears" untestable and hide the exception again.

**D6 — Build on `CommandPalette`, not `ShapePickerModal`.** `features/commandPalette/ui/CommandPalette.tsx`
already solves this exact surface: `TextField` filter, a flattened `activeIndex` that crosses group
boundaries, Arrow/Enter handling, `EmptyState` at zero results, `.eyebrow` group labels, and
icon/title/subtitle rows — and it inherits Escape plus focus restore from the shared `Modal` rather than
reimplementing them. `ShapePickerModal` has no search, no groups and no arrow-key navigation. Per DESIGN.md
§6 (`SchemaFieldViewer`/HEL-1022), filtering FLATTENS across groups and grouping renders only when it helps.
**No new visual dialect is introduced** — the existing `.eyebrow` header plus icon/title/subtitle row markup
is reused. If implementation finds that cohesion in the running app requires a new dialect, that is an
escalation, not a judgement call to make in code.

**D7 — Icons stay client-side; this is not the forbidden mapping.** `OpType.icon` is a `LucideIcon` component
reference and cannot cross the wire. `OP_TYPES` is therefore reduced to an icon map keyed by kind, with label,
description, group and order all coming from the server. The ruling forbids a client-side GROUP mapping; a
presentation-asset lookup is a different thing, and the spec says so explicitly so a reviewer is not left to
guess. A kind with no icon entry falls back to a default glyph rather than failing to render.

**D8 — Test ownership is split by what each layer can actually observe.** The partition/coverage assertions
(every `Registry` kind appears exactly once; unauthorable is explicit) belong to a backend ScalaTest over
`Registry`, which can see the real registry. The frontend keeps one narrowed drift guard — that its icon map
covers every authorable kind — replacing `KNOWN_UNLISTED_KINDS`, whose two entries become backend
declarations. Deferred create keeps routing through the existing `requiresCompleteConfigForCreate`, and temp
ids through the exported `isTempStepId`; the palette re-derives neither.

## Risks / Trade-offs

- Retiring `OpDropdown` deletes its F-040 max-height clamp tests, which assert `role="menu"` + inline
  `maxHeight` → the shared `Modal` owns sizing, so that mechanism is moot rather than regressed. **Risk:** a
  reviewer reads the deleted tests as a lost guarantee. **Mitigation:** state it here and in tasks; assert
  the palette's own scroll containment instead.
- Nine e2e specs drive add-step, including `hel912-lanes-rejoin.spec.ts`, which has a known ~5.7% composite
  red rate across three signatures owned by HEL-992. **Risk:** misreading a pre-existing flake as this
  change's regression. **Mitigation:** treat only a NEW signature as a regression; re-run before concluding.
- The palette becomes dependent on a network fetch where a static array needed none. **Risk:** a failed or
  slow catalog fetch leaves the user unable to add a step. **Mitigation:** the palette must show a real error
  state with a retry, never an empty list that looks like "no steps exist".
- `authorable` defaulting to true means forgetting to flag a genuinely unauthorable new kind surfaces it as a
  broken choice. **Trade-off accepted:** the opposite default would let a new kind vanish silently, which is
  the failure mode the AC explicitly forbids; a visible wrong choice is louder than a silent omission.

## Planner Notes

Self-approved: the endpoint name/shape (D2, D3), the companion-level declaration (D1), the authorability
reconciliation (D5) — which the ticket explicitly delegates ("decide deliberately ... and say what you
concluded") — and the test split (D8). Escalated rather than decided: none yet; D1's reading of the ruling's
letter and D6's no-new-dialect commitment are the two the design gate should press hardest on.
