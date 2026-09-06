# HEL-952: SSRF — SQL connector builds a JDBC URL from a caller-supplied host with no egress guard

## Description

Split out of HEL-879 (REST connector SSRF egress guard), which enumerated every outbound-fetch site in the backend as
one of its acceptance criteria. That enumeration found `SqlConnectorDriver` to be a genuine adjacent exposure, and
HEL-879's design deliberately scoped it out rather than fixing it silently or dropping it.

`SqlConnectorDriver.buildJdbcUrl` interpolates the caller-supplied `config.host` / `config.port` / `config.database`
into `jdbc:postgresql://…`, `jdbc:mysql://…`, or `jdbc:${other}://…`, and `connect` hands that straight to
`DriverManager.getConnection`. `host` is an ordinary non-secret connector field. So an authenticated caller can point a
SQL data source at loopback, link-local (including the cloud metadata address `169.254.169.254`), or RFC1918 address
space, exactly as they could for REST before HEL-879.

None of HEL-879's *pinning* mechanism transfers directly: the REST fix pins the TCP connection to the already-validated
`InetAddress` via a Pekko HTTP `ClientTransport`, and JDBC has no `ClientTransport` seam — the driver opens its own
socket. The *policy* (`ContentSourceSupport.isBlockedAddress` / `defaultResolveHost` / `checkEgress`) does transfer and
must be reused rather than reimplemented.

## Premise validation (performed at Setup, 2026-09-06)

Confirmed against the live tree at `main` @ 75f59b04. `buildJdbcUrl` is at lines 47–53 (the ticket says 49–53 — stale by
two lines, mechanism unchanged). `host` is `secret = false` at line 25. `grep` for
`isBlockedAddress|checkEgress|validateUrl|validateAndResolve` finds zero hits in `SqlConnectorDriver.scala` and zero in
`SourceService`'s SQL branches. No SQL-path egress validation exists at create, update, or connect time. Verdict:
**no-drift**. Full record: `.concertino/runs/HEL-952/evidence/premise-validation.md`.

## Acceptance criteria

- [ ] A SQL Connector cannot be created or updated with a host resolving to loopback, link-local, or private address
      space; rejection is tested for each class, not just one representative.
- [ ] A DNS name resolving to an internal address is rejected at connect time, not only at create time.
- [ ] The connection is pinned to the validated address, or the inability to pin is explicitly documented with the
      residual risk stated.
- [ ] Legitimate external database hosts continue to work.

## Run constraints (from the delivery request)

- The guard is the deliverable and must be **shown to actually block**: a test demonstrated red before the fix
  (SSRF reachable), then green after (refused).
- Mutation-check the guard: disabling it must turn the test red **for the right reason** (a refusal assertion failing,
  not an unrelated exception). A red for the wrong reason is recorded and discarded.
- No fixture may pass vacuously — verify what the fixture actually exercises reaches the code path it claims to.
- Reuse `ContentSourceSupport`; two divergent egress guards is its own defect.
- **Do NOT use Playwright or run e2e specs** (HEL-972 holds Playwright and the dev database).
- **Do NOT add a Flyway migration.** Prefer a spec with its own EmbeddedPostgres.
- Never commit a real credential or a real internal hostname.
