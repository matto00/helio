## Why

Durable memory of a user's activity is sensitive. Before it can be relied on in production, the
user must be able to opt OUT of memory capture entirely and have stale memory expire. This is the
last ticket of the Agent Memory & Preferences epic (HEL-420) — all four dependencies (420-A/B/C/D)
are merged.

## What Changes

- Add `memoryEnabled: Boolean` to `AgentPreferences` (defaults to `true` — an env-var-overridable
  constant — preserving today's actual behavior, since no opt-out has ever existed; the ticket's
  own "opt OUT" framing, not "opt in", confirms default-on). Exposed read-only via the existing
  `GET /api/preferences`; written via a **new**, narrowly-scoped `PUT /api/preferences/memory-enabled`
  endpoint — deliberately **not** folded into the existing full-replace `PUT /api/preferences` body,
  to avoid a real backward-compatibility hazard: 420-D's already-shipped Settings UI has no
  knowledge of this field and would silently reset it to the default on every unrelated preferences
  save if it were part of that full-replace contract.
- `AgentMemoryService.add` becomes a no-op (validates, but never persists) when the caller's
  `memoryEnabled` is `false` — still returns a normal success response (there is no current
  production caller of `POST /api/agent/memory` to break; existing entries are untouched).
- `WorkspaceContextService.buildAgentContext` (420-C's grounding composition) skips memory
  entirely when `memoryEnabled` is `false` — no `list`/`touch` call, `agentContext.memory` is
  empty. Preferences are still included regardless (the opt-out is scoped to memory capture, not
  preferences). 420-D's management UI (`GET /api/agent/memory`) is **unaffected** by the flag —
  a user must still be able to see and clear existing entries after opting out, per the ticket's
  own "previously-stored entries remain until cleared" / complete "forget me" framing.
- Add age-based retention: entries older than a retention window (90 days, env-var-overridable,
  documented as a placeholder pending HEL-438's own retention-policy work — no concrete value
  exists anywhere in that epic yet) are pruned on access. `AgentMemoryRepository.list`/`add` both
  prune expired rows for the caller before running their main query — a single choke point every
  read (management UI, grounding) and write (cap-and-evict) goes through, mirroring 420-B's own
  "cap lives at the service layer, threaded as a parameter" precedent for the retention window too.
- No Flyway migration needed — `memoryEnabled` lives inside the existing `agent_preferences.preferences`
  JSONB blob (the same additive-field pattern `extras` already established); retention uses the
  existing `agent_memory.created_at` column.
- No FQNs inlined in Scala.

## Capabilities

### New Capabilities

- `agent-memory-opt-out`: the `memoryEnabled` flag, its dedicated read/write surface, and its
  effect on `add`/grounding (never on the management UI's `list`/`delete`/`clear`).
- `agent-memory-retention`: age-based expiry, pruned on access, independent of the opt-out flag.

### Modified Capabilities

(none — additive; the existing full-replace `PUT /api/preferences` contract is deliberately left
completely untouched by this ticket, see design.md Decision 1)

## Impact

- Affected code: `backend/src/main/scala/com/helio/domain/model.scala` (`AgentPreferences` gains
  `memoryEnabled`), `backend/src/main/scala/com/helio/services/AgentPreferencesService.scala` (new
  `setMemoryEnabled`; existing `put` preserves the current stored `memoryEnabled` value),
  `backend/src/main/scala/com/helio/infrastructure/AgentPreferencesRepository.scala`
  (`memoryEnabled` in the JSONB (de)serialization), `backend/src/main/scala/com/helio/services/
  AgentMemoryService.scala` (opt-out check in `add`; retention window constant; new
  `AgentPreferencesService` dependency), `backend/src/main/scala/com/helio/infrastructure/
  AgentMemoryRepository.scala` (prune-then-act in `list`/`add`),
  `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` (skip memory when
  disabled), new `backend/src/main/scala/com/helio/api/protocols/` wire types + a small route for
  the new endpoint, `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (wiring),
  `schemas/agent-preferences.schema.json` (new field + new endpoint's schema).
- No frontend changes — the UI toggle itself is explicitly out of scope (a downstream ticket
  consumes this once filed; 420-D/HEL-525 already shipped without it).
- No changes to `AgentMemoryRoutes`'s existing four endpoints' request/response shapes.
