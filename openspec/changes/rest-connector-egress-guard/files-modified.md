# Files modified — HEL-879 (rest-connector-egress-guard)

- `backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` — publishes the
  validate-and-resolve core as `validateAndResolve` (was private `resolveValidated`) and adds a
  public `pinnedPoolSettings`/`pinnedTransport` accessor (design.md Decision 1), so
  `RestApiConnectorDriver`/`ConnectorEntityService` can reuse the one denylist/pinning
  implementation without going through `fetchUrl`. `fetchUrl` itself is unchanged behaviorally —
  refactored to call the now-public core.
- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — adds
  `resolveHost`/`isBlocked` constructor params (appended last, real defaults, existing
  `fetchOverride`-based test constructions unaffected); guards `issueAndParse`/`issueTest` (the
  request-issuing choke points, design.md Decision 2) via `validateAndResolve` before any
  connection, pinning the TCP connection to the validated address on success; replaces
  `response.status.isSuccess()` with the explicit 2xx-range check in both issuers (Decision 3) so
  a 3xx is an error and its body is never parsed. Removed the now-unused shared `poolSettings`
  val.
- `backend/src/main/scala/com/helio/services/sources/ConnectorEntityService.scala` — adds the same
  injected `resolveHost`/`isBlocked` seam (defaulted to the real production values) and validates
  `baseUrl` via `ContentSourceSupport.validateUrl` in both `create` (after the non-empty check,
  before persistence) and `update` (leaving the stored row unchanged on refusal) — design.md
  Decision 4, a non-authoritative second guard.
- `backend/src/main/scala/com/helio/app/Main.scala` — wires the real `resolveHost`/`isBlocked`
  defaults into `RestApiConnectorDriver`'s sole production construction site (design.md Decision
  5 — `ApiRoutes` cannot reach this seam, since it receives a ready-made driver).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `ConnectorEntityService`'s
  `resolveHost`/`isBlocked` to the existing `dataSourceUrlResolveHost`/`dataSourceUrlIsBlocked`
  seam/defaults already threaded into `ApiRoutes` (design.md Decision 5), rather than adding a
  second seam.
- `backend/src/test/scala/com/helio/services/sources/RestConnectorEgressGuardSpec.scala` (new) —
  the ticket's task-4 coverage: class-by-class rejection of loopback / link-local (incl.
  169.254.169.254) / RFC1918 / IPv6 site-local / IPv6 unique-local / any-local / multicast for
  `ConnectorEntityService.create`/`update` (4.1/4.2); `SourceService.inferRest`/`testRest`
  ephemeral-path rejection per class (4.3); a Connector-resolved fetch entry point (not
  infer/test) refusing a stored Connector's now-disallowed destination independently of
  create-time validation (4.4/4.8); the DNS-rebinding TOCTOU pin, modeled on
  `ContentSourceSupportSpec.scala:249-265` (4.5); a 302 treated as an error with no body parsing
  (4.6); an allowed external destination succeeding through the real guarded issuer, admitting
  only the "localhost" test hostname via the hostname-keyed `isBlocked` seam (4.7). **Every
  `RestApiConnectorDriver` construction in this file uses `fetchOverride = None`** (task 1.0) —
  the driver's default constructor param — so every assertion actually reaches
  `issueAndParse`/`issueTest`.
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverSpec.scala` —
  pre-existing fixture binds a local test server to `"localhost"`, which real DNS resolves to
  loopback; now passes `isBlocked = admitLocalhost` (keyed on the hostname string, never widening
  the loopback address class) so the new guard runs for real without breaking this non-egress
  fixture.
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverBodySpec.scala` — same
  `admitLocalhost` fix, same reason.
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverConnectorResolutionSpec.scala` —
  same `admitLocalhost` fix, same reason.
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverTemplatingSpec.scala` —
  same `admitLocalhost` fix, same reason.
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — same
  `admitLocalhost` fix for `stubConnector`, needed because `testConnectionEphemeral` (used by
  `POST /api/sources/test`) does not consult `fetchOverride` (design.md Decision 2's asymmetry
  note) and so reaches the real guard against this spec's local test server.
- `backend/src/test/scala/com/helio/services/sources/RestSourceConnectorMigrationSpec.scala` —
  same `admitLocalhost` fix; this spec's migration coverage fetches through the real
  Connector-resolved path against a local test server.
- `backend/src/test/scala/com/helio/api/routes/sources/ConnectorEntityRoutesSpec.scala` — two
  fixtures used the non-resolvable hostname `api.example.com` (not a wildcarded subdomain of
  `example.com`); the new create-time DNS validation (Decision 4) made `sbt test` depend on real
  DNS returning NXDOMAIN for it. Swapped to `https://example.com`, which resolves. Not an
  egress-class widening — a fixture defect exposed by adding a real DNS check that didn't
  previously run.

## fetchOverride = None accounting (task 1.0)

Every `RestApiConnectorDriver` construction added or modified by this change that is meant to
exercise the egress guard uses `fetchOverride = None` (the constructor's default — simply never
passing `fetchOverride`):

- All constructions in `RestConnectorEgressGuardSpec.scala`.
- The `admitLocalhost`-patched constructions in `RestApiConnectorDriverSpec.scala`,
  `RestApiConnectorDriverBodySpec.scala`, `RestApiConnectorDriverConnectorResolutionSpec.scala`,
  `RestApiConnectorDriverTemplatingSpec.scala`, and `RestSourceConnectorMigrationSpec.scala` — none
  of these pass `fetchOverride`.
- `DataSourceRoutesSpec.scala`'s `stubConnector` DOES set `fetchOverride` (pre-existing, for its
  `fetch`-based tests), but its two `POST /api/sources/test` REST assertions are still valid
  egress-guard evidence because `testConnectionEphemeral` never consults `fetchOverride`
  (design.md Decision 2's asymmetry) — confirmed by the fact those two tests broke against the
  real local server before the `admitLocalhost` fix, proving the guard was actually being
  evaluated.

## Evidence (task 5.2 / 5.3, re-observed cycle 2 per evaluation-1.md)

**No production database was accessed for any of this.** All queries below ran against the
local dev Postgres instance (`localhost:5432/helio`, the `backend/.env` `DATABASE_URL` target),
via `psql -h localhost -U matt -d helio`.

### Task 5.2: dev-database Connector/data_sources assessment

Query 1 — total Connector count:

```sql
select count(*) from connectors;
```

Observed: `106`.

Query 2 — Connectors whose `base_url` contains a loopback/link-local/RFC1918/any-local literal:

```sql
select base_url from connectors where base_url ~ '(127\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.|192\.168\.|169\.254\.|localhost|0\.0\.0\.0)';
```

Observed: **0 rows**. (Manual inspection of the full 106-row `base_url` list separately confirmed
every value is either a real public hostname — e.g. `jsonplaceholder.typicode.com`,
`api.stripe.com` — or a non-resolving `*.example.com`/`helio.dev` fixture hostname; none is a
literal disallowed address or resolves to one.)

Query 3 — legacy bare-url REST `data_sources` rows (the pre-HEL-822 shape this ticket's
create/update guard does not retroactively touch):

```sql
select config->>'url' from data_sources where source_type='rest_api' and config->>'url' is not null;
```

Observed: **0 rows**.

**Disposition (design.md Decision 7):** no migration is performed and none is needed here — 0
existing Connectors resolve to a disallowed address today, so no row is newly broken by this
change; 0 legacy bare-url REST sources exist to be affected either. Per Decision 7, had any
existing row's destination been disallowed, it would simply fail at fetch time with the
disallowed-address error going forward (no scan/rewrite/delete) — this dev database happens to
have none in that state, which is itself the "zero" observation being recorded, not an omission.

### Task 5.3 / ticket AC7: live external endpoint verification

Endpoint: `https://api.sleeper.app/v1/state/nfl` (the Sleeper API the HEL-857 epic uses).

How exercised: a throwaway ScalaTest spec constructed `new RestApiConnectorDriver()` — i.e. the
real production defaults (`resolveHost = ContentSourceSupport.defaultResolveHost`, `isBlocked =
ContentSourceSupport.isBlockedAddress`, `fetchOverride = None`) — and called
`driver.fetchEphemeral(EphemeralRestConfig(url = "https://api.sleeper.app/v1/state/nfl", method =
"GET"))`, i.e. through the real guarded `issueAndParse` issuer, not a stub. The spec was run via
`sbt "testOnly ...SleeperLiveCheckSpec"` and then deleted (not committed) — it exists only as a
one-off verification artifact, both times it was run.

Observed (re-run cycle 2, identical to the cycle-1 observation): `Right(...)`, HTTP success, JSON
object shape `{display_week, league_create_season, league_season, leg, previous_season, season,
season_has_scores, season_start_date, season_type, week}`, e.g.:

```json
{"display_week":1,"league_create_season":"2026","league_season":"2026","leg":1,"previous_season":"2025","season":"2026","season_has_scores":true,"season_start_date":"2026-09-09","season_type":"regular","week":1}
```

This confirms the guard does not break a legitimate external destination — DNS resolution,
address-class check, TCP pin, and 2xx-range check all passed for a real public API, through the
same `issueAndParse` code path every REST fetch now runs through.
