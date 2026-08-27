## 1. Backend — model + wire

- [x] 1.1 Add `parameters: Map[String, String] = Map.empty` to `RestApiConfig` (model.scala)
- [x] 1.2 Add `parameters: Option[Map[String,String]] = None` to `RestApiConfigPayload` (wire); `toDomain` maps via `.getOrElse(Map.empty)`, `fromDomain` emits `None` when empty; update BOTH `jsonFormat8`→`jsonFormat9` sites (`DataSourceProtocol.scala:391` AND `DataSourceConfigCodec.scala:20` — easy to miss the second)
- [x] 1.3 Thread `parameters` through `CreateSourceRequest`/`RestApiConfigPayload.toDomain` so a create request can set it

## 2. Backend — interpolator

- [x] 2.1 Add `TemplateInterpolator` (new file, `domain/connectors/`): `resolve(template, params): Either[String, String]`, `{{[A-Za-z0-9_]+}}` regex, left-to-right first-unresolved-wins
- [x] 2.2 Add endpoint-substitution percent-encoding helper (opaque-literal encoding of substituted portions only, static text untouched)
- [x] 2.3 Add header-value CRLF-injection guard (post-substitution check, curated failure)
- [x] 2.4 Add JSON-body-value escaping helper (`JsString(...).toString` stripped of outer quotes)

## 3. Backend — wire into fetch path

- [x] 3.1 `RestApiConnectorDriver.buildResolvedRequest`: interpolate `endpoint` (encoded-splice), `queryParams` values (raw, rely on Uri.Query encoding), `headers` values (raw + CRLF guard) against `config.parameters`; propagate `Left` as curated error before building `HttpRequest`
- [x] 3.2 `buildEphemeralRequest` path: do NOT call `TemplateInterpolator` here — no `parameters` store exists on this path; a `{{...}}` in a bare-`url` request's `headers`/`url` is left as literal text (existing behavior, unchanged). Document this in a code comment pointing at design.md's Non-Goals
- [x] 3.3 Confirm decrypted `credentialValue` is never merged into the map passed to `TemplateInterpolator.resolve` (structural, not a test-only guarantee — code-review point for skeptic/evaluator)

## 4. Tests

- [x] 4.1 Endpoint/query/header placeholders resolve correctly (connectorId-carrying path, `SourceService`/`RestApiConnectorDriver` level)
- [x] 4.2 Run-time (pipeline) path resolves identically — test through `InProcessPipelineEngine`/`PipelineRunService`'s `RestSource` arm, not just argued from shared code
- [x] 4.3 Unresolved variable fails loudly and names the variable, for each of endpoint/query/header (request-path, connectorId-resolving) — demonstrated red (no HTTP call issued); plus a `TemplateInterpolator`-level unresolved-variable test against `body` string content
- [x] 4.4 Escaping: query param value containing `&`, a quote, a newline, and unicode (AC names all four for query params, not just `&`); header value containing CRLF (rejected); JSON body value containing a quote, a newline, and unicode; endpoint value containing a space and a `*` (RFC 3986 path-segment encoding, not `URLEncoder` form-encoding — space must become `%20`, not `+`)
- [x] 4.5 Credential unreachability: hostile templates `{{apiKey}}`/`{{credential}}`/`{{secret}}` with no matching `parameters` entry fail loud like any other unresolved variable; assert the decrypted credential string never appears in a built request in a real-auth test
- [x] 4.6 No-parameters source: existing/no-template source fetch is byte-identical to pre-change behavior
- [x] 4.6a Decode regression: a stored `rest_api` config blob with no `parameters` key (every pre-existing row) still decodes successfully to `RestApiConfig(parameters = Map.empty)` — not `Left("malformed")`/`__malformed__` sentinel (design.md Decision 2a)
- [x] 4.7 `TemplateInterpolator.resolve` applied directly to `body` string content (endpoint-to-body boundary with HEL-826, per design.md Decision 7)
- [x] 4.8 Regression: templated header value colliding with the auth header's name still does not duplicate (design.md Decision 6)
- [x] 4.9 Ephemeral path: a bare-`url` infer/test request containing `{{...}}` in `url`/`headers` is sent with the placeholder left as literal text, not resolved and not failed (design.md Decision, Non-Goals)
