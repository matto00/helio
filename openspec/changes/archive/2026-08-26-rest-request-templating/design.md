## Context

See proposal.md for motivation. Ground truth verified against the current tree (ticket text's
own `RestApiConnector`/`buildRequest` references are stale — HEL-825 renamed the class,
HEL-822 reworked the shape). Both fetch entry points confirmed by direct read:

- `RestApiConnectorDriver.buildResolvedRequest` (`RestApiConnectorDriver.scala:101-139`) —
  reached by every `SourceService.createRest/inferRest/testRest/refreshRest` call that carries
  `connectorId`, and by `InProcessPipelineEngine`'s `RestSource` arm via `PipelineRunService` →
  `connector.fetch`.
- `RestApiConnectorDriver.buildEphemeralRequest` (line 242-246) — reached only by bare-`url`
  `infer`/`test` (HEL-822 Decision 1c dual-support) and inline pipeline-proposal sources. Never
  persists a `RestSource`, so it has no `parameters` store — see Non-Goals.

`RestApiConfig` (model.scala:508-514) is currently `(connectorId, endpoint, method,
queryParams, headers, body: Option[String])`. `body` is an unused structural placeholder
(HEL-826's job to wire as an HTTP entity).

## Goals / Non-Goals

**Goals:** `{{name}}` templating resolved against a new `RestApiConfig.parameters` map, applied
identically at both entry points above where a `parameters` store exists; fail-loud on
unresolved; context-correct escaping; credential structurally unreachable; existing dual-support
and no-template sources unaffected.

**Non-Goals:**
- `buildEphemeralRequest` templating: the ephemeral path (bare-`url`, pre-Connector, never
  persisted) has no `RestSource` and therefore no `parameters` map to resolve against.
  **Revised (skeptic round 1, CR1) — resolved as literal passthrough, not fail-loud.** A
  `{{...}}` placeholder reaching this path is left as literal text, unchanged — the
  backward-compatible choice (a bare `url`/header containing `{{` works today and must keep
  working; fail-loud there would be a behavior change on an existing path this ticket does not
  otherwise touch). `TemplateInterpolator.resolve` is simply never called on this path — no new
  code, no new failure mode. This is a real, stated boundary: the AC's "authoring-time" coverage
  is satisfied by the `connectorId`-carrying authoring calls (test/preview/refresh against an
  already-created source), which do go through `buildResolvedRequest` and do have `parameters`.
  `specs/rest-api-connector/spec.md`'s fail-loud requirement is scoped explicitly to the
  `connectorId`-resolving path for this reason.
- Run-time (per-pipeline-run) parameter overrides and workspace-level shared values — both named
  by the ticket as candidate sources, both deferred (see Decision 5).
- `body` as an actual HTTP entity (HEL-826). This ticket only makes `body`'s *string content*
  support the same `{{name}}` resolution/escaping as the other fields, verified directly against
  `TemplateInterpolator`, since `buildResolvedRequest` does not attach `body` to the outbound
  `HttpRequest` at all yet.
- Repeated query-key support (`?tag=a&tag=b`) — `queryParams` stays `Map[String,String]`
  (single value per key), same pre-existing limitation as today (`uri.query().toMap`,
  `RestApiConnectorDriver.scala:120`). Not fixed here — widening `queryParams` to
  `Map[String, Seq[String]]` is a wire-shape change affecting every existing caller
  (`RestApiConfigPayload`, `DataSourceConfigCodec`, the frontend), disproportionate to this
  ticket's scope. Recorded as an explicit out-of-scope finding, not silently inherited.

## Decisions

### Decision 1: Syntax — `{{name}}`, human-decided (escalated)
Escalated to the human per this ticket's own instruction (syntax is expensive to reverse once
agents/UI author against it). Resolved: `{{name}}`, matching the ticket's own example and
unambiguous against JSON/URL/shell syntax (`${...}` collides with shell expansion and JS
template literals, and is easy to produce accidentally inside JSON). `name` is restricted to
`[A-Za-z0-9_]+`; a `{{...}}` that doesn't match this pattern is left as literal text, not treated
as a placeholder (avoids false-positive matches against unrelated double-brace text).

### Decision 2: Value source — `RestApiConfig.parameters: Map[String, String]`, human-decided
Escalated and resolved: a new source-level field, set via API/agent alongside the template
strings. **Not scope creep**: the AC requires interpolation and unresolved-variable failure to
be *demonstrated*, which is only possible with a real value store — the "defer storage" option
considered in escalation was rejected specifically because every template would fail loud with
no store, so the ticket could never satisfy its own AC.

### Decision 2a: `parameters` wire shape — `Option[Map[String,String]]` on the payload, `Map` on the domain
**Added (skeptic round 1, CR2).** Verified against `spray-json` 1.3.6's `ProductFormats.fromField`
(the actual dependency source): a missing JSON field is tolerated only when the field's format is
an `OptionFormat` — a Scala case-class default value (`= Map.empty`) is never consulted by the
generated reader. Every already-stored `rest_api` `data_sources.config` blob lacks a `parameters`
key. If `RestApiConfigPayload.parameters` were declared as a bare `Map[String,String] =
Map.empty`, decoding any existing row would throw, `DataSourceConfigCodec.decodeRest` would
return `Left("malformed: ...")`, and `DataSourceRepository.rowToDomain` would silently substitute
`RestApiConfig(connectorId = "__malformed__")` — every pre-existing REST source stops fetching,
contradicting this ticket's own "byte-identical to today" AC. Fixed:
- `RestApiConfigPayload.parameters: Option[Map[String, String]] = None` (matches all eight
  existing sibling fields' `Option` treatment).
- `RestApiConfigPayload.toDomain` maps it via `.getOrElse(Map.empty)` onto the domain
  `RestApiConfig.parameters: Map[String, String] = Map.empty`.
- `RestApiConfigPayload.fromDomain` emits `None` when `parameters.isEmpty`, exactly mirroring the
  existing `queryParams`/`headers` treatment, so `encodeRest` output is unchanged for every
  existing source (the "byte-identical" claim holds on the encode side too).
- Both `jsonFormat8` → `jsonFormat9` sites (`DataSourceProtocol.scala:391` and
  `DataSourceConfigCodec.scala:20`) are updated together.
- A decode test asserts a stored config blob with **no** `parameters` key still decodes to a
  working `RestApiConfig` with `parameters = Map.empty` — the regression this decision exists to
  prevent.

### Decision 2b: no update path for `parameters` in this ticket — stated limitation, not silently assumed
**Added (skeptic round 1, CR4).** `UpdateDataSourceRequest` is `(name: Option[String])` only
(`DataSourceProtocol.scala:107`); `PATCH /api/sources/:id` cannot touch `config` at all today, for
any REST field, not just `parameters`. Adding a `config`-mutation path is a pre-existing gap this
ticket did not create and is disproportionate to add here (it would touch validation, ownership
re-checks, and every other `RestApiConfig` field's update semantics, not just `parameters`).
Stated explicitly rather than left implicit: **a source's `parameters` can only be set at create
time in this ticket** (via `POST /api/sources` or an agent-authored create); changing it requires
recreating the source. This makes source-level static parameters materially less useful than a
first read of Decision 2 implies, and pushes real per-run flexibility toward the deferred
run-time-override seam (Decision 5). Recorded as a follow-up candidate for whichever ticket adds
general REST-source-config editing (likely HEL-827, form parity), not filed as a new ticket per
this run's own scope discipline — the coordinator triages it.

### Decision 3: `TemplateInterpolator` — one function, per-context escaping applied by the caller
```scala
object TemplateInterpolator {
  // Left(name) on first unresolved placeholder found, scanning left-to-right.
  def resolve(template: String, params: Map[String, String]): Either[String, String]
}
```
Callers apply context-specific encoding to the *substituted value* before/after calling
`resolve`, not inside it (keeps the resolver itself dumb and reusable):
- **Query param values**: substituted raw; Pekko's `Uri.Query`/`Uri.withQuery` already
  percent-encodes on render (confirmed: current code builds
  `Uri.Query(uri.query().toMap + (k -> v))`), so `&`, `=`, `#` in a resolved value cannot break
  out of the query string — no extra encoding needed here.
- **Endpoint**: resolved as a whole string, then the *substituted portions* are percent-encoded
  as an opaque literal path-segment token before being spliced back into the endpoint template —
  a substituted value can never introduce `/`, `?`, `#`, or a new path segment. **Revised
  (skeptic round 1, CR3) — RFC 3986 path-segment encoding, not `URLEncoder`.**
  `java.net.URLEncoder.encode` implements `application/x-www-form-urlencoded` (HTML form)
  encoding, not RFC 3986 path-segment encoding: it renders a space as `+`, which in a URL *path*
  is a literal plus character, not a decoded space — a templated value of `New York` would be
  delivered to the upstream API as the path segment `New+York`, silently wrong rather than
  rejected. The helper instead builds the segment via Pekko's `Uri.Path.Segment` rendering (RFC
  3986-correct: encodes space as `%20`, correctly handles `*`/`~`), never via `URLEncoder`.
  Static (non-templated) parts of `endpoint` are untouched.
- **Header values**: substituted raw, then the *whole resolved header value* is checked for
  `\r`/`\n`; if present, the fetch fails with a curated error (never sent) — the CRLF-injection
  guard.
- **Body**: substituted values are JSON-string-escaped (`spray.json.JsString(value).toString`,
  stripped of its own surrounding quotes) before splicing into the template — assumes the
  template's static text already supplies the JSON structure/quoting (e.g.
  `{"name": "{{userName}}"}`), consistent with HEL-826's future body being JSON-shaped.

### Decision 4: Credential unreachability — structural, not a naming convention
`buildResolvedRequest`'s `credentialValue` (decrypted, HEL-536 `decryptForUse`) is passed only
to `buildAuthHeaders`/`injectAuthQueryParam`, never merged into `config.parameters` or any map
`TemplateInterpolator.resolve` is called with. A template author cannot special-case a variable
name to reach it — there is no code path where it becomes reachable, regardless of what a
parameter is *named*. Tested with hostile templates (`{{apiKey}}`, `{{credential}}`,
`{{secret}}`) with no matching `parameters` entry: asserted to fail loud with the standard
unresolved-variable error, and the decrypted credential string is asserted absent from the
built request in every test that exercises real auth.

### Decision 5: Extension seam for run-time/workspace values (not built)
`TemplateInterpolator.resolve` takes a plain `Map[String, String]` rather than
`RestApiConfig` directly — so a future ticket adds run-time overrides by merging
`runtimeParams ++ config.parameters` (or `config.parameters ++ runtimeParams`, precedence
TBD by that ticket) before calling `resolve`, and workspace-level values by merging a third map
underneath both, without changing `resolve`'s signature or this ticket's tests. Not built here.

### Decision 6: Inherited known-issue #1 (auth-header duplicate) — already fixed on main, re-verified
Re-read `RestApiConnectorDriver.scala:131-134`: `baseHeaders` is already filtered against
`authHeaderNames` (case-insensitive) before the final `authHeaders ++ baseHeaders` merge — a
source/Connector-default header colliding with the auth header's name does NOT currently
duplicate. The known-issues brief's claim is stale (it likely predates HEL-822's own
skeptic-driven fix, still visible in the inline comment at line 126-130). This ticket adds no
new header-name collision surface (headers are substituted by value, not by name), so this
stays fixed; a regression test with a templated header value colliding with the auth header name
is added to pin it.

### Decision 7: Body-templating boundary with HEL-826, stated explicitly
This ticket makes `TemplateInterpolator` apply to `config.body`'s string content (tested
directly against the interpolator, since `body` isn't wired into the outbound request yet).
HEL-826 wires `body` as an actual `HttpEntity` with a content type; when it does, it calls the
same `TemplateInterpolator.resolve` with the same JSON-escaping helper this ticket ships, rather
than inventing a second templating path. Recorded here so HEL-826 doesn't skip or duplicate it.

## Risks / Trade-offs

[Endpoint percent-encoding is coarse — a legitimately multi-segment templated endpoint value
(e.g. `{{path}}` meant to expand to `foo/bar`) is encoded as one opaque segment `foo%2Fbar`] →
accepted trade-off: allowing raw `/` in a substituted value reopens exactly the path-injection
surface this decision closes; a multi-segment need can compose multiple static/templated
endpoint pieces instead.

[`queryParams`/`headers` are `Map[String,String]` — the executor should verify no ordering
dependency in tests, since Scala `Map` iteration order isn't guaranteed] → tests assert on final
built values, not construction order.

Not applicable — this change does not touch `.husky/**` or any script a pre-commit hook invokes.
