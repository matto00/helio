## Files Modified

- `backend/src/main/resources/db/migration/V80__assistant_conversations.sql` — new migration: the
  `assistant_conversations` metadata table, its two indexes, and RLS (mirrors V77's owner-direct
  shape exactly, per design.md D1).
- `backend/src/main/scala/com/helio/domain/model.scala` — adds the `AssistantConversationId`
  value-class ID (mirrors `AuthoringConversationId`/`PatchSetApplicationId`'s existing precedent).
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — adds
  `AssistantConversationIdSegment`, the route-boundary `PathMatcher1` for the new ID.
- `backend/src/main/scala/com/helio/infrastructure/AssistantConversationRepository.scala` — new:
  owner-scoped Slick repository (`create`/`findById`/`findAll`/`updatePinned`/`updateTitle`/
  `touchUpdatedAt`), plus the hand-written, repository-internal `ClaudeContentBlock`/
  `ClaudeToolMessage` spray-json formatters (design.md D3). `updateTitle` is an addition beyond
  tasks.md 3.1's literal method list, required to satisfy the PATCH rename behavior tasks.md
  5.1/5.2 and design.md D6 explicitly specify.
- `backend/src/main/scala/com/helio/services/AssistantConversationService.scala` — new: composes
  the repository with `FileSystem` (write-then-record ordering, design.md D2); `create`/
  `appendTurn`/`get`/`list`/`setPinned`/`rename`/`update` (the last two are additions beyond
  tasks.md 4.1-4.6's literal list, needed for `PATCH /:id`'s documented rename capability); title
  derivation (`resolveTitle`) implementing design.md D6's full resolution including both
  design-gate round-1 fixes (both `title`/`firstMessage` absent, and `firstMessage` present but
  text-less).
- `backend/src/main/scala/com/helio/api/protocols/AssistantConversationProtocol.scala` — new: wire
  request/response types (`CreateAssistantConversationRequest`, `AppendAssistantConversationTurnRequest`,
  `UpdateAssistantConversationRequest`, `AssistantConversationSummaryResponse`,
  `AssistantConversationResponse`). Transcript fields are raw `JsValue` — the repository-internal
  `ClaudeToolMessage` formatter is never imported here (design.md D3).
- `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala` — new: thin
  HTTP shell for `/api/assistant-conversations` (mirrors `MetricRoutes`). List's default `limit`
  is the route-local constant `10` (NOT `Page.Default.limit`, design.md D5's round-1 fix), clamped
  to `Page.MaxLimit`.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in
  `AssistantConversationProtocol`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `assistantConversationServiceOpt`
  (nullable-optional, gated on the existing `dbContext` param — no new constructor parameter
  needed) and mounts `AssistantConversationRoutes`.
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — adds
  `assistant_conversations` to the `rlsTables` allowlist (CONTRIBUTING's "Adding a new ACL'd
  table" checklist).
- `backend/src/test/scala/com/helio/infrastructure/AssistantConversationRepositorySpec.scala` —
  new: CRUD round-trip + real Postgres RLS enforcement, mirroring
  `AuthoringConversationRepositorySpec`'s exact dual-pool (`helio_app_test` non-superuser role)
  convention (tasks.md 6.6/6.7's explicit requirement).
- `backend/src/test/scala/com/helio/services/AssistantConversationServiceSpec.scala` — new:
  service-level coverage (create/append/list/pin/rename/update, title-derivation edge cases,
  transcript round-trip via `LocalFileSystem` over a temp dir, append-on-missing/foreign-owned-id
  `NotFound`).
- `schemas/create-assistant-conversation-request.schema.json`,
  `schemas/append-assistant-conversation-turn-request.schema.json`,
  `schemas/update-assistant-conversation-request.schema.json`,
  `schemas/assistant-conversation-summary.schema.json`,
  `schemas/assistant-conversation.schema.json` — new JSON Schemas for the new wire types
  (CONTRIBUTING: "Keep schema updates in the same change as related client/server code");
  `npm run check:schemas` passes with all five in sync.
- `openspec/changes/assistant-conversation-persistence/tasks.md` — all tasks checked off.
