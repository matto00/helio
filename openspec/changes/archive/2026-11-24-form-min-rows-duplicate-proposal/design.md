## Context

HEL-1618 (e3eda3eda) added the client rule in `frontend/src/features/panels/ui/grid/panelGridConfig.ts`:
`FORM_MIN_ROWS = 5`; `panelMinRows` exempts any non-form and any compact counter; `liftResizedForm` grows a resized
sub-5 non-counter form to 5 only when `isSpaceBelowFree(items, target, 5)` (no OTHER item overlaps the target's
columns on rows `y + h .. y + 5 - 1`), never moving another item. The compact-counter predicate is
`isCompactCounterConfig` in `frontend/src/features/panels/ui/form/compactCounter.ts`: `fields.length === 1 &&
fields[0].control === "counter"` (a missing config or zero fields is a plain form).

Backend paths that create or place a panel (enumerated in
`.concertino/runs/HEL-1834/evidence/premise-validation.md`):

| Path | Today | This change |
| --- | --- | --- |
| single/batch create, patch-set create | `PlacementSizes.forNewPanel` -> 5 rows | unchanged |
| auto-layout | `PanelPacker` Form minH 5 | unchanged |
| panel duplicate | `CreatePlacement.duplicateSizes` copies source h | min 5 for non-counter form |
| proposal apply (+ combined apply) | `ProposalLayoutSupport.buildLayout` copies authored lg h | lift-when-free |
| `PUT /dashboards/:id/contents` | same `buildLayout` | lift-when-free (owner: include) |
| dashboard import | verbatim | unchanged, guard test (owner ruling) |
| dashboard duplicate | verbatim (`DashboardSnapshotRepository.duplicate`) | unchanged, guard test (owner: exclude-with-guard-test) |

## Goals / Non-Goals

Goals: the three paths above never create a non-counter form under 5 rows when they can do so without moving
another panel; compact counters keep their height; import and dashboard duplicate untouched.

Non-goals: changing `PanelPacker` (it clamps compact counters to 5 too; out of scope), any frontend change, any
API/schema change, any migration, re-validating stored layouts.

## Decisions

### D1. One backend predicate and one rule object

Add to the form domain (`FormPanelConfig` companion or `FormPanel`) `isCompactCounter(config)`:
`config.fields.size == 1 && config.fields.head.control == "counter"`, with a scaladoc naming
`compactCounter.ts` as its client twin. Add `services/panels/FormPlacementRule` (name is the executor's choice)
with `FormMinRows = 5`, `minRowsFor(panel: Panel): Int` (5 for a `FormPanel` that is not a compact counter, else 1 =
no floor), and `isSpaceBelowFree(items, target, rows)` mirroring the client function exactly (same half-open
interval arithmetic, excludes the target by panelId). A unit table pins the predicate on the same cases the client
names: zero fields, one counter, one non-counter, two fields with a counter, missing config (Empty).
Alternatives: a cross-language shared fixture — rejected as heavier than the 1-line predicate warrants.

### D2. Panel duplicate: floor the size, always free

`CreatePlacement.duplicateSizes` gains a `minH: Int` parameter (default 1); every breakpoint's chosen size gets
`h = max(minH, h)`. `PanelLifecycleWrites.duplicatePlaced` computes `minH = FormPlacementRule.minRowsFor(panel)` from
the source panel (the duplicate copies its type and config) and threads it through
`PanelMutationRepository.duplicate`. `CreatePlacement.append` places the copy at `x = 0` below every stored item of
that breakpoint, so the rows below are free by construction: this is the client's lift-when-free rule with the
condition always true, and no other item moves. The kind-default fallback is already 5.

### D3. Proposal apply and replace contents: lift-when-free on authored lg

`ProposalLayoutSupport.buildLayout` gains a per-panel `minRows: Vector[Int]` (same order as `builtIds`, default all
1). After building the authored lg items and BEFORE computing `bottom` for unauthored items, walk the authored items
in proposal order; for each with `h < minRows(i)`, if `isSpaceBelowFree(currentAuthored, item, minRows(i))` set
`h = minRows(i)`, else keep it. `currentAuthored` includes earlier lifts, so two stacked forms resolve
deterministically and the result never overlaps (a lift only claims free cells). Unauthored items are then appended
below the post-lift bottom as today, and md/sm/xs are reflowed from the final lg (reflow keeps `h`, so the lift
carries through). Callers: `DashboardProposalService.applyLayout` passes `minRowsFor` of each created panel;
`DashboardContentsService.buildAndReplace` passes `minRowsFor` of each built panel. Combined-proposal apply reaches
`DashboardProposalService` and inherits the change (the executor confirms this by reading the code and states it).
`validate` (pre-creation authored-layout check) is unchanged: the lift happens after validation and cannot create an
overlap. Unauthored form panels already get 5 via `forNewPanel`/`ContentDefault`.

Why lift-when-free and not an unconditional floor: an unconditional floor would overlap an authored panel directly
below, which would either fail `DashboardService.update` validation (rolling back the whole apply) or require moving
the neighbour; the ticket forbids moving other panels, and the client resolves exactly this case by keeping the height.

### D4. Guards for import and dashboard duplicate

Add one test each (labelled `GUARD` in the test name/comment, per MISTAKES.md / red-vs-guard): import a dashboard
whose layout holds a non-counter form at 4 rows -> stored form is 4 rows; duplicate such a dashboard -> the copy's
form is 4 rows. Each guard must be shown failable by a recorded mutation (e.g. temporarily applying the floor in
`DashboardSnapshotRepository`'s remap) and the mutation reverted.

## Testing Strategy

Red first, committed as `.txt` before implementation (C12). Per path an end-to-end-of-service test on the lane DB:
duplicate (4-row form -> 5 in every breakpoint; 4-row compact counter -> 4; other items unchanged), proposal apply
(authored form at 4 with free space -> 5; with an authored panel directly below -> 4 and neighbour unchanged; compact
counter at 4 -> 4), replace contents (authored form at 4 -> 5; compact counter at 4 -> 4). Pure unit tests for the
predicate, `isSpaceBelowFree`, `duplicateSizes(minH)` and `buildLayout(minRows)`. Mutation evidence for each new test.
Fixtures only, no model call.

## Risks / Trade-offs

- Proposal tests that assert exact authored heights for form panels may change; any such existing test that changes
  must be explained, not silently edited (a fixture change is a symptom).
- `buildLayout` default parameter keeps any other caller unchanged; the executor lists every caller.
