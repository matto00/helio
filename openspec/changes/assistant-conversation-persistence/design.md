## Context

`authoring_conversations` (V77/V78) is the closest precedent — owner-scoped, `FORCE ROW LEVEL
SECURITY`, `current_setting('app.current_user_id')` policy, `AuthoringConversationRepository`
wrapping every query in `ctx.withUserContext(...)` plus an explicit `ownerId ===` filter as
defense-in-depth. But it stores the full transcript as `api_history JSONB` *in Postgres* — this
ticket's canonical shape (per the epic design spec) is deliberately different: a slim metadata row
plus a GCS/local-backed blob, reusing the existing `FileSystem` trait
(`write`/`read`/delete/exists/list`) that `ImageUploadService` already uses (write-blob-then-record-
metadata ordering). No `pinned` column or pinned-first ordering exists anywhere in the backend today
— this ticket introduces it. HEL-660's `ClaudeContentBlock`/`ClaudeToolMessage` have no spray-json
formatter yet (no prior consumer ever serialized them). Highest existing migration: `V79`.

## Goals / Non-Goals

**Goals:**
- `assistant_conversations` (Postgres metadata) + transcript blob (via `FileSystem`) — create,
  append, list (pinned-first), pin/unpin, get one.
- RLS enforced and tested against a real non-superuser role, mirroring
  `AuthoringConversationRepositorySpec`'s exact dual-pool convention.

**Non-Goals:**
- No `AssistantService.converse` wiring to this persistence (ticket.md scope boundary) — a later
  ticket's job.
- No retention/archival mechanic beyond a display-time `LIMIT` (D4).
- No frontend changes.

## Decisions

**D1 — `V80__assistant_conversations.sql` mirrors V77's RLS shape exactly, plus a `pinned` column
and a `gcs_body_ref` instead of `api_history`.**
```sql
CREATE TABLE assistant_conversations (
    id            TEXT PRIMARY KEY,
    owner_id      UUID NOT NULL REFERENCES users(id),
    title         TEXT NOT NULL,
    pinned        BOOLEAN NOT NULL DEFAULT FALSE,
    gcs_body_ref  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_assistant_conversations_owner_id ON assistant_conversations(owner_id);
CREATE INDEX idx_assistant_conversations_owner_pinned_updated
  ON assistant_conversations(owner_id, pinned DESC, updated_at DESC);
ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_conversations_owner ON assistant_conversations
  USING (owner_id = current_setting('app.current_user_id')::uuid);
```
The composite index directly serves the list query's `ORDER BY pinned DESC, updated_at DESC` per
owner — a new index, not reuse, since no existing table has this exact ordering need.

**D2 — Transcript body via the existing `FileSystem` trait, write-then-record ordering.**
`AssistantConversationService` composes `AssistantConversationRepository` with an injected
`FileSystem` (`LocalFileSystem`/`GcsFileSystem`, selected once at `Main.scala` startup exactly as
today, no new selection logic). Path: `assistant-conversations/{userId}/{conversationId}.json`. On
create/append: serialize `Seq[ClaudeToolMessage]` to JSON bytes, `fileSystem.write(path, bytes)`
first, **then** upsert the Postgres row (`gcs_body_ref`, `updated_at`) — mirrors
`ImageUploadService`'s existing "write blob, then persist metadata" ordering (a metadata row is
never created pointing at a blob that doesn't exist yet). On get: read the metadata row, then
`fileSystem.read(gcs_body_ref)`, deserialize back to `Seq[ClaudeToolMessage]`. Whole-file overwrite
on append (no partial/append-in-place — `FileSystem` has no such primitive; every write replaces
the full blob), consistent with treating the blob as "the current transcript," not an append log.

**D3 — New `ClaudeContentBlock`/`ClaudeToolMessage` spray-json formatters, repository-internal.**
Hand-written (sealed-trait discriminated union for `ClaudeContentBlock`, mirroring the existing
`ClaudeApiContentBlock` formatter's style in `ClaudeProtocol.scala`; `jsonFormat2` for
`ClaudeToolMessage`), declared in `AssistantConversationRepository`'s companion object — mirrors
`AuthoringConversationRepository`'s own existing precedent for `ClaudeMessage`'s formatter ("never
wire-exposed... so its JSON format lives here, repository-internal, rather than under
`com.helio.api.protocols`"). These are for the *blob's* JSON shape, not the HTTP API's — the route
layer's own `AssistantConversationProtocol.scala` formats the metadata-facing request/response
types only.

**D4 — Retention beyond top-10: a display-time `LIMIT`, not a data-lifecycle mechanic.** No
soft-delete/archival column pattern (`archived_at`/`deleted_at`/`is_deleted`) exists anywhere in
this codebase for any resource — confirmed at planning time via a repo-wide search. Inventing one
for a single ticket with no precedent to extend isn't justified. The list endpoint's default `LIMIT
10` (pinned-first) is purely a *view* constraint; no row beyond it is hidden, archived, or deleted —
every conversation remains fully readable by id and remains a candidate to be pinned back into the
default view. No delete endpoint is added this ticket either — deletion isn't named in any AC
("created, appended to, listed..., pinned/unpinned"); a future ticket can add explicit delete if a
real product need arises, consistent with every other resource's genuine hard-delete-on-explicit-
action pattern in this codebase (never a background/scheduled cleanup).

**D5 — Route shape mirrors `MetricRoutes`'s thin-HTTP-shell pattern, but with a route-local default
limit, not the shared `Page.Default` (design-gate round 1 fix).** `AssistantConversationRoutes`
under `pathPrefix("assistant-conversations")`: `POST /` (create, optionally seeded with a first
message — derives `title` per D6), `GET /` (list; accepts an optional `limit` query parameter,
**defaulting to `10` when omitted** — a route-local constant, explicitly NOT `Page.Default.limit`
(`200`), since mirroring `MetricRoutes`'s pagination shape literally would silently violate this
ticket's own "default view shows 10 most recent" AC), `GET /:id` (metadata + transcript), `POST
/:id/messages` (append a turn), `PATCH /:id` (pin/unpin, and/or rename `title`). Mounted in
`ApiRoutes.scala` gated on `Option[AssistantConversationService]` (nullable-dependency pattern,
same as `MetricRoutes`).

**D6 — `title` derivation, including the both-absent case (design-gate round 1 fix).** On create, if
no explicit `title` is supplied, derive one from the first message's text (truncated to a bounded
length, mirroring how a chat UI's list item needs a short label) — a pure, in-memory string
operation, no LLM call. **When both `title` and `firstMessage` are absent** (both are `Option`, and
`title TEXT NOT NULL` in Postgres — a genuinely reachable, previously-unaddressed call shape), the
title defaults to the literal `"New conversation"`. `PATCH` allows an explicit rename at any time,
overriding whichever title (derived or default) is currently set, permanently (no re-derivation
once set).

## Risks / Trade-offs

- **New composite index (D1)** adds one index to maintain; justified — it directly serves the one
  query this feature exists to make cheap (`ORDER BY pinned DESC, updated_at DESC` per owner).
- **Two-step write (D2, blob then row)** has a narrow window where a blob exists with no metadata
  row pointing at it yet (e.g. process crash between the two steps) → acceptable: an orphaned blob
  is inert (never listed, never read, since nothing references it) and costs storage only, not
  correctness — same accepted risk `ImageUploadService`'s identical ordering already carries.
- **No retention mechanic (D4)** means conversation count grows unbounded per user over time →
  acceptable for v1, matches the ticket's own explicit "implementation-time decision, not blocking
  on further product input," and mirrors this codebase's existing norm of not building speculative
  infrastructure ahead of a real, stated need.

## Planner Notes

- Self-approved: D4's "no lifecycle mechanic" reading of "retention/archival mechanics... is an
  implementation-time decision — pick one and document it" — the ticket explicitly delegates this
  choice to the implementer; picking "no destructive mechanic, LIMIT-only" is the most conservative,
  lowest-risk option among the ones considered, and is the one this codebase's total absence of any
  soft-delete precedent elsewhere already implicitly favors.
- Self-approved: no `AssistantService` wiring this ticket (ticket.md scope boundary) — directly
  precedented by HEL-662's own identical deferral of route/DI wiring for the same "no live consumer
  needed yet" reason.
