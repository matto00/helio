# Ticket Context — HEL-256

**Linear**: https://linear.app/helioapp/issue/HEL-256
**Title**: [P0] Data Source schema disappearance after server restart
**Priority**: Urgent (P0)
**Project**: Helio v1.3.1 — Polish & Hardening (parent epic HEL-241)

## The bug

A Data Source's inferred schema **sometimes** disappears after a backend restart. Likely scoped to CSV sources, but verify scope (could also affect static/SQL).

Lesson from HEL-242: "sometimes" often means "depends on user behavior" or "depends on session state", not a true race. Approach with empirical reproduction first.

## Pre-verified surface (orchestrator-relay's pre-investigation, post-HEL-236)

### Current architecture (post-CS2c-2)

- `DataSource` is a sealed-trait ADT (`backend/src/main/scala/com/helio/domain/DataSource.scala`) with 4 typed subtypes: `CsvSource`, `RestSource`, `SqlSource`, `StaticSource`
- `CsvSource.config = CsvSourceConfig(path: String)` — **no schema/fields on the DataSource itself**
- Schema lives in a separate `data_types` row: `data_types.source_id` → `data_sources.id` link; `data_types.fields` holds the inferred `DataField` vector
- `data_sources` Slick table columns (`DataSourceRepository.scala`): `id`, `name`, `source_type`, `config`, `created_at`, `updated_at`, `owner_id`

### Upload flow (verified at `DataSourceService.createCsv:88-134`)

1. Decode UTF-8 bytes (fail on non-UTF-8)
2. `SchemaInferenceEngine.fromCsv(csvContent)` — infer fields synchronously
3. Insert `CsvSource` into `data_sources`
4. Insert linked `DataType` with `fields = inferred.fields...` into `data_types`
5. Write CSV bytes to `FileSystem.write(filePath, bytes)`

**Schema IS persisted at upload time** (in `data_types` row). If it disappears after restart, the candidates are:
1. The DataType row didn't actually persist (silent write failure)
2. The DataType row is filtered out on read (ACL/ownership check on the DataType, NOT on the source)
3. Sources page UI doesn't display the persisted schema — it reads from elsewhere (e.g., re-inference)
4. The re-inference path runs at read time, depends on the CSV file being present, fails after restart (file moved, FileSystem root changed)
5. DB isn't actually persistent (in-memory H2 or similar misconfig — unlikely; `DATABASE_URL` is PostgreSQL)
6. ID drift across restart (regenerated on each boot — unlikely, but verify)

### Likely-irrelevant hypothesis from ticket: "DemoData shadows CSV sources"

**Refuted by pre-investigation**: `DemoData.seedIfEmpty` in `backend/src/main/scala/com/helio/app/DemoData.scala` only inserts dashboards + panels, and only when `dashboard count == 0`. Doesn't touch `data_sources` or `data_types`. Don't waste cycle-1 time re-confirming this.

## Acceptance criteria (from Linear)

1. Upload a CSV → restart backend → reload — schema is intact
2. Regression test exercises persistence-across-restart for CSV, static, and SQL source types
3. Root cause documented in commit message and (if cross-cutting) in `notes/`

## Cycle plan

- **Cycle 1 — Investigation only** (NO production code changes):
  - Trace the Sources page's schema display path end-to-end (UI → API → service → repo)
  - Identify whether the Sources page reads from persisted `data_types.fields` OR re-infers from the CSV file
  - Reproduce the bug via Playwright (upload a fresh CSV, verify schema visible, restart backend, reload, observe)
  - Verify the suspected mechanism with evidence
  - Write fix design with surface estimate
  - Deliver: `executor-report-1.md` with reproduction recipe + root cause + fix design
- **Cycle 2 — Fix + regression test** (only after cycle-1 design approved):
  - Implement fix per cycle-1 design
  - Add restart-persistence regression test for CSV (and ideally static + SQL)
  - Playwright verification
  - All gates green

## Patterns inherited

- Behavior-preserving fix discipline ([[feedback-refactor-discipline]])
- File-size budgets unchanged
- No-inline-FQN pre-commit hook
- Atomic commits per logical change
- Verify hypotheses empirically (HEL-242 lesson — the 5-day-old recorded hypothesis was wrong)

## Pre-existing data-hygiene caveats from HEL-242 / HEL-267

HEL-267 (Medium priority, just filed) flagged dev-DB drift issues including:
- ProfitAgg pipeline fails 422 at run-submit
- Six pre-V15 NULL-owner DataType rows in dev DB
- A DataType (`c1005183-...`) owned by a user other than matt

If HEL-256 cycle 1's reproduction recipe needs a clean DB state, the executor may need to upload a fresh CSV source as matt FIRST (don't rely on existing seed data). Be aware that any existing CSV sources in the dev DB might already be in a drift state and shouldn't be used for repro.

## Out of scope

- HEL-242 (just shipped)
- HEL-266 (cross-tab SSE design — separate ticket)
- HEL-267 (dev-DB drift cleanup — separate ticket)
- Refactoring DataSource/DataType ownership semantics beyond what the fix requires
- Frontend feature additions
- Backend ADT/protocol changes (HEL-236 chain just settled)

## Process

- Worktree: `/home/matt/Development/helio/.worktrees/HEL-256`
- Branch: `bug/datasource-schema-restart/HEL-256`
- Dev ports: 5413 (frontend), 8320 (backend)
- linear-executor + linear-evaluator at opus model
- Commits prefixed `HEL-256 [cycle N]: <summary>`
- STOP after evaluation passes; present PR and ask human before merging

## Escalation policy

If cycle 1 cannot reproduce the bug:
- Document what was tried (CSV files used, restart commands, browser state, accounts)
- Surface as BLOCKER with reproduction-attempt findings
- The orchestrator-relay decides: more investigation, request user's repro steps, accept as not-reproducible
