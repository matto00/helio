# HEL-531: Agent memory privacy controls — opt-out + retention

## Description

Durable memory of a user's activity is sensitive. Before it can be relied on in production, the user must be able to opt OUT of memory capture entirely and have stale memory expire. This ticket adds those privacy controls, coordinating the retention bound with the Data Retention & Privacy epic (HEL-438).

Builds on the agent-memory store (420-B / HEL-478) and its bounded eviction.

## Scope

- Preference flag: add a `memoryEnabled: Boolean` (default configurable) control to the user-preference store (420-A) or the memory service. When disabled, `AgentMemoryService.add` becomes a no-op (nothing is captured) and the grounding feed (420-C) surfaces no memory — but existing entries are preserved unless explicitly cleared.
- Retention: add age-based expiry to `AgentMemoryService`/`AgentMemoryRepository` — entries older than a retention window (constant, documented, coordinated with HEL-438) are excluded from reads and pruned (a `pruneExpired(user)` method invoked on access or on a maintenance path; no new scheduler required for this ticket).
- API surface: expose the opt-out toggle via the preferences endpoint so 420-D's UI can drive it; ensure "clear all" (from 420-B) plus opt-out gives a complete "forget me" path.
- No FQNs inlined in Scala.

## Acceptance criteria

- [ ] With memory disabled, `AgentMemoryService.add` writes nothing and the grounding feed exposes no memory (proven by a ScalaTest), while previously-stored entries remain until cleared.
- [ ] Entries past the retention window are excluded from reads and pruned; a ScalaTest proves an over-age entry is not returned and is removed.
- [ ] The opt-out flag is readable/writable through the preferences API and defaults to a documented value.
- [ ] Retention window value is documented and noted as coordinated with HEL-438.
- [ ] Additive/backward-compatible; `sbt test` passes; no FQNs inlined.

## Out of scope

- The UI toggle itself (that is 420-D, HEL-525, already shipped — consumes this flag once available).
- A background scheduled prune job (retention is enforced on-access here; a scheduled sweep can follow under HEL-438).

## Dependencies

- Blocked by 420-B (HEL-478, merged). Relates to Data Retention & Privacy (HEL-438). Pairs with 420-D (HEL-525, UI — already shipped, does not yet expose this flag) and 420-C (HEL-521, grounding feed — already shipped, needs to honor the opt-out).

## Naming correction (Planning)

The ticket text above references "the user-preference store (420-A)" generically. 420-A (HEL-472) actually shipped as `AgentPreferences`/`AgentPreferencesService`/`AgentPreferencesRepository` (a human-approved Planning-time rename to avoid colliding with an unrelated, pre-existing UI-theming feature — see HEL-472's archived `ticket.md`). This ticket uses those actual shipped names throughout.
