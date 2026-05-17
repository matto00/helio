# Ticket Context — HEL-236 CS4

**Linear**: https://linear.app/helioapp/issue/HEL-236
**Sub-PR**: CS4 — frontend decomposition closeout (**FINAL** sub-PR of HEL-236)

## Position in the HEL-236 chain

CS1 #146 → CS2a #147 → CS2b #148 → CS2c-1 #149 → CS2c-2 #150 → CS2c-3a #151 → CS2c-3b #152 → CS2c-3c #153 → CS3 #154 → **CS4 (this PR)**. Closes the HEL-236 chain.

## Goal

Final closeout of the frontend decomposition work. Four pieces:

1. **Primary — `features/panels/ui/PanelCreationModal.tsx` per-subtype decomposition** (716L → <400L). Per-subtype config field components (`MetricConfigFields`, `ChartTypeField`, `ImageConfigField`, `DividerConfigField` at lines 112–237) extract into `features/panels/ui/creators/<Kind>CreatorFields.tsx` mirroring CS2c-3c's editors+renderers pattern. Modal shell stays in `PanelCreationModal.tsx`.
2. **`features/types/models.ts` per-domain decomposition** (372L, 85 consumer files). Move domain types to their feature folders' `types/`; collapse re-export shim; retain only truly cross-cutting types (likely just `ResourceMeta`, paginated query types, generic response wrappers).
3. **`features/pipelines/ui/StepCard.tsx` per-kind split** (323L → ideally <250L) — IF natural. Investigate first; if the body dispatches on step kind for rendering, extract per-kind sub-components into `features/pipelines/ui/stepCards/<Kind>StepCard.tsx`. If not natural, leave at 323L (under hard cap; soft-cap warning acceptable).
4. **Test rename** — `frontend/src/features/panels/ui/ComputedFieldPicker.test.tsx` actually exercises `PanelDetailModal`; rename to `PanelDetailModal.computedFields.test.tsx` (or similar — executor judgment).

## Current state (entering CS4)

- 9 prior sub-PRs merged (CS1 through CS3); only file currently over 400L hard cap is `PanelCreationModal.tsx` (716L) — that's the CS4 target
- `features/<domain>/{ui,state,hooks,services,types}/` structure landed in CS3
- `types/models.ts` is a hybrid: cross-cutting definitions + re-export shim for CS2c-3c's extracted domain types (`panel.ts`, `pipelineStep.ts`, `dataSource.ts`)
- 85 files import from `types/models` — biggest mechanical surface

## models.ts decomposition mapping (concrete)

Current `types/models.ts` contents → target locations:

| Type | Target |
|---|---|
| `ResourceMeta` | stays at `types/models.ts` (cross-cutting) |
| `DashboardAppearance`, `DashboardLayoutItem`, `DashboardLayout`, `Dashboard`, `DashboardSnapshotPanelEntry`, `DashboardSnapshotDashboardEntry`, `DashboardSnapshot`, `DashboardUpdatePayload`, `UpdateDashboardBatchRequest`, `DuplicateDashboardResponse` | `features/dashboards/types/` |
| `ChartLegend`, `ChartTooltip`, `ChartAxisLabel`, `ChartAxisLabels`, `ChartAppearance`, `PanelAppearance`, `PanelBatchItem`, `UpdatePanelsBatchRequest`, `UpdatePanelsBatchResponse`, `MetricTypeConfig`, `ChartTypeConfig`, `ImageTypeConfig`, `DividerTypeConfig`, `TypeConfig`, `PanelUpdateFields`, `MappedPanelData`, `PanelPaginationState` | extend `features/panels/types/panel.ts` |
| `DataTypeField`, `ComputedField`, `DataType` | `features/dataTypes/types/` |
| `Pipeline`, `PipelineSummary`, `RunStatus`, `RunStatusResponse`, `PipelineRunRecord` | extend `features/pipelines/types/pipelineStep.ts` (or new sibling) |
| `InferredField`, `StaticColumnType`, `StaticColumn`, `StaticSourcePayload` | extend `features/sources/types/dataSource.ts` (or new sibling) |
| `User`, `UserPreferences`, `UserPreferencePayload`, `AuthResponse`, `UpdateUserPreferenceRequest` | `features/auth/types/` |
| `export type {…}` re-export blocks for `DividerOrientation`, `Panel`, `PanelKind`, etc. | delete; consumers import from domain modules directly |

Executor may refine this mapping if a type's natural home differs from the above — document deviations in cycle-1 report.

## Cycle plan

- **Cycle 1** — mechanical: `models.ts` decomposition + test rename. Pure structural moves. High import-path churn (~85 files). Mirrors CS3 cycle 1 in nature.
- **Cycle 2** — creative: `PanelCreationModal` per-subtype decomposition + `StepCard` per-kind split (if natural). Mirrors CS2c-3c cycle 2 in nature.

## Acceptance criteria

1. `PanelCreationModal.tsx` < 400L; 4 per-type config field components extracted into `features/panels/ui/creators/`
2. `models.ts` either (a) reduced to truly-cross-cutting types only (likely <100L) and the file's role is clearly documented, or (b) retired entirely if no cross-cutting types remain
3. All 85 import sites updated to import from new domain locations
4. `StepCard.tsx` either <250L (if per-kind split natural) or stays at 323L with documented rationale
5. `ComputedFieldPicker.test.tsx` renamed to match its actual subject
6. All gates pass: sbt test, lint, format:check, jest, build, check:schemas, check:openspec, check:scala-quality, pre-commit hook
7. No file >400L hard cap anywhere in the frontend after CS4 lands
8. No behavior changes — Playwright Phase 3 smoke confirms parity with main

## Patterns inherited

- Behavior-preserving structural refactor ([[feedback-refactor-discipline]])
- File-size budgets: routes ≤150 hard, services ≤300 soft, other src ≤250 soft, **>400 BLOCKER**
- No-inline-FQN pre-commit hook (backend untouched but hook still runs)
- Atomic commits — one per major extract / one per feature's import updates
- Per-subtype decomposition co-located per file (CS2c-3c editors+renderers + CS2c-3a per-step pattern)
- Drive-by extractions allowed if behavior-preserving and only path under cap (CS3 cycle 2 precedent)
- Playwright Phase 3 smoke as evaluator deliverable

## Out of scope (do NOT touch)

- HEL-242 fix (deferred; root-cause hypothesis recorded)
- `useLegacyBoundPanel` removal (preserved; CS3-era spinoff but NOT this PR)
- `appearance.chart` → `ChartPanelConfig` migration (spinoff)
- Behavior changes to any moved file
- Backend, schemas, OpenSpec specs other than this change folder
- Path-alias introduction if not already in repo
- Other soft-cap files (toastListeners 394L, PanelDetailModal 390L, App.tsx 348L, etc.) — leave alone unless cycle 2 surfaces a clear reason

## Process

- Worktree: `/home/matt/Development/helio/.worktrees/HEL-236-cs4`
- Branch: `task/frontend-decomp-closeout/HEL-236`
- Dev ports: 5411 (frontend), 8318 (backend)
- linear-executor + linear-evaluator at opus model
- Commits prefixed `HEL-236 CS4 cycle N: <summary>`
- STOP after evaluation passes; present PR and ask human before merging

## Escalation policy

If cycle 1 models.ts decomposition surfaces circular imports or other coupling issues, surface as BLOCKER with concrete split options. If cycle 2 `PanelCreationModal` decomposition doesn't naturally extract 4 per-subtype components (e.g. modal state machine is too tightly coupled), surface as BLOCKER with options to (a) accept a small behavior-preserving refactor or (b) leave file over cap and defer to a follow-up.
