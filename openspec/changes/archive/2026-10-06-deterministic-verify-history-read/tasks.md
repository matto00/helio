## Standing Constraints

- [C1] Purge-attribution evidence: any red/green claim must show the purger's deletion line with N>0 timestamped inside the harness run's window.
- [C2] Never run a shortened-interval purger against the real shared dev DB (`helio`); use private stand-in databases only.
- [C3] Before ANY write (incl. register), prove the listener on the port is the recorded JVM (its own stdout printed `Helio backend listening on` for that port, or `ss -ltnp` listener pid == recorded PID); fix D3's "can never receive" wording accordingly.
- [C4] Bootstrap-PAT revoke on a dead-JVM path is reported as moot (DB dropped), not as an unconfirmed removal.

## 1. Probes

- [x] 1.1 Probe `.env` vs shell `DATABASE_URL` precedence under `sbt run` and record the result in evidence
- [x] 1.2 Prove D2's observable on a dedicated DB: record v0 at first health, per-tick increments vs tick interval, proceed at v0+2
- [x] 1.3 Probe CREATEDB on the `.env` role and the sbt 2 classpath + javaOptions export; record both in evidence

## 2. Isolated verify mode

- [x] 2.1 Add `helio-mcp/scripts/verifyIsolated.ts` per D3–D5 incl. OS port, PID-alive health, psql user-row check, signal teardown
- [x] 2.2 Add `verify:isolated` to `helio-mcp/package.json` scripts only (no deps); verify `npm ls` unchanged
- [x] 2.3 Point verify.ts's thinning error at `npm run verify:isolated`; verify the message text in the diff
- [x] 2.4 Document the isolated setup and why it holds against other backends' purges (incl. HEL-1343) in README

## 3. Tests and proof

- [x] 3.1 Build helio-mcp fresh in the worktree (`npm run build`); verify `dist/` timestamps postdate the change
- [x] 3.2 Red (D6, same launcher): stand-in S + 1-min purger B thins the read; B deletion line N>0 inside window
- [x] 3.3 Green (D6): `verify:isolated` 30/30 while B deletes N>0 on S inside the window; capture full logs
- [x] 3.4 Teardown proof: dedicated + stand-in DBs absent, recorded PIDs gone, PATs revoked; record exact names/ids
- [x] 3.4a Identity-guard proof: force the dedicated-DB user-row check to miss (test/dry-run); show abort + teardown
- [x] 3.5 Interrupt proof: SIGINT a `verify:isolated` run mid-flight; DB dropped, PID gone, ledger names printed
- [x] 3.5b Forced-path demos (cheap): D2 timeout → teardown + non-zero; unconfirmed dropdb → non-zero naming it
- [x] 3.6 Root Jest run (`npm test -- --testPathPatterns=helio-mcp`) and helio-mcp typecheck pass
