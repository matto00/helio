# Proposal — Frontend feature-folder restructure

## Why

The frontend has a partial feature-first structure (`features/` with 9 domain folders) but it only holds Redux slices. UI components, hooks, services, and types live in flat top-level folders (`components/` has 53 non-test files mixed across all domains). This creates three concrete problems:

1. **Navigation friction** — touching one domain means jumping between 4 flat folders.
2. **Domain ownership unclear** — flat `components/` makes it hard to spot which feature owns which UI surface; new contributors don't have a natural place to drop new files.
3. **File-size BLOCKERS hide** — three files are already over the 400L hard cap (`PipelineDetailPage.tsx` 1200L, `PanelCreationModal.tsx` 716L, `AddSourceModal.tsx` 475L), but their over-cap status is invisible at the directory level.

## What

Move every domain-specific file into `features/<domain>/{ui,state,hooks,services,types}/`. Cross-cutting code stays in narrowed top-level folders or moves to `shared/`. Decompose `PipelineDetailPage` and `AddSourceModal` in their new homes (cycle 2). Leave `PanelCreationModal` over-cap for CS4 (per-subtype decomposition is CS4 territory, mirroring CS2c-3c's editors+renderers split).

This is a **behavior-preserving structural refactor**. No domain changes, no API changes, no test changes (beyond imports + relocated test files).

## Impact

- `features/` 9 folders → ~9 folders with nested subfolders
- `components/` 53 → 0 domain files; subset moves to `shared/`
- `hooks/` 17 → 2 cross-cutting only
- `services/` 8 → 1 (`httpClient` only)
- `types/` 4 → 0–1 (residual cross-cutting)
- ~191 ts/tsx files affected for import paths
- 2 BLOCKER decompositions in cycle 2 (each likely yielding 4–6 sibling files)

## How (cycle plan)

- **Cycle 1** — mechanical restructure: move files, update imports, no behavior changes, no decomposition. Gates green at end.
- **Cycle 2** — decompose `PipelineDetailPage.tsx` and `AddSourceModal.tsx` in their new feature homes. All gates green; nothing >400L except `PanelCreationModal` (CS4-tagged).

## Risks

- **Import-path churn** — ~191 files touched. Mitigation: cycle 1 is mechanical; per-feature atomic commits make review tractable.
- **Hidden circular dependencies** — moving files between feature folders may surface latent import cycles. Mitigation: `npm run build` catches at compile time; addressed cycle 1.
- **Test paths break** — tests + fixtures move with their target. Mitigation: Jest auto-discovers; verify with `npm test` after each commit group.
- **Scope explosion** — if cycle 1 grows beyond manageable, ESCALATE with feature-by-feature split (CS3a = panels+pipelines, CS3b = remaining domains).
