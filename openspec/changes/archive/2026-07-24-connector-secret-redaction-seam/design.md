## Context

Redaction lives entirely in `DataSourceProtocol.DataSourceResponse.fromDomain`: `redactSqlPayload`
zeroes `SqlSourceConfigPayload.password` when non-empty, `redactRestPayload`/`redactRestAuth` zero
`RestApiAuthPayload.token` (bearer) or `.value` (api_key) whenever present, leaving the auth-type
discriminator and all non-credential fields (host, database, user, query, url, method, headers)
intact. Both `SqlSourceConfigPayload` and `RestApiConfigPayload` live in `com.helio.api.protocols`
(the wire layer) — the domain configs (`SqlSourceConfig`, `RestApiConfig` in `domain/model.scala`)
carry the same secret fields but redaction has never operated on them directly. Existing coverage:
`DataSourceProtocolSpec`'s "DataSourceResponse.fromDomain credential redaction" block, which must
keep passing unmodified.

## HEL-460 / HEL-536 boundary

HEL-460's original text asked for a live `secret-manager` backend (GCP Secret Manager reference,
resolved at fetch time). That overlapped HEL-536 ("Connector credential storage standard"), which
frames itself as the canonical storage substrate v1.9 connectors build on — both a GCP-reference
approach and an envelope-encrypted-Postgres-column approach are within HEL-536's remit. Shipping a
live `secret-manager` backend here would have given v1.9 two divergent, independently-evolving
mechanisms for "keep a credential out of plaintext."

**Decision (human-confirmed, both tickets amended in Linear 2026-07-24):** HEL-536 owns every
non-inline backend. HEL-460 owns the centralization + redaction seam and ships `inline` (today's
exact behavior) as the only concrete `SecretBackend`. The seam is designed so HEL-536 can add a
non-inline backend later without touching call sites: `SecretRedaction.redact` already takes a
`SecretBackend` parameter (defaulted to `InlineSecretBackend`); HEL-536 adds a new `SecretBackend`
implementation and a way to select it, not a new call-site shape.

## Goals / Non-Goals

**Goals:**
- One place (`HasSecrets[Config]` instances) where a connector's wire-payload type declares its
  secret fields, replacing the two hand-written `redactXPayload` functions.
- Forgetting to declare a secret field is a **loud** failure: deleting a `HasSecrets[X]` instance is
  a compile error at its only call site (`DataSourceResponse.fromDomain`); narrowing an existing
  instance's `fields` set (so a secret slips through unmasked) is a test failure, asserted against
  the actual serialized JSON.
- Byte-identical wire output: `"***"` masking, the SQL-empty-password exemption, and the REST
  Option-presence-triggers-masking behavior are all preserved exactly.
- `SecretBackend` extension point with no dangling unimplemented case.

**Non-Goals:**
- Any backend beyond `inline` — HEL-536.
- Wiring the seam through `Connector[Config]`'s domain-level config types — redaction stays a
  wire-layer (api.protocols) concern, matching where it lives today and where `SqlSourceConfigPayload`/
  `RestApiConfigPayload` are defined; the domain configs never see the seam.
- Any change to `DataSourceResponse`'s wire shape or the response case classes' field types (would
  force edits to `DataSourceProtocolSpec`'s existing format round-trip tests, which construct
  `SqlSourceResponse`/`RestSourceResponse` directly with raw payloads to test the discriminated-union
  format in isolation from `fromDomain`).

## Decisions

**1. `SecretField[Config](name, get: Config => Option[String], set: (Config, String) => Config)` as a
plain data declaration, not a macro/reflection-based scan.** A field is "secret and present" when
`get` returns `Some`; `get` is where the SQL-vs-REST asymmetry lives (SQL: `None` when the password
string is empty, matching the existing `p.password.isEmpty` exemption; REST: `None` unless the
matching auth-type discriminator matches, matching the existing `case "bearer" =>` / `case "api_key"
=>` split — `token`/`value` are masked whenever `Some`, empty string or not, exactly like today).
`HasSecrets[Config].fields: Set[SecretField[Config]]` is the "declare once" surface — REST needs two
entries (`auth.token`, `auth.value`) because a single config carries either kind of auth, and only
the matching one participates.

**2. No `Redacted[Config]` wrapper type on the response case classes.** Considered: typing
`SqlSourceResponse.config`/`RestSourceResponse.config` as `Redacted[X]`, constructible only via
`HasSecrets[X].redact`, so a raw payload literally cannot type-check into the field. Rejected: this
would change the response case classes' field types, which breaks compilation of
`DataSourceProtocolSpec`'s existing discriminated-union-format tests (they construct
`SqlSourceResponse`/`RestSourceResponse` directly with a raw `SqlSourceConfigPayload`/
`RestApiConfigPayload` to test wire-format round-tripping independent of `fromDomain`) — editing
those tests to accommodate the new type is exactly what the ticket instructs against. Instead,
`SecretRedaction.redact(payload)` is called at the one production call site
(`DataSourceResponse.fromDomain`) and returns a plain, already-masked `Config` — same field types,
zero test churn. The enforcement this gives up (nothing stops a *new* `fromDomain` case from
assigning a raw, non-redacted payload without calling `redact`) is exactly the gap the amended
acceptance criteria names its own mitigation for: assert on the **actual serialized JSON**, which
catches a bypassed call site regardless of whether a type system could have prevented it.

**3. `SecretBackend` is a plain trait with `def mask(raw: String): String`, one object
(`InlineSecretBackend`), no sealed-trait enumeration.** `SecretRedaction.redact` accepts
`backend: SecretBackend = InlineSecretBackend` as a defaulted parameter — the extension point HEL-536
needs (pass a different `SecretBackend`) exists without a second, unimplemented case for a reader to
puzzle over. `InlineSecretBackend`'s doc comment names HEL-536 as the owner of future backends.

**4. `HasSecrets[X]` instances live in each payload type's own companion object in
`DataSourceProtocol.scala`** (`SqlSourceConfigPayload.hasSecrets`, `RestApiConfigPayload.hasSecrets`),
not centralized in the seam module. The generic machinery (`SecretField`, `HasSecrets`,
`SecretBackend`, `InlineSecretBackend`, `SecretRedaction.redact`) lives in
`com.helio.services.SecretField.scala` — mirroring `SchemaInferenceFacade`/`CreateSourceEnvelope`'s
precedent of living in `services/` (not `domain/`) because the payload types the seam operates on are
api-protocol types. Declaring each connector's `HasSecrets` instance next to its own payload type
means a future connector (Sheets/BigQuery/S3/webhook) adds one `implicit val hasSecrets` in its own
protocol file, not an edit to a growing shared registry.

**5. `Connector.scala` gets a `'''Secret redaction'''` doc block**, alongside the existing four
blocks (`'''Refresh semantics'''`, `'''ExecutionContext'''`, `'''Schema inference'''`, `'''Fetch-error
envelope'''`), per that file's established role as the cross-connector contract home. It documents
that a connector whose wire
payload carries secret fields declares a `HasSecrets[Payload]` instance so `DataSourceResponse.
fromDomain` redacts automatically — a pointer for future connector tickets, not a new SPI method (the
`Connector[Config]` trait's `Config` type param is the *domain* config; the seam operates on the
*wire payload* type, one level up, where it already lives today).

## Risks / Trade-offs

- [Risk] A future connector's `fromDomain` case assigns a raw payload without calling
  `SecretRedaction.redact` — decision 2 accepts this isn't compile-time-prevented. → Mitigation: the
  new JSON-assertion tests in `DataSourceProtocolSpec` are the load-bearing check for SQL/REST today;
  `Connector.scala`'s doc block plus this design doc are the pointer for future connectors, whose own
  tickets are responsible for their own redaction tests (explicitly out of scope here per the
  ticket's "per-connector declarations for connectors not yet built").
- [Trade-off] Two `SecretField` entries for REST (bearer token, api-key value) instead of one
  generic "auth secret" field, because the existing behavior masks only the field matching the active
  auth type, not both — collapsing them would either mask a field that was never set (spurious "***"
  on an absent auth kind) or require the same type-discriminator branching `get`/`set` already encode
  per-field, so nothing is saved by merging them.
- [Risk] Ticket AC1 says secrets must never appear in "API responses **and logs**." This change
  addresses the response half only. Verified (not assumed): grepping every `log.error`/`log.warn`/
  `log.info`/`log.debug` call in `SqlConnector.scala`, `RestApiConnector.scala`, `SourceService.scala`,
  and `DataSourceProtocol.scala`, none logs a config/auth object — every call site logs a static
  message plus the caught exception, never `SqlSourceConfig`/`RestApiConfig`/their payload
  equivalents. So the logs clause is satisfied **today**, but only incidentally — this change adds no
  mechanism that would catch a future connector (or a future edit to an existing one) that starts
  logging its raw config, e.g. `log.error(s"fetch failed for $config", e)`. Nothing here would fail if
  that happened. → Whether a log-redaction guard (e.g. a lint rule flagging `SecretField`-covered
  types passed to `log.*`, or a `Redactable`-only logging helper) is worth building is an open
  question for the orchestrator/human to decide; if wanted, it should be a follow-up ticket, not
  built here — out of scope for this change's already-bounded surface.

## Migration Plan

No data migration — `inline` reproduces today's storage (`config` JSON column) and today's redaction
output exactly. Deploy is a pure code change; rollback is a revert.

## Open Questions

None — scope is fully bounded by the HEL-460/HEL-536 split above.

## Planner Notes

- Self-approved: keeping the seam at the wire-payload layer (not threading it through
  `Connector[Config]`'s domain config type) — matches where redaction already lives and avoids
  widening the `Connector[Config]` SPI mid-epic, which the connector-spi design doc's "Sibling
  ownership map" reserves for this ticket only as "redaction stays in `DataSourceResponse.fromDomain`
  per acceptance criteria; centralizing it is out of scope here" for HEL-449 — this ticket is exactly
  that centralization, still inside `fromDomain`.
- Self-approved: no CLAUDE.md production-env table change — the amended ticket explicitly removes the
  env-var switch from scope.
