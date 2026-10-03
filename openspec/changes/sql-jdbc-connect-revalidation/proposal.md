## Why

HEL-952's SQL egress guard validates `config.host` and then hands the hostname to `DriverManager.getConnection`, which resolves it again. An attacker controlling authoritative DNS can answer public to the guard and internal to the driver (DNS rebinding) and reach an internal database port. The owner ruled: close it by re-validating at the moment of TCP connect via each driver's socket-factory hook, and refuse dialects for which no hook exists.

## What Changes

- A connect-time guard for pgjdbc (`socketFactory` = a `javax.net.SocketFactory` subclass) and mysql-connector-j (`socketFactory` = a `com.mysql.cj.protocol.SocketFactory` implementation). Each validates the `InetAddress` actually being connected to (never a re-resolved hostname) with the shared `ContentSourceSupport.isBlockedAddress` policy and refuses before any TCP connect.
- `buildJdbcUrl`/`connect` attach the factory only for user-supplied-host SQL connections; the application's own DB pool and `PipelineRunNotifyBus` are untouched.
- BREAKING (owner-accepted, regression against HEL-952 AC4): any dialect other than `postgresql`/`mysql` is refused with a 4xx at source create and at connect time (instead of the generic `jdbc:<dialect>:` URL).
- `outbound-egress-guard` spec: replace the "JDBC exempt from pinning" requirement with a connect-time re-validation requirement and an unknown-dialect refusal requirement.

## Capabilities

### Modified Capabilities
- `outbound-egress-guard`: the JDBC path moves from "governed, exempt from pinning" to "governed, re-validated at TCP connect"; unknown dialects refused.

## Impact

- `backend/.../domain/connectors/SqlConnectorDriver.scala` plus two new factory classes; `SourceService` create-time validation; tests; the `outbound-egress-guard` spec. No schema/API-shape change beyond the new 4xx.
