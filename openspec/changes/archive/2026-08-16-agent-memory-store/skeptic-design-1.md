## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- **Artifacts read in full**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/agent-memory-persistence/spec.md`, `specs/agent-memory-api/spec.md`,
  `workflow-state.md`.

- **Migration numbering (V82) is current, not stale.** `ls backend/src/main/resources/db/migration/`
  in both this worktree and the main checkout (`/home/matt/Development/helio`) shows the latest
  migration is `V81__agent_preferences.sql` (HEL-472, merged, confirmed via `git log --oneline -3`
  showing `281a5899 HEL-472 ... (#349)` at HEAD). `V82` is genuinely the next free slot — the
  ticket.md text "main at V59" is stale boilerplate from ticket creation, but design.md correctly
  re-derived V82 at scheduling time per the ticket's own "do NOT hardcode" instruction. No
  contradiction in practice.

- **`ApiToken` structural analogue holds up.** Read
  `backend/src/main/scala/com/helio/infrastructure/ApiTokenRepository.scala` and
  `.../services/ApiTokenService.scala` in full. Confirmed: multi-row-per-owner shape,
  `withUserContext`-scoped `create`/`list`/`revoke`, `revoke` returning `Boolean`
  (found-vs-not-found indistinguishable at the API) — exactly what design.md Decision 5 claims as
  precedent for `delete`.

- **`DbContext.withUserContext` genuinely supports Decision 3's one-transaction cap-and-evict.**
  Read `backend/src/main/scala/com/helio/infrastructure/DbContext.scala`: `withUserContext` already
  wraps the whole passed-in `DBIO[R]` in `.transactionally` after prepending the `SET LOCAL
  app.current_user_id`. A composed `insert andThen count andThen conditional-delete` action is a
  real, available primitive here — Decision 3 is technically executable, not hand-waved.

- **`ScheduleKind` precedent for the `kind` enum is real and directly transferable.** Read
  `model.scala:701-716` (`ScheduleKind.fromString`/`asString`) and
  `PipelineScheduleRepository.scala:26-41` (row `TEXT` ↔ domain enum conversion at the repository
  boundary, `IllegalStateException` on an unknown DB value). This is the exact shape
  `AgentMemoryKind`/`AgentMemoryRepository` would reuse.

- **RLS pattern (Decision 2) matches V42/V81 exactly.** Read `V42__api_tokens.sql` and
  `V81__agent_preferences.sql` in full: `ENABLE`+`FORCE`, single `USING`-only policy on the owner
  column, no separate `WITH CHECK` (matches design.md's stated rationale verbatim). Confirmed V81
  needs no extra `GRANT`/`ALTER DEFAULT PRIVILEGES` (inherits from V38, same migrating role) — the
  planned V82 migration doesn't need one either, consistent with the most recent precedent.

- **`NULLS FIRST` eviction ordering is correct Postgres semantics, not a plausible-sounding
  mistake.** Postgres defaults `ASC` to `NULLS LAST`; design.md explicitly overrides to `ASC NULLS
  FIRST` to put never-touched entries first in eviction order — the intended semantic ("never
  touched" evicted before "touched") is achieved correctly, not by accident.

- **RlsOwnerTablesSpec extension approach (Decision 6) matches its own established convention.**
  Read the file: `agent_preferences` already has its own seeded section
  (`seedAgentPreferences`/owner-isolation assertions) alongside `image_uploads`, following the
  exact "extend, don't fork" pattern Decision 6 proposes for `agent_memory`.

- **Route/wiring pattern (ApiRoutes.scala, tasks 3.2/3.3) matches the cited precedent exactly.**
  Read `ApiTokenRoutes.scala` and `AgentPreferencesRoutes.scala` (both `pathEndOrSingleSlash` +
  `path(IdSegment)` shapes) and `ApiRoutes.scala:104-109,270-273,550-554` — the nullable-optional
  `agentPreferencesRepo: AgentPreferencesRepository = null` /
  `agentPreferencesServiceOpt.fold(reject)` pattern is real and is exactly what tasks.md 3.3 cites.
  `Main.scala` wiring (`agentPreferencesRepo = new AgentPreferencesRepository(ctx)`, passed into
  `ApiRoutes`) confirms task 2.3's plan is a straightforward mechanical copy of a working pattern.

- **JSON Schema / `check-schema-drift.mjs` convention (task 3.4) verified.** Read
  `schemas/api-token.schema.json` (`title` = wire DTO name) and
  `scripts/check-schema-drift.mjs` (parses `case class` names out of
  `JsonProtocols.scala` + every file under `api/protocols/`) — the planned
  `title: "AgentMemoryEntryResponse"` will resolve correctly under this script's matching logic.

- **No naming collision.** Independently ran
  `grep -rn "AgentMemory\|agent_memory\|api/agent/memory" backend/src/main/scala schemas
  openspec/specs` (excluding the change dir itself) — zero hits, confirming design.md's own
  collision check.

- **AC-to-task traceability**: all 5 ticket ACs map to concrete tasks/spec scenarios (table+RLS+
  indexes → 1.3/persistence spec; cap-and-evict → 2.1/4.1/persistence spec; list/delete/clear/touch
  RLS-isolated → 2.1/4.1/4.3; REST + schema → 3.1-3.4/4.4/4.5/api spec; additive/sbt
  test/no-FQNs → 4.5). No AC is uncovered, no task exceeds the ticket's scope (no frontend, no
  420-C/D/E work, no `AgentPreferences` touching — proposal.md's Impact section is scoped exactly
  to the ticket).

### Verdict: CONFIRM

The plan is grounded in real, verified precedent at every structural decision point (RLS shape,
transaction primitive, enum pattern, route wiring, schema-drift convention) — this isn't
plausible-sounding hand-waving, the cited files actually contain what design.md claims they
contain, and the cited mechanisms (e.g. `withUserContext`'s `.transactionally` wrap,
`NULLS FIRST` semantics) are technically correct. AC coverage is complete and scope is disciplined.

### Non-blocking notes

1. **`content` blank/empty validation is unaddressed.** CLAUDE.md's Architecture section states
   "Inputs are normalized by `RequestValidation` before reaching repositories" as a house-wide
   convention, and every comparable create-request in this codebase enforces it (e.g.
   `RequestValidation.validateCreateApiTokenRequest` rejects `req.name.isBlank`). `agent-memory-api`
   spec.md's own "Valid creation request" scenario says "a body with a valid `kind` and *non-empty*
   `content`" — implying non-emptiness is a precondition — but there is no
   "empty content is rejected" scenario, and tasks.md 2.2 only mentions validating `kind`, not
   `content`. A competent implementer could reasonably go either way (silently accept blank
   `content`, or add a `validateCreateAgentMemoryRequest` mirroring the `ApiToken` precedent).
   Worth deciding explicitly before/during execution (recommend mirroring the `ApiToken` blank-name
   rejection pattern), but doesn't block starting implementation — no AC or RLS/eviction-correctness
   guarantee depends on it.
2. **Minor internal tension between Decision 3 and the Risks section.** Decision 3 states the
   single-transaction cap-and-evict "closes the race where two concurrent `add` calls... could
   jointly exceed the cap," while the Risks section immediately after admits "could contend under
   concurrent writes for the same user" and explicitly accepts that as out-of-scope risk. The two
   statements are in some tension (one claims the race is closed, the other admits residual
   contention risk) — worth softening Decision 3's "closes the race" wording during execution, but
   the Risks section already makes the actual trade-off decision explicit and reasoned (bounded
   impact: at most a transient off-by-a-few overage for a single interactive user's own concurrent
   writes, not an RLS/security issue), so this doesn't warrant blocking the design.
3. **`list` ordering is unspecified** (unlike `ApiTokenRepository.list`'s explicit
   `sortBy(_.createdAt.desc)`). Low-stakes since this ticket has no frontend consumer, but worth
   picking an explicit order (e.g. newest-first, matching `ApiToken`) during implementation for
   consistency.
