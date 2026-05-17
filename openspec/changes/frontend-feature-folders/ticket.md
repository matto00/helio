# Ticket Context — HEL-236 CS3

**Linear**: https://linear.app/helioapp/issue/HEL-236
**Parent ticket title**: Codebase refactor — modularity, DRY, and structural restructure
**Sub-PR**: CS3 — frontend feature-folder restructure

## Position in the HEL-236 chain

- CS1 (PR #146) — backend protocols split — merged
- CS2a (PR #147) — backend routes decompose — merged
- CS2b (PR #148) — backend service layer — merged
- CS2c-1 (PR #149) — domain ADT foundations — merged
- CS2c-2 (PR #150) — DataSource ADT + wire-shape evolution — merged
- CS2c-3a (PR #151) — PipelineStep ADT — merged
- CS2c-3b (PR #152) — Panel typed ADT (backend, wire preserved) — merged
- CS2c-3c (PR #153) — Panel wire collapse + frontend lockstep — merged
- **CS3 — THIS PR** — frontend feature-folder restructure
- CS4 — final sub-PR; scope likely shrinks to `PanelCreationModal` per-subtype decomp after CS3

## Goal

Move the flat `components/`, `hooks/`, `services/`, `types/` folders into per-domain feature folders under `features/<domain>/{ui,state,hooks,services,types}/`. Behavior-preserving structural refactor. Plus decompose two pre-existing file-size BLOCKERs whose decomposition is non-subtype work (per-subtype decomp belongs to CS4).

## Current state (entering CS3)

- `features/` already has 9 domain folders (`auth`, `dashboards`, `dataTypes`, `layout`, `panels`, `pipelines`, `sources`, `toasts`) but only holds Redux slices + slice-adjacent state — not UI/hooks/services/types
- `components/` — 53 non-test components mixed across all domains
- `hooks/` — 17 files (10 domain-specific, 7 cross-cutting)
- `services/` — 8 files (7 domain-specific, 1 cross-cutting `httpClient`)
- `types/` — 4 files (3 already domain-extracted in CS2c-3c)
- 191 total ts/tsx files in `frontend/src/`

## Three pre-existing file-size BLOCKERs (>400L hard cap)

1. `frontend/src/components/PipelineDetailPage.tsx` — **1200L** — decomposes along non-subtype lines (`StepCard`, `OpDropdown`, `RibbonSegment`, `SourceChip`, narrowing helpers). **In scope for CS3 cycle 2.**
2. `frontend/src/components/AddSourceModal.tsx` — **475L** — multi-step wizard / per-source-type forms. **In scope for CS3 cycle 2.**
3. `frontend/src/components/PanelCreationModal.tsx` — **716L** — decomposes along per-subtype lines (`MetricConfigFields`, `ChartTypeField`, `ImageConfigField`, `DividerConfigField`). **OUT OF SCOPE — deferred to CS4** because per-subtype decomp is CS4 territory (mirroring CS2c-3c's editors+renderers pattern).

## Target structure

```
features/
  auth/         {ui,state,services}/  (no hooks/types yet)
  dashboards/   {ui,state,services}/
  dataTypes/    {ui,state,services}/
  layout/       {state,hooks}/
  panels/       {ui,state,hooks,services,types}/
  pipelines/    {ui,state,hooks,services,types}/
  sources/      {ui,state,services,types}/
  toasts/       {state,hooks}/
shared/         chrome + ui/ + cross-cutting components (StatusMessage, Popover, OverlayProvider, SaveStateIndicator, Sidebar*, ActionsMenu, AccentPicker, OrbitMark, InlineError)
hooks/          reduxHooks, useRelativeTime (cross-cutting only)
services/       httpClient only
types/          residual cross-cutting (`models.ts` if anything remains; likely deleted)
```

CS2c-3c's `components/panels/{editors,renderers}/` subfolders move into `features/panels/ui/{editors,renderers}/`.

`app/`, `pages/`, `context/`, `store/`, `theme/`, `utils/`, `config/`, `test/`, `theme/` stay where they are (small + cross-cutting).

## Cycle plan

- **Cycle 1** — pure mechanical moves: relocate all files, update all import paths, no behavior changes, no decompositions. Gates green at end.
- **Cycle 2** — BLOCKER decompositions in their new homes: `features/pipelines/ui/PipelineDetailPage.tsx` → main page (<400L) + sibling files; `features/sources/ui/AddSourceModal.tsx` → main shell (<400L) + sibling files.

## Acceptance criteria

1. All 53 components moved into appropriate `features/<domain>/ui/` or `shared/`; no components remain in flat `components/` (except subfolders like `components/ui/` if kept under `shared/ui/`).
2. All 10 domain-specific hooks moved into `features/<domain>/hooks/`; only `reduxHooks` + `useRelativeTime` remain in `hooks/`.
3. All 7 domain-specific services moved into `features/<domain>/services/`; only `httpClient` remains in `services/`.
4. All domain-specific types moved into `features/<domain>/types/`; cross-cutting `models.ts` residue evaluated for retention vs deletion.
5. Tests + CSS sidecars travel with their target file.
6. All call sites updated; `npm run build` and `npm test` green.
7. After cycle 2: `PipelineDetailPage.tsx` and `AddSourceModal.tsx` both under 400L hard cap, decomposed into siblings within their feature folder.
8. `PanelCreationModal.tsx` stays over-cap (716L) — deliberate, CS4-scoped, document in evaluation report.
9. All gates pass: lint, format, jest, build, sbt test (unchanged), pre-commit hook, openspec validate.
10. No behavior changes — Playwright Phase 3 smoke confirms parity with main.

## Patterns inherited from CS2c-3c

- File-size BLOCKER triage: extract first, dispatch second
- Behavior-preserving structural refactor discipline ([[feedback-refactor-discipline]])
- No-inline-FQN pre-commit hook is the gate (backend unaffected by frontend moves)
- Atomic commits preferred — group moves by feature folder
- Playwright Phase 3 smoke as evaluator deliverable
- Drive-by extractions allowed when they're the only path under cap (CS2c-3c precedent — must be behavior-preserving)

## Out of scope (do NOT touch)

- `PanelCreationModal.tsx` decomposition — CS4
- Any behavior changes — pure structural refactor
- Backend, schemas, OpenSpec specs (non-change ones), HEL-242, HEL-256
- `useLegacyBoundPanel` removal — still pending pipeline/legacy unification (CS3-era spinoff but NOT this PR)
- `appearance.chart` → `ChartPanelConfig` migration — spinoff

## Process

- Worktree: `/home/matt/Development/helio/.worktrees/HEL-236-cs3`
- Branch: `task/frontend-feature-folders/HEL-236`
- Dev ports: 5410 (frontend), 8317 (backend)
- linear-executor + linear-evaluator at opus model
- Commits prefixed `HEL-236 CS3 cycle N: <summary>`
- File-size BLOCKER check: anything >400L after cycle 2 (except `PanelCreationModal`) is a hard fail
- STOP after evaluation passes; present PR and ask human before merging

## Escalation policy

If scope explodes in cycle 1 (e.g. import-path churn unmanageable, hidden circular dependencies), surface as ESCALATION. Likely split lines: by feature domain (cycle 1a = panels+pipelines, cycle 1b = remaining domains).
