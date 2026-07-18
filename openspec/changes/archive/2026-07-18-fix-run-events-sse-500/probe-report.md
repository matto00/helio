# HEL-299 Probe Report — `GET /api/pipelines/:id/run-events` (SSE) 500

## Outcome

**The 500 did NOT reproduce** against a live backend across the full widened
matrix. Every candidate root cause from `design.md` Decision 2 was exonerated by
direct probe. Per the fallback (Decision 5), the shipped deliverable is route
hardening (Decision 3) + a failure-path regression test (Decision 4) + this
report. No root-cause code change was made because no root cause was confirmed —
making a speculative fix would violate the systematic-debugging Iron Law.

## Environment

- Backend: worktree on port 8379, dev Postgres `helio` on 5432.
- App pool connects as role `matt`, which is a **superuser** (`rolsuper=t`) →
  bypasses RLS in dev. This is the documented dev/CI parity gap (HEL-285): RLS
  policies are never enforced on the app pool in dev.
- Probe instrumentation: the hardened `log.error(..., ex)` at the `Failure(ex)`
  branch (the permanent form) logs the full stack trace server-side. No such log
  line appeared during any probe — i.e. `pipelineExistsShared` never failed.

## Frontend consumer (task 1.2)

`frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` issues a single
`fetch(GET /api/pipelines/:id/run-events, { credentials: "include" })` (session
cookie; no PAT, no `Last-Event-ID`, no reconnect loop — an `AbortController`
closes the stream on unmount / terminal status). It validates `response.ok` +
`Content-Type: text/event-stream` before reading the body. Nothing in the client
provokes a server 500; a non-SSE response merely sets `connectionError`.

## Matrix (live curl against port 8379)

| # | Scenario | Auth | Result | Verdict |
|---|----------|------|--------|---------|
| 1 | Owned pipeline, completed (`555f4bae…`) | session cookie | `200 text/event-stream` | OK |
| 2 | Owned pipeline, never-run (`531e0c3c…`) | session cookie | `200 text/event-stream` | OK |
| 3 | Non-existent UUID | session cookie | `404` | OK |
| 4 | Existing pipeline, no cookie | none | `401` | OK |
| 5 | Owned pipeline | PAT (`Bearer helio_pat_…`) | `200 text/event-stream` | OK |
| 6 | Non-existent | PAT | `404` | OK |
| 7 | Grantee WITHOUT grant | session (2nd user) | `404` | OK |
| 8 | Grantee WITH viewer grant | session (2nd user) | `200 text/event-stream` | OK |
| 9 | 25 concurrent SSE connections | session cookie | 25 × `200` | OK |

Pipeline run state (never-run vs completed) is irrelevant to the guard:
`pipelineExistsShared` only checks existence/access and never reads run status,
so states 1–2 fully cover that dimension. "Deleted-mid-stream" cannot 500 the
guard — `findByIdShared` resolves the row atomically; a delete before it → 404,
after it → the guard already passed and the in-memory registry stream holds no DB
connection.

## Non-superuser RLS probe (task 1.8)

Because dev runs as superuser, RLS is the one thing the live matrix cannot
exercise. I created a uniquely-named, non-superuser, `NOBYPASSRLS` role
(`hel299_probe_rls`, scoped to the `helio` DB, dropped afterward) and ran the
exact grantee query `findByIdShared` issues under `withUserContext`:

```sql
SET ROLE hel299_probe_rls;
SELECT set_config('app.current_user_id', '<grantee-uuid>', false);
SELECT exists(SELECT 1 FROM resource_permissions
  WHERE resource_type='pipeline' AND resource_id='<pipe>' AND grantee_id='<grantee>'::uuid);
-- → t   (with SELECT granted on all ACL'd tables)
```

Findings:
- The `resource_permissions` SELECT policies (dashboard + pipeline variants) are
  OR-combined, so evaluating any read touches BOTH `dashboards` and `pipelines`.
  A role lacking SELECT on `dashboards` gets `ERROR: permission denied for table
  dashboards`. In production the app role (`DB_USER`) owns all tables and holds
  those privileges, so this is a probe-role artifact, not the prod fault.
- `pipelines_select` uses `helio_can_access_pipeline(id)` (SECURITY DEFINER,
  owned by `helio_privileged` after **V40**). The V40 re-own fix is present in
  this DB, so the HEL-286 mutual-recursion (`stack depth limit exceeded`) does
  NOT occur: the grantee query returned `t` cleanly under the non-superuser role.

Conclusion: the RLS path that would have been the prime cross-site-only suspect
is already fixed by V40 and does not fail post-fix. RLS is **exonerated** on
current main.

## Candidate causes — verdicts (design.md Decision 2)

- **`UUID.fromString(caller.id.value)` on a non-UUID id** — EXONERATED. Session
  and PAT callers both resolve to UUID user ids (owner `9532cfcf…`, grantee
  `2c5c6555…`); the grantee branch (probe #8) ran `UUID.fromString` successfully.
- **RLS/session-context failure under a non-superuser role** — EXONERATED on
  current main. V40 broke the recursion; the non-superuser grantee query
  succeeds (see above).
- **Transient DB/pool error (HikariCP timeout) under concurrent load** — NOT
  reproduced at 25 concurrent streams (probe #9). The guard acquires and releases
  a connection quickly; the SSE stream itself holds no DB connection. A pool
  timeout remains the only *plausible* explanation for the one-time UI-review
  observation, but it is environmental/transient and could not be reproduced —
  the hardened logging (below) will capture it with a full stack trace if it ever
  recurs.

## Shipped regardless (Decisions 3 + 4)

- **Route hardening** — `PipelineRunStreamRoutes` `Failure(ex)` now logs the full
  exception + stack trace server-side (`log.error(…, ex)`) and returns a generic
  `{"message":"Internal server error"}` body instead of leaking `ex.getMessage`.
- **Regression tests** (`PipelineRunRoutesSpec`):
  - Viewer-grantee path returns `200 text/event-stream` (locks the design-flagged
    suspect branch).
  - A guard whose future fails returns `500` with a generic body that does NOT
    contain the exception message — verified **FAILING before** the hardening and
    **passing after**.

## Cleanup

Temp non-superuser role and all probe test data (2nd user, viewer grant, PAT)
were removed from the shared dev DB; verified 0 leftover rows.
