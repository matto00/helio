# HEL-998 evidence

## 1. RED on unmodified main (task 1.1)
Command: `cd backend && nice -n 19 sbt "testOnly com.helio.domain.connectors.SqlConnectorRebindingSpec"`
(spec written against main's API only: injected guard `resolveHost` answers 93.184.216.34 for "localhost"; the driver resolves "localhost" itself to loopback.)

```
[info] SqlConnectorDriver.connect with a rebinding resolver (public for the guard, loopback for the driver)
[info] - should never reach the internal address for postgresql *** FAILED ***
[info]   None was empty (SqlConnectorRebindingSpec.scala:51)      <- connect() SUCCEEDED against embedded Postgres on loopback
[info] - should never reach the internal address for mysql *** FAILED ***
[info]   1 was not equal to 0 (SqlConnectorRebindingSpec.scala:60) <- counting loopback ServerSocket accepted 1 connection
[info] Tests: succeeded 0, failed 2, canceled 0, ignored 0, pending 0
```

## 2. GREEN after implementation
Same spec, same command: `Tests: succeeded 2, failed 0` (postgresql + mysql rebinding tests pass; typed `SqlEgressRefusedException` unwrapped from PSQLException / CommunicationsException via the cause chain; mysql listener accept count 0).
Extra specs added: `SqlConnectorRebindingSpec` (hook-only-strict, positive path, injection), `SqlEgressSocketFactoriesSpec`, `SqlConnectorConfigShapeSpec`, `SqlConnectorTlsSpec`, `PipelineInlineSqlShapeSpec`, `SourceServiceSpec` "SQL config shape". Targeted run of the three connector specs: 45 passed; TLS spec 3 passed.

## 3. MUTATION
(a) Factory check removed (`case Some(a) if !EgressConnectGuard.isBlocked(a) => super.connect` -> `case Some(_) => super.connect`):
```
[info] Tests: succeeded 12, failed 9
 FAILED: refuse a loopback address without connecting (no exception thrown)
 FAILED: refuse a link-local metadata address (SocketTimeoutException instead of refusal)
 FAILED: use the production denylist when no predicate is set
 FAILED: refuse the host/port overloads for a blocked address
 FAILED: still refuse a blocked address when sslmode=require is set
 FAILED: never reach the internal address for postgresql (None was empty)
 FAILED: never reach the internal address for mysql (1 was not equal to 0)
 FAILED: refuse loopback for postgresql when only the hook is strict
 FAILED: refuse loopback for mysql when only the hook is strict (1 was not equal to 0)
```
Restored (verified byte-identical from saved copy).
(b) Database validator neutralised (`else if (!config.database.matches(...))` -> `else if (false)`): 12 failed, including `not be able to override the socket factory` (PSQLException instead of SqlConfigRefusedException) and every `refuse database ...` case incl. trailing `\n`. Restored (grep for the mutation = 0 hits).

## 4. TLS
`SqlConnectorTlsSpec` (real TLS-enabled embedded Postgres, throwaway openssl self-signed cert): through `PgEgressSocketFactory`, `sslmode=require` completes and `SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()` is true; the default `sslmode=prefer` via `SqlConnectorDriver.connect` is also encrypted; a blocked address is still refused with `sslmode=require`. The spec cancels (assume) if `openssl` is missing. MySQL: unchanged `useSSL=false` URL; TLS upgrade is the driver's `StandardSocketFactory.performTlsHandshake` over our `Socket` subclass; no MySQL server available, so stated not proven.

## 5. JDBC open sites (grep of src/main)
`grep -rn "DriverManager\|jdbc:" backend/src/main --include=*.scala`: only `SqlConnectorDriver` (connect, the single chokepoint for execute/testConnection/inferSchema/fetch/preview/pipeline runs; factory attached via Properties) and `PipelineRunNotifyBus.scala:186` (`DriverManager.getConnection(dbUrl, dbUser, dbPassword)`, the app's own DB, untouched). App pool is Slick/Hikari (no `DriverManager`). Test `SqlEgressSocketFactoriesSpec` "application's own database connections" asserts the only main files naming the factory classes are `SqlEgressSocketFactories.scala` and `SqlConnectorDriver.scala` and that PipelineRunNotifyBus still uses the plain call with no `socketFactory`.

## 6. Dev-DB inventory (read-only: PGOPTIONS default_transaction_read_only=on; psql as the .env user; note it is a superuser so RLS does not hide rows)
```
SELECT config->>'dialect' AS dialect, count(*) FROM data_sources WHERE source_type='sql' GROUP BY 1;  -> (0 rows)
SELECT count(*) FROM data_sources WHERE source_type='sql';                                               -> 0
SELECT config->>'dialect', (config->>'database' ~ '^[A-Za-z0-9_.$-]+$'), count(*) ... GROUP BY 1,2;     -> (0 rows)
SELECT config->>'host', count(*) FROM data_sources WHERE source_type='sql' GROUP BY 1;                   -> (0 rows)
```
| dialect | persisted sources in dev DB |
|---|---|
| postgresql | 0 |
| mysql | 0 |
| any other | 0 |
Nothing in the dev DB is affected by the unknown-dialect refusal or the database-name pattern. (Production not inspected, by instruction.)

## 7. Full backend gate
`cd backend && nice -n 19 sbt testFull` -> `Tests: succeeded 5478, failed 0, canceled 0, ignored 0, pending 0`, EXIT=0. (An earlier run aborted only SourceServiceSpec because my new test read `embeddedPostgres.getPort` at construction time; fixed, rerun green. No known flakes (HEL-1228/1225, HEL-1215, HEL-1247) were seen.) Frontend/mcp untouched; their gates not run.
