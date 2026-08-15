## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

**Environmental note (non-blocking, worked around):** this worktree's `scripts/concertino/`
is missing `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (only 6 of the ~18
files `git ls-files scripts/concertino/` vs. the main checkout's on-disk set are tracked/gitignored
generated artifacts present in the main checkout but never copied into this worktree). Confirmed
these are pure path-argument utilities with no cwd-dependent logic (each resolves its own git
context via `git -C`/`git rev-parse --git-common-dir`), so I invoked the main checkout's identical
copies against this worktree's paths — functionally identical to an in-worktree invocation. Flagging
for the orchestrator/setup-worktree.sh, not blocking this review.

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/assistant-conversation-persistence/spec.md`.
- Read `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`'s "Data model & persistence"
  section (lines 44-48) — ticket.md's Scope and design.md's Context both match it verbatim (table
  columns, path prefix, `ORDER BY pinned DESC, updatedAt DESC`, top-10-unless-pinned default).
- **D1 (RLS shape)**: read `backend/src/main/resources/db/migration/V77__authoring_conversations.sql`
  directly. design.md's SQL block reproduces V77's `id TEXT PRIMARY KEY`, `owner_id UUID NOT NULL
  REFERENCES users(id)`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, and
  `USING (owner_id = current_setting('app.current_user_id')::uuid)` policy shape exactly, correctly
  substituting `api_history JSONB` for `pinned BOOLEAN`/`gcs_body_ref TEXT`. Confirmed `users(id)` is
  `UUID PRIMARY KEY` (migration search), so the FK type matches. Confirmed highest existing migration
  is V79 (`ls backend/.../db/migration | sort`), so `V80` is uncollided.
- **D2 (FileSystem reuse)**: read `FileSystem.scala` (trait: `write/read/delete/exists/list`, matches
  design's description exactly) and `ImageUploadService.scala` in full — confirmed the real
  write-then-record ordering: `fileSystem.write(storageKey, bytes).flatMap { _ => repo.insert(upload) }`
  (lines ~64-67). design.md D2's claimed ordering is accurate, not asserted-only.
- **D3 (no existing formatter)**: grepped `ClaudeContentBlock`/`ClaudeToolMessage` across
  `backend/src/main/scala` — defined in `ClaudeModels.scala` (sealed trait + 3 case classes / 1 case
  class), used in `AssistantService.scala`/`ClaudeClient.scala`, but no `RootJsonFormat`/`jsonFormat`
  anywhere referencing them (only `ClaudeApiContentBlock`/`ClaudeApiMessage`, the *wire* types in
  `ClaudeWireModels.scala`/`ClaudeProtocol.scala`, have formatters). Read
  `AuthoringConversationRepository.scala` in full — confirmed its companion object really does declare
  `implicit val claudeMessageFormat: RootJsonFormat[ClaudeMessage] = jsonFormat2(ClaudeMessage.apply)`
  with the exact "never wire-exposed... repository-internal" comment design.md D3 quotes. The precedent
  claim is real, not invented.
- **D5 (route pattern)**: read `MetricRoutes.scala` in full — confirmed the thin-HTTP-shell shape
  (service does all logic, route is `pathPrefix`/`concat`/`ServiceResponse.run`) and confirmed
  `ApiRoutes.scala`'s `Option[Service]`-gated nullable-dependency pattern is real and pervasive
  (`metricServiceOpt = Option(metricRepo).map(...)`, `dashboardAuthoringServiceOpt`,
  `workspaceTeardownServiceOpt`, etc., each with an explanatory comment about fixtures that don't pass
  a given repo/`DbContext`). Confirmed `Main.scala` builds `FileSystem` once via
  `HELIO_UPLOADS_BACKEND` and threads it through `ApiRoutes`'s constructor — "no new `FileSystem`
  selection logic" is accurate.
- **Testing convention**: read `AuthoringConversationRepositorySpec.scala` — confirmed the real
  dual-pool (`appDb`/`privilegedDb` via `SET ROLE helio_privileged`) RLS-testing convention design.md
  cites exists and matches. Confirmed `DataSourceServiceSpec`'s `LocalFileSystem` +
  `Files.createTempDirectory` construction pattern (task 6.5's cited precedent) is real.
- **No `pinned` column precedent**: grepped `pinned` across `backend/src/main/scala` +
  migrations — the only hits are unrelated uses of the English word ("pinned to 12", DNS/transport
  pinning in `ContentSourceSupport`). D2's "no pinned column or pinned-first ordering exists anywhere"
  claim holds.
- **Scope boundary (point 5)**: confirmed HEL-660/661/662 are merged on `main`
  (`git log --oneline`: `38e053ee HEL-662...`, `99ecfe72 HEL-661...`, `12e52dce HEL-660...`), and this
  worktree's `HEAD` is exactly `main`'s tip — no drift. Confirmed no `AssistantConversation*` files
  exist yet anywhere in `backend/src/main/scala` (`AssistantService.scala`/`AssistantSystemPrompt.scala`/
  `AssistantToolExecutor.scala`/`WorkspaceAssistantTools.scala` only) — no collision risk, and AC1's
  three verbs (create/append/list/pin) are all satisfiable purely through the new route surface without
  `AssistantService` ever calling into it. HEL-662's own `dashboardAuthoringServiceOpt`/
  `refinementServiceOpt` deferred-DI precedent in `ApiRoutes.scala` genuinely supports "route wiring
  deferred to a later ticket" as an established pattern, not an invented excuse.
- **Retention decision (point 4)**: grepped for `archived_at`/`deleted_at`/`is_deleted` patterns —
  none found tied to any resource table; D4's "no precedent to extend" claim is accurate. The chosen
  behavior (unbounded rows, default view is a display `LIMIT`, full access remains via id or an
  explicit larger page size once D5's `Page`-paginated route ships) is a defensible reading of "pick
  one and document it, not blocking on further input" — see Change Request 2 below for the one gap in
  how this interacts with D5's pagination default.
- Ran `openspec validate assistant-conversation-persistence --strict` myself (not merely read as a
  claim) — **`Change 'assistant-conversation-persistence' is valid`**.

### Verdict: REFUTE

The design is unusually well-grounded — every cited precedent file (V77, `FileSystem.scala`,
`ImageUploadService.scala`, `AuthoringConversationRepository.scala`, `MetricRoutes.scala`,
`ApiRoutes.scala`'s Option-gating, the dual-pool RLS spec, `DataSourceServiceSpec`'s `LocalFileSystem`
pattern) checks out exactly as described against the real source, and none of the six review points
turned up a fabricated or misrepresented claim. But two concrete gaps block a clean implementation
pass and should be closed in design.md/tasks.md before execution:

### Change Requests

1. **`title` derivation has no defined fallback when both `title` and `firstMessage` are absent —
   this can violate the `NOT NULL` constraint on `title` (design.md D1's DDL).** Task 4.2's signature
   is `create(user, firstMessage: Option[ClaudeToolMessage], title: Option[String])` — both
   parameters are explicitly optional, and D5 describes create as "optionally seeded with a first
   message." D6 only specifies behavior for two of the four `(title, firstMessage)` combinations:
   explicit title present (use it), or title absent + `firstMessage` present (derive from it). The
   `title = None, firstMessage = None` case is unaddressed, yet the type signature makes it a fully
   reachable call. Since `title TEXT NOT NULL` (D1), whatever the service does here either throws an
   unhandled exception, inserts an empty string nobody decided on, or hits a DB constraint violation
   surfaced as an ugly 500 — none of which is specified. **Required revision**: design.md D6 (and
   task 4.2) must state the resolution — either (a) reject the call with a validation error when
   neither is supplied, or (b) define a literal fallback title (e.g. `"New conversation"`) — and
   tasks.md's test list should gain a case for it (there is currently no test covering this branch;
   6.8 only covers "title derivation from the first message," which presupposes a first message
   exists).

2. **D5's default-list-size mechanism is stated as an outcome ("default-limited to 10") but not as an
   implementation, and its own cited precedent produces the wrong default if copied literally.**
   `MetricRoutes.scala` — the route this ticket is explicitly told to mirror — implements its list
   default via `"limit".as[Int].withDefault(Page.Default.limit)`, and `Page.Default = Page(offset = 0,
   limit = 200)` (`backend/src/main/scala/com/helio/domain/pagination.scala`). If an implementer
   follows D5's own "mirror `MetricRoutes`'s thin-HTTP-shell pattern" instruction literally for the
   list endpoint's parameter defaulting, the *actual* default becomes 200, not 10 — directly
   contradicting the ticket's AC ("default to at most the 10 most recent... unless pinned") and
   spec.md's own scenario ("The default list is capped at 10 without an explicit page size"). Task 6.4
   would eventually catch this at test time, but design gate exists precisely to close this kind of
   ambiguity before an implementer burns a cycle on the wrong default. **Required revision**: design.md
   D5 (or a new sub-bullet) should say explicitly that the `limit` parameter directive for this one
   route defaults to a **route-local `10`**, not `Page.Default.limit` — i.e. `"limit".as[Int]
   .withDefault(10)` — distinct from every sibling paginated route's convention, and name why (this
   route's default view size is a product requirement distinct from the generic pagination default).

### Non-blocking notes

- D1's two indexes (`idx_..._owner_id` and the composite `idx_..._owner_pinned_updated`) are
  slightly redundant — Postgres can already serve an `owner_id`-only predicate off the composite
  index's leftmost column. Not incorrect, just one more index to maintain than strictly necessary;
  not worth blocking on given V77's own precedent also favors a single dedicated `owner_id` index for
  clarity.
- ticket.md's Notes ("via pinning, or a future pagination/search ticket") reads as if browsing past
  the top-10 needs a later ticket, while D5's own `Page`-paginated route already lets a caller fetch
  beyond 10 via an explicit `limit`/`offset` this ticket ships. Not a contradiction worth blocking on
  — the ticket's phrasing is about UI, and the API already being more capable than the ticket's prose
  implies is a good problem to have — but worth a one-line acknowledgment in design.md so a future
  reader doesn't think pagination requires new work.
