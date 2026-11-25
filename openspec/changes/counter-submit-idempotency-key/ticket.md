# HEL-1175: Counter row-appends have no idempotency key — a lost ack + manual re-click can double-count

## Description

Follow-up of HEL-1169. HEL-1169 made the counter/form submit path reconcile against the dataset's authoritative aggregate after a network failure that happens after the server has committed the write, instead of rolling back the correct optimistic value. It was scoped not to close a narrower pre-existing gap (see `openspec/changes/archive/2026-09-24-form-submit-network-reconcile/design.md`, Non-Goals).

Counter row-appends (`FormSubmission.scala`, HEL-1089) have no idempotency key: each write is a plain `{occurred_at, delta}` append with a server-assigned `occurred_at`. There is no client-side retry (`httpClient.ts` has no retry interceptor), so the risk needs a user action: the acknowledgement is lost (the client sees a network failure but the write committed) and the user re-clicks, and the second click double-counts. Nothing server-side detects or rejects the duplicate.

## Acceptance criteria (suggested; refine during planning)

- Define an idempotency key scheme for the counter submit path (e.g. a client-generated request id echoed back and deduplicated server-side within some retention window).
- A retried/duplicate submit with the same idempotency key does not append a second row.
- No behavior change for the ordinary, non-duplicate submit path.

## Driver-required AC (once the open questions are ruled)

- Red-first tests: a backend spec proving a same-key re-submit appends exactly one row, and a mutation that drops the dedupe turns it red.
- A seam test that the client's key reaches the server under the field name the server reads.
- RLS parity for any new table (NOBYPASSRLS run, grants in the migration).
- Schema, client and server in one change.

## Open questions (Planning escalation, unresolved)

See workflow-state.md PENDING_ESCALATION. Not decided by the orchestrator.
