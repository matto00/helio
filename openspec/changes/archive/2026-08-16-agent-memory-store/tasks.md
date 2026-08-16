## 1. ### Backend — domain + migration

- [x] 1.1 Add `AgentMemoryId(value: String) extends AnyVal` and `AgentMemoryEntry(id, ownerId:
      UserId, kind: AgentMemoryKind, content: String, createdAt: Instant,
      lastUsedAt: Option[Instant])` to `backend/src/main/scala/com/helio/domain/model.scala`.
- [x] 1.2 Add `AgentMemoryKind` sealed trait + companion object (`Fact`/`Goal`/
      `PreferenceNote`, `fromString`/`asString`) following the `ScheduleKind` pattern.
- [x] 1.3 Add Flyway migration `backend/src/main/resources/db/migration/V82__agent_memory.sql`
      creating `agent_memory` (`id UUID PRIMARY KEY`, `owner_id UUID NOT NULL REFERENCES
      users(id) ON DELETE CASCADE`, `kind TEXT NOT NULL`, `content TEXT NOT NULL`,
      `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `last_used_at TIMESTAMPTZ`) with
      owner-only RLS (`ENABLE`+`FORCE`, policy on `owner_id`), an index on `owner_id`, and a
      composite index on `(owner_id, created_at)`, per design.md Decision 2.

## 2. ### Backend — repository + service

- [x] 2.1 Add `AgentMemoryRepository` (Slick) in `backend/src/main/scala/com/helio/infrastructure/`
      with `add(entry): Future[AgentMemoryEntry]` (single transaction: insert, then evict the
      oldest-`last_used_at`-then-`created_at` entry if the owner's count exceeds 100, per
      design.md Decision 3), `list(user): Future[Seq[AgentMemoryEntry]]`,
      `touch(id, user): Future[Unit]` (no-op on unknown/cross-user id), `delete(id, user):
      Future[Boolean]`, `clear(user): Future[Int]` — all under `withUserContext`.
- [x] 2.2 Add `AgentMemoryService` in `backend/src/main/scala/com/helio/services/` delegating to
      the repository, validating `kind` via `AgentMemoryKind.fromString` before `add`, and
      rejecting blank `content` (mirroring `RequestValidation.validateCreateApiTokenRequest`'s
      blank-name rejection).
- [x] 2.4 `list` returns entries newest-first (`ORDER BY created_at DESC`), matching
      `ApiTokenRepository.list`'s explicit ordering convention.
- [x] 2.3 Wire `AgentMemoryRepository`/`AgentMemoryService` construction into
      `backend/src/main/scala/com/helio/app/Main.scala`.

## 3. ### Backend — routes + wire format

- [x] 3.1 Add `backend/src/main/scala/com/helio/api/protocols/AgentMemoryProtocol.scala`
      defining `AgentMemoryEntryResponse` and `CreateAgentMemoryRequest` wire DTOs (decoupled
      from the domain `AgentMemoryEntry` case class, with a `.fromDomain` converter), following
      `AgentPreferencesProtocol.scala`/`PipelineScheduleProtocol.scala`'s pattern — then mix
      `AgentMemoryProtocol` into `JsonProtocols`'s `extends` chain (CONTRIBUTING.md: "Don't add
      new formatters to the aggregator directly").
- [x] 3.2 Add `backend/src/main/scala/com/helio/api/routes/AgentMemoryRoutes.scala` with
      `GET/POST /api/agent/memory`, `DELETE /api/agent/memory/:id`, and
      `DELETE /api/agent/memory` (clear all — no id segment), following `ApiTokenRoutes.scala`'s
      structure.
- [x] 3.3 Mount `AgentMemoryRoutes` in `backend/src/main/scala/com/helio/api/ApiRoutes.scala` on
      the authenticated route tree, following the `agentPreferencesServiceOpt`/
      `AgentPreferencesRoutes` wiring pattern (nullable-optional-repo `.fold(reject)`).
- [x] 3.4 Add `schemas/agent-memory.schema.json` (JSON Schema 2020-12) with `title:
      "AgentMemoryEntryResponse"` (the wire DTO name, so `scripts/check-schema-drift.mjs` can
      resolve it), following `schemas/api-token.schema.json`'s conventions.

## 4. ### Tests

- [x] 4.1 Add an `AgentMemoryRepositorySpec` unit test covering: `add` under the cap does not
      evict; `add` past the cap (insert 101 entries) evicts exactly the least-recently-useful
      entry (oldest `last_used_at`, nulls-first, `created_at` tiebreak) and keeps the count at
      100; `touch` updates `last_used_at` and changes subsequent eviction order; `touch`/
      `delete` are no-ops/return-false for unknown or cross-user ids; `clear` removes all and
      returns the correct count.
- [x] 4.2 Add an `AgentMemoryServiceSpec` unit test covering `kind` validation (rejects a value
      outside `fact`/`goal`/`preference-note`) and blank-`content` rejection.
- [x] 4.3 Extend `backend/src/test/scala/com/helio/infrastructure/RlsOwnerTablesSpec.scala` with
      an `agent_memory` section (mirroring the `agent_preferences`/`image_uploads` sections):
      seed via `AgentMemoryRepository.add`, assert `withUserContext(ownerA)` cannot see, delete,
      or clear `ownerB`'s entries, and `withSystemContext` sees both.
- [x] 4.4 Add a route-level test for `GET/POST /api/agent/memory`,
      `DELETE /api/agent/memory/:id`, and `DELETE /api/agent/memory` (create-then-list
      round-trip, invalid-`kind` 400, delete-then-404-on-repeat, clear-then-empty-list, 401 when
      unauthenticated).
- [x] 4.5 Validate `schemas/agent-memory.schema.json` and run `sbt test`; confirm no FQNs are
      inlined per CONTRIBUTING.md.
