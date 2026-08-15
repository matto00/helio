# HEL-663: Assistant conversation persistence (Postgres metadata + GCS transcript body)

## Description

HEL-659's assistant needs persistent, listable conversations — the ~10-most-recent-unless-pinned
list described in `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`.

## Scope

* New table `assistant_conversations`: `id`, `userId`, `title` (derived from first message or
  user-renamed), `pinned` (bool), `createdAt`, `updatedAt`, `gcsBodyRef`. Flyway migration.
* Transcript body (messages + tool calls) stored as a JSON blob via the *existing* uploads-backend
  abstraction (`HELIO_UPLOADS_BACKEND`/`HELIO_UPLOADS_BUCKET`, local-or-gcs), under a new path
  prefix (e.g. `assistant-conversations/{userId}/{conversationId}.json`) — reuse this, don't stand
  up new bucket/IAM wiring.
* List endpoint: `ORDER BY pinned DESC, updatedAt DESC`, default view shows 10 most recent unless
  pinned.
* Retention/archival mechanics for anything beyond the top 10 (hard delete vs. hide-only) is an
  implementation-time decision — pick one and document it in this ticket's own design notes, not
  blocking on further product input.
* Standard ACL: a user can only list/read/write their own conversations.

## Acceptance Criteria

- [ ] A conversation can be created, appended to, listed (respecting the pinned/recent ordering),
      and pinned/unpinned via the API.
- [ ] Transcript bodies round-trip correctly through both the local and GCS uploads backends
      (whichever the test environment uses), reusing the existing abstraction rather than a
      parallel implementation.
- [ ] RLS/ACL: one user cannot list or read another user's conversations (test against a real
      non-superuser role, not the bypass pool — per this codebase's established RLS testing
      convention).

## Context / Notes

- Parent epic: HEL-659. Fourth of 8 child tickets; delivery order 660 (merged) → 661 (merged) → 662
  (merged) → 663 (this ticket) → 664 → 665 → 666 → 667.
- **Scope boundary (self-approved, see design.md): wiring `AssistantService.converse` to actually
  load/save history through this new persistence (switching its signature back from an explicit
  `history` parameter to a `conversationId` lookup, per the epic's original architecture) is left
  for whichever later ticket adds the real `/api/assistant/*` route** — HEL-662 itself deferred all
  route/DI wiring for the same reason (no live consumer needed yet). This ticket's own scope and ACs
  are self-contained: a persistence CRUD/list API, not an `AssistantService` integration. Consistent
  with the coordinator's own framing when HEL-662 shipped: "Once [HEL-663] lands, converse should be
  able to take a real conversationId" — a statement about what becomes *possible*, not a requirement
  that this ticket does that wiring itself.
- Retention beyond top-10 (research at planning time): **no soft-delete/archival precedent exists
  anywhere in this codebase** (no `archived_at`/`deleted_at`/`is_deleted` column pattern for any
  resource). Self-approved decision, documented in design.md: the top-10 default is a **display-time
  `LIMIT`, not a data-lifecycle mechanic** — no row is hidden or deleted by this ticket; all
  conversations remain queryable indefinitely (via pinning, or a future pagination/search ticket).
  No new "archival" infrastructure invented for a single ticket with no existing pattern to extend.
