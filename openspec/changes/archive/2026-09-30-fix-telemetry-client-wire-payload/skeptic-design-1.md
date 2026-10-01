## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket.md, proposal/design/tasks and spec delta; no TODO/TBD placeholders, no proposal/design/tasks contradictions.
- Root cause confirmed in code: track.ts send() stringifies QueuedEvent (includes userId); ProductEventRegistry.validateClientEvent (line 88-89) rejects top-level keys outside event/properties/occurredAt with "unknown field(s): userId" - matches spec/task 3.2 literal.
- Flag claim verified: markFirstDashboardDelivered only on "sent" (track.ts flush); in-memory pending set in firstDashboardFlag.ts is not persisted, so a 400 drop does not poison and reload re-emits. Design's accepted in-page non-re-emit is accurate.
- Legacy queue items: mapper allow-list pick at send handles userId in persisted items.
- All 5 client events exist in ClientEvents; fixture can cover each.
- AC coverage: red-first live (1.1/4.1), seam test + mutation (3.1-3.3), 400 decision drop+log (2.2, design D3), flag not poisoned (2.3). All covered.

### Verdict: CONFIRM

### Non-blocking notes
- "Every TelemetryEvent variant" in the seam test: make coverage compile-time exhaustive (e.g. a Record<TelemetryEvent["event"], props> sample map) so a new variant cannot be silently omitted.
- Fixture contains occurredAt: use fake timers/fixed Date so regeneration is deterministic (server clamps old timestamps to now, so validation still returns Right).
- Fixture is written by the frontend test and read by the backend spec; ensure the frontend test fails (not skips) when UPDATE flag is unset and file is missing.
- Spec says "single error log per page-load": reset the once-flag in resetTelemetryForTests.
