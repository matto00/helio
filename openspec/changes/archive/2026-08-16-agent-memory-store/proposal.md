## Why

Beyond structured preferences (420-A, HEL-472), the in-app agent benefits from durable
free-form memory: learned facts and recurring goals ("this user's dashboards are about Netflix
content metrics", "they always want sentiment coloring"). This change adds a per-user
agent-memory store that is persisted and bounded (capped entry count with deterministic
eviction) so it can grow across sessions without becoming unbounded — a prerequisite the Data
Retention & Privacy epic (HEL-438) coordinates on. It is the free-form half of Agent Memory &
Preferences (HEL-420); the structured half is 420-A.

## What Changes

- Add `AgentMemoryId` (value class) and `AgentMemoryEntry(id, ownerId, kind, content, createdAt,
  lastUsedAt)` domain types. `kind` is a closed allow-list (`fact`/`goal`/`preference-note`) via
  a sealed-trait enum (mirroring `ScheduleKind`'s `fromString`/`asString` pattern), free-text
  `content`.
- Add Flyway migration V82 creating `agent_memory` with owner-only RLS (`ENABLE`+`FORCE`, policy
  on `owner_id`, mirroring `V42`/`V54`/`V81`), an index on `owner_id`, and a `created_at` index
  to support eviction ordering.
- Add `AgentMemoryRepository` (Slick) and `AgentMemoryService`: `add` enforces a constant
  per-user cap (100 entries) with oldest-`lastUsedAt`-then-`createdAt` eviction, evicting the
  least-recently-useful entry in the same transaction as the insert that would exceed the cap.
  `list`, `touch(id)`, `delete(id)`, `clear(user)` round out the CRUD surface.
- Add `GET/POST /api/agent/memory`, `DELETE /api/agent/memory/:id`, `DELETE /api/agent/memory`
  (clear all) on the authenticated route tree; a new per-domain
  `AgentMemoryProtocol.scala` (wire DTOs + formatters, mixed into `JsonProtocols` — never
  formatters added to the aggregator directly, per CONTRIBUTING.md); a JSON Schema under
  `schemas/`.

## Capabilities

### New Capabilities

- `agent-memory-persistence`: Flyway-backed `agent_memory` table (owner-only RLS, eviction
  indexes) + `AgentMemoryRepository` with cap-and-evict `add` semantics.
- `agent-memory-api`: `GET/POST /api/agent/memory`, `DELETE /api/agent/memory/:id`,
  `DELETE /api/agent/memory` routes, request/response formatting, and the `AgentMemoryService`
  add/list/touch/delete/clear surface.

### Modified Capabilities

(none — this is additive; no existing capability's requirements change)

## Impact

- Affected code: `backend/src/main/scala/com/helio/domain/model.scala`,
  `backend/src/main/scala/com/helio/infrastructure/` (new repository),
  `backend/src/main/scala/com/helio/services/` (new service),
  `backend/src/main/scala/com/helio/api/protocols/AgentMemoryProtocol.scala` (new),
  `backend/src/main/scala/com/helio/api/routes/` (new routes class),
  `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (mounts routes, mixes in protocol),
  `backend/src/main/scala/com/helio/app/Main.scala` (wiring),
  `backend/src/main/resources/db/migration/V82__agent_memory.sql`, `schemas/`.
- No frontend changes in this ticket (420-D management UI is a separate, downstream ticket).
- No interaction with 420-A's `AgentPreferences`/`agent_preferences` — a separate table and
  concern (structured defaults vs. free-form memory).
