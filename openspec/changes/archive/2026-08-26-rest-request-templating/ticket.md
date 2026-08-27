# HEL-823: Request templating: parameterize endpoint, query params, headers, and body

## Description

Child 4 of HEL-820 (epic: REST Connections — reusable credentialed hosts, parameterized source). Depends on child 3 (HEL-822, merged). Completes the spine.

There is no templating or interpolation anywhere in the fetch path today — `config.endpoint`, `config.queryParams`, `config.headers`, and `config.body` are used verbatim exactly as stored. This ticket introduces parameterization so an endpoint, its query params, headers, and payload can carry variables rather than being frozen strings.

## Insertion point (verified against current tree, not the ticket's stale line numbers)

Both authoring-time and run-time fetches funnel through `RestApiConnectorDriver`:
- `buildResolvedRequest` (Connector-resolving path: `SourceService.createRest/inferRest/testRest/refreshRest` when a `connectorId` request, and `InProcessPipelineEngine.loadRows`'s `case r: RestSource =>` via `PipelineRunService`)
- `buildEphemeralRequest` (bare-`url` dual-support path: `/api/sources/infer`, `/api/sources/test`, inline pipeline-proposal sources)

Both must interpolate templated values for full AC coverage — a single shared interpolation function, called from both.

## Known issues in the code being extended (from HEL-822's final-gate skeptic, non-blocking there)

1. Auth-header collision: `headers = authHeaders ++ baseHeaders` at `RestApiConnectorDriver.scala:137` — `baseHeaders` is filtered against `authHeaderNames` (line 131-134) so this is actually already handled for the *auth* header name colliding with a *source* header name. Re-verify at execution time; do not silently assume regression.
2. `uri.query().toMap` (line 120) silently collapses repeated query keys (`?tag=a&tag=b` → one entry) — a pre-existing limitation. Do not let templated query params make this worse; state explicitly whether repeated-key templated params are supported.
3. Header precedence is right-biased `++` (Decision 4: source wins) — keep this behavior correct as headers become templated.
4. `RestSourceConnectorMigration.run`'s unbounded `Future.sequence` — not in this ticket's path, do not touch.

## Design questions to settle

- Template syntax, value source, and unresolved-variable behavior (fail loud, naming the variable — per HEL-822 Decision 6's fail-loud posture).
- Escaping/injection: CRLF header injection, query-string smuggling, JSON body escaping — hostile-input tests required, not just happy path.
- Credentials: the Connector's decrypted credential must never be an addressable template variable (contract carried from HEL-536/821: raw credential never returned by any read path, decrypted only at the point of outbound call).

## Acceptance criteria

- [ ] Endpoint, query params, headers, and body all support parameterization
- [ ] Interpolation applies identically to authoring-time (test/preview/refresh) and run-time (pipeline) fetches — demonstrated on both paths
- [ ] An unresolved variable fails loudly, with a message naming the variable. Demonstrated red.
- [ ] Values are escaped correctly per context — tests including `&`, quotes, newlines, and unicode in both a query param and a JSON body
- [ ] Credentials are not interpolable (or, if they are, justified + HEL-616 logging consequences addressed)
- [ ] A source with no parameters behaves exactly as before

## Out of scope

Connectors CRUD UI (HEL-824), REST body/response shaping beyond templating the body string (HEL-826), form parity + dual-support retirement (HEL-827), agent/MCP surface (HEL-828), in-chat credential capture (HEL-829).
