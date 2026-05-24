# Executor Report — Cycle 1

**Change**: `frontend-decomp-closeout`
**Cycle**: 1 (mechanical — `models.ts` decomposition + test rename)
**Ticket**: HEL-236 CS4

## Summary

Decomposed `frontend/src/types/models.ts` from 372 lines down to 19 lines,
distributing six domains' types into their respective feature folders'
`types/` directories. Renamed the misnamed `ComputedFieldPicker.test.tsx`
to `PanelDetailModal.computedFields.test.tsx` and moved it to the SUT's
folder. All cycle 1 tasks (groups 1, 2, 3, 4) are complete.

The work was split into six atomic commits per source-domain (one per
target feature) followed by the test rename, after the OpenSpec change
folder commit. Every commit was preceded by `npx tsc --noEmit` + `npm
run build` to catch missed imports early.

## Type-move counts per domain

| Target | New / extended file | Types moved | Consumer files updated |
|---|---|---|---|
| `features/dataTypes/types/dataType.ts` | new | 3 (`DataType`, `DataTypeField`, `ComputedField`) | 11 |
| `features/auth/types/user.ts` | new | 5 (`User`, `UserPreferences`, `UserPreferencePayload`, `AuthResponse`, `UpdateUserPreferenceRequest`) | 7 |
| `features/dashboards/types/dashboard.ts` | new | 10 (`Dashboard`, `DashboardAppearance`, `DashboardLayout`, `DashboardLayoutItem`, `DashboardSnapshot`, `DashboardSnapshotPanelEntry`, `DashboardSnapshotDashboardEntry`, `DashboardUpdatePayload`, `UpdateDashboardBatchRequest`, `DuplicateDashboardResponse`) | 12 |
| `features/sources/types/dataSource.ts` | extended | 4 (`InferredField`, `StaticColumnType`, `StaticColumn`, `StaticSourcePayload`) | 7 |
| `features/pipelines/types/pipelineStep.ts` | extended | 5 (`Pipeline`, `PipelineSummary`, `RunStatus`, `RunStatusResponse`, `PipelineRunRecord`) | 11 |
| `features/panels/types/panel.ts` | extended | 17 (chart-appearance shapes + `PanelAppearance` + creation `TypeConfig` union + `PanelBatchItem`/batch wrappers + `PanelUpdateFields`/`MappedPanelData`/`PanelPaginationState`) | ~40 |
| `types/models.ts` (survives) | trimmed | 1 (`ResourceMeta`) | 8 (residual cross-cutting consumers) |

**Total types moved**: 44 + 1 retained = 45.
**Total consumer-file updates**: 85 unique files (matches ticket's
expected ~85 import-site count); some files were touched in more than
one commit because they imported types from multiple domains.

The `DataSource` ADT and `PipelineStep` ADT were not "moved" in this cycle
(they already lived in their feature folders since CS2c-2 and CS2c-3a
respectively), but their `export type {…}` **re-export blocks** in
`models.ts` are now deleted (task 1.8). The 8 files that previously
imported `DataSource` / `DataSourceKind` from `types/models` were
re-pointed to `features/sources/types/dataSource` directly.

## `models.ts` final state

19 lines, 1 export (`ResourceMeta`). Per design D7 recommendation (a) —
keeps the import path `import type { ResourceMeta } from "..../types/models"`
working for the 8 surviving consumers and gives future cross-cutting
types an obvious home with minimal churn. Top comment block documents
the rationale and links each migrated domain to its new location, so
future readers can find where the old contents went.

## File-size soft-cap notes

The two existing feature `types/` files grew when receiving the moved
types:

- `features/panels/types/panel.ts` — 190L → 279L (over soft 250L cap; well
  under 400L hard cap). Holds the panel discriminated union, per-subtype
  config shapes, appearance shapes, creation `TypeConfig` union, batch
  shapes, pagination state, and default-config factories. Decomposing
  further would split tightly-cohesive types and create cross-file
  cycles, so I left it as a single cohesive panel-types module.
- `features/pipelines/types/pipelineStep.ts` — 216L → 255L (5L over soft
  cap). Holds the pipeline-step discriminated union, analyze-step union,
  and the new pipeline-run summary types. Same cohesion argument.

Both stayed under the 400L hard cap and both decompositions would have
been cosmetic. Surfacing as informational; not splitting in cycle 1.

`features/sources/types/dataSource.ts` 78L → 102L; `panel.ts` and
`pipelineStep.ts` are the only files over soft cap that were created or
grown in cycle 1.

No file > 400L was introduced. (`PanelCreationModal.tsx` 716L remains
the only over-cap file in the frontend; that is cycle 2's primary
target.)

## Deviations from ticket mapping

None of significance. The ticket-suggested target for `Pipeline*` /
`RunStatus*` was either `pipelineStep.ts` or a new sibling — I picked
`pipelineStep.ts` because the new types are part of the same pipeline
domain and the file was already structured with section comments
welcoming related types. No new sibling file was warranted.

## Circular-import surprises

None observed. The two cycle-risk pairings I watched for were:

1. **dashboard.ts → panel.ts**: `DuplicateDashboardResponse` references
   `Panel`, so `features/dashboards/types/dashboard.ts` imports `Panel`
   from `features/panels/types/panel.ts`. There is no reverse edge —
   `panel.ts` does not import from `dashboard.ts`. Safe one-way.
2. **panel.ts → models.ts** (residual `ResourceMeta`): one-way, no
   cycle.

`npm run build` was run after each commit-group and stayed green
throughout.

## Test count + behavior preservation

664 tests / 58 suites both before and after cycle 1 — preserved exactly,
including the renamed test which still asserts the same `PanelDetailModal`
computed-field behaviors. The rename touched only the file path + the two
relative imports that broke because the SUT and mocked service paths
shifted.

## Drive-bys

None. All edits were either type moves, import-path updates, or the
test rename. No behavior-changing edits, no unrelated refactors. The
Prettier re-flowing of three import statements (run via `npm run format`)
folded multi-line imports onto single lines where they fit under 100
chars — those are cosmetic and were applied as part of the panel-types
commit.

## Gates run

| Gate | Result |
|---|---|
| `sbt test` (sanity) | 591 tests / 35 suites pass |
| `npm run lint` | clean (0 warnings) |
| `npm run format:check` | clean (after `npm run format` ran on 3 files) |
| `npm test` | 664 tests / 58 suites pass |
| `npm run build` | clean |
| `npm run check:schemas` | 6/6 in sync |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean (18 informational soft warnings, all in pre-existing backend test files unchanged this cycle) |
| `models.ts` size cap | 19 lines (target was <100L) |
| no new file > 400L hard cap | confirmed (largest new/grown: `panel.ts` 279L) |

All cycle 1 gates green; ready for evaluator review.

## Commit timeline (cycle 1)

1. `00eb404` OpenSpec change folder
2. `86b3fe7` DataType types
3. `03d58bb` Auth types
4. `ce23cc4` Dashboard types
5. `97c02da` Source schema types
6. `ccffcdb` Pipeline summary + run types
7. `f29bcf5` Panel-adjacent types + models.ts collapse
8. `4aa0ad3` Test rename

## Next

Cycle 2 will tackle the `PanelCreationModal.tsx` 716L per-subtype
decomposition (primary) and the `StepCard.tsx` 323L per-kind split
investigation. No cycle-1 blockers carry forward.
