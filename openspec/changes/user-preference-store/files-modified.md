# Files modified — HEL-472 (user-preference-store)

## New files

- `backend/src/main/resources/db/migration/V81__agent_preferences.sql` — Flyway migration
  creating `agent_preferences` (`user_id UUID PRIMARY KEY`, `preferences JSONB`, `updated_at`)
  with owner-only RLS (`ENABLE`+`FORCE`, policy on `user_id`), mirroring V42/V54.
- `backend/src/main/scala/com/helio/infrastructure/AgentPreferencesRepository.scala` — Slick
  repository: `get(userId)`/`put(userId, prefs)` upsert-by-user, always under
  `withUserContext`; the four logical fields serialize into/out of the single `preferences`
  JSONB column at this boundary.
- `backend/src/main/scala/com/helio/services/AgentPreferencesService.scala` — business logic:
  `get` maps a missing row to `AgentPreferences.empty`, `put` builds the domain object from the
  authenticated caller's id + the request DTO (full replace, absent `extras` normalized to `{}`).
- `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala` — per-domain
  protocol trait: `AgentPreferencesResponse`/`PutAgentPreferencesRequest` wire DTOs (decoupled
  from the domain case class), `AgentPreferencesResponse.fromDomain`, and their Spray JSON
  formatters.
- `backend/src/main/scala/com/helio/api/routes/AgentPreferencesRoutes.scala` — thin HTTP shell
  for `GET`/`PUT /api/preferences`.
- `schemas/agent-preferences.schema.json` — JSON Schema (title `AgentPreferencesResponse`) for
  the GET/PUT response shape.
- `backend/src/test/scala/com/helio/infrastructure/AgentPreferencesRepositorySpec.scala` —
  repository unit tests: absent-row `get`, insert, full-replace-not-merge, empty round-trip.
- `backend/src/test/scala/com/helio/services/AgentPreferencesServiceSpec.scala` — service unit
  tests: get-returns-defaults-when-absent, userId always from the caller, `extras`
  absent-vs-explicit-`{}` normalization, full-replace-not-merge.
- `backend/src/test/scala/com/helio/api/routes/AgentPreferencesRoutesSpec.scala` — route-level
  tests: default-object GET, full round-trip PUT, full-replace-clears-omitted-field.

## Modified files

- `backend/src/main/scala/com/helio/domain/model.scala` — added the `AgentPreferences` domain
  case class (`userId`, `defaultSeriesColors`, `defaultPanelStyle`, `namingConventions`,
  `extras`) and its `empty(userId)` companion factory.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed `AgentPreferencesProtocol`
  into the aggregator's `extends` chain (no formatters added directly, per CONTRIBUTING.md).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added the nullable-optional
  `agentPreferencesRepo` constructor param, `agentPreferencesServiceOpt` wiring, and mounted
  `AgentPreferencesRoutes` on the authenticated route tree (`.fold(reject)`-gated, mirroring
  `metricServiceOpt`/`alertRuleServiceOpt`).
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `AgentPreferencesRepository`
  and passes it into `ApiRoutes`.
- `backend/src/test/scala/com/helio/infrastructure/RlsOwnerTablesSpec.scala` — added an
  `agent_preferences` RLS section (seeded via `AgentPreferencesRepository.put`, mirroring the
  `image_uploads` section): owner-scoped visibility, cross-user overwrite rejection, and
  `withSystemContext` sees-all.
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — added
  `agent_preferences` to the `rlsTables` allowlist (CONTRIBUTING.md's "Adding a new ACL'd
  table" checklist, step 3).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added 401-unauthenticated tests
  for `GET`/`PUT /api/preferences` in the composed-route-tree "Protected routes" section.
