## Context

HEL-472 (420-A) is the foundational ticket of the Agent Memory & Preferences epic (HEL-420):
a per-user, schema-bounded store the in-app agent reads for authoring defaults (series colors,
panel style, naming conventions). Downstream tickets depend on this shape: 420-C (HEL-521) feeds
it into agent-authoring context, 420-D (HEL-525) builds a management UI over it.

An unrelated, pre-existing feature already occupies the literal name the ticket requested —
see "Planner Notes" below for the resolution.

Existing owner-scoped resources to mirror: `ApiToken` (`model.scala`), `ApiTokenService`/
`ApiTokenRoutes`, and the owner-only RLS migrations `V42__api_tokens.sql`/
`V54__image_uploads.sql`. `RlsOwnerTablesSpec` (`backend/src/test/scala/com/helio/infrastructure/`)
is the canonical pattern for an owner-isolation ScalaTest: EmbeddedPostgres + a non-superuser
`helio_app_test` role so RLS is genuinely evaluated (not bypassed like the default superuser
connection), asserting `withUserContext(ownerA)` excludes `withUserContext(ownerB)`'s rows and
`withSystemContext` (BYPASSRLS) sees everything.

## Goals / Non-Goals

**Goals:**
- Durable, owner-isolated storage for a small set of typed, additive-friendly authoring-default
  fields, with a JSONB `extras` escape hatch for forward-compat.
- `GET`/`PUT /api/preferences` returning sensible defaults when nothing is stored yet.
- Prove RLS isolation with a real (non-bypassed) ScalaTest, following the `RlsOwnerTablesSpec`
  pattern.

**Non-Goals:**
- Feeding preferences into the agent's authoring context (420-C / HEL-521).
- A management UI (420-D / HEL-525) or privacy/retention controls (420-E / HEL-531).
- The free-form agent-memory store (420-B / HEL-478) — this ticket is the structured,
  schema-bounded half only.
- Touching the existing, unrelated UI-theming preferences feature in any way.

## Decisions

**Decision 1 — table shape: one row per user, JSONB blob, not one column per field.**
`agent_preferences (user_id UUID PRIMARY KEY, preferences JSONB NOT NULL DEFAULT '{}', updated_at
TIMESTAMPTZ NOT NULL DEFAULT now())`. The four logical fields (`defaultSeriesColors`,
`defaultPanelStyle`, `namingConventions`, `extras`) are serialized into the single `preferences`
JSONB column at the repository boundary, mirroring how `UserPreferenceRepository` already stores
`accentColor` inside the `users.preferences` TEXT column (JSON-string-encoded) rather than as
separate typed columns. Alternative considered: one column per field — rejected because it
doesn't accommodate the `extras` forward-compat escape hatch the ticket explicitly calls for, and
every future field addition would need its own migration.

**Decision 2 — RLS: owner-only, `ENABLE`+`FORCE`, single policy on `user_id` (V42/V54 pattern).**
```sql
ALTER TABLE agent_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_preferences_owner ON agent_preferences
  USING (user_id = current_setting('app.current_user_id')::uuid);
```
No separate `WITH CHECK` — as in `V42`/`V54`, the `USING` expression alone also gates `INSERT`,
so a user cannot write a row for another `user_id`. `FORCE` closes the fail-open gap for any
future privileged-pool-bypassing code path added by mistake.

**Decision 3 — repository: `INSERT ... ON CONFLICT (user_id) DO UPDATE` upsert, not
read-then-write.** `AgentPreferencesRepository.put` does a single upsert statement under
`withUserContext(userId)` (never `withSystemContext` — the caller's own RLS context is always
the write context, exactly like `ImageUploadRepository.insert`). `get` returns `Option`, and
`AgentPreferencesService.get` maps `None` to an all-`None`/empty-`extras` default `AgentPreferences`
so callers (routes, later the agent context in 420-C) never have to branch on absence.

**Decision 4 — `put` is a full replace, not a merge.** Matches the ticket's stated semantics
("full replace") and `ApiTokenService`'s precedent of small, fully-specified request bodies. The
frontend/caller is responsible for round-tripping unmodified fields it doesn't intend to change.
`extras` is caller-owned and replaced wholesale on every `put`, including a missing/absent
`extras` key in the request body, which is treated identically to an explicit `{}` (clears any
previously-stored `extras`) — never merged field-by-field with the prior stored value.

**Decision 4a — `updated_at` is repository-internal, not part of the domain/wire shape.**
`AgentPreferences` (domain case class) and its wire DTO carry only the four content fields;
`updated_at` exists solely as a DB-side audit/ordering column the repository sets via
`now()` on every upsert and never reads back into the domain type. This differs from
`ApiToken`/`ImageUploadResponse`, which surface their timestamp fields because those are
user-facing (e.g. "token created on..."); `agent_preferences.updated_at` has no such consumer
in this ticket's scope (agent authoring, not human-visible audit trail) — a later ticket can add
it to the domain/wire shape if a concrete consumer needs it.

**Decision 5 — RLS isolation test: extend `RlsOwnerTablesSpec`, not a new spec file.** The
ticket's acceptance criteria call for "a ScalaTest" proving A-cannot-read/overwrite-B isolation.
`RlsOwnerTablesSpec` already stands up the non-superuser `helio_app_test` role + embedded
Postgres + Flyway migration harness this needs; adding an `agent_preferences` section there
(mirroring the existing `image_uploads` section, seeding via the real repository's `put`, not
raw SQL) reuses that harness rather than duplicating it. Also add an
`AgentPreferencesRepository`/`Service`-level unit test for the get-returns-defaults/put-full-replace
contract itself (not RLS) alongside the other `infrastructure`/`api` test suites.

## Planner Notes

**Naming collision, self-approved via escalation (see `ticket.md` "Escalation Resolution").**
The ticket's literal names (`UserPreferences`/`UserPreferencesRepository`/
`UserPreferencesService`/table `user_preferences`) collide with an existing, unrelated
UI-theming feature (`UserPreferences` in `com.helio.api.protocols.AuthProtocol`, aliased at
`com.helio.api.UserPreferences`; `UserPreferenceRepository` singular; `users.preferences` TEXT
column + `user_dashboard_zoom`; `PATCH /api/users/me/update`) — unrelated to agent authoring,
not mentioned in HEL-472 or epic HEL-420. Escalated to the human; resolved **rename-new**: this
change uses `AgentPreferences`/`AgentPreferencesRepository`/`AgentPreferencesService`/table
`agent_preferences` instead. Route path `GET/PUT /api/preferences` is unchanged (no literal
collision there). The existing UI-theming feature is left completely untouched.

**Migration number.** Main's migration directory currently ends at `V80__assistant_conversations
.sql` (checked directly at Planning time, not the ticket's stale "V59" note from epic-creation
time) — this change's migration is `V81__agent_preferences.sql`.

## Risks / Trade-offs

- [Risk] A future engineer searching for "user preferences" finds two, differently-named stores
  (`AgentPreferences` for agent authoring, the existing `UserPreferences` for UI theming) and
  has to learn the distinction. → Mitigation: the naming split is deliberate and documented here
  and in `proposal.md`; the two concerns genuinely are different consumers (agent context vs.
  app-shell theming) and don't share a data model.
- [Risk] JSONB blob storage means no DB-level schema enforcement on `defaultPanelStyle`/
  `namingConventions` shape. → Mitigation: JSON Schema under `schemas/` validates the wire
  contract; malformed `JsObject` shapes are still valid JSONB (accepted at the DB layer) but
  rejected at the API layer by `RequestValidation`/route-level parsing before ever reaching the
  repository.
