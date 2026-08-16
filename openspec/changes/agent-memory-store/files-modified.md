# Files modified — HEL-478 agent-memory-store

- `backend/src/main/scala/com/helio/domain/model.scala` — adds `AgentMemoryId`,
  `AgentMemoryEntry`, and the `AgentMemoryKind` sealed trait (`Fact`/`Goal`/`PreferenceNote`,
  `fromString`/`asString`, mirroring `ScheduleKind`).
- `backend/src/main/resources/db/migration/V82__agent_memory.sql` — new `agent_memory` table
  (multi-row-per-owner, mirrors `api_tokens`), owner-only RLS (`ENABLE`+`FORCE`), `idx_agent_memory_owner_id`,
  and composite `idx_agent_memory_owner_created` to support the eviction query's ordering.
- `backend/src/main/scala/com/helio/infrastructure/AgentMemoryRepository.scala` — new Slick
  repository: `add` (single-transaction cap-and-evict, oldest-`last_used_at`-then-`created_at`,
  NULLS FIRST), `list` (newest-first), `touch`, `delete`, `clear` — all under `withUserContext`.
  Cycle-2 fix (evaluator CR1): `evictIfOverCap` now excludes the just-inserted row's own id from
  the eviction candidate query, so it can never evict the entry `add` just created.
- `backend/src/main/scala/com/helio/services/AgentMemoryService.scala` — new service: `kind`
  validation via `AgentMemoryKind.fromString`, blank-`content` rejection, delegates CRUD to the
  repository.
- `backend/src/main/scala/com/helio/api/protocols/AgentMemoryProtocol.scala` — new per-domain
  protocol trait: `AgentMemoryEntryResponse`/`CreateAgentMemoryRequest` wire DTOs + formatters.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes `AgentMemoryProtocol` into
  the aggregator's `extends` chain.
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — adds
  `AgentMemoryIdSegment` path matcher.
- `backend/src/main/scala/com/helio/api/routes/AgentMemoryRoutes.scala` — new routes class:
  `GET/POST /api/agent/memory`, `DELETE /api/agent/memory/:id`, `DELETE /api/agent/memory`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `agentMemoryRepo` (nullable
  optional, `agentMemoryServiceOpt.fold(reject)` pattern) and mounts `AgentMemoryRoutes` on the
  authenticated route tree.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `AgentMemoryRepository` and
  passes it into `ApiRoutes`.
- `schemas/agent-memory.schema.json` — new JSON Schema (`title: "AgentMemoryEntryResponse"`).
- `backend/src/test/scala/com/helio/infrastructure/AgentMemoryRepositorySpec.scala` — new spec:
  cap-and-evict mechanics (insert-under-cap, insert-past-cap with 101 entries), `touch`'s effect
  on eviction order, `touch`/`delete` no-op-on-unknown/cross-user-id, `clear`. Cycle-2 addition
  (evaluator CR1 regression test): seed the cap with all-`touch`ed (non-null `last_used_at`)
  entries, then `add` one more untouched entry, and assert the new entry survives while an
  existing entry was evicted — fails before the `evictIfOverCap` fix, passes after.
- `backend/src/test/scala/com/helio/services/AgentMemoryServiceSpec.scala` — new spec: `kind`
  allow-list validation, blank/whitespace-only `content` rejection, content trimming.
- `backend/src/test/scala/com/helio/infrastructure/RlsOwnerTablesSpec.scala` — adds an
  `agent_memory` RLS section (seeded via the real repository), proving owner-isolation for
  read/delete/clear and full visibility under `withSystemContext`.
- `backend/src/test/scala/com/helio/api/routes/AgentMemoryRoutesSpec.scala` — new spec:
  create-then-list round-trip (newest-first), invalid-`kind`/blank-`content` 400,
  delete-then-404-on-repeat, clear-then-empty-list.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — adds composed-route-tree 401
  coverage for all four `/api/agent/memory` endpoints (mirrors the `/api/preferences` split:
  functional CRUD in the isolated spec, 401-without-auth here).
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — cycle-2 fix
  (evaluator CR2): adds `"agent_memory"` to the `rlsTables` allowlist per CONTRIBUTING.md's
  "Adding a new ACL'd table" checklist, so the mechanical `relrowsecurity`/`relforcerowsecurity`/
  `pg_policies` guard covers V82's table.
