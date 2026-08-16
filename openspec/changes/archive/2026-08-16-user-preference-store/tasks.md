## 1. ### Backend — domain + migration

- [x] 1.1 Add `AgentPreferences` case class to `backend/src/main/scala/com/helio/domain/model.scala`
      (`userId: UserId`, `defaultSeriesColors: Option[Vector[String]]`,
      `defaultPanelStyle: Option[JsObject]`, `namingConventions: Option[JsObject]`,
      `extras: JsObject`).
- [x] 1.2 Add Flyway migration `backend/src/main/resources/db/migration/V81__agent_preferences.sql`
      creating `agent_preferences` (`user_id UUID PRIMARY KEY`,
      `preferences JSONB NOT NULL DEFAULT '{}'`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`)
      with owner-only RLS (`ENABLE`+`FORCE`, policy on `user_id`), per design.md Decision 2.

## 2. ### Backend — repository + service

- [x] 2.1 Add `AgentPreferencesRepository` (Slick) in `backend/src/main/scala/com/helio/infrastructure/`
      with `get(userId): Future[Option[AgentPreferences]]` and
      `put(userId, prefs): Future[AgentPreferences]` (upsert via
      `INSERT ... ON CONFLICT (user_id) DO UPDATE`, always under `withUserContext(userId)`).
- [x] 2.2 Add `AgentPreferencesService` with `get(user): Future[AgentPreferences]` (maps
      repository `None` to an all-empty default) and `put(user, prefs): Future[AgentPreferences]`
      (full replace, delegates to the repository).
- [x] 2.3 Wire `AgentPreferencesRepository`/`AgentPreferencesService` construction into
      `backend/src/main/scala/com/helio/app/Main.scala`.

## 3. ### Backend — routes + wire format

- [x] 3.1 Add `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala`
      defining `AgentPreferencesResponse` (GET/PUT response) and `PutAgentPreferencesRequest`
      (PUT request body) — distinct wire DTOs decoupled from the domain `AgentPreferences` case
      class, with an `AgentPreferencesResponse.fromDomain` converter, following the
      `PipelineScheduleProtocol.scala`/`ImageUploadProtocol.scala` pattern (per-domain protocol
      trait — CONTRIBUTING.md: "Don't add new formatters to the aggregator directly") — then mix
      `AgentPreferencesProtocol` into `JsonProtocols`'s `extends` chain.
- [x] 3.2 Add `GET /api/preferences` and `PUT /api/preferences` to
      `backend/src/main/scala/com/helio/api/ApiRoutes.scala` on the authenticated route tree,
      delegating to `AgentPreferencesService`.
- [x] 3.3 Add `schemas/agent-preferences.schema.json` (JSON Schema 2020-12) with `title:
      "AgentPreferencesResponse"` (the wire DTO name, so `scripts/check-schema-drift.mjs` can
      resolve it against `AgentPreferencesProtocol.scala`), following
      `schemas/api-token.schema.json`'s conventions.

## 4. ### Tests

- [x] 4.1 Add an `AgentPreferencesRepository`/`AgentPreferencesService` unit test covering
      get-returns-defaults-when-absent and put-is-a-full-replace (not a merge).
- [x] 4.2 Extend `backend/src/test/scala/com/helio/infrastructure/RlsOwnerTablesSpec.scala` with
      an `agent_preferences` section (mirroring the existing `image_uploads` section): seed via
      `AgentPreferencesRepository.put`, assert `withUserContext(ownerA)` cannot see or overwrite
      `ownerB`'s row, and `withSystemContext` sees both.
- [x] 4.3 Add a route-level test for `GET`/`PUT /api/preferences` (default-object response when
      unset, round-trip of `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions`/`extras`,
      401 when unauthenticated).
- [x] 4.4 Validate `schemas/agent-preferences.schema.json` and run `sbt test`; confirm no FQNs
      are inlined per CONTRIBUTING.md.
