# HEL-236 — Codebase refactor — modularity, DRY, and structural restructure

**Change Set 2a of 5** (CS1 backend protocols ✅ merged; CS2a backend routes ← this; CS2b backend engine; CS3 frontend structure; CS4 frontend decomposition)

## Linear ticket excerpt

> Goal: improve modularity, reduce duplication, and restructure both frontend and backend for long-term maintainability after the v1.3 feature spree. v1.3 added a lot of surface area quickly: 9 pipeline ops, analyze endpoint, run/SSE/dry-run/overwrite/last-run-stats, Type Registry rework, Spark integration scaffolding. Patterns are repeating across files and a few god-files have accumulated. A focused refactor pass before v1.4 will pay back in every subsequent ticket.

## CS2a scope (this change)

Five groups of route-layer work, all behavior-preserving:

| Group | What |
|---|---|
| A | Finish ID-wrapper rollout (`PathMatcher1[T]`) on 5 remaining route files |
| B | Dedup `DashboardRoutes` PATCH handler; clean up `validateSnapshotPayload`'s non-local `return`s |
| C | Flatten `PanelRoutes` PATCH handler (8-level nesting → `Either` chain) |
| D | Narrow `extends JsonProtocols` → per-domain protocol on 5 repository/directive files |
| E | (Conditional) Split route files that remain > 250 lines after A–D |

## Acceptance

- All 506 backend tests + frontend gates remain green
- Every route file ≤ 250 lines (`CONTRIBUTING.md` soft budget)
- No `extends JsonProtocols` in repositories or directives
- No `return` statements in `validateSnapshotPayload` (Either-chain idiomatic Scala)
- PanelRoutes PATCH has ≤ 4 levels of nesting in the validation chain
- `Option[Option[_]]` semantics for `typeId` / `fieldMapping` preserved exactly (absent vs. explicit null)

## Out of scope

- CS2b: `PipelineRunRoutes` run-lifecycle helpers, `InProcessPipelineEngine` decomposition, `DataSourceRepository.rowToDomain` alignment, inner-vs-left-join policy
- CS3/CS4: anything frontend
- New endpoints, new fields, renamed routes, wire-shape changes

## Standards binding

`CONTRIBUTING.md` is binding — especially *Imports & Qualifiers* (no inline FQNs) and the file-size soft budgets. Per the *AI Collaborators* section: structural refactors must be behavior-preserving; surface non-trivial findings as spinoff candidates rather than fixing inline.
