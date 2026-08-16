## Context

HEL-531 (420-E) is the fifth and last ticket of the Agent Memory & Preferences epic (HEL-420).
All four dependencies are merged: 420-A (`AgentPreferences`, HEL-472), 420-B (`AgentMemoryEntry`
+ cap-and-evict, HEL-478), 420-C (grounding composition in `WorkspaceContextService`, HEL-521),
420-D (the management UI, HEL-525 — already shipped, has no knowledge of this ticket's new
`memoryEnabled` field). This last point is load-bearing: any design here has to be safe against
an already-shipped, unaware caller of the existing `PUT /api/preferences` full-replace endpoint.

Ground truth read directly: `AgentPreferencesService.put`/`AgentPreferencesRepository.put`
(confirmed: a pure `insertOrUpdate` — every `put` call constructs a brand-new JSONB blob from
scratch via `domainToRow`, with **no read-before-write**; nothing preserves a field the caller's
request doesn't mention), `AgentMemoryRepository`'s `add`/`list`/`touch` (confirmed: `add`'s
cap-and-evict already threads its `cap: Int` constant down from the service layer as an explicit
parameter, not hardcoded in the repository — the precedent this ticket's retention window
follows), `WorkspaceContextService.buildAgentContext` (confirmed: already calls
`preferencesService.get(user)` before touching memory, so the `memoryEnabled` check has the data
it needs with no new service dependency at that call site), and `WorkspaceContextBudget
.DefaultBudgetBytes` (confirmed: the existing env-var-override pattern,
`sys.env.get("...").flatMap(_.toIntOption).getOrElse(default)`, this ticket's two new
configurable defaults both follow verbatim). HEL-438 (Data Retention & Privacy epic) has no child
tickets started and defines no concrete retention-window value anywhere — confirmed by reading
the epic directly.

## Goals / Non-Goals

**Goals:**
- A `memoryEnabled` flag, readable/writable through the preferences API, defaulting to a
  documented, configurable value, that stops new memory capture without ever touching
  already-shipped, unaware callers of the existing full-replace preferences endpoint.
- Age-based retention, independent of the opt-out flag, enforced on access with no new scheduler.
- A complete "forget me" path: opt-out (stops new capture) + "clear all" (already shipped, 420-B)
  together let a user fully purge and stop future collection.

**Non-Goals:**
- The UI toggle itself (a downstream ticket, once filed, consumes the new endpoint — 420-D
  shipped before this ticket existed).
- A background scheduled prune sweep (HEL-438's own future scope; this ticket enforces retention
  only on access, exactly as the ticket text specifies).
- Any change to `AgentMemoryRoutes`'s four existing endpoints' request/response shapes, or to
  `PUT /api/preferences`'s existing four-field full-replace contract.

## Decisions

**Decision 1 — `memoryEnabled` is written through a NEW, dedicated `PUT /api/preferences/memory-enabled`
endpoint, never folded into the existing full-replace `PUT /api/preferences` body.** This is the
single most consequential decision in this design. `AgentPreferencesRepository.put` is a pure,
read-free `insertOrUpdate`: every call constructs the ENTIRE stored JSONB blob from whatever
`AgentPreferences` object it's given. If `memoryEnabled` were added as a field on
`PutAgentPreferencesRequest` (the existing full-replace body), then 420-D's already-shipped
Settings UI — which has no knowledge of this field and will never include it in a request body —
would cause every ordinary "Save preferences" click to silently reset `memoryEnabled` back to the
hardcoded default, undoing a user's opt-out the next time they save an unrelated preference. This
is not a hypothetical: it is the direct, mechanical consequence of the existing, already-tested
`insertOrUpdate`-with-no-read-before-write architecture (confirmed above) meeting an
already-shipped, unaware caller. Splitting the write path into its own endpoint sidesteps the
hazard entirely, with no need to special-case the existing full-replace handler's semantics for
one field: `PutAgentPreferencesRequest`'s existing four fields and their full-replace-clears-on-
omission behavior (420-A design.md Decision 4, still tested by `AgentPreferencesServiceSpec`)
are completely unchanged by this ticket. `GET /api/preferences` gains `memoryEnabled` as an
always-present read field — no compatibility risk on the read side.

**Decision 2 — the existing `PUT /api/preferences` handler must still preserve the caller's
current `memoryEnabled` value when writing the other four fields.** Since `memoryEnabled` now
lives inside the same JSONB blob those four fields share, `AgentPreferencesService.put` (the
general handler) must read the caller's current `AgentPreferences` first, carry its
`memoryEnabled` forward unchanged, overlay the request's four fields, and only then write —
turning what was a blind write into a narrow read-then-write for this one carried-forward field,
while every other field's full-replace/clear-on-omission semantics stay byte-for-byte identical
to before (verified: `AgentPreferencesServiceSpec`'s existing "full replace... omitting a
previously-set field clears it" test exercises only those four fields and is unaffected). The new
`setMemoryEnabled` endpoint does the mirror-image: read current preferences, overlay only
`memoryEnabled`, write the whole object back — both entry points funnel through the same
`AgentPreferencesRepository.put` primitive, which itself needs no changes at all.

**Decision 3 — `memoryEnabled` defaults to `true` (memory capture ON by default), an env-var-
overridable constant mirroring `WorkspaceContextBudget.DefaultBudgetBytes`'s pattern.** The
ticket's own language is "opt OUT of memory capture" (not "opt in") throughout, and 420-C's
grounding feature has shipped and behaved as if memory capture is unconditionally on since
HEL-521 merged — defaulting to `false` would be an unannounced behavior change/regression for
every existing user the moment this ticket ships, contradicting "Additive/backward-compatible"
(AC5). `AgentPreferences.empty(userId, memoryEnabled)` takes this as an explicit parameter (the
domain layer stays pure — no `sys.env` reached from `domain/model.scala`); the env-var read lives
in `AgentPreferencesService`, matching where `WorkspaceContextService.assemble`'s own
`budgetBytes` default is resolved (services layer, not domain).

**Decision 4 — the opt-out check happens in `AgentMemoryService.add` (blocks new writes) and in
`WorkspaceContextService.buildAgentContext` (blocks grounding surfacing) — never in
`AgentMemoryService.list`/`AgentMemoryRepository.list` itself.** The ticket's own AC1 language —
"previously-stored entries remain until cleared" — only makes sense if those entries stay visible
somewhere; 420-D's management UI (`GET /api/agent/memory`, already shipped) is that somewhere,
and it must keep working identically after opt-out so the user can actually review-then-clear
(the "forget me" path the ticket itself describes). Gating `list` itself would silently break
420-D's UI the moment a user opts out — exactly the kind of downstream regression a ticket
whose own dependency chain includes an already-shipped consumer must not introduce.
`AgentMemoryService` gains a new dependency on `AgentPreferencesService` (an internal composition,
not an external dependency) so `add` can check the flag; `WorkspaceContextService.buildAgentContext`
needs no new dependency at all — it already fetches `preferences` before touching memory.

**Decision 5 — `add`'s no-op-when-disabled returns a normal success response, never a distinguishable
error.** No current caller of `POST /api/agent/memory` exists in production (420-B's own scope
excluded automatic capture; 420-C only reads/touches; 420-D's UI never creates entries by design) —
this is a low-stakes choice with no real caller behavior to preserve either way. AC1 frames this
as "writes nothing," not "is rejected" — a silent, honest "nothing captured" success matches that
framing and privacy-respecting convention (never signaling to a caller, via a distinguishable
error shape, whether opt-out is in effect).

**Decision 6 — retention is age-since-`createdAt`, deliberately independent of `lastUsedAt` (the
eviction cap's own axis) and never extended by a `touch`.** 420-B's cap-and-evict already answers
"which entry is least useful" via `lastUsedAt`; retention answers a different question — "how long
is any personal data kept at all," a data-minimization ceiling, not a usefulness measure. Letting
`touch` extend an entry's retention would make the ceiling non-absolute (an entry surfaced
repeatedly by grounding could live forever), defeating the point of a retention window. Pruning is
threaded as an explicit parameter (`retentionDays: Int`) from `AgentMemoryService` into
`AgentMemoryRepository.list`/`add`, mirroring 420-B's own "cap lives at the service layer, not
hardcoded in the repository" precedent for `cap: Int` exactly. Both `list` and `add` prune the
caller's expired rows (a `DELETE ... WHERE created_at < now() - retentionDays` under the same
`withUserContext`) before running their main query — one choke point every read and write path
already goes through, satisfying "invoked on access" (ticket text) without a new scheduler.
`RetentionDays` defaults to `90`, env-var-overridable (`AGENT_MEMORY_RETENTION_DAYS`), explicitly
documented as a placeholder self-approved tunable pending HEL-438's own retention-policy work —
mirrors 420-B's own `MaxEntriesPerUser = 100` "e.g. 100 entries" precedent exactly (AC4's
"coordinated with HEL-438" is satisfied by this explicit placeholder-and-pointer, since HEL-438
itself defines no concrete value anywhere to coordinate against yet).

## Risks / Trade-offs

- [Risk] Two separate `PUT` endpoints for one logical resource (`/api/preferences` and
  `/api/preferences/memory-enabled`) is slightly more API surface than a single endpoint. →
  Mitigation: the alternative (folding into the existing body) is a real, mechanically-certain
  backward-compatibility hazard against an already-shipped caller, not a hypothetical one — worth
  the extra surface. A future ticket could migrate 420-D's UI to send `memoryEnabled` in the main
  body once it's UI-aware, at which point the dedicated endpoint could be deprecated; out of this
  ticket's scope.
- [Risk] A retention window that prunes even frequently-touched entries could delete something a
  user is actively relying on. → Mitigation: this is the intended, documented behavior of a real
  data-minimization ceiling (Decision 6) — flagged here for the human/skeptic to confirm intent
  matches the ticket's privacy framing, not silently assumed.
