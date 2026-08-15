## Why

HEL-662's `AssistantService.converse` takes an explicit, caller-supplied message history because no
persistence existed yet for it. HEL-659's assistant needs real, listable, pin-able conversations — a
Chat nav destination (HEL-664+) needs somewhere to list conversations from and a transcript to load.

## What Changes

- New Flyway migration `V80__assistant_conversations.sql`: slim Postgres metadata table
  (`id`, `owner_id`, `title`, `pinned`, `created_at`, `updated_at`, `gcs_body_ref`) with the same
  `FORCE ROW LEVEL SECURITY` + `current_setting('app.current_user_id')` owner policy as
  `authoring_conversations` (V77).
- New `AssistantConversationRepository`: Postgres metadata CRUD, mirroring
  `AuthoringConversationRepository`'s RLS-wrapped, owner-filtered call pattern exactly.
- New `AssistantConversationService`: composes the repository with the *existing* `FileSystem`
  abstraction (`LocalFileSystem`/`GcsFileSystem`, selected via `HELIO_UPLOADS_BACKEND`) to store the
  transcript body (`Seq[ClaudeToolMessage]`, JSON) under `assistant-conversations/{userId}/
  {conversationId}.json` — no new bucket/IAM wiring, reuses the exact abstraction `ImageUploadService`
  already uses.
- New hand-written spray-json formatters for `ClaudeContentBlock`/`ClaudeToolMessage` (HEL-660's
  domain types never needed one before — no consumer serialized them) — repository-internal, never
  wire-exposed, mirroring `AuthoringConversationRepository`'s existing convention for
  `ClaudeMessage`'s own formatter.
- New `AssistantConversationRoutes` (`/api/assistant-conversations`): create, list (`pinned DESC,
  updatedAt DESC`, default limit 10), get one (metadata + transcript), append a turn, pin/unpin
  (`PATCH`) — mirroring `MetricRoutes`'s thin-HTTP-shell pattern, mounted in `ApiRoutes.scala`
  gated on an `Option[AssistantConversationService]` like every other nullable-dependency service.

## Capabilities

### New Capabilities

- `assistant-conversation-persistence`: the `assistant_conversations` table, RLS policy,
  repository/service, and CRUD + list API.

### Modified Capabilities

(none)

## Impact

- `backend/src/main/resources/db/migration/V80__assistant_conversations.sql` (new).
- `backend/src/main/scala/com/helio/infrastructure/AssistantConversationRepository.scala` (new).
- `backend/src/main/scala/com/helio/services/AssistantConversationService.scala` (new).
- `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala` (new).
- `backend/src/main/scala/com/helio/api/protocols/AssistantConversationProtocol.scala` (new — wire
  request/response types for the route).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`: mount the new route, gated
  `Option[AssistantConversationService]`.
- No changes to `AssistantService`/`ClaudeModels` — this ticket adds persistence alongside HEL-662's
  existing explicit-history signature, not a replacement of it (see ticket.md's scope-boundary note).

## Non-goals

- No wiring of `AssistantService.converse` to actually load/save through this persistence — later
  ticket's job (see ticket.md).
- No retention/archival/hard-delete mechanic beyond the top-10 display `LIMIT` — no precedent exists
  in this codebase for one, and building it for a single ticket isn't justified (see design.md).
- No frontend changes.
