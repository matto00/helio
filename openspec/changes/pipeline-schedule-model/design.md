## Context

Pipelines run manually only. This ticket adds durable schedule storage + CRUD; HEL-415 (sibling,
strictly after this merges) will poll `pipeline_schedules` and fire runs through
`PipelineRunService`, which already triggers `AlertEvaluationService` on success (HEL-466) — so
scheduled runs get alert evaluation for free once 415 lands. Nothing here talks to
`PipelineRunService`.

Closest existing analog: the HEL-447/455/466 alert chain — `AlertRuleRepository`/`Service`/
`Routes`/`AlertRuleProtocol` is the direct pattern to mirror for repository/service/route/protocol
shape. The RLS shape differs: alert_rules is direct-owner (has its own `owner_id`); a schedule is
a 1:1 child of a pipeline, so it follows `pipeline_steps`/`pipeline_runs`'s **indirect-owner** V35
pattern instead (no `owner_id` column; RLS joins to `pipelines.owner_id`).

Verified at scheduling time: main is at 0969fa66, latest migration on disk is `V61__alert_events.sql`
→ next available is **V62**.

## Goals / Non-Goals

**Goals:**
- Durable, owner-scoped (via parent pipeline) schedule storage: one schedule per pipeline.
- `GET/PUT/DELETE /api/pipelines/:id/schedule`; `PUT` upserts (a pipeline has 0 or 1 schedules,
  so create/replace collapse into one idempotent verb — avoids a separate POST-then-404-on-PATCH
  dance the sibling config-UI ticket would otherwise have to handle).
- Structural validation of `kind`/`expression`/`timezone` at write time, rejecting malformed
  input with a clear 400.
- Schema contract (`schemas/`, `openspec/specs/`) for the shape above.

**Non-Goals:**
- Computing/maintaining `next_run_at` from a cron expression. This ticket persists `next_run_at`
  as a nullable, service-writable column but never populates it — that requires real next-fire-time
  semantics (timezone-aware, DST-aware) that only make sense next to the poller that consumes them.
  Owned entirely by HEL-415. Avoids duplicating (and re-testing) that logic here, and avoids
  introducing a cron-math dependency for a ticket explicitly scoped to "no runtime."
- Firing runs, scheduler polling loop, config UI, run provenance — all sibling tickets.

## Decisions

**1. Dedicated `pipeline_schedules` table, not columns on `pipelines`.** Ticket's own preference;
also matches the existing pattern of narrow child tables (`pipeline_steps`, `pipeline_runs`)
rather than widening the pipelines row for a feature most pipelines won't use.

**2. Indirect-owner RLS (V35 pattern), not a copied `owner_id`.** `pipeline_schedules.pipeline_id`
already determines ownership transitively; adding a redundant `owner_id` risks the two falling out
of sync (e.g. after a pipeline-ownership transfer, which doesn't exist today but shouldn't be
foreclosed). Mirrors `pipeline_steps_owner`/`pipeline_runs_owner` exactly: `FORCE ROW LEVEL
SECURITY` + `EXISTS` subquery against `pipelines.owner_id`.

**3. `pipeline_id UNIQUE` (1:1), not a schedule id surfaced to callers.** The route is
`/api/pipelines/:id/schedule` (singleton), not `/api/schedules/:id` — no client ever needs a
schedule id independent of its pipeline. The table still gets a synthetic `id TEXT PRIMARY KEY`
(consistent with every other table's id-as-PK convention) but repository lookups key on
`pipeline_id`.

**4. `PUT` is create-or-replace (upsert), no separate `POST`.** Ticket text says
`GET/PUT/DELETE`. Repository `upsert` does `INSERT ... ON CONFLICT (pipeline_id) DO UPDATE`
inside `withUserContext`, backstopped by an app-layer ownership check on the parent pipeline
(mirrors `AlertRuleService.create`'s not-found-or-not-owned check against `dataTypeRepo`, here
against `pipelineRepo.findByIdOwned`).

**5. Cron/interval validation is structural, hand-rolled — no new library.** `kind = "cron"`:
validate a standard 5-field expression (minute hour day-of-month month day-of-week) — each field
non-empty and matching `*`, a number in range, a comma-list, a `-` range, or a `/` step, with
per-field bounds (0-59, 0-23, 1-31, 1-12, 0-6). `kind = "interval"`: validate a `<n><unit>` token
(`s`/`m`/`h`/`d`) with `n > 0`. `timezone`: validate via `java.time.ZoneId.of(_)` (already on the
classpath, zero new dependency) catching `DateTimeException`. This is deliberately shallow — it
catches malformed input, not semantic nonsense like `31` for February — matching the ticket's
literal AC ("invalid...expressions are rejected") without building real cron math this ticket has
no runtime to exercise.

**6. `enabled` defaults to `true` on create**, mirroring `AlertRuleService.create`'s
`req.enabled.getOrElse(true)` — the "absent optional fields normalize at the boundary" pattern
already established for spray-json (`Option` → omitted key on the wire).

## Risks / Trade-offs

- [Risk] Structural cron validation accepts syntactically-valid-but-semantically-empty crons
  (e.g. `31 * * * *`, a day-of-month that occurs 7x/year) → Mitigation: HEL-415's actual next-fire
  computation is the real gate; this ticket's validation is a write-time UX guard, not a
  correctness guarantee, and the design explicitly non-goals next-fire computation.
- [Risk] Upsert-via-`PUT` diverges from the alert-rule chain's POST/PATCH split → Mitigation:
  intentional (Decision 4); documented so HEL-416 (config UI) doesn't reinvent a POST.

## Planner Notes

- Self-approved: no new external dependency (cron validation is hand-rolled regex/range checks,
  timezone validation uses `java.time.ZoneId` already on the classpath) — stays inside
  self-approvable planning decisions.
- Self-approved: `next_run_at` persisted-but-unpopulated by this ticket (Non-Goals) — reads as the
  correct scope boundary given the ticket's own "no runtime" framing and out-of-scope list.
