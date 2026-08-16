## Why

The in-app agent (HEL-341) starts cold every session: it has no durable record of a user's
authoring defaults — preferred series colors, default panel styling, naming conventions. This
change introduces the persistent store the agent (and later the app UI, 420-D) reads to make
authoring feel consistent with what the user already likes. It is the structured,
schema-bounded half of Agent Memory & Preferences (HEL-420); free-form learned facts are the
separate agent-memory store (420-B, HEL-478).

## What Changes

- Add a new `AgentPreferences` domain case class keyed by `UserId`, holding
  `defaultSeriesColors: Option[Vector[String]]`, `defaultPanelStyle: Option[JsObject]`,
  `namingConventions: Option[JsObject]`, and `extras: JsObject`.
- Add Flyway migration V81 creating `agent_preferences` (`user_id UUID PRIMARY KEY`,
  `preferences JSONB NOT NULL DEFAULT '{}'`, `updated_at`), with owner-only RLS
  (`ENABLE`+`FORCE`, policy on `user_id`) mirroring the `V42`/`V54` pattern.
- Add `AgentPreferencesRepository` (Slick, upsert-by-user) and `AgentPreferencesService`
  (`get` returns defaults when absent, `put` does a full upsert-replace).
- Add `GET /api/preferences` and `PUT /api/preferences` on the authenticated route tree; wire
  into `ApiRoutes.scala`; wire DTOs (`AgentPreferencesResponse`, `PutAgentPreferencesRequest`)
  and their formatters in a new per-domain `AgentPreferencesProtocol.scala`, mixed into
  `JsonProtocols` (CONTRIBUTING.md: "Don't add new formatters to the aggregator directly" — see
  `ImageUploadProtocol.scala`/`PipelineScheduleProtocol.scala` for the precedent); a JSON Schema
  under `schemas/`.

**Naming note:** an existing, unrelated UI-theming feature already uses the name
`UserPreferences` (`com.helio.api.protocols.AuthProtocol`, aliased at
`com.helio.api.UserPreferences`) for accent-color/dashboard-zoom storage
(`UserPreferenceRepository`, `users.preferences` column, `PATCH /api/users/me/update`). This
change deliberately uses `AgentPreferences`/`AgentPreferencesRepository`/
`AgentPreferencesService`/`agent_preferences` instead of the ticket's literal
`UserPreferences`-prefixed names to avoid colliding with it (human-approved escalation
resolution, see `ticket.md`). The route path `GET/PUT /api/preferences` is unchanged from the
ticket — it does not collide with any existing route.

## Capabilities

### New Capabilities

- `agent-preferences-persistence`: Flyway-backed `agent_preferences` table (owner-only RLS) +
  `AgentPreferencesRepository` upsert-by-user persistence.
- `agent-preferences-api`: `GET/PUT /api/preferences` routes, request/response formatting, and
  the `AgentPreferencesService` get-with-defaults / put-full-replace semantics.

### Modified Capabilities

(none — this is additive; no existing capability's requirements change)

## Impact

- Affected code: `backend/src/main/scala/com/helio/domain/model.scala`,
  `backend/src/main/scala/com/helio/infrastructure/` (new repository),
  `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala` (new — wire
  DTOs + formatters), `backend/src/main/scala/com/helio/api/JsonProtocols.scala` (mixes in the
  new trait; no formatters added directly), `backend/src/main/scala/com/helio/api/ApiRoutes.scala`,
  `backend/src/main/scala/com/helio/app/Main.scala` (wiring),
  `backend/src/main/resources/db/migration/V81__agent_preferences.sql`, `schemas/`.
- No frontend changes in this ticket (420-D management UI is a separate, downstream ticket).
- No changes to the existing `UserPreferences`/`UserPreferenceRepository`/
  `users.preferences`/`user_dashboard_zoom` UI-theming feature — left untouched.
