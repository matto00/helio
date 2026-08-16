## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Decision 1 (dedicated `PUT /api/preferences/memory-enabled` endpoint, not folded into the
   full-replace body) — CONFIRMED against ground truth.**
   - `backend/src/main/scala/com/helio/infrastructure/AgentPreferencesRepository.scala:40-43` —
     `put` is exactly the claimed pure `insertOrUpdate`: `table.insertOrUpdate(domainToRow(prefs))`,
     with `domainToRow` (lines 60-71) constructing the ENTIRE JSONB blob from the `AgentPreferences`
     object passed in — no prior read anywhere in the method.
   - `backend/src/main/scala/com/helio/services/AgentPreferencesService.scala:28-37` — `put`
     constructs `prefs` purely from `req`'s four fields and calls `repo.put` directly; no
     read-before-write today. This is the exact mechanism design.md describes as the hazard.
   - `frontend/src/features/settings/ui/PreferencesEditor.tsx:137-143` — the shipped (420-D /
     HEL-525) `handleSubmit` builds `request: PutAgentPreferencesRequest` with exactly
     `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions`/`extras` — no `memoryEnabled`
     field, and the TS type (`frontend/src/features/settings/types/preferences.ts:24-29`) doesn't
     declare one either.
   - `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala:25-30,44` —
     `PutAgentPreferencesRequest`'s existing four fields are all `Option[...]`, decoded via
     `jsonFormat4` (spray-json's standard missing-key → `None` semantics, confirmed by the
     in-repo comment at `settingsService.ts:5-9` describing this exact gotcha for the sibling
     fields). If `memoryEnabled` were added to this struct, the shipped UI's request (which never
     sends the key) would decode it to `None`/default on every save — the claimed hazard is real,
     not hypothetical.
   - Verdict: Decision 1's central claim is fully grounded. Splitting the write path is the
     correct, conservative call.

2. **Decision 4 (opt-out never gates `list`) — CONFIRMED.**
   - `backend/src/main/scala/com/helio/api/routes/AgentMemoryRoutes.scala:33-36` — `GET
     /api/agent/memory` (420-D's management UI's read path) calls `agentMemoryService.list(user)`
     directly, no flag check.
   - `backend/src/main/scala/com/helio/services/AgentMemoryService.scala:46-47` — `list` simply
     delegates to `repo.list(user)`, unconditionally.
   - The design's reasoning (gating `list` would silently break the already-shipped management UI,
     contradicting the ticket's own "previously-stored entries remain until cleared" / forget-me
     framing) holds given this wiring.

3. **Decision 6's `cap: Int` threading precedent — CONFIRMED.**
   - `backend/src/main/scala/com/helio/infrastructure/AgentMemoryRepository.scala:30` —
     `def add(entry: AgentMemoryEntry, cap: Int)`, with the service
     (`AgentMemoryService.scala:20,40`) supplying `MaxEntriesPerUser = 100` as an explicit
     argument. This is the real, already-shipped precedent design.md cites for threading
     `retentionDays: Int` the same way.

4. **HEL-438 has no concrete retention-window value — CONFIRMED via Linear.**
   - `mcp__linear__get_issue(HEL-438)`: status `Backlog`, description lists only "Intended child
     tickets (draft)" (retention policy model, pruning jobs, export/deletion, PII review,
     agent-memory coordination) — no child tickets started, no concrete day/window value anywhere.
     Treating 90 days as a documented, env-var-overridable, explicitly-flagged placeholder
     (mirroring `MaxEntriesPerUser`'s own precedent) is a reasonable, non-hand-wavy resolution —
     not deferred ambiguity, since it's explicit and self-contained.

5. **`WorkspaceContextService.buildAgentContext` already fetches `preferences` before memory —
   CONFIRMED.**
   - `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala:214-227`:
     `preferences <- preferencesService.get(user)` runs before `entries <-
     memoryService.list(user)`, and the class already carries `agentPreferencesServiceOpt`/
     `agentMemoryServiceOpt` as constructor fields (used at `ApiRoutes.scala:307-314`). "No new
     dependency needed at this call site" is accurate.

6. **Decision 3 (`memoryEnabled` defaults to `true`) — independently assessed as well-reasoned,
   not merely asserted.** The ticket's own scope language is "opt OUT of memory capture" (not
   "opt in"), and `WorkspaceContextService.buildAgentContext`'s already-shipped (420-C / HEL-521)
   code unconditionally calls `memoryService.list`/`touch` today — i.e. real, current production
   behavior is "always capture/surface." A `false` default would be an unannounced regression the
   moment this ships, directly contradicting AC5 ("Additive/backward-compatible"). This reasoning
   is sound and grounded in the actual shipped grounding code, not just plausible-sounding prose.

7. **Naming-correction section — CONFIRMED against archived ticket.** HEL-472's archived
   `openspec/changes/archive/2026-08-16-user-preference-store/ticket.md` contains an "Escalation
   Resolution (Planning, 2026-08-15)" section with the exact rename (`AgentPreferences`/
   `AgentPreferencesRepository`/`AgentPreferencesService`/`agent_preferences` table) HEL-531's
   Naming Correction section describes. Not fabricated.

8. **AC traceability.** All five ACs map to concrete spec-delta requirements and tasks.md items
   (AC1 → opt-out spec §"add is a no-op" + §"grounding feed" + tasks 3.2/4.1/5.2/5.4/5.5; AC2 →
   retention spec + tasks 3.3/3.4/5.3; AC3 → opt-out spec's readable/writable requirements + tasks
   1.2/2.1-2.3/5.1/5.6; AC4 → design.md Decision 6 + retention spec + tasks 3.3; AC5 → tasks 5.7).
   No AC is left uncovered, no task exceeds the ticket's stated scope.

9. **Scope check.** No FQNs inlined per design/tasks text; proposal.md's Impact section correctly
   scopes changes to the backend files that actually exist (`AgentPreferencesRepository.scala`,
   `AgentPreferencesService.scala`, `AgentMemoryService.scala`, `AgentMemoryRepository.scala`,
   `WorkspaceContextService.scala`, `ApiRoutes.scala`, protocols, schema) — verified each file
   exists at the stated path and the described current behavior matches what's actually there. No
   frontend changes claimed and none needed (UI toggle explicitly out of scope, matches ticket).

### Non-blocking notes

- **`ApiRoutes.scala` wiring nuance not discussed in design.md.** `agentMemoryServiceOpt` is today
  built as `Option(agentMemoryRepo).map(new AgentMemoryService(_))` (`ApiRoutes.scala:282`). Once
  `AgentMemoryService` requires an `AgentPreferencesService` (task 3.1), this line must become a
  for-comprehension over both `Option(agentMemoryRepo)` and `agentPreferencesServiceOpt` (exact
  precedent already in the same file: `alertEvaluationServiceOpt` at lines 180-184, which composes
  two nullable-optional repos the same way). In production `Main.scala` always constructs and
  passes both repos together (lines 73-75, 147-148), so there's no production behavior risk, but a
  future fixture that supplies `agentMemoryRepo` without `agentPreferencesRepo` would newly lose
  the `/api/agent/memory` route mount. Worth a one-line acknowledgment in design.md or tasks.md
  4.2, though the fix is mechanical and a working precedent already exists in the file.
- **tasks.md doesn't explicitly enumerate updating existing test call sites** whose signatures the
  planned changes will break: `new AgentMemoryService(repo)` in `AgentMemoryServiceSpec.scala:42`,
  `AgentMemoryRoutesSpec.scala:75`, `WorkspaceContextServiceAgentContextSpec.scala:98`, and
  `repo.list(user1)` (no `retentionDays` arg) called ~10 times in
  `AgentMemoryRepositorySpec.scala`. This is a fully mechanical, compile-error-forced consequence
  of tasks 3.1/3.3 and not a judgment call, so it doesn't block the design gate, but calling it out
  explicitly in tasks.md would save a beat during execution.
- Two `PUT` endpoints for one logical resource (design.md's own flagged risk) is an acceptable,
  well-justified trade-off given the real backward-compatibility hazard it avoids.

### Verdict: CONFIRM
