# Design: Output Picker, Panel Sheet, Nav/Onboarding Retirement (HEL-909)

## Context

Backend Output/panel-placement routes already exist (P1.3/P1.5):
`POST /api/panels` (`kind:"output"`, server-owned decision-15 default size),
`GET /api/outputs/:id/rows`, `GET /api/outputs/:id/assertion-status`,
`GET /api/pipelines/:id/capabilities?stepId=`. `OutputEditorSheet.tsx`
(`features/pipelines/ui/outputEditor/`) is the reference pattern this ticket
follows for the Panel sheet's "Output link"/"Swap output" affordances.

## File-Reference Enumeration (the axis, not the instance list — lesson from P1.5)

Ran the ticket's own AC grep
(`dataTypeId|metricId|/registry|/metrics|fetchDataTypes|dataTypesSlice|metricsSlice`)
against `frontend/src` at plan time: **134 files** match (re-verified
independently of the human's "37" estimate, which likely scoped only the
`dataTypesSlice`/`/api/types` subset — both numbers are real, just different
slices of the same problem; 134 is the AC's own literal count and the number
this ticket is actually held to).

Every match falls into exactly one of four axes. **Every executor cycle must
classify each file it touches into one of these four before editing it** —
do not migrate file-by-file discovering the pattern as you go.

### Axis A — Delete outright (whole feature retired)
`features/dataTypes/**` (service, slice, types, TypeRegistryPage,
TypeDetailPage, TypeDetailPanel, TypeListTable + all their tests/READMEs),
`features/metrics/**` (service, slice, types, MetricsPage, MetricDetailPage,
CreateMetricModal, MetricEditorForm, MetricListTable + tests/README),
`PanelCreationModal.tsx` + `creationSteps/*` (`NameEntryStep`,
`ShapeInstantiateStep`, `DataTypeSelectStep`, `TemplateSelectStep`,
`TypeSelectStep`) + `PanelCreationPreview.tsx` + `panelTemplates.ts`,
`ComputedFieldForm`/`ComputedFieldsEditor` (`features/pipelines/ui/computedFields/`).
Delete only once `grep -rl` for each file's own export returns zero
importers outside its own directory — confirm per file, don't assume.

### Axis B — Delete once orphaned (HEL-937 absorption: legacy dataType-keyed editors)
`features/panels/ui/editors/{BindingEditor,MetricPicker,DataTypePicker,
CollectionEditor,TimelineEditor,MetricBindingFields,useMetricBindingState,
useBoundOrLiteralState,BoundOrLiteralField}.tsx/.ts` + their `.test.tsx`/
`.test.ts` siblings, plus the DataType-field-listing parts of `fieldOptions.ts`
and `updatePanelTextBinding` in `panelsSlice.ts`. **Resolved, not a caution:**
`TextContentEditor.tsx` and `MarkdownEditor.tsx` are used by BOTH the retired
dataType-bound-text path AND the surviving literal-content-panel path today,
but the source-of-truth spec (line 76) already decides this — **strip the
Source/bound mode entirely from both files; the surviving editor is
literal-only.** This is not a split to evaluate case-by-case; it is a single
mechanical removal applied to both files (see "TextContentEditor /
MarkdownEditor — resolved, not deferred" below for the exact dependents).
`useChartDisplayState.ts`/`useTableDisplayState.ts` are **not** on this list
by default — check whether `OutputEditorSheet.tsx` already owns equivalent
state or these hooks are still the shared implementation; don't delete a hook
the Output editor itself depends on.

### Axis C — Repoint (read path moves from DataType/Metric to Output)
`PanelDetailModal.tsx` + its 9 test files (rebuilt as the Panel sheet —
title/appearance/Output-link/Swap-output only, no field-mapping/aggregation
control per AC), `features/panels/services/panelService.ts` (**central,
previously missed** — carries `dataTypeId?: string` payload params at :46/:58
and `metricId?: string | null` at :134/:150 on the panel create/update
request builders; both drop entirely once the payload is
`{dashboardId, kind, outputId, title?}`/placement-only PATCH), `PanelCard.tsx`, `PanelList.tsx`, `PanelContent.tsx`,
`renderers/{CollectionRenderer,TableRenderer,TimelineRenderer}.tsx`,
`panelThunks.ts` (delete the HEL-292 `/api/panels/:id/query` call at
`:433-451` per proposal.md, not disable), `panelsSlice.ts`, `panelPayloads.ts`,
`panelNarrowing.ts`, `types/panel.ts` (`outputId`/`kind` discriminator per
spec's `panels` schema change), `sources/ui/{SourcesPage,SourceDetailPage,
EmptySchemaAffordance,AddSourceModal}.tsx` (→ `inferredSchema` off the source
payload), `shared/chrome/{sections,SidebarBody,MobileNavSheet,
navDestinations,usePickerSelection,pickerEmptyState}.{ts,tsx}` (nav collapse
to 5 destinations), `onboarding/**` (three-step model), the proposal/patch-set
review surfaces (`ProposalReview*`, `CombinedProposalReview*`,
`PatchSetReviewPage`, `dashboards/types/proposal.ts`,
`dashboards/services/outputsService.ts`) — these were P1.4's schema/service
work; confirm what remains is display-copy only (labels/props referencing old
names) before assuming a deeper rewrite is needed here.

### Axis D — Incidental (confirm-then-fix, likely small)
`AppRoutes.tsx` (route removal), `store.ts` (slice registration removal),
`App.test.tsx`, `CommandBar.test.tsx`, `settingsSlice.ts`,
`auditEventsSlice.ts`, `toastListeners.ts`, `assistantConversationsSlice.test.ts`,
`ActiveConversationPanel.tsx`, `ProposalHandoff.test.tsx`, `StatusChip.tsx`,
`tokenAuditSweep.css.test.ts`, `test/{panelFixtures,renderWithStore,
rawElementGuardHel440}.{ts,tsx}` — read each; most are either a stale fixture
constant, a generic "metric"-shaped variable name coincidentally matching the
grep, or a genuine small reference. Fix or confirm-benign individually; do
not batch-guess.

**HEL-936 overlap:** the `/api/types` half of Axis C (Sources pages,
`panelThunks`, `types/panel.ts`) is the same 18-file sweep HEL-936 named.
Treat as one migration — call this out in the PR body so a reviewer doesn't
look for a second pass.

## Panel data model

`panels.kind ∈ {output, text, markdown, image, divider}` (already migrated
server-side per P1.1/P1.3). Frontend `types/panel.ts` gets a matching
discriminated union: `OutputPanel { kind: "output", outputId, title?,
appearance }` vs. content-panel variants (unchanged shape). `PATCH
/api/panels/:id` keeps only placement fields (title, appearance, layout) —
frontend never sends field-mapping/aggregation for an output panel again.

## Output picker

New component `features/dashboards/ui/OutputPicker.tsx` (or under
`features/panels/ui/` — executor's call, follow existing directory
convention for dashboard-level modals). Fetches `GET
/api/pipelines/:id/outputs` per pipeline (or a combined list endpoint if one
exists — check `outputsService.ts` first), groups by pipeline, shows
placement count via `GET /api/outputs/:id/panels`, marks "already on this
board" by cross-referencing the current dashboard's panels. Selecting an
Output calls `POST /api/panels {dashboardId, kind:"output", outputId,
title?}` with **no layout** — the response's placed layout is what the grid
renders (no optimistic placement, per decision 15). Keyboard: arrow keys
move focus in the grouped list, Enter places the focused item — accessible
names per DESIGN.md §8.

## Panel sheet

Small sheet: title override (writes on blur/submit via existing PATCH
pattern), appearance (reuse `AppearanceEditor.tsx` — content-panel-agnostic,
not on the delete list), Output link (`<Link to="/pipelines/:id">` opening
the Output sheet — check `OutputEditorSheet.tsx`'s own deep-link/query-param
convention and match it), Swap output (re-opens `OutputPicker` scoped to
replace), placements note ("Used on N dashboards" — from
`GET /api/outputs/:id/panels`, count only, no need to list them all here).

## Nav

`sections.ts`'s `PickerId` union drops `"registry"` and `"metrics"`; the
`sections` array drops their two entries. `SidebarBody`/`MobileNavSheet`/
`navDestinations.ts` derive from this array already (per the file's own
header comment) — removing the two entries should cascade with no
independent hardcoded list to also edit; **verify this claim against the
live components rather than trusting the comment** (lesson: probe, don't
trust docs).

## Onboarding

`onboardingSteps.ts` collapses to 3 steps. `OnboardingChecklist.tsx`'s Done
button gets a DESIGN.md-compliant style plus a regression test that reads
**computed** styles (`getComputedStyle` in jsdom, or an RTL-rendered probe) —
proven red first against a deliberately broken cascade (comment out the
relevant CSS rule, confirm the test fails, then restore + confirm green).
Closing copy names all five nav destinations (Dashboards, Data Sources, Data
Pipelines, Connectors, Assistant).

## Gate-Chain Implications Checklist (CON-132)

This ticket does not touch `.husky/**` or any script a pre-commit hook
invokes — confirmed by scope (frontend features + nav + onboarding only, no
build tooling, no `scripts/concertino/` changes). N/A.

## Testing strategy

- Every rewritten test proven red against a reintroduced defect before being
  trusted green (lesson 3) — especially the Done-button computed-style guard
  (HEL-792) and any test asserting "picker groups by pipeline" or
  "keyboard-operable" (a card-count assertion is not an order/grouping
  assertion — HEL-908's blind-gate lesson applies identically here).
- Playwright: full `New pipeline (paste table) → Output → dashboard` flow
  with an interaction count vs. the old wizard's ≥4 screens/~5 clicks per
  panel.
- Jest: `OutputPicker` grouping/keyboard-nav/already-placed-state; Panel
  sheet never renders a field-mapping/aggregation control (a negative
  assertion — assert absence of the specific old controls by role/name, not
  just "renders without crashing").
- Confirm dev/backend servers are started from the commit under test before
  any UI evidence is collected, every time (lesson 1 — this batch was burned
  twice by stale-server false positives).

## Risks

- Axis B's `TextContentEditor`/`MarkdownEditor` bound-mode strip (resolved
  above, not a case-by-case split) is the most likely place to under- or
  over-delete — follow the resolution exactly: strip Source/bound mode
  entirely, keep the literal-content path, in both files.
- 134-file scope means multiple executor cycles are expected; plan chunks
  that each leave `sbt test`/`npm run lint`/`typecheck`/`test` green rather
  than one giant commit (lesson 5 — retire executors when increments shrink
  rather than nudging).

## Round-1 design-gate revisions (skeptic REFUTE, resolved below)

### Axis C — additional test-sibling repoints

`usePanelData.test.ts`, `PanelCardBody.predispatch.test.tsx`,
`MobilePanelStack.test.tsx` — fixtures encoding `config.dataTypeId`
throughout; rewrite fixtures to the `outputId` shape, proving each rewritten
assertion red first (lesson 3). `shared/chrome/SaveStateIndicator.test.tsx`
and `features/pipelines/ui/PipelineDetailPage.test.tsx` import
`dataTypesReducer` from the Axis-A-deleted slice purely for store-shape
scaffolding in `configureStore` — replace with the post-deletion store shape
(no `dataTypes` reducer key). `features/sources/ui/SourceDetailPanel.test.tsx`
imports `fetchDataTypes` from the Axis-A-deleted service purely to mock it
away — delete that mock, not the test.
`features/pipelines/state/pipelinesSlice.ts` (:111, :320) and
`features/patchSets/state/patchSetsSlice.test.ts`,
`features/proposals/state/combinedProposalsSlice.test.ts`,
`features/settings/state/settingsSlice.test.ts`, `hooks/README.md` — read
each; expected to be either an incidental doc-comment reference (see the
comment-carve-out rule below) or a small store-shape scaffold identical to
the `SaveStateIndicator` case above; resolve per-file, not by assuming a
single pattern covers all of them.

### Axis C — panelService.ts (central, previously missed)

`features/panels/services/panelService.ts` carries `dataTypeId?: string`
payload params at :46/:58 and `metricId?: string | null` at :134/:150 on the
panel create/update request builders. This is the panel service layer —
arguably the single most central file in this migration. Both params drop
entirely once the create/update payload is
`{dashboardId, kind, outputId, title?}` / placement-only PATCH.

### AC-grep comment carve-out (resolved, not deferred)

Four of the 134 matches are **inside deliberate, accurate explanatory
comments already written by P1.5** on the *surviving* Output surface:
`outputConfigTypes.ts:3` ("carry no `dataTypeId` — a bound field is just a
column name resolved…"), `useOutputTableColumns.ts:4` ("bound to
`panel.config.dataTypeId` -- not applicable here…"), `pipelinesSlice.ts:111,320`
("mirrors `dataTypesSlice`'s 409-branching precedent"). A literal reading of
the AC forces deleting or mangling correct documentation of the *new* model
just to silence a string match on retired-concept names.

**Resolution: reword, don't scope the grep.** The final AC-verification grep
(task 11.1) runs exactly as written in the ticket, with no comment-scoping
flag — a scoped grep would be a second, undocumented contract nobody could
reproduce from the ticket text. Instead, reword these comments so they
describe the surviving Output model without naming the retired identifiers
verbatim (e.g. "a bound field is a column name, not a type-registry entity"
instead of "…not a DataType entity" — same meaning, no banned substring).
Small, mechanical — see tasks.md 8.2 — not left to the executor to improvise
mid-migration.

### TextContentEditor / MarkdownEditor — resolved, not deferred

Both files gate a Source/Static mode toggle behind `fetchDataTypes`/
`selectPipelineOutputDataTypes` (`TextContentEditor.tsx:13-24,34-40,106-123`;
`MarkdownEditor.tsx:13,32-38,101-118`). The source-of-truth spec (line 76)
already answers this: *"today's data-bound text **and** markdown panels …
data-bound text panels migrate to `markdown` Outputs. Content panels
(literal text, literal markdown, image, divider) remain dashboard-native and
carry no Output."* **Resolution: strip the Source/bound mode entirely from
both files; the surviving editor is literal-only** — not "confirm which
parts survive," a decision already made by the spec. Axis B (delete-once-
orphaned) additionally includes: `useBoundOrLiteralState.ts`,
`BoundOrLiteralField.tsx`, `fieldOptions.ts` (the DataType-field-listing
parts specifically — check for any literal-only remainder before deleting
the whole file), and `updatePanelTextBinding` in `panelsSlice.ts` — all
reachable only from the now-removed bound path.

### Panel sheet data source — resolved, not deferred

The Panel sheet's content (title override, appearance, Output link, Swap
output, placement count) needs exactly: the panel's own `outputId` (already
on the panel record), `GET /api/outputs/:id` for the Output's `pipelineId`
(to build the `/pipelines/:id` link) and any display name, and
`GET /api/outputs/:id/panels` for the placement count. **It does not call
`GET /api/pipelines/:id/capabilities`** — that endpoint answers "what can be
bound at this node," an Output-authoring question (`OutputEditorSheet`'s own
concern), not a placement-editing one. `ticket.md`'s "capabilities-at-node
(or an equivalent Output-sheet-derived data source)" wording is superseded
by this explicit contract.

### Additional contradicted capability specs

Six more existing specs are directly contradicted by this change and now
have deltas (alongside the original 14): `frontend-panel-creation`
(create-request shape), `panel-starter-templates` (deletes
`panelTemplates.ts`/`TemplateSelectStep`), `panel-type-picker-cards` (the
type-select step it's scoped to no longer exists — distinct from
`panel-type-selector`, which already had a delta), `text-panel-content-source`
and `markdown-panel-content-source` (both define the retired Source/Static
bound-content mode), `panel-config-field-or-literal-pattern` (defines the
bind-to-DataType-field toggle itself, retired per the TextContentEditor/
MarkdownEditor resolution above).

### "Type registry" AC clause — resolved

The ticket's OpenSpec AC bullet lists "type registry" among the capability
areas to update/remove. No `openspec/specs/` capability matches a frontend
type-registry concept — the only near-name, `acl-resource-type-registry`, is
backend ACL and out of this ticket's frontend scope. This AC clause is
satisfied **vacuously**: `TypeRegistryPage`/`TypeDetailPage`'s own coverage
is already handled by `panel-creation-datatype-step`'s and
`panel-creation-datatype-empty-state`'s REMOVED deltas plus Axis A's outright
deletion — there is no separate "type registry" capability spec to touch.
Recorded so the evaluator does not chase a phantom deliverable.

## Cycle-1 executor finding (architecture clarification, not a scope change)

Confirmed against the live backend: `Output` itself carries `kind: OutputKind`
(metric/chart/table/collection/timeline/markdown) plus its own resolved
config/schema (`backend/.../domain/model/model.scala:802-816`); backend
`domain/panels/` already contains only `OutputPanel`/`TextPanel`/
`MarkdownPanel`/`ImagePanel`/`DividerPanel` — the bound-kind panel classes
are already gone server-side. This means **Axis C's renderers
(`MetricRenderer`/`ChartRenderer`/`TableRenderer`/`CollectionRenderer`/
`TimelineRenderer`) are not deleted (they are not Axis A) — they survive,
re-plumbed to read an Output's kind/config/rows** (`GET /api/outputs/:id` +
`GET /api/outputs/:id/rows`) instead of `panel.config`. An `OutputPanel`
alone (`{outputId}`) does not carry enough info to render — the frontend
must fetch the resolved Output to get `kind`/`config`/`schema`. Task 1.1's
discriminated union should reflect this: `OutputPanel { kind:"output",
outputId, title?, appearance }` is the *placement* record; rendering it
requires a separate fetch of the Output itself, cached the same way
`OutputPreviewPane.tsx` (P1.5, `features/pipelines/ui/outputEditor/`) already
does it — **reuse that precedent** (`OutputPreviewPane.tsx`,
`OutputKindFields.tsx`, `buildOutputConfig.ts`) rather than re-deriving
kind-aware rendering from scratch.

**Combined-landing note:** chunks 1-3 (types/panel.ts, panelPayloads,
panelNarrowing, panelsSlice, panelService, panelThunks, usePanelData,
PanelCreationModal+creationSteps, all of ui/editors/*, all of ui/renderers/*,
PanelCard, PanelContent, PanelDetailModal+tests — ~40 non-test files, ~10k
lines) are mutually load-bearing on the `Panel`/`PanelConfig` discriminated
union and cannot be split into independently-green sub-commits at the type
level; they must land as one coherent cycle (may still be multiple commits
within that cycle, e.g. type rewrite -> state layer -> UI layer -> deletions,
each gate-green in sequence, but no intermediate commit can skip straight to
`main`-mergeable state until the whole set is done). Chunk 4 (Sources pages
off DataTypes) is more decoupled and may land before or after this combined
set.

## Scope boundary: proposal/patch-set `dataTypeId` wire field (orchestrator decision)

A 10th-cycle executor found the final AC grep's remaining hits (32 at the
final gate, per evaluation-4.md/skeptic-final-1c.md — the exact count moves
slightly cycle to cycle as adjacent files change; record the PR-body figure
fresh rather than trusting this historical snapshot) are
dominated by `dataTypeId` on `dashboards/types/proposal.ts` and
`ProposalReview*.tsx`, which mirror a REAL backend wire field:
`backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala:17`
still defines `dataTypeId: Option[String]` on the proposal wire protocol —
this was never retargeted to `outputId` by P1.3/P1.4 (the source-of-truth
spec assigned proposal/patch-set schemas to P1.4, which apparently didn't
close this specific field).

**Decision: out of scope for HEL-909.** `proposal.md`'s own "Impact" section
states this ticket is frontend-only; renaming a backend wire protocol field
is not achievable without a corresponding backend change, and unilaterally
renaming only the frontend's mirror of it would break wire compatibility
with the real `POST`/response bodies the backend actually sends. This is a
genuine cross-epic gap (a P1.4 leftover), not P1.6's to silently absorb —
unlike the HEL-937 absorption (which was a frontend-only migration HEL-909's
own AC already forced), fixing this would require touching backend protocol
code outside this ticket's stated frontend-only scope.

**Action:** file a follow-up ticket at Delivery time (via the standard
follow-up-triage escalation) for retargeting
`DashboardProposalProtocol`/`CombinedProposalProtocol`'s `dataTypeId` field
to `outputId`, blocking on nothing further in this epic's locked Phase-1
sequence (P1.7 is next and doesn't touch proposals). The final AC grep
(task 11.1) is satisfied **except for this pre-existing, backend-anchored
subset** — record the exact remaining count and file list in the PR body so
a reviewer isn't surprised by a non-zero grep result, and don't force a
frontend-only rename to make the number superficially zero.

## Cycle 3: `dashboards.layout` write-path audit

Two targeted checks requested by the coordinator ahead of re-review.

### 1. `AutoLayoutService` precedent comment (PanelService.scala)

Grepped `PanelService.scala` for `AutoLayoutService`: one hit, the scaladoc
above `placeDefaultLayout` (the method the cycle-2 fix landed in). The
comment cited `AutoLayoutService`'s "D6... `kept ++ packed` append" as
precedent for `placeDefaultLayout`'s own "append below the lowest occupied
row, no collision-avoidance" behavior. That specific citation (append
without collision-avoidance) is a real, accurate parallel — both methods do
literally that. But the comment was adjacent to, and easy to misread as
covering, the now-fixed lg-to-all-breakpoints bug, and `AutoLayoutService`
turned out (see below) to have its OWN unrelated instance of that exact bug
— so citing it as any kind of "this pattern is fine, see precedent" anchor
was misleading. **Reworded** to state plainly that a single-item append has
nothing in common with `AutoLayoutService`'s whole-board re-pack, and that
`placeDefaultLayout` does not lean on it as precedent for anything. Also
extracted `breakpointCols`/`scaleItemToBreakpoint` out of `PanelService`
into a new shared `LayoutBreakpointScaling` object (see below) — the
scaladoc now points at that shared object instead of file-local methods.

### 2. Every `dashboards.layout` write path, audited for the lg-to-all-breakpoints / unscaled-copy defect class

Enumerated via `grep -rn "DashboardLayout(" backend/src/main/scala/` plus
the two payload-typed proposal/apply-layout sites that build the wire
`DashboardLayoutPayload` directly (same defect class, different type).

**Already fixed (cycle 2), unchanged this cycle:**
- `PanelService.placeDefaultLayout` — per-breakpoint append + scale, via the
  newly extracted `LayoutBreakpointScaling`.
- `frontend/src/features/panels/state/panelThunks.ts` `createPanel` thunk —
  mirrors the backend fix client-side (`scaleLayoutItem`), already landed
  cycle 2. Re-confirmed clean this cycle (no code change).

**Found + fixed this cycle (same defect class, genuine new instances):**

- **`AutoLayoutService.applyAutoLayout`** — packed `kept ++ packed` items at
  the request's `cols` width (default 12, i.e. `lg`), then wrote that SAME
  array verbatim into `md`/`sm`/`xs` (`DashboardLayout(lg = items, md =
  items, sm = items, xs = items)`). `md`/`sm`/`xs` have narrower column
  counts (10/6/2) than `lg`'s 12, so any packed item wider than a target
  breakpoint's column count (e.g. `w=8` on `xs`'s 2-col grid) was persisted
  as an out-of-bounds item on that breakpoint. This is the identical defect
  class `placeDefaultLayout` was fixed for in cycle 2, just in a sibling
  service. **Red-first proof:** temporarily reverted the fix, ran (updated)
  `AutoLayoutRouteSpec`, confirmed a real failure (`4 was not less than or
  equal to 2` — an item scaled for xs still carried its lg width).
  Restored the fix, re-ran, green. Fixed by deriving `md`/`sm`/`xs`
  independently via `LayoutBreakpointScaling.scaleItemsToBreakpoint`.

- **`DashboardContentsService.remapLayout`** (the `PUT
  /api/dashboards/:id/contents` batch-replace / propose-apply-to-existing-
  dashboard path) — remapped each proposal panel's single caller-supplied
  `{x,y,w,h}` (implicitly authored against `lg`'s 12-col grid — the
  proposal wire schema has no per-breakpoint concept) onto its freshly
  minted panel id, then wrote the SAME remapped array into all four
  breakpoints. A `w=4` proposal item is fine on `lg`(12) and `md`(10) but
  already exceeds `xs`'s 2 columns. **Red-first proof:** reverted, ran
  (updated) `DashboardContentsReplaceSpec`, confirmed failure (`4 was not
  less than or equal to 2`). Restored, re-ran, green. Fixed the same way as
  `AutoLayoutService` (independent per-breakpoint scale from the `lg`
  array).

- **`DashboardProposalService.applyLayout`** (`POST
  /api/dashboards/apply-proposal`, the sibling create-a-new-dashboard-from-
  proposal path) — same defect, same root cause (a proposal-authored
  single `{x,y,w,h}` copied verbatim into `lg`/`md`/`sm`/`xs`), on the wire
  `DashboardLayoutItemPayload`/`DashboardLayoutPayload` types rather than
  the domain `DashboardLayoutItem`/`DashboardLayout` types. **Red-first
  proof:** reverted, ran (updated) `DashboardApplyProposalSpec`, confirmed
  failure (`4 was not less than or equal to 2`). Restored, re-ran, green.
  Fixed via a new `LayoutBreakpointScaling.scaleWidthAndX(x, w, sourceCols,
  targetCols)` overload (same math, operating on raw ints so the payload
  type doesn't need to round-trip through the domain type).

  These two proposal-authored paths share one root cause and were fixed
  together with the same shared utility and the same discipline.

**Checked, confirmed clean (with the specific read that confirms it):**

- **`AutoLayoutService`'s own per-breakpoint math, post-fix** — now uses
  `LayoutBreakpointScaling.scaleItemsToBreakpoint(items, cols, breakpointCols(bp))`
  for `md`/`sm`/`xs`, the exact same scale-then-clamp formula
  `placeDefaultLayout` uses (proportional scale, `w` clamped to
  `[1,targetCols]`, `x` clamped to `[0,targetCols-w]`). Confirmed by the
  `AutoLayoutRouteSpec` assertion that every `md`/`sm`/`xs` item's `w` is
  `<=` that breakpoint's column count after packing a `w=6`+`w=8` pair that
  would overflow `xs`/`sm` unscaled.

- **`DashboardSnapshotRepository.duplicate`** (`POST
  /api/dashboards/:id/duplicate`) — reads `sourceDash.layout.{lg,md,sm,xs}`
  and remaps EACH breakpoint's own existing array independently via a
  shared `remapItems` helper (`items.flatMap(item =>
  idMap.get(...).map(...))`), never substituting one breakpoint's array for
  another's. Whatever scaling was correct in the source dashboard's stored
  `md`/`sm`/`xs` (by this cycle's fix, or by having been hand-arranged by a
  user) is preserved verbatim, just with panel ids remapped. Clean by
  construction — there is no `lg`-value read anywhere in this method except
  for `lg`'s own remap.

- **`DashboardSnapshotRepository.importSnapshot`** (`POST
  /api/dashboards/import`) — same shape as `duplicate`: `remapLayoutItem`
  applied independently to each of `payload.dashboard.layout.{lg,md,sm,xs}`
  via `.flatMap`. No breakpoint's array is ever derived from another's.
  Clean by the same construction argument.

- **Panel delete (`PanelService.delete` → `PanelRepository.delete`)** —
  deletes the panel row only; never reads or writes `dashboards.layout` at
  all (the layout's per-breakpoint entry for the deleted panel id becomes a
  dangling reference to a panel that no longer exists, but that's a
  different, pre-existing gap — not the lg-to-all/unscaled-copy defect
  class this audit is checking for, and out of this cycle's scope).

- **Panel duplicate (`PanelService.duplicate` →
  `PanelMutationRepository.duplicate`)** — inserts a new panel row (title
  disambiguated via the `(copy)`/`(copy N)` regex) and returns it; never
  touches `dashboards.layout` at all — the frontend auto-places the
  duplicated panel the same way it auto-places any panel with no stored
  layout entry. Not a write path for this defect class.

- **`PanelBatchCreateSpec`'s route (`POST /api/panels/batch`)** — this
  route creates panels only; it has no layout-placement step of its own
  (confirmed by reading the spec: its `ignoredFields` set for response
  comparison already excludes `layout`, and no assertion in the file
  touches `dashboards.layout`). Layout for individual created panels still
  goes through `PanelService.placeDefaultLayout` per panel (the cycle-2
  fix), not a batch-specific path — nothing new to check here.

**Frontend, re-audited (`frontend/src/features/dashboards/**`,
`frontend/src/features/panels/**`):**

- `DesktopPanelGrid.tsx`'s `onLayoutChange` → `fromResponsiveLayouts` —
  react-grid-layout supplies each breakpoint's ACTUAL post-drag/resize
  layout natively (real per-breakpoint pixel/column math done by the
  library itself, not derived by copying `lg`), so there is no scale-from-
  `lg` step to get wrong here. Clean by construction — RGL is already the
  scaling authority for user-interactive changes.
- `panelThunks.ts` `createPanel` — already fixed cycle 2 (see above),
  re-confirmed unchanged.
- `dashboardsSlice.ts`'s `setDashboardLayoutLocally` reducer — a straight
  `dashboard.layout = layout` assignment; it doesn't derive breakpoints
  from each other, it just stores whatever `DashboardLayout` object the
  caller already computed (correctly, post-fix) upstream.
- `ProposalReviewPage.tsx`'s `synthesizeDemoProposal` — builds a demo
  proposal's single `{x,y,w,h}` (the wire `ProposalPanelLayout` request
  shape, not a `DashboardLayout`); the actual per-breakpoint scaling for
  whatever this demo payload triggers happens server-side in
  `DashboardProposalService.applyLayout`, fixed above. Not an independent
  write path.

No further instances of the defect class were found on either side.
