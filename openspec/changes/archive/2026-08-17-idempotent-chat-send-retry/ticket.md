# HEL-698: Chat send can succeed server-side while the client reports failure (retry risks duplicate messages)

## Description

### Observed behavior

A chat send sometimes surfaces a network error to the user, but the message (and often Claude's reply) actually landed server-side — confirmed by refreshing, which shows it in the transcript. A user seeing the error has no way to tell this happened, and a natural retry risks sending a near-duplicate message.

### Root cause (grounded in code)

`AssistantConversationRoutes.converseFlow` (lines ~114-146) does, in order: (1) call Claude via `assistantService.converse` (up to 3 tool-call hops), (2) `service.appendTurn` — durably persists BOTH the user's message and Claude's response, (3) a final `service.get` re-fetch purely to shape the HTTP response body.

If step 3 (or the HTTP response back to the client) fails — a `SQLTransientConnectionException` on that final read (the same class of failure just fixed for the general case in HEL-696), a Cloud Run instance restart mid-request, a client-side timeout — the client receives a failure even though step 2 already durably persisted everything. This is a structural gap, not something HEL-696 eliminates: any side-effecting request over an unreliable network has this shape regardless of how rare backend errors are.

### Scope

Not prescribing the mechanism here (that's implementation-planning work), but the fix needs to close this class of bug, e.g. via a client-generated idempotency key threaded through create/converse so a retry of an already-landed send is a no-op, and/or client-side reconciliation after an error (check whether the message actually landed before treating it as failed) instead of assuming failure.

## Acceptance Criteria

- [ ] Retrying a message after a "failed" send that actually landed server-side does not produce a duplicate/near-duplicate user turn in the transcript.
- [ ] After an error response, the client's displayed state (error banner, preserved input, etc.) accurately reflects whether the message landed, rather than always implying total failure.

## Metadata

- Priority: High
- Project: Helio v1.6 — Agentic Workflows & Pipelines
- Team: Helio Platform
- Related: HEL-696 (prod privileged DB pool connection storm — fixed the general transient-read failure, does not eliminate this structural gap)
