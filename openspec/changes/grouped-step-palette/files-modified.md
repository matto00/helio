# Files modified — HEL-1136 grouped-step-palette

Diff base: `abe2a8fae1c827976aedf696bfaa0416b210d92c` (resolved live via
`scripts/concertino/resolve-review-base.sh`).

## Cycle 2 — evaluation-1.md CR1/CR2 fixes

**CR1 (Escape focus-restore).** `PipelineRiverView.tsx` (all 3 `StepPalette` render sites) and
`BranchAffordance.tsx` now pass `StepPalette`'s real `open` boolean unconditionally
(`<StepPalette open={someBoolean} .../>`) instead of conditionally mounting the whole tree
(`{someBoolean && <StepPalette open .../>}`). Root cause: `Modal.tsx`'s focus-restore
(`previouslyFocusedRef.current?.focus()`) lives in the `useEffect(..., [open])`'s else-branch,
which only fires on a true->false `open` transition, never on unmount — a live Playwright check
confirms Escape now correctly returns focus to the trigger button. `PipelineRiverView.test.tsx`
gained a new regression test ("pressing Escape closes the gap palette and restores focus to the
gap button that opened it") exercising the real `cancel`-event path `Modal.test.tsx` uses.

**CR2 (failable task-6.2 checks).** `StepPalette.tsx` gained an exported
`findUngroupedEntriesInGroups(groups: ResultGroup[])`, factored out of
`ungroupedEntriesInACategory` (now a thin wrapper) — `ResultRow`/`ResultGroup` are now exported
too, purely for this testability seam; no behavior change. `StepPalette.test.tsx`'s two task-6.2
tests were rewritten to genuinely invoke the checked function against a fixture where the
offending entry stays present but is dropped/mis-rendered (an authorable entry whose `group` id
matches no `catalog.groups` entry for `missingFromAllView`; a hand-built `ResultGroup[]` with an
ungrouped entry under a labeled header for `findUngroupedEntriesInGroups`), and both were manually
red-proofed by temporarily stubbing the real implementations to `return []` and confirming the
tests fail, then restoring — see the CR1/CR2 finding notes inline in the test file for why
`ungroupedEntriesInACategory` itself can never be driven non-empty by catalog data alone given a
correct `buildGroups` (a permanent invariant, not a testing shortcut).

**Explicit finding (asked, not expanded in scope):** yes, in production, an authorable catalog
entry whose declared `group` id matches nothing in `catalog.groups` DOES silently disappear from
the no-filter "All" view — `buildGroups`'s grouped branch only reads back entries via
`for (const group of catalog.groups) { byGroup.get(group.id) }`, so an entry filed under an
unrecognized key is never retrieved (and, having a defined-but-unrecognized `group`, never falls
into the ungrouped bucket either). It DOES still appear once a filter is active, since that branch
returns `matches` directly with no dependency on `catalog.groups`. This can't happen today because
the backend derives both `catalog.groups` and every entry's `group` from the same `StepGroup`
source (nothing in the current code permits them to drift apart), so this is a frontend
defense-in-depth gap, not a live defect — not fixed per the instruction to only report, not expand
scope, unless it's genuinely broken today.

**Non-blocking suggestion (optional, applied).**
`backend/src/test/scala/com/helio/domain/model/PipelineStepRegistryCatalogSpec.scala`'s
`"the partition guard"` block (tautological — compared a value derived from `Registry` back
against `Registry`) is retitled/trimmed to `"an undeclared PipelineStep.Companion"` and keeps only
the one assertion it can actually demonstrate (safe defaults for an undeclared companion); the
class doc comment now points at `PipelineStepCatalogServiceSpec` for the real, provably-failable
coverage-equals-registry guard task 6.1 asks for.

## Backend — kind-level metadata

- `backend/src/main/scala/com/helio/domain/model/StepGroup.scala` — new sealed `StepGroup` ADT declaring each group's id/label/display order (design.md D3).
- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — extends `Companion` with `group: Option[StepGroup] = None`, `catalogDescription: String = ""`, `authorable: Boolean = true` (design.md D1).
- All 27 step companions below declare `group`/`catalogDescription`; `JoinStep`/`GroupByStep`
  additionally declare `authorable = false`; `assert` is deliberately left ungrouped (the shipped
  ungrouped-kind example):
- `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala`,
  `AnalyzeWithAiStep.scala`,
  `AssertStep.scala`,
  `CastStep.scala`,
  `ChunkByTokenCountStep.scala`,
  `ComputeStep.scala`,
  `ConvertFormatStep.scala`,
  `DateBucketStep.scala`,
  `DedupeStep.scala`,
  `ExtractHeadingsStep.scala`,
  `FillNullStep.scala`,
  `FilterStep.scala`,
  `GenerateTextStep.scala`,
  `GroupByStep.scala`,
  `JoinStep.scala`,
  `LimitStep.scala`,
  `LookupStep.scala`,
  `PivotStep.scala`,
  `RenameStep.scala`,
  `SelectStep.scala`,
  `SortStep.scala`,
  `SplitTextStep.scala`,
  `StringOpsStep.scala`,
  `UnionStep.scala`,
  `UnpivotStep.scala`,
  `UpsertSourceStep.scala`,
  `WindowStep.scala`

## Backend — catalog endpoint

- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepCatalogService.scala` — new: projects `PipelineStep.Registry` into `PipelineStepCatalog {groups, steps}`; `labelFor` derives a human label per kind.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepCatalogProtocol.scala` — new: wire types + spray-json formats; `group: Option[String]` (absent, not null, when ungrouped).
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineStepCatalogRoutes.scala` — new: `GET /pipeline-step-catalog`, distinct top-level prefix.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in `PipelineStepCatalogProtocol`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports the new response types for `com.helio.api._` callers (mirrors the `PipelineShape*` re-exports).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `PipelineStepCatalogService`/`PipelineStepCatalogRoutes` into the `authenticatedUser` tree.
- `schemas/pipelines/pipeline-step-catalog.schema.json` — new JSON Schema for the catalog response.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/model/StepGroupSpec.scala` — new: `StepGroup.All` order stability + unique ids/labels.
- `backend/src/test/scala/com/helio/domain/model/PipelineStepRegistryCatalogSpec.scala` — new: non-blank descriptions, exact unauthorable set, partition/coverage guard (task 6.1).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineStepCatalogServiceSpec.scala` — new: catalog projection coverage.
- `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepCatalogProtocolSpec.scala` — new: absent-not-null wire assertion, array-not-object ordering assertion.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepCatalogRoutesSpec.scala` — new: isolated route 200 coverage.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — adds composed-route-tree 401/200 coverage for `GET /api/pipeline-step-catalog`.

## Frontend — data access

- `frontend/src/features/pipelines/types/pipelineStepCatalog.ts` — new: catalog wire types (`group?: string`).
- `frontend/src/features/pipelines/services/pipelineService.ts` — adds `getPipelineStepCatalog()`.
- `frontend/src/features/pipelines/services/pipelineService.test.ts` — adds coverage, including the absent-group-key assertion.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — adds `STEP_ICONS`/`DEFAULT_STEP_ICON` (icon-only presentation lookup, not a group mapping — design.md D7); `OP_TYPES` kept as-is (see note below).
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts` — replaces the `KNOWN_UNLISTED_KINDS` drift guard with an icon-coverage guard over authorable kinds, parsed live from each step file's `authorable` declaration (task 6.3).

## Frontend — the palette

- `frontend/src/features/pipelines/ui/StepPalette.tsx` — new: the grouped/filterable/keyboard-navigable add-step chooser, built on `Modal`, reusing `CommandPalette.css` markup. Exports `missingFromAllView`/`ungroupedEntriesInACategory` (task 6.2 failable checks).
- `frontend/src/features/pipelines/ui/StepPalette.test.tsx` — new: full coverage (rendering, filtering/flattening, keyboard, unauthorable exclusion, error/retry, "All" completeness).

## Frontend — call-site migration

- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — replaces all 3 `OpDropdown` render sites (gap insert, empty-state append, bottom-row append) with `StepPalette`; drops now-unused anchor-ref plumbing.
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — updates affected tests to the new async/`role="option"`/`role="dialog"` shape; adds the `getPipelineStepCatalog` mock + `<dialog>` showModal/close stub.
- `frontend/src/features/pipelines/ui/BranchAffordance.tsx` — rebuilt on `StepPalette` (no anchor needed — centered Modal, not a portalled anchored menu).
- `frontend/src/features/pipelines/ui/LaneColumn.tsx` — drops the now-unused `laneAnchorEl` state (its `BranchAffordance` usage no longer needs an anchor).
- `frontend/src/features/pipelines/ui/OpDropdown.tsx`, `OpDropdown.test.tsx` — deleted.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — deletes the now-dead `.pipeline-detail-page__op-dropdown*` rules.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — adds `getPipelineStepCatalog` mock + fixture; converts the affected add-step tests to `await screen.findByRole("option", ...)`.
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — re-lines the `PipelineDetailPage.css` spacing baseline (39 lines removed by the dead-CSS deletion; one baseline entry removed outright since its literal no longer exists).

## Root-cause / probe note (F-040 retirement, task 6.4)

`OpDropdown`'s F-040 max-height clamp (`position: fixed` + inline `maxHeight` computed from
viewport space below the trigger) is **retired as moot, not regressed**: `StepPalette` renders on
the shared `Modal`, whose `.ui-modal` CSS already caps `max-height: 90vh` with `overflow-y: auto`
on the body — verified live via Playwright against a real pipeline with the palette open
(`.playwright-mcp/step-palette-dark.png`, `.playwright-mcp/step-palette-light.png`): the results
list scrolls within the modal body rather than the modal itself overflowing the viewport. No
regression test needed to replace F-040's — the containment mechanism moved from a bespoke
per-open clamp to the primitive every other modal in the app already relies on.

## Known deviation from a literal task-3.3 reading

Task 3.3 says "Reduce `OP_TYPES` to an icon map keyed by kind". `OP_TYPES` (the `{id,label,icon}[]`
array) is kept **unchanged** rather than deleted, because it is also the source `pipelineStepToStep`/
`makeStep`/`StepCard` use to label and iconify an **already-persisted or freshly-created** step
card — a concern distinct from the picker's own data source, and rewriting it would touch ~15
files/dozens of tests unrelated to the palette's server-driven behavior. `STEP_ICONS` was added
alongside it (derived from `OP_TYPES`) specifically for `StepPalette`'s icon lookup, satisfying
design.md D7's actual requirement (icons stay client-side, not a group mapping) without widening
this change's blast radius into step-card label rendering. Flagged here for reviewer visibility
rather than silently diverging from the task's literal wording.
