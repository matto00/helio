# Design — Frontend feature-folder restructure

## D1 — Target folder shape: nested per-domain subfolders

```
features/<domain>/
  ui/          components (UI), CSS sidecars, render-side tests
  state/       Redux slices, thunks, narrowing helpers, payload builders
  hooks/       domain-specific hooks
  services/    domain-specific API client modules
  types/       domain-specific TypeScript types
```

Each subfolder is created **only if non-empty**. e.g. `features/auth/` likely won't have `hooks/` or `types/` subfolders since none exist today.

Rationale: instantly visible boundaries; matches the established `state`-style separation already used in many codebases; nest is shallow (one extra hop) so navigation stays fast.

Alternative considered: flat-per-domain (everything at one level inside `features/<domain>/`). Rejected because navigation is fast but boundaries are invisible — for `panels/` which has ~14 UI files + 7 state files + 5 hooks + 1 service + 1 type, the flat layout would be a soup of 28+ files at one level.

## D2 — `shared/` umbrella for cross-cutting UI

New top-level `shared/` folder holds chrome and reusable UI that's not owned by any single feature:

```
shared/
  ui/             reusable widgets (Select.tsx, etc. — current components/ui/ moves here)
  chrome/         layout chrome: SidebarBody, SidebarItemList, ActionsMenu, AccentPicker, OrbitMark, OverlayProvider, Popover.css, SaveStateIndicator, StatusMessage, InlineError, UserMenu
```

Rationale: keeps `features/` clean (only domain code); makes truly shared UI obviously reusable.

Alternative considered: leave shared UI in `components/`. Rejected because the goal is to empty flat `components/` so domain ownership is unambiguous.

## D3 — Top-level folders that stay

- `app/` — App.tsx, App.css, App.test.tsx, README — application shell, stays
- `pages/` — DataSourcesPage (only one) — stays for now; revisit if it grows
- `context/` — SaveStateContext — cross-cutting React context, stays
- `store/` — Redux store config, stays
- `theme/` — ThemeProvider, theme.ts, appearance.ts — stays
- `utils/` — chartAppearance, formatRelativeTime — pure helpers, stays
- `config/` — env.ts — stays
- `test/` — test utilities (envMock, jest.setup, renderWithStore, panelFixtures, mocks) — stays
- `main.tsx` — entry point, stays
- `hooks/` — reduced to `reduxHooks.ts` + `useRelativeTime.ts`
- `services/` — reduced to `httpClient.ts` + `httpClient.test.ts`
- `types/` — reduced to whatever cross-cutting residue remains in `models.ts` (likely retired entirely if all consumers migrate to domain types)

## D4 — BLOCKER decomposition strategy (cycle 2)

### `features/pipelines/ui/PipelineDetailPage.tsx` (1200L → <400L)

Natural decomposition lines (already separated by section comments in source):

- Main page → `PipelineDetailPage.tsx`
- `StepCard` (lines 306–597) → `StepCard.tsx`
- `OpDropdown` (lines 206–246) → `OpDropdown.tsx`
- `SourceChip` (lines 598–670) → `SourceChip.tsx`
- `RibbonSegment` (lines 156–205) → `RibbonSegment.tsx`
- Narrowing helpers (lines 247–305) → `stepNarrowing.ts`
- Op types + step types (lines 75–155) → `stepTypes.ts`

All extracts behavior-preserving; each new file <250L soft cap.

### `features/sources/ui/AddSourceModal.tsx` (475L → <400L)

Two extraction lines:

- Per-source-type form bodies → per-source-type components (likely `RestApiForm.tsx`, `CsvForm.tsx`, `SqlForm.tsx`; `StaticSourceForm.tsx` already exists separately)
- Multi-step wizard logic stays in `AddSourceModal.tsx` as the shell

Specific extractions TBD by executor based on the file's structure; goal is shell <400L.

## D5 — Drive-by extractions allowed within rule

Per CS2c-3c precedent ([[feedback-refactor-discipline]] still binding): drive-by extractions ARE allowed if and only if:
- They are behavior-preserving structural moves (no logic changes)
- They are the only path to bringing a file under the file-size cap
- Re-exports preserve every existing import (no broken consumers)

In CS3 specifically, drive-bys are expected during cycle 2 to bring the two BLOCKER files under cap. Cycle 1 is pure mechanical movement and should NOT introduce drive-by extractions.

## D6 — Import-path mechanics

- Use Vite/TypeScript path aliases if already configured; otherwise use relative paths
- After cycle 1, audit imports for opportunities to introduce path aliases (`@/features/panels/...`) — but only if the codebase already uses them; do NOT introduce a new convention in this PR
- Each commit's import-path update must be complete (no commit leaves the build broken)

## D7 — Test files travel with their target

For every `Foo.tsx` that moves, `Foo.test.tsx` moves too. CSS sidecars (`Foo.css`) move too. This is non-negotiable; Jest auto-discovery handles the path change.

Test utilities in `frontend/src/test/` stay put (they're cross-cutting).

## D8 — `models.ts` residue policy

CS2c-3c extracted `dataSource.ts`, `panel.ts`, `pipelineStep.ts` out of `models.ts` (367L remaining). Audit the residual: if it's all cross-cutting (e.g. `ResourceMeta`, paginated query types, shared response wrappers) it stays at `types/models.ts`. If it's all domain-owned, extract and delete `models.ts` entirely.

Decision deferred to executor judgment in cycle 1. Document the rationale in the executor report.
