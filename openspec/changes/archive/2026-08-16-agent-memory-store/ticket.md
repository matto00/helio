# HEL-478: Per-user agent memory store — persisted + bounded

## Description

Beyond structured preferences (420-A, HEL-472), the agent benefits from durable free-form memory: learned facts and recurring goals ("this user's dashboards are about Netflix content metrics", "they always want sentiment coloring"). This ticket adds a per-user agent-memory store that is PERSISTED and BOUNDED (capped entry count with deterministic eviction) so it can grow across sessions without becoming unbounded — a prerequisite the Data Retention & Privacy epic (HEL-438) coordinates on.

Mirror the owner-scoped resource pattern used by `ApiToken` (`model.scala`, `ApiTokenService`, `V42__api_tokens.sql` owner-only RLS).

## Scope

- Domain (`backend/src/main/scala/com/helio/domain/model.scala`): `AgentMemoryId(value: String) extends AnyVal` and `AgentMemoryEntry(id, ownerId: UserId, kind: String, content: String, createdAt: Instant, lastUsedAt: Option[Instant])`. `kind` allow-list: `fact|goal|preference-note` (free-text `content`).
- Persistence: Flyway migration (next available VNN, assigned at scheduling time — main at V59; do NOT hardcode) creating `agent_memory` (owner-only RLS per `V42`/`V54`), index on `owner_id`, and a created-at index to support eviction ordering.
- Repository + Service: `AgentMemoryRepository` (Slick) and `AgentMemoryService`. `add` enforces a per-user bound — a constant cap (e.g. 100 entries) with oldest-`lastUsedAt`-then-`createdAt` eviction so an insert past the cap deletes the least-recently-useful entry in the same transaction. Methods: `add`, `list`, `touch(id)` (updates `lastUsedAt`), `delete(id)`, `clear(user)`.
- Routes: `GET/POST /api/agent/memory`, `DELETE /api/agent/memory/:id`, `DELETE /api/agent/memory` (clear all); wire into `ApiRoutes.scala`; formatters in `JsonProtocols.scala`; JSON Schema under `schemas/`.
- No FQNs inlined.

## Acceptance criteria

- [ ] `agent_memory` table created via Flyway with owner-only RLS and the required indexes.
- [ ] `add` past the per-user cap evicts the least-recently-useful entry, keeping the total at the cap (proven by a ScalaTest).
- [ ] `list`/`delete`/`clear`/`touch` behave per spec and are RLS-isolated between users (ScalaTest).
- [ ] REST endpoints create/list/delete/clear memory for the authenticated user; JSON Schema added and validated.
- [ ] Additive; `sbt test` passes; no FQNs inlined.

## Out of scope

- Feeding memory into the agent authoring context (420-C).
- Management UI (420-D); privacy opt-out toggle + retention policy (420-E).
- Automatic memory EXTRACTION from conversations (that is authoring/refinement work, HEL-341/HEL-343) — this ticket provides the store + explicit write API only.

## Dependencies

- None to build. Relates to Data Retention & Privacy (HEL-438) for the retention bound. Downstream: 420-C/D/E.
