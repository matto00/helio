## 1. ### Backend — domain + preferences service

- [x] 1.1 Add `memoryEnabled: Boolean` to `AgentPreferences` in
      `backend/src/main/scala/com/helio/domain/model.scala`; change
      `AgentPreferences.empty(userId)` to `AgentPreferences.empty(userId, memoryEnabled: Boolean)`
      (explicit parameter — domain stays pure, no `sys.env` reached from `domain/model.scala`,
      design.md Decision 3).
- [x] 1.2 Add an env-var-overridable `DefaultMemoryEnabled: Boolean` constant to
      `AgentPreferencesService` (`AGENT_MEMORY_DEFAULT_ENABLED`, default `true`), mirroring
      `WorkspaceContextBudget.DefaultBudgetBytes`'s pattern. Update `AgentPreferencesService.get`
      to pass it into `AgentPreferences.empty` when no row exists.
- [x] 1.3 Update `AgentPreferencesService.put` (the existing full-replace handler) to read the
      caller's current `AgentPreferences` first, carry its `memoryEnabled` forward unchanged, and
      overlay the request's four existing fields — design.md Decision 2. The other four fields'
      full-replace/clear-on-omission semantics are unchanged.
- [x] 1.4 Add `AgentPreferencesService.setMemoryEnabled(user, enabled: Boolean):
      Future[AgentPreferences]`: read the caller's current `AgentPreferences`, overlay only
      `memoryEnabled`, write the whole object back via the existing `AgentPreferencesRepository.put`
      (no repository changes needed).
- [x] 1.5 Update `AgentPreferencesRepository`'s `domainToRow`/`rowToDomain` to (de)serialize
      `memoryEnabled` into/from the existing `preferences` JSONB blob (same additive-field pattern
      `extras` already established — no migration needed).

## 2. ### Backend — wire types + routes

- [x] 2.1 Add `memoryEnabled: Boolean` to `AgentPreferencesResponse` and its `.fromDomain`
      converter in `AgentPreferencesProtocol.scala`.
- [x] 2.2 Add `PutMemoryEnabledRequest(memoryEnabled: Boolean)` (a new, minimal wire type) and its
      formatter to `AgentPreferencesProtocol.scala`.
- [x] 2.3 Add `PUT /api/preferences/memory-enabled` to `AgentPreferencesRoutes.scala`, delegating
      to `AgentPreferencesService.setMemoryEnabled` — design.md Decision 1: a separate route from
      the existing `PUT /api/preferences`, not folded into its body.
- [x] 2.4 Update `schemas/agent-preferences.schema.json`: add `memoryEnabled` to
      `AgentPreferencesResponse`'s required/properties, and add a schema for the new endpoint's
      request body.

## 3. ### Backend — memory service + repository (opt-out effect + retention)

- [x] 3.1 Add an `AgentPreferencesService` dependency to `AgentMemoryService`'s constructor.
- [x] 3.2 Update `AgentMemoryService.add`: check the caller's `memoryEnabled` (via the new
      dependency) after existing `kind`/blank-content validation; when `false`, return the
      constructed (never-persisted) entry as a normal success without calling
      `AgentMemoryRepository.add` — design.md Decision 5.
- [x] 3.3 Add an env-var-overridable `RetentionDays: Int` constant to `AgentMemoryService`
      (`AGENT_MEMORY_RETENTION_DAYS`, default `90`), documented as coordinated with HEL-438 per a
      self-approved-tunable placeholder (design.md Decision 6, mirrors `MaxEntriesPerUser`'s own
      "e.g. 100 entries" precedent). Thread it as an explicit parameter into
      `AgentMemoryRepository.list`/`add` (never hardcoded/env-read inside the repository itself,
      mirroring `cap`'s existing threading pattern).
- [x] 3.4 Add `AgentMemoryRepository.pruneExpired(user, retentionDays): DBIO[Int]` (a private
      helper, not a public method) deleting the caller's rows whose `created_at` is older than
      `retentionDays`. Call it from `list` (prune, then select) and from `add` (prune, then run
      the existing insert+evict logic) — both under the same `withUserContext` action, design.md
      Decision 6.

## 4. ### Backend — grounding

- [x] 4.1 Update `WorkspaceContextService.buildAgentContext`: when the already-fetched
      `preferences.memoryEnabled` is `false`, skip the `memoryService.list`/`touch` calls entirely
      and produce an empty `memory` list in `WorkspaceContextAgentSection`, while still including
      `preferences` — design.md Decision 4. No new dependency needed at this call site.
- [x] 4.2 Update `backend/src/main/scala/com/helio/app/Main.scala`/`ApiRoutes.scala` wiring for
      `AgentMemoryService`'s new `AgentPreferencesService` constructor dependency.

## 5. ### Tests

- [x] 5.1 Add `AgentPreferencesServiceSpec` coverage: `get` returns `memoryEnabled: true` by
      default for a new user; `put` (general endpoint) preserves a previously-opted-out caller's
      `memoryEnabled` while updating the other four fields; `setMemoryEnabled` persists the flag
      and leaves the other four fields unchanged in both directions.
- [x] 5.2 Add `AgentMemoryServiceSpec` coverage: `add` is a no-op (no row persisted, still success)
      when `memoryEnabled: false`; `add` behaves normally when `true` (the default).
- [x] 5.3 Add `AgentMemoryRepositorySpec` coverage: an over-age entry is excluded from `list` and
      actually deleted (verified via a direct follow-up query); a within-window entry is
      unaffected; `add`'s cap-and-evict runs after pruning (an over-age entry doesn't count toward
      cap pressure); a `touch`ed-but-over-age entry is still pruned (retention is not extended by
      usage).
- [x] 5.4 Add `WorkspaceContextServiceSpec` (or extend the existing agent-context spec) coverage:
      `agentContext.memory` is empty when `memoryEnabled: false`, while `agentContext.preferences`
      is still populated; unaffected (existing behavior) when `true`.
- [x] 5.5 Add `AgentMemoryRoutesSpec`/`ApiRoutesSpec` coverage proving `GET`/`DELETE
      /api/agent/memory[/:id]` behave identically regardless of `memoryEnabled` (design.md
      Decision 4's "management UI unaffected" requirement) — a ScalaTest, not just documented
      intent.
- [x] 5.6 Add `AgentPreferencesRoutesSpec` coverage for the new `PUT /api/preferences/memory-enabled`
      endpoint (opt out, opt back in, unauthenticated 401) and a route-level test proving a
      `PUT /api/preferences` save does not reset a previously-set `memoryEnabled`.
- [x] 5.7 Validate `schemas/agent-preferences.schema.json` and run `sbt test`; confirm no FQNs
      inlined per CONTRIBUTING.md.
