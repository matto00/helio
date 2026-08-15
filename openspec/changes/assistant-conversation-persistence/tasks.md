## 1. Backend: Migration

- [x] 1.1 Add `backend/src/main/resources/db/migration/V80__assistant_conversations.sql`: table
      (`id TEXT PK`, `owner_id UUID NOT NULL REFERENCES users(id)`, `title TEXT NOT NULL`, `pinned
      BOOLEAN NOT NULL DEFAULT FALSE`, `gcs_body_ref TEXT NOT NULL`, `created_at`/`updated_at
      TIMESTAMPTZ NOT NULL DEFAULT NOW()`), an index on `owner_id`, a composite index on `(owner_id,
      pinned DESC, updated_at DESC)`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, and the owner policy —
      mirror `V77__authoring_conversations.sql` exactly for the RLS shape (design.md D1)

## 2. Backend: Domain formatters

- [x] 2.1 Add hand-written spray-json formatters for `ClaudeContentBlock` (sealed-trait
      discriminated union, mirroring `ClaudeApiContentBlock`'s style in `ClaudeProtocol.scala`) and
      `ClaudeToolMessage` (`jsonFormat2`), declared in `AssistantConversationRepository`'s companion
      object — repository-internal, never wire-exposed (design.md D3, mirrors
      `AuthoringConversationRepository`'s existing `ClaudeMessage` formatter precedent)

## 3. Backend: Repository

- [x] 3.1 Add `AssistantConversationRepository(ctx: DbContext)(implicit ec)`: `create`,
      `findById(id, ownerId)`, `findAll(ownerId, limit)` (ordered `pinned DESC, updatedAt DESC`),
      `updatePinned(id, ownerId, pinned)`, `touchUpdatedAt(id, ownerId, gcsBodyRef)` (called after
      an append rewrites the blob) — every method wrapped in `ctx.withUserContext(...)` PLUS an
      explicit `ownerId ===` filter as defense-in-depth, mirroring
      `AuthoringConversationRepository`'s exact pattern

## 4. Backend: Service (FileSystem composition)

- [x] 4.1 Add `AssistantConversationService(repo: AssistantConversationRepository, fileSystem:
      FileSystem)(implicit ec)`
- [x] 4.2 Implement `create(user, firstMessage: Option[ClaudeToolMessage], title: Option[String])`:
      derive `title` from `firstMessage`'s first `Text` content block, truncated to a bounded
      length (design.md D6); when BOTH `title` and `firstMessage` are absent, OR `firstMessage` is
      present but carries no `Text` block (e.g. a tool-only turn), default to the literal `"New
      conversation"` (design.md D6 — `title` is `NOT NULL`, both are reachable call shapes and
      neither may throw or leave it unset); serialize the initial transcript, `fileSystem.write`
      FIRST, then create the Postgres row (design.md D2 — write-then-record ordering, mirrors
      `ImageUploadService`)
- [x] 4.3 Implement `appendTurn(user, id, turns: Seq[ClaudeToolMessage])`: read existing metadata
      (owner-scoped, `NotFound` if missing/not-owned), read+deserialize the existing blob, append,
      re-write the WHOLE blob (no partial/append-in-place — `FileSystem` has no such primitive),
      then update `updated_at`/`gcs_body_ref` in Postgres
- [x] 4.4 Implement `get(user, id)`: metadata + read+deserialize the transcript blob,
      `Left(NotFound)` if missing/not-owned
- [x] 4.5 Implement `list(user, limit: Int = 10)`: pure Postgres query via
      `repo.findAll(ownerId, limit)`, no blob reads (list is metadata-only, per the design spec's
      compact-summary philosophy already established for `find`/HEL-661)
- [x] 4.6 Implement `setPinned(user, id, pinned: Boolean)`: Postgres-only update, no blob touch

## 5. Backend: Protocol + Routes

- [x] 5.1 Add `AssistantConversationProtocol.scala`: `CreateAssistantConversationRequest`,
      `AppendAssistantConversationTurnRequest`, `UpdateAssistantConversationRequest` (pin/rename),
      `AssistantConversationSummaryResponse` (list-item shape: id, title, pinned, updatedAt),
      `AssistantConversationResponse` (get-one shape: summary fields + transcript)
- [x] 5.2 Add `AssistantConversationRoutes(service, user)` under `pathPrefix("assistant-conversations")`:
      `POST /` (create), `GET /` (list; optional `limit` query param, defaulting to a ROUTE-LOCAL
      constant `10` when omitted — explicitly NOT `Page.Default.limit`, which is `200` and would
      silently violate the "default view shows 10 most recent" AC, per design.md D5; clamp an
      explicit `limit` to `Page.MaxLimit` same as `MetricRoutes` does, so this route can't be asked
      for an unbounded result set either), `GET /:id` (get one), `POST /:id/messages` (append),
      `PATCH /:id` (pin/unpin, rename) — mirror `MetricRoutes`'s thin-HTTP-shell pattern otherwise
- [x] 5.3 Mount `AssistantConversationRoutes` in `ApiRoutes.scala`, gated on
      `Option[AssistantConversationService]` (nullable-dependency pattern, same as every other
      optional service), constructing the service from the already-selected `FileSystem` instance
      `Main.scala` builds at startup — no new `FileSystem` selection logic

## Tests

- [x] 6.1 Test: create → append → list shows the conversation with an updated `updatedAt`
- [x] 6.2 Test: pin via `PATCH` → subsequent list reflects `pinned: true`
- [x] 6.3 Test: list ordering — a pinned-but-older conversation sorts before an unpinned-but-newer
      one
- [x] 6.4 Test: default list call (no explicit page size) returns at most 10, pinned-first then
      most-recent-first, for a user with more than 10 conversations
- [x] 6.5 Test: transcript round-trip — write via `FileSystem.write`, read back via
      `FileSystem.read`, deserialize, equals the original `Seq[ClaudeToolMessage]` (use
      `LocalFileSystem` over a `Files.createTempDirectory` temp dir, mirroring
      `DataSourceServiceSpec`'s existing construction pattern)
- [x] 6.6 Test (RLS, real non-superuser role — mirror `AuthoringConversationRepositorySpec`'s exact
      dual-pool convention, NOT the bypass/privileged pool): a second user cannot list the first
      user's conversations
- [x] 6.7 Test (RLS, same convention): a second user requesting the first user's conversation by id
      gets a not-found result, not the content
- [x] 6.8 Test: title derivation from the first message when no explicit title is supplied; an
      explicit `PATCH` rename overrides it permanently; when BOTH `title` and `firstMessage` are
      absent, the created conversation's title is `"New conversation"` (design-gate round 1 fix)
- [x] 6.9 Test: append on a nonexistent or not-owned conversation id returns `NotFound`, not an
      exception
- [x] 6.10 Test: `sbt test` fully green; confirm zero real GCS network calls in the automated suite
      (local-filesystem-backed tests only)
