# Evidence: teardown, identity guard, interrupt, forced paths (tasks 3.4, 3.4a, 3.5, 3.5b), residue ledger

## 3.4 teardown
Every isolated/proof run printed `revoked bootstrap PAT <id> (confirmed 401)`, `stopped backend JVM pid N (port no longer
answers)`, `dropped database <name> (confirmed absent from pg_database)`; RED/GREEN drivers did the same for S, A, B
(`stop B pid 154994: gone, port silent`, `drop S helio_verify_standin_eae76433ac: confirmed absent`). Final read-only
listing of `pg_database` names starting `helio_verify`: `(none)`.

## 3.4a identity guard (`userRowCheck` forced to miss)
    LEDGER database helio_verify_88ff9facb3ce / backend JVM pid 102427 port 36429 / user b7698b91-... verify-0caec92a@...
    isolated verify failed: user verify-0caec92a@helio-verify.invalid not found in dedicated database helio_verify_88ff9facb3ce - wrong backend answered; aborting
    stopped backend JVM pid 102427 ...; dropped database helio_verify_88ff9facb3ce (confirmed absent); exit code = 1
No bootstrap PAT was minted and the harness never ran.

## 3.5 interrupt (real SIGINT to the running script, mid-harness)
    LEDGER database helio_verify_44ecafeeb868 / backend JVM pid 112994 / user facf4528-93ac-4374-88b3-23ce4345e775 /
    bootstrap PAT f2a65089-4770-4d6f-9407-20d9ac10aeaf / harness pid 113202
    SIGINT received - tearing down; revoked bootstrap PAT f2a65089-... (confirmed 401); stopped backend JVM pid 112994;
    dropped database helio_verify_44ecafeeb868 (confirmed absent); exit=130
    afterwards: pids 112962 (tsx), 112994 (JVM), 113202 (harness) not alive; database absent.

## 3.5b forced paths
- D2 timeout (`startupPassTimeoutMs: 1500`): `isolated verify failed: startup retention pass not proven complete within 1.5s`,
  JVM 103764 stopped, DB helio_verify_6a47a8d5be2a dropped, exit 1.
- Unconfirmed dropdb (real held session `psql ... pg_sleep(600)` on the dedicated DB, no FORCE): harness 30/30 `VERIFY OK`, then
  `TEARDOWN FAILED: database helio_verify_cf9c423ecaa0: could not confirm it was dropped`, exit code = 1.
  Manual cleanup by exact name: server session pid 111876 `pg_terminate_backend`, `dropdb helio_verify_cf9c423ecaa0`, exists=false.
  (An earlier dropfail run, DB helio_verify_49f571fb6a7d, was cleaned the same way - session 105145 terminated by pid, DB dropped.)

## Defects found and fixed while proving
1. `POST /api/tokens` with the session cookie needs `X-Helio-Requested-With: 1` (CSRF) - first run failed 403; fixed in `isolatedAuth.ts`.
2. With default rate limits a 429 `Retry-After` of 59 s outlasts the MCP client's 60 s timeout (`McpError -32001`) - flaked the dropfail demo
   harness; the isolated backend now lifts `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW`/`RATE_LIMIT_REQUESTS_PER_WINDOW`.

## Residue ledger
Process: orphan MCP server pid 100291 left by a proof-driver generator kill (driver bug, proof-side only) - killed by exact pid, confirmed gone.
Driver then switched to process-group kill of the recorded generator pid. Pid 3267 (`/helio/helio-mcp/dist/index.js`, main checkout) is the
session's own MCP server, not ours; untouched.
Databases created and dropped: every stand-in `helio_verify_standin_<hex>` and dedicated `helio_verify_<hex>` appears in its driver/run log with
`confirmed absent`; the final read-only `pg_database` listing for `helio_verify%` is `(none)`.
PATs: every bootstrap/run/S PAT revoked, 401 confirmed in each log. The shared `helio` DB and `matt@helio.dev` were never touched.

Disclosure: npm writes its own debug log under `~/.npm/_logs` on every invocation (including one failed `npm run build` I ran from the wrong
directory); the harness rule against writes under `~` was breached by that unavoidable npm behaviour before I set a project-local cache. Reported, not deleted.

## Cycle 2 re-run (effective javaOptions incl. the 3 jdk.internal/nio.channels flags, harness stop confirmed)
`npm run verify:isolated` exit 0: DB helio_verify_0feaa4979b4d, JVM pid 199276, harness pid 199508; `points=30 sparkline=30`;
`stopped harness pid 199508`, bootstrap PAT a025fc6b-f9b9-43df-b13e-cd1633164d95 revoked (401), JVM stopped, DB dropped (confirmed absent).
