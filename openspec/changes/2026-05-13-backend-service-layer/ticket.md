# HEL-236 — Codebase refactor — modularity, DRY, and structural restructure

**Change Set 2b of 6** (CS1 ✅ merged; CS2a ✅ merged; **CS2b service layer ← this**; CS2c domain ADTs + engine; CS3 frontend structure; CS4 frontend decomposition)

## CS2b scope (this change)

**Layered architecture move.** Extract business logic from routes into a dedicated `services/` package. Routes become thin HTTP adapters; services are plain Scala classes — no Pekko HTTP types, no implicits, testable in isolation.

This is the **first of two architectural moves** in HEL-236:
- **CS2b (this PR)** — service-layer extraction; wire shapes unchanged
- **CS2c (next)** — domain ADT remodel (Panel + DataSource sealed traits) + wire shape evolves alongside

The split-by-concern means CS2c's polymorphic dispatch lands naturally on top of the service layer instead of trying to add it to fat routes.

## Acceptance

- Every route file ≤ 150 lines (except `PipelineRunRoutes` deferred to CS2c)
- No Pekko HTTP types in any file under `services/`
- No business logic remains in routes — they're HTTP adapters only
- All 511 backend tests + frontend gates remain green
- Wire shape byte-identical (CS2c is when it evolves)
- `PanelPatchService.scala` deleted; its logic absorbed into `PanelService`
- `PublicDashboardRoutes.resolvePanels` → `PanelService.resolveBindingsForRead` (CS2a spinoff closed)

## Out of scope

- Domain ADTs (CS2c — Panel + DataSource sealed traits)
- Wire shape evolution (CS2c)
- `PipelineRunRoutes` decomp + `InProcessPipelineEngine` split (CS2c)
- `DataSourceRepository.rowToDomain` alignment + join policy (CS2c)
- HEL-242 P0 — deferred until CS2c
- HEL-256 P0 — parallel side-PR off main, not in CS2b

## Standards binding

`CONTRIBUTING.md` is binding. Imports & Qualifiers rule + file-size budgets. Refactor discipline: behavior-preserving; trivial bugs fix inline, non-trivial bugs become spinoff candidates. The *AI Collaborators* section spells out the agent-specific rules.

**Security-critical surgery: AuthService.** Cookie attributes, password hashing algorithm + work factor, token expiry, CSRF state — all must be byte-identical before/after. The evaluator will audit this specifically.
