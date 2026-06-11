# HEL-267: Dev seed data drift — ProfitAgg pipeline fails 422 and panels can't bind to its output

## Description

Surfaced during HEL-242 evaluation. The dev DB has drifted from the seeded `DemoData` state, breaking the natural Playwright reproduction recipe for HEL-242 (and likely future Panel-System investigations).

## Symptoms

Two distinct issues observed against the local dev DB on 2026-05-17:

### 1. ProfitAgg pipeline fails 422 at run-submit

`POST /api/pipelines/<profitagg-id>/run` returns `422 Unprocessable Entity` with `"DataSource not found for join"`. Persists even after copying the missing CSV into the worktree's `backend/data/uploads/csv/`. Looks like a `DataSourceId` referenced by a join step in the seeded pipeline definition no longer resolves to an extant data_source row.

### 2. ProfitAgg's output DataType is owned by a different user

ProfitAgg writes to DataType `c1005183-...`. matt's user id is `9532cfcf-9882-45ba-8247-23706bc00113`. The DataType row's `owner_id` is not matt's. Result: any attempt to PATCH-bind one of matt's panels to that DataType gets immediately scrubbed back to `""` by `PanelService.resolveSingleBinding` on the next read, because `dataTypeRepo.findById(typeId, user.id)` returns `None` for matt.

## Why this matters

Blocks Playwright-based reproduction of any future P0/P1 bug investigation in the Panel ↔ DataType ↔ Pipeline surface. HEL-242 evaluation worked around this by surfacing the Redux store via React-fiber walk and dispatching actions directly — viable for a narrow reducer fix but not for surface bugs that require the natural UI flow (e.g. SSE timing, multi-panel render order, dashboard switching).

## Related (the broader data-hygiene gap)

Per HEL-242 cycle-1 design.md spinoff #1: there are **six pre-V15 legacy DataType rows in the dev DB with** `owner_id IS NULL`. NULL-owner DataTypes deterministically scrub bindings for every user (since `findById(typeId, ownerId)` filters by `ownerId === ownerUuid` and NULL fails that filter). Both the NULL-owner rows and the wrong-owner ProfitAgg output are facets of the same underlying issue: seeded/migrated data that doesn't match what the current ACL model expects.

## Investigation surface

* `backend/src/main/scala/com/helio/api/DemoData.scala` — what seeded ProfitAgg + its referenced DataSource + output DataType; does the seed re-bind ownership on user creation?
* `backend/src/main/resources/db/migration/V14__data_sources_owner.sql` and `V15__data_types_owner.sql` — the migrations that added `owner_id` columns; did they leave six pre-V15 rows as NULL?
* `backend/src/main/scala/com/helio/services/PipelineService.scala` — what raises the `DataSource not found for join` error
* The current state of matt's local dev DB (`select id, name, owner_id from data_types where owner_id is null;` and equivalent for `data_sources`)
* The PipelineStep config in the dev DB for the ProfitAgg pipeline (`select id, config from pipeline_steps where pipeline_id = '<profitagg-id>'`) — what data_source_id does the join step reference, does it exist?

## Acceptance Criteria

* ProfitAgg pipeline can be run end-to-end via the UI by matt with no 422
* matt can bind one of his panels to ProfitAgg's output DataType via the UI (no immediate scrub)
* The six NULL-owner DataType rows are either backfilled to matt or deleted (decision to make during investigation)
* `DemoData` seeding (or a one-shot dev-DB-repair script) keeps the seed consistent with the ACL model so this drift doesn't recur on the next schema change
* Document the dev-DB repair procedure in `backend/README.md` or equivalent so future contributors don't have to rediscover it

## Out of Scope

* Production data migration (this is dev-only)
* The asymmetric ACL on `GET /api/types/:id/rows` (HEL-242 cycle-1 spinoff #4)
* Adding ACL check to `PATCH /api/panels/:id` `updatePanelBinding` to surface a 400 instead of silent scrub

## Related Tickets

* HEL-242 — evaluator surfaced this drift during Phase 3 Playwright verification
* HEL-256 — different mechanism (prod-style schema disappearance after restart) but adjacent dev-hygiene domain
* HEL-261 — DemoData / inferred-type interaction audit; may share investigation surface
