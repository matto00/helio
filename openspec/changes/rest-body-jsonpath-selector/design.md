## Context

See proposal.md for motivation. Current state, confirmed by direct read against `b3e866fd`:

- `RestApiConfig.body: Option[String]` **already exists** as a structural placeholder (HEL-823),
  round-trips through `RestApiConfigPayload`/`DataSourceConfigCodec`, but is never attached to the
  outbound `HttpRequest` — `buildResolvedRequest` builds `HttpRequest(method, uri, headers)` with no
  entity. `TemplateInterpolator.resolveJsonBody`/`jsonEscape` already exist and are unit-tested
  directly (HEL-823 design.md Decision 7), but nothing calls them yet.
- `jsonPath` is UI-only: collected by `RestApiForm.tsx`, sent as `RestApiConfigBody.jsonPath`, silently
  dropped by spray-json at the payload→domain boundary (no `jsonPath`/`rootSelector` field exists on
  `RestApiConfig`/`RestApiConfigPayload`).
- The **only live source-creation UI today** is `AddSourceModal`/`RestApiForm`, which always uses the
  legacy bare-`url` dual-support path (`SourceService.createRest`'s `(None, Some(url))` branch) — the
  `/connectors` CRUD page (HEL-824) manages Connectors, not source creation. So a `rootSelector`/`body`
  field must be threaded through *both* the `connectorId` path and the bare-`url` legacy path to be
  reachable from the real UI, matching how `method`/`headers` are already threaded through both today.
  This is field-forwarding, not a change to the dual-support branching logic itself — HEL-827 still
  owns retiring that branch.
- Two inherited-defect claims from the ticket, checked directly:
  - `splitUrl`'s repeated-query-key collapsing (`uri.query().toMap`): **confirmed still present**, but
    only partially — `RestSourceConnectorMigration.splitUrl` already detects and loudly logs it
    (`hasDuplicateKeys`) at migration time (HEL-822). `buildResolvedRequest`'s own query-param merge
    (`uri.withQuery(Uri.Query(uri.query().toMap + (k -> v)))`) still silently collapses duplicates in
    the *existing* URI's query string on every live request, unguarded. **Deferred** — unrelated to
    body/jsonPath, would need `RestApiConfig.queryParams` to become an ordered multi-map, a structural
    change out of this ticket's scope. Flagged in the PR body for the coordinator to file.
  - Auth/source header collision: **already fixed**, contradicting the ticket text. Current
    `buildResolvedRequest` (lines 136-147) already filters `baseHeaders` against `authHeaderNames`
    before merging — a source/Connector-default header colliding with the auth header name is already
    dropped in favor of the real auth header. No action needed; noted here so the next reader doesn't
    re-open it.

## Goals / Non-Goals

**Goals:**
- Request body (payload + content type) actually sent, honoring HEL-823's templating.
- A body on GET/HEAD is rejected (400), not silently sent.
- A minimal `rootSelector` dot-path applied in `toRows`, unset behaving byte-identically to today.
- Both reachable end-to-end from the real UI (`AddSourceModal`) and from a direct API payload.

**Non-Goals:**
- Flatten, pagination-loop composition, curated `fetchError` envelope (HEL-468), HEL-473
  inference-facade integration for response shaping — reserved for HEL-599.
- Fixing `splitUrl`/query-merge duplicate-key collapsing (deferred, see Context).
- Any change to the `connectorId`/`url` dual-support branching logic itself (HEL-827).
- Nested/wildcard/array-index path syntax for `rootSelector` — dot-separated object-key segments only
  (`data.items`), matching HEL-599's own stated convention.

## Decisions

**Decision 1 — `rootSelector` dot-path semantics (strict HEL-599 subset).** Add
`rootSelector: Option[String] = None` to `RestApiConfig`/`RestApiConfigPayload`/`EphemeralRestConfig`.
`toRows(json: JsValue, rootSelector: Option[String])`: when `None`, behavior is **byte-identical** to
today (`JsArray` → elements, `JsObject` → single row, other → single row) — the existing 3-arg match is
untouched, just reached via an `Option`-guarded call. When `Some(path)`, split on `.`, walk `JsObject`
fields only (no array-index syntax, no wildcards), then apply the *same* existing 3-way match to
whatever value is found at the end of the walk (so `data.items` pointing at a nested object still
produces one row, exactly like today's top-level-object case — no special-casing). A missing key or a
non-object encountered mid-walk returns `Vector.empty` (curated-empty, not a 500) — HEL-599 will replace
this with its own curated `fetchError` envelope (HEL-468); this ticket does not build that envelope, so
"selector didn't match" surfaces as zero rows plus a server-side warn log, not a client-visible error.
This keeps `toRows`'s signature and 3-way match exactly as HEL-599 will need to extend it (same
dot-path convention, same "unset reproduces today" contract) rather than requiring a rewrite.

**Decision 2 — body wiring.** `buildResolvedRequest` resolves `config.body` via
`TemplateInterpolator.resolveJsonBody(_, config.parameters)` (the same seam HEL-823 built and reserved
for this ticket — Decision 7), alongside the existing endpoint/query/header resolution, inside the same
`for`-comprehension so an unresolved body variable short-circuits before any request is built, exactly
like every other templated field. The resolved body becomes `HttpEntity(contentType, resolvedBody)`
attached to the `HttpRequest` via `.withEntity(...)`, only when `config.body.isDefined`.
`bodyContentType: Option[String] = None` added alongside `body`; `None` defaults to `application/json`;
a present value is parsed via Pekko's `ContentType.parse`. Where that parse failure is validated is
governed by Decision 3's invariant below, not restated here.

**Decision 3 — decode-is-total invariant (design-gate cycle 6 sweep, after FIVE rounds each finding the
same class of defect in a different field: a validation living in `RestApiConfigPayload.toDomain`,
while a second construction path bypasses `toDomain` and persists the unvalidated value, which then
bricks the row into the `__malformed__` sentinel when `DataSourceConfigCodec.decodeRest` reads it back
— rounds 2-4 for `body`+method, round 5 left `bodyContentType` behind making the same mistake again).
Rather than patch `bodyContentType` as a second point fix, this is now a general, explicitly stated
rule:**

> **`toDomain`/`decodeRest` decode is total: it NEVER rejects based on the semantic validity of `body`,
> `bodyContentType`, or `rootSelector` (only structural/security invariants that predate this ticket —
> `auth` rejection, `connectorId`/`url` exclusivity, reserved-sentinel rejection — remain in `toDomain`,
> and are safe there; see the sweep below for why). Every semantic validation THIS TICKET introduces
> (GET/HEAD+body, unparseable `bodyContentType`) lives ONLY at the two choke points that actually issue
> an outbound HTTP request (`buildResolvedRequest`, `buildEphemeralRequest`), optionally duplicated as
> non-authoritative, belt-and-braces UX at create-time. A future field's validation must follow the same
> placement — never inside `toDomain` — or it reintroduces this exact defect class.**

**Sweep 1 — every validation currently performed in `toDomain` (`RestApiConfigPayload.toDomain`,
`DataSourceProtocol.scala:338-362`), classified:**
- `auth`/credential field rejection (`p.auth.isDefined` → 400) — pre-existing (HEL-822), not touched by
  this ticket. Reachable from decode (`decodeRest` calls `toDomain` on every stored row with a
  `connectorId`), but SAFE: `RestApiConfigPayload.fromDomain` never writes `auth` (always `None`) and no
  construction path this sweep found (Sweep 2 below) sets it either, so a stored row can never carry
  `auth` in the first place — this check is live on write, structurally unreachable-but-harmless on
  read. Left as-is.
- `connectorId`/`url` mutual-exclusivity + presence checks — pre-existing. SAFE on decode:
  `decodeRest` forces `.copy(url = None)` before calling `toDomain` (so "both present" can never trigger
  from decode) and only calls `toDomain` after confirming a non-empty `connectorId` string was present
  in the JSON (so "neither present" can't trigger either). Left as-is.
- Reserved-sentinel (`__unmigrated__`/`__malformed__`) `connectorId` rejection — pre-existing, and
  DELIBERATELY still enforced on decode (it exists precisely to stop a forged sentinel value in stored
  JSON from being mistaken for the repository's own internal marker). Left as-is — this one is
  correctly a decode-time check, not an instance of the defect class the invariant above targets (it is
  a security guard against a stored value, not a business-rule validation the row would otherwise fail
  for having a "wrong" value).
- **NEW this ticket:** GET/HEAD+body rejection, unparseable `bodyContentType` rejection — per the
  invariant, NEITHER lives in `toDomain`. `bodyContentType` in particular is the round-5 gap: Decision 2
  above no longer specifies where its `ContentType.parse` failure is validated — Sweep 3 states it.

**Sweep 2 — every construction path that produces a `RestApiConfig`/`EphemeralRestConfig`, re-derived
directly from `backend/src/main/scala` (not from memory — this epic has a documented history of
incomplete enumeration: HEL-822's "no frontend caller exists" was false, HEL-825's design gate needed
six rounds for the same reason):**
- `RestApiConfig(...)` sites: (1) `DataSourceProtocol.scala:352` — `toDomain` itself, the primary
  decode+create path, governed by the invariant above. (2) `SourceService.scala:117` —
  `createRest`'s bare-`url` branch, bypasses `toDomain` entirely; must forward
  `body`/`bodyContentType`/`rootSelector` and get the belt-and-braces create-time check (Decision 3
  boundary list below). (3) `RestSourceConnectorMigration.scala:153` — the legacy-migration write path;
  constructs a `newConfig` from a legacy row's `endpoint`/`method`/`queryParams`/`headers` only, never
  sets `body`/`bodyContentType`/`rootSelector` (no legacy shape ever carried them) — no action needed,
  confirmed by reading the full construction, not assumed. (4) `DataSourceRepository.scala:55` — the
  `__malformed__`/`__unmigrated__` sentinel construction on a decode failure; carries no `body` either
  (`RestApiConfig(connectorId = sentinel)`, every other field defaulted) — no action needed. (5)
  `RestApiConnectorDriver.scala:315` — the `fetchOverride` test-fixture adapter used by
  `fetchEphemeral`; synthesizes a `RestApiConfig` from an `EphemeralRestConfig`'s
  `url`/`method`/`headers` only, never sets `body` — inherits whatever `EphemeralRestConfig` itself
  carried is NOT true here (this adapter drops body on the floor for the fixture-stub path only,
  test-infrastructure-only, never a real request) — noted, not fixed: exercises only `fetchOverride`
  callers in tests, never a live path, out of scope.
- `EphemeralRestConfig(...)` sites: (1) `SourceService.scala:217` — `toEphemeral`, per Decision 4/3.
  (2) `PipelineService.scala:368` — inline `rest_api` dry-analyze bare-`url` branch, per Decision 3
  boundary #4 / task 2.3c.
No test-helper or other construction site in `backend/src/main/scala` was found beyond these seven.

**Sweep 3 — the invariant applied uniformly.** `toDomain` performs NO validation of `body`,
`bodyContentType`, or `rootSelector` — it decodes whatever is stored, always. The single canonical
`RestApiConfig.rejectBodyOnSafeMethod(method, body): Either[String, Unit]` helper, AND `bodyContentType`
parsing via `ContentType.parse` (its failure treated identically — a `Left` returned, never a thrown
exception), are both called ONLY inside the two functions that are the sole choke points for actually
issuing an outbound HTTP request:
- `buildResolvedRequest` (the `connectorId`-resolving path — covers create-time fetch, infer, test,
  refresh, AND `PipelineService`'s inline `rest_api` `connectorId` branch, since all of them ultimately
  call `RestApiConnectorDriver.fetch`/`inferSchema`/`testConnection`, which call
  `buildResolvedRequest`).
- `buildEphemeralRequest` (the bare-`url` path — covers `SourceService.toEphemeral`'s two callers AND
  `PipelineService`'s inline `rest_api` bare-`url` branch, since all of them call
  `fetchEphemeral`/`inferSchemaEphemeral`/`testConnectionEphemeral`, which call
  `buildEphemeralRequest`).

Both checks short-circuit to `Left`/curated-error BEFORE the `HttpRequest` is built, structurally — no
future caller of `fetch`/`inferSchema`/`testConnection` (present or not-yet-written) can bypass this by
constructing a config directly. `DataSourceConfigCodec.decodeRest`'s read path is unaffected by either
check (it never calls `buildResolvedRequest`/`buildEphemeralRequest`), so a pre-existing stored row with
`method=GET`+a body, OR an unparseable `bodyContentType` (both producible today via a direct API call,
since `body`/`bodyContentType` have round-tripped unvalidated since HEL-823/this ticket's own wire
change), decodes fine; it simply never gets to send that body, since the reject fires at first fetch —
exactly like any other curated fetch error already does for that row today.

As a separate, additive UX improvement (not the safety boundary — belt-and-braces only, non-exhaustive
by design per the invariant), the SAME two checks are also called at create-time so a user gets an
immediate 400 on submit rather than an opaque failure on the first background fetch: in
`SourceService.createRest`'s `connectorId` branch (`SourceService.scala:89`, after `toDomain` succeeds)
and its bare-`url` branch (`SourceService.scala:117-122`, before constructing `RestApiConfig`). This
belt-and-braces call is explicitly NOT required for correctness — if a future create path omits it, the
worst outcome is a delayed 4xx instead of an immediate 400, never a silently-sent body or a bricked row.

**Decision 4 — ephemeral (bare-`url`) path.** `EphemeralRestConfig` gains `body`/`bodyContentType`
**and `rootSelector`** mirroring `RestApiConfig` (design-gate cycle 1 REFUTE finding: the first draft
omitted `rootSelector` from `EphemeralRestConfig`, which would both fail to compile against task 2.3's
own forwarding requirement and — because `AddSourceModal`'s "Preview schema"/"Test connection" affordances
run exclusively through this ephemeral path today — silently infer a schema from the response wrapper
while the eventually-created source would yield shaped rows, defeating the whole point of previewing
first). `body`/`bodyContentType` thread into `buildEphemeralRequest` identically to Decision 2, minus
templating (HEL-823's own Non-Goals already establish the ephemeral path never calls
`TemplateInterpolator`, since there is no `parameters` store to resolve against; a `{{...}}` in an
ephemeral body is left as literal text, exactly like today's ephemeral endpoint/header behavior).
`rootSelector` threads into every `toRows` call reachable from the ephemeral path
(`inferSchemaEphemeral`) the same way the Connector-resolving path does.

**Decision 5 — legacy bare-`url` create path.** `SourceService.createRest`'s `(None, Some(url))` branch
(the only path `AddSourceModal` reaches today) already forwards `method`/`headers` from
`request.config` into the synthesized `RestApiConfig` (lines 117-122); this ticket adds
`body`/`bodyContentType`/`rootSelector` to that same forwarding, symmetric with the existing fields —
not a change to the branch's Connector-synthesis logic itself.

**Decision 6 — frontend.** `RestApiForm.tsx`/`AddSourceModal.tsx` currently hardcode `method: "GET"` —
there is no method control anywhere in the form (design-gate cycle 1 REFUTE finding: without one, a
body editor gated on "only for POST/PUT/PATCH" can never render, making AC #1 unreachable from the live
UI). This ticket adds a method `<select>` (`GET`/`POST`/`PUT`/`PATCH`) to `RestApiForm.tsx`, replacing
the hardcoded `"GET"` in both `RestApiForm.buildConfig()` and `AddSourceModal.tsx`'s own two config-building
call sites (currently `:119` and `:150`). The body textarea + content-type select is shown only when
the selected method is POST/PUT/PATCH (disabled/hidden for GET/HEAD, matching Decision 3's server-side
rejection so the UI never offers an input the server will reject). The existing `jsonPath` field is
rewired to send `rootSelector` (label/placeholder unchanged — `data.items` is a valid dot-path either
name). No new component; extends the existing form, `RestApiConfigBody`, and `buildConfig()`.

**Decision 7 — injection surface.** `jsonEscape` (HEL-823, already unit-tested with quotes/backslash/
control chars/unicode via spray-json's own `JsString` writer) is reused unchanged — this ticket adds no
second escaping path. New coverage here is at the wiring level: a hostile body template
(`{"q": "{{userInput}}"}` with `userInput` containing `"`, `\`, newline, unicode, control chars) must
produce valid JSON on the wire, verified against a real HTTP echo endpoint end-to-end, not just at the
`TemplateInterpolator` unit level HEL-823 already covers. Credential-unreachability (`{{apiKey}}`/
`{{credential}}`/`{{secret}}` never resolvable from `config.parameters`) is structural and already
proven by HEL-823 (Decision 4) — `credentialValue` is never merged into the map passed to
`TemplateInterpolator`; this ticket's body-templating call site uses the same `config.parameters` map,
so the same structural guarantee holds without new code, verified by an added test using a hostile body.

**Decision 8 — spray-json silent-field-drop, general hazard (per coordinator's ask).** Nothing in this
codebase structurally prevents a future frontend-payload field from being added and silently dropped at
a backend case class boundary the way `jsonPath` was — spray-json's generated formats simply ignore
unknown JSON keys; there is no schema-drift check that would catch "the frontend sends a key no backend
type declares." (The pre-commit "schema-drift check" mentioned in CLAUDE.md compares `schemas/`
JSON-Schema definitions to something else — it did not catch this instance, since `jsonPath` was never
added to `schemas/` either.) This is convention, not a structural guarantee — noted for the PR body as a
triage finding, not addressed here.

## Risks / Trade-offs

- [Risk] A `rootSelector` pointing at a valid-looking path that resolves to a non-object mid-walk
  silently yields zero rows (curated-empty), which could look like "the source has no data" rather than
  "the selector is wrong" → Mitigation: server-side warn log naming the source id + unmatched path
  segment; HEL-599 owns the real user-facing error envelope.
- [Risk] Threading `body`/`rootSelector` through the legacy bare-`url` path adds one more field this
  ticket, not HEL-827, is responsible for keeping in sync → Mitigation: identical mechanical pattern to
  the existing `method`/`headers` forwarding already there; no new abstraction introduced.
- [Trade-off] Deferring the query-param duplicate-key collapse leaves a known, narrower silent-corruption
  edge live in `buildResolvedRequest` → accepted; unrelated to this ticket's scope, flagged for the
  coordinator to triage separately.

## Migration Plan

None. `body`/`bodyContentType`/`rootSelector` are new, additive `Option` fields on a JSONB-backed config
(no Flyway migration needed — Slick/spray-json already tolerate new optional keys on read, confirmed by
the existing `parameters: Option[...]` field added by HEL-823 the same way). No data to migrate: `body`
was already round-tripping as an unused placeholder (nothing to backfill), and `jsonPath` was never
persisted anywhere (confirmed in premise-validation.md) — every pre-existing REST source simply has
`rootSelector = None` and keeps behaving exactly as before (Decision 1's byte-identical-when-unset
contract is what proves this, not an assertion).

## Open Questions

None — every ambiguity above (HEL-599 overlap, body-templating boundary, both inherited defects, both
create paths) was resolved as a Decision, not deferred.
