# HEL-472: User preference store — model, persistence, CRUD

## Description

The in-app agent (HEL-341) starts cold every session: it has no durable record of a user's defaults — preferred series colors, default panel styling, naming conventions. This ticket introduces the persistent USER PREFERENCE STORE that the agent (and later the app UI) reads to make authoring feel consistent with what the user already likes. It is the structured, schema-bounded half of Agent Memory & Preferences (HEL-420); free-form learned facts are the separate agent-memory store (420-B).

Existing owner-scoped resources to mirror: `ApiToken` (`model.scala`), `ApiTokenService`/`ApiTokenRoutes`, and the owner-only RLS migrations (`V42__api_tokens.sql`, `V54__image_uploads.sql`).

## Scope

- Domain (`backend/src/main/scala/com/helio/domain/model.scala`): `UserPreferences` case class keyed by `UserId`, holding a small set of typed, additive-friendly fields stored as JSONB: `defaultSeriesColors: Option[Vector[String]]`, `defaultPanelStyle: Option[JsObject]` (background/color/transparency defaults mirroring `PanelAppearance`), `namingConventions: Option[JsObject]` (e.g. dashboard/panel title casing), and a generic `extras: JsObject` escape hatch for forward-compat.
- Persistence: Flyway migration (next available VNN, assigned at scheduling time — main at V59; do NOT hardcode) creating `user_preferences` (`user_id UUID PRIMARY KEY`, `preferences JSONB NOT NULL DEFAULT '{}'`, `updated_at`), owner-only RLS following the `V42`/`V54` pattern (`ENABLE`+`FORCE`, policy on `user_id`).
- Repository + Service: `UserPreferencesRepository` (Slick, upsert-by-user) and `UserPreferencesService` with `get(user)` (returns defaults when absent) and `put(user, prefs)` (full replace).
- Routes: `GET /api/preferences` and `PUT /api/preferences` on the authenticated tree; wire into `ApiRoutes.scala`; formatters in `JsonProtocols.scala`; a JSON Schema under `schemas/` for the request/response.
- No FQNs inlined in Scala.

## Acceptance criteria

- [ ] `user_preferences` table created via Flyway with owner-only RLS; one row per user (PK on `user_id`).
- [ ] `GET /api/preferences` returns the caller's preferences (an empty/default object when none stored); `PUT /api/preferences` upserts and returns the persisted object.
- [ ] RLS isolation proven by a ScalaTest: user A cannot read or overwrite user B's preferences.
- [ ] Round-trip preserves `defaultSeriesColors`, `defaultPanelStyle`, `namingConventions`, and `extras`.
- [ ] JSON Schema added and validated; `sbt test` passes; no FQNs inlined.

## Out of scope

- Feeding preferences into the agent context (420-C).
- Management UI (420-D) and privacy/opt-out (420-E).
- The free-form agent-memory store (420-B).

## Dependencies

- None — foundational. Downstream: 420-C/D.

## Escalation Resolution (Planning, 2026-08-15)

The ticket's literal naming (`UserPreferences` case class / `UserPreferencesRepository` /
`UserPreferencesService` / table `user_preferences`) collides with an existing, unrelated
UI-theming feature already in the codebase: `UserPreferences` case class in
`com.helio.api.protocols.AuthProtocol` (aliased at `com.helio.api.UserPreferences` via
`package.scala`), `UserPreferenceRepository` (singular), a `users.preferences` TEXT column +
`user_dashboard_zoom` table, and `PATCH /api/users/me/update` — all for accent-color/zoom-level
UI preferences, unrelated to agent-authoring defaults and not mentioned in HEL-472 or epic
HEL-420.

**Resolved (human decision, rename-new):** this ticket's new store uses distinct names to avoid
any collision with the legacy UI-theming feature, since these are legitimately distinct
concepts:

- Domain case class: `AgentPreferences` (not `UserPreferences`)
- Repository: `AgentPreferencesRepository` (not `UserPreferencesRepository`)
- Service: `AgentPreferencesService` (not `UserPreferencesService`)
- Table: `agent_preferences` (not `user_preferences`)
- Route path: **unchanged** — `GET/PUT /api/preferences` per the ticket (no literal collision
  with any existing route).

Every other detail of the ticket's Scope section (fields, RLS pattern, get-returns-defaults/
put-full-replace semantics, JSON Schema, no-FQN discipline) is unchanged — only the identifiers
above are renamed.
