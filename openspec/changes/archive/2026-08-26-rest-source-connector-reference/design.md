## Context

`RestApiConfig(url, method, auth, headers)` lives in `model.scala`; wire shape in
`RestApiConfigPayload` (`DataSourceProtocol.scala`), decode/encode in
`DataSourceConfigCodec.decodeRest/encodeRest`. HEL-821 (landed, eeeae509) shipped `connectors`
(V93) + `ConnectorRepository`/`ConnectorEntityService`/`ConnectorEntityRoutes` at
`/api/connectors`, with `ConnectorRepository.delete`'s `dependentCount` collaborator
explicitly stubbed to always-zero as this ticket's seam. HEL-536 (landed, eab2afdb) shipped
`connector_credentials` (V92) + `EncryptedSecretBackend`/`ConnectorCredentialRepository` —
`create/get/list/decryptForUse/delete`, consumed as-is. Local dev DB currently has **zero**
`rest_api` rows (verified via `psql`), so migration correctness must be proven via a seeded
representative row, not an existing one — the AC's "real sources, listed by id" requirement is
satisfied against a seeded row in this ticket's own verification, not a claim about production
data that isn't visible from this worktree.

## Goals / Non-Goals

**Goals:** `RestSource` references a Connector; no credential remains on the source; every
pre-existing `rest_api` source still fetches after migration; header precedence is documented
and tested; migration reversibility is stated explicitly; wire contract updated in all four
places; the `dependentCount` seam gets its real implementation; `schemas/` question resolved.

**Non-goals:** templating (HEL-823), UI (HEL-824), REST body/response shaping (HEL-826, a
`body` field is added structurally but not given request-body-shaping semantics), form parity
(HEL-827), agent/MCP surface (HEL-828), credential rotation, a Connector-dedup algorithm,
migration rollback tooling.

## Decisions

### Decision 1: Migration strategy — auto-migrate (a), 1:1, no dedup

Chosen over (b) dual-support and (c) manual migration. (b) is explicitly what caused the
`snapshotId`/`id` fallback mess in HEL-626 (ticket's own citation) — two permanently-live code
paths for the same concept. (c) leaves every pre-existing source silently broken until a human
acts, which fails the AC ("every pre-existing REST source still fetches successfully after
migration") outright — manual migration is not migration until someone does it.

**Why this is a technical decision, not a product one (and why it isn't escalated here):**
the end-user-visible outcome is identical either way — a pre-existing source keeps returning
the same data through the same credential. Nothing about *what* the user's source does changes;
only *where* its credential lives changes, and that is exactly the encrypted-at-rest guarantee
HEL-536/821 were built to provide. The choice between (a) and (b) is a risk-tolerance call
about migration *safety*, not about breaking anyone's data or access — so it is self-approved
here per the Planning rubric, with the reasoning recorded for the human to override if they
see something this worktree can't (e.g. production row count/shape this sandbox has no
visibility into). Flagged explicitly in the delivery report.

**No dedup.** The ticket text offers "dedupe by host+credential, or accept duplicates" as
alternatives. Deduping requires comparing a *new* source's plaintext credential against
*already-encrypted* existing Connectors' credentials — which means decrypting every candidate
Connector's credential during migration just to compare it, multiplying exposure of decrypted
plaintext in memory for a purely cosmetic space-saving. Accepting 1:1 duplicates costs nothing
functionally (each source still works exactly as before) and avoids that exposure entirely.
Chosen: **1:1, no dedup.**

**Revised (skeptic round 1, CR3 — coordinator-resolved, human decision) — this is a
two-halves decision, not one.** The skeptic's design-gate review found the "no frontend caller
exists" premise behind my original Decision-1 framing false: `RestApiForm.tsx`, live and wired
into `AddSourceModal.tsx` (Sources page), submits a bare `{url, method, jsonPath?}` to
`POST /api/sources` today and collects no auth at all. Under the connector-only shape this
ticket originally specified, every submission through that existing, unmodified UI would 400
the moment this ships — a real user-facing regression, not a where-the-credential-lives detail
(confirmed independently by the coordinator, not just the skeptic). Escalated to the human;
resolved: **dual-support the legacy inline shape, on both halves of this ticket, as one
consistent compat story:**

1. **Migration half** (already decided above): every pre-existing `rest_api` row is
   auto-migrated into a synthesized 1:1 Connector, once, at startup.
2. **Create half** (the new part CR3 forced): `POST /api/sources` for `type: "rest_api"`
   continues to accept the legacy bare-`url` shape **alongside** the new `connectorId` shape.
   A bare-`url` create synthesizes an implicit no-auth Connector at request time, exactly as
   the migration synthesizes one for a pre-existing row — same mechanism, same naming
   convention (Decision 1a below), invoked at a different moment (request time vs. startup
   scan) rather than as a second, bespoke compat path. This is deliberately framed as **one**
   dual-support decision applied at two points in the source's lifecycle (initial migration of
   existing rows, and every subsequent create of a new one), not two independently-invented
   mechanisms — the exact failure mode (a second ad hoc code path where one would do) this
   epic has been guarding against since HEL-626.

**Ambiguity guard:** a create request carrying **both** `connectorId` and `url` is rejected
with 400 ("provide exactly one of connectorId or url") — neither silently prefers one nor
silently merges them. Neither the ticket nor the original CR3 resolution covered this case
explicitly; naming it here closes the gap before round 2 of the design gate.

**Consistent with CR6:** the implicit Connector synthesized by a bare-`url` create always uses
`authType: "none"` (Decision 3's `ConnectorAuthShape`) and an empty-string credential — the
same no-auth policy CR6 established. (See the CR4 revision immediately below for the corrected,
precise statement of which layer this actually persists through — round 1's claim that it goes
"through the same validated path" as a direct `POST /api/connectors` call was inaccurate and is
corrected there, not repeated here.)

**Revised (skeptic round 2, CR4) — the two halves bottom out at different layers, stated
plainly rather than papered over.** Round 1's "one compat story, not two" claimed a single
shared synthesis helper for both halves; round 2 correctly found this cannot be literally one
code path, because `ConnectorEntityService.create(req, user)` requires an
`AuthenticatedUser` (`ConnectorEntityService.scala:31`), while the startup migration (Decision
7) iterates rows across arbitrary owners with no request context at all — it has no user to
authenticate as. Restated concretely: **"one compat story" means one *shared policy*
(auto-migrate/auto-create with no dedup, `authType: "none"`, the naming convention, the
`implicit: true` flag — Decision 1a), implemented as a small shared pure helper,
`ImplicitConnectorConfig.forLegacySource(name, baseUrl, auth): (String, String, String,
String)` (returns the name, `ConnectorAuthShape` JSON, credential plaintext, and credential
name to use), that both call sites invoke and then each persist through their own layer**:
- **Create path** (task 1.2a): calls the helper, then persists via
  `ConnectorRepository.create` directly (bypassing `ConnectorEntityService.create`'s
  HTTP-request validation, since there is no incoming `ConnectorCreateRequest` to validate —
  the values are already trusted, server-synthesized data, not client input) — still inside
  the request's existing `AuthenticatedUser` context, still owner-scoped.
- **Migration path** (task 4.1): calls the same helper, persists via
  `ConnectorRepository.create` directly (as already designed — the migration never had a
  request-scoped user to go through the service layer with).

Both land on `ConnectorRepository.create`, not `ConnectorEntityService.create` — correcting
round 1's inaccurate "routed through the same validated path" claim. Both synthesized-connector
paths bypass `ConnectorEntityService.create`'s HTTP-request validation entirely (there is no
incoming request to validate for either), so CR6's service-layer `authType == "none"` empty-
credential carve-out is unaffected by this correction and stays exactly as CR6 specified —
it exists for the **separate**, still-real case of a user directly calling `POST
/api/connectors` with an explicit `authType: "none"` body (HEL-824's future UI, or a manual
API call today), which does go through `ConnectorEntityService.create` and does need the
carve-out. What genuinely *is* shared between the two synthesis call sites: the policy helper
above, so the naming convention, auth shape, and `implicit` flag can never drift between them.

### Decision 1c: `/api/sources/infer` and `/api/sources/test` are the same UI flow's other two
legs, and they need a different resolution — ephemeral, never persisting

**Revised (skeptic round 2, CR1/CR2/CR3) — ground truth from `SourcePreviewRoutes.scala`,
`SourceService.scala`, `AddSourceModal.tsx`, `RestApiForm.tsx`.** Decision 1's dual-support
covered `POST /api/sources` only. But `AddSourceModal.handlePreview` — the **hard precondition**
for ever reaching create (`setStep("preview")` only fires on a successful
`POST /api/sources/infer`) — and `RestApiForm`'s own "Test connection" button
(`POST /api/sources/test`) both post the identical bare `{url, method, jsonPath?}` shape today,
and both decode straight into `RestApiConfigPayload` in `SourcePreviewRoutes` →
`SourceService.inferRest`/`testRest`. Without covering these two, the existing UI's own
"Preview schema" step fails before a user can ever reach the create call Decision 1 fixed —
the dual-support would be dead code from the UI's perspective.

**These two routes get bare-`url` dual-support too — but resolved *ephemerally*, never by
persisting a Connector.** `infer`/`test` never create a DataSource, and the existing UI never
sends auth on either call (only `url`/`method`/`jsonPath` — verified: no auth field exists in
`RestApiForm.tsx`'s `buildConfig`). So a bare-`url` infer/test needs no Connector round-trip at
all.

**Revised (skeptic round 3, CR1/CR2) — a concrete, structurally distinct carrier type, not a
sentinel `connectorId`.** Round 2's "sentinel `RestApiConfig` with `connectorId =
'__ephemeral__'`" phrasing was unimplementable as written (Decision 3's `RestApiConfig` has no
`url` field left to carry the bare URL on) and, worse, would have been a resolution/ownership
**bypass**: `buildRequest` special-casing a `connectorId` value to skip the ownership check
entirely is a hole a client could drive by hand-crafting `config.connectorId =
"__ephemeral__"` on a real, persisted `POST /api/sources` call, since nothing in Decision 3's
`connectorId` field was ever scoped to reject it. Fixed, concretely: a distinct, small,
**never-persisted** `EphemeralRestConfig(url: String, method: String, headers: Map[String,
String])` type, used **only** as the in-memory argument to a new `RestApiConnectorDriver.
fetchEphemeral(config: EphemeralRestConfig): Future[Either[String, JsValue]]` overload (and its
`inferSchema`/`testConnection` equivalents) — it never implements or extends `RestApiConfig`,
never round-trips through `DataSourceConfigCodec`, and is never reachable from
`ConnectorRepository`/`DataSourceRepository` at all. `fetchEphemeral` builds the request
directly from `url`/`method`/`headers` with no auth and no normalizing join (there is no
`baseUrl` to join against) — byte-for-byte what today's driver already does for these two
routes. `POST /api/sources`' `connectorId` field, by contrast, is validated at the
`RestApiConfigPayload.toDomain` decode boundary to be a well-formed connector id that resolves
via `findByIdOwned` — the reserved sentinel strings (`__unmigrated__`, `__malformed__`, and
this decision's own ephemeral path, which never touches `connectorId` at all) simply cannot
arise from client input at that boundary, closing the bypass structurally rather than by
convention. Naively routing bare-`url` infer/test through Decision 1's implicit-Connector
*create* synthesis was the trap CR2 (round 2) originally flagged: that would persist a new
`connectors` row on every single "Test connection"/"Preview schema" click, an unbounded
row-creation path with no cleanup story. The ephemeral resolution avoids that entirely — it is
a genuine divergence from the create path's behavior, and this decision states it explicitly
rather than letting "one compat story" paper over it.

A `connectorId`-carrying infer/test request (the new-shape path, for a caller previewing
against an already-created Connector) resolves that Connector exactly as Decision 3 describes
for create/fetch — ownership-scoped via `findByIdOwned`, still never persisting anything new.

**User threading (CR3):** `SourceService.inferRest`/`testRest` currently take only a payload,
unlike `createRest(request, user)`. Both gain an `AuthenticatedUser` parameter (the routes
already hold `user: AuthenticatedUser` as a constructor field on `SourcePreviewRoutes` — this
is a threading fix, not a new capability) so a `connectorId`-carrying request can be
ownership-scoped exactly like every other Connector lookup in this design. The bare-`url`
ephemeral path does not need it (no Connector is looked up), but the signature carries it
uniformly rather than having two different method shapes for the two request variants.

**Revised (skeptic round 3, CR3) — a third, previously-uncovered live consumer.**
`PipelineService.resolveInlineSourceSchema` (`PipelineService.scala:338-355`) calls
`RestApiConfigPayload.toDomain` then `inferSchema` for an inline `rest_api` source embedded in
a pipeline proposal, reachable from `POST /api/pipelines/apply-proposal` and
`.../analyze-proposal`. It breaks at compile time under the new payload shape and needs the
same bare-url-vs-connectorId decision Decision 1c already made for `infer`/`test` — chosen:
**identical treatment** — a bare `url` in an inline pipeline-proposal source resolves through
the same `EphemeralRestConfig`/`fetchEphemeral` path (never persists a Connector; a pipeline
proposal is itself provisional, so persisting a Connector for a proposal that may never be
applied would be worse than for a UI preview click), a `connectorId` resolves the real
Connector. `resolveProposalSourceSchema` already holds the acting user (line 292) — task 1.7's
scope grows to thread it the remaining one call down to `resolveInlineSourceSchema`.

### Decision 1a: Implicit Connectors must be visibly identifiable, not mystery rows

Both halves of Decision 1's dual-support (migration and create) synthesize a Connector nobody
explicitly asked to create as a first-class entity. Left unmarked, these become exactly the
kind of unaccountable row the coordinator flagged as a real risk once dual-support tickets
(historically, per HEL-626) are never actually retired. Chosen:

- **Naming convention**, consistent across both synthesis points: `name = s"Auto: $sourceName"`
  for a create-time implicit Connector, `name = s"Migrated: $sourceName"` for a startup-
  migration one (already specified above) — distinct prefixes so the two synthesis paths
  remain individually traceable in a support/debugging context, even though they share one
  mechanism.
- **Structural flag**, not just a name (names are mutable/renamable and shouldn't be the only
  signal): `connectors.config` (Decision 3's `ConnectorAuthShape`) gains an `implicit: true`
  field, set by both synthesis points, absent (or `false`) for a Connector a user created
  directly via `POST /api/connectors`.
- **HEL-824 visibility, noted for that ticket, not built here:** the Connectors list HEL-824
  ships should be able to surface `implicit: true` Connectors distinctly (e.g. a badge) so a
  user isn't confused by rows they never explicitly created — recorded here as a heads-up for
  HEL-824, not a task of this ticket.

**Revised (skeptic round 2, CR5) — `implicit` must be server-owned, not client-settable.**
`ConnectorEntityService.create`/`update` currently pass `req.config` through **verbatim** to
storage — a client-supplied `config.implicit = true` would be persisted as-is on a genuinely
user-created Connector (defeating the flag's purpose), and `update` could just as easily strip
`implicit: true` off a synthesized one via a normal `PATCH`. Fixed: `implicit` is a
**server-owned field**, never read from the client-supplied `config` on either `create` or
`update` — both strip/ignore any `implicit` key present in the request body and set the field
themselves (`false` for a client-initiated `POST /api/connectors`, `true` only when the write
originates from Decision 1's synthesis helper, Decision 1c's ephemeral path is exempt since it
never persists anything). `Decision 3`'s `ConnectorAuthShape` JSON block (below) is updated to
list `implicit` explicitly as part of the shape, so its presence isn't defined in two places
that could drift.

### Decision 1b: Retiring dual-support is HEL-827's job, recorded, not filed

The coordinator was explicit: removing this dual-support (once `RestApiForm` gains a real
Connector picker) belongs to **HEL-827** (REST source form parity), and this compat path is
exactly the kind of thing that becomes permanent if nobody schedules its removal. This design
document records that obligation; per this run's instructions, no new ticket is filed here —
the coordinator triages it. **Out-of-scope finding, recorded for the coordinator (not fixed,
not filed):** HEL-827 should remove the `POST /api/sources` bare-`url` acceptance path (and
ideally offer a one-time backfill/dedup of the `implicit: true` Connectors it leaves behind)
once `RestApiForm` is replaced with a Connector-aware form.

### Decision 2: Where connectorId lives — inside the existing opaque `config` JSONB, no schema change

`data_sources.config` is already an opaque per-kind JSONB blob (V4-era); `RestApiConfig`
already lives entirely inside it. `connectorId` is just another field in that same JSON shape
— it does not need a real `data_sources` column, an FK, or a migration to add one. This means:
no new Flyway migration, no new RLS-protected table, **nothing to add to HEL-842's
`RlsPolicyGuardSpec` allowlist** (the allowlist covers tables, and this ticket adds none — the
"add it in this PR" contract in the ticket's own text is honored by there being nothing to
add, not by skipping the check). `connectors`' own RLS (HEL-821, V93) is unchanged and already
covers Connector reads.

Referential integrity for `connectorId` (does the referenced Connector exist, is it owned by
the same user) is enforced at the **application layer** (service/route, on create/update),
mirroring how `data_sources` already has no DB-level FK into anything else it references —
consistent with the existing pattern, not a new one.

### Decision 3: `RestApiConfig` target shape

```scala
final case class RestApiConfig(
    connectorId: String,             // required; empty string is invalid, rejected at decode (Decision 6)
    endpoint: String = "",           // path appended to the Connector's baseUrl; may be empty (call the base URL directly)
    method: String = "GET",
    queryParams: Map[String, String] = Map.empty,
    headers: Map[String, String] = Map.empty,  // source-level; merges over the Connector's config-level defaults
    body: Option[String] = None      // structural placeholder for HEL-826; unused by this ticket's fetch path beyond carrying it through wire<->domain
)
```

`auth` is removed entirely — not defaulted to `NoAuth`, not left as a vestigial `Option` — so
"no credential remains on the source" is enforced by the type itself, not by convention.

`RestApiConnectorDriver.buildRequest` resolves `connectorId` → `Connector` (via
`ConnectorRepository.findByIdOwned`) → decrypts its credential (via
`ConnectorCredentialRepository.decryptForUse`, the existing outbound-use path from HEL-536/821
Decision 6 — never a client-facing read) → builds the full URL by joining `connector.baseUrl`
and `config.endpoint` through a normalizing join (never naive string concatenation — collapse
a doubled `/` at the seam, insert one if neither side has it; the migration's own URL split,
Decision 7, must round-trip through this same join) → applies auth per **Decision 3's revised
auth-shape contract below** → merges headers per Decision 4.

**Revised (skeptic round 1, CR1/CR2) — `connectors.config`'s auth shape, concretely, and
proven secret-free.** The Connector's `config` JSONB column carries a new, dedicated
`ConnectorAuthShape` — **not** a reuse of `RestApiAuthPayload` (which contains `token`/`value`,
the credential itself; HEL-821 Decision 1 fixes `connectors.config` as non-secret extras only,
and writing a credential there would defeat HEL-536/821's encrypted-at-rest guarantee):

```json
// connectors.config for kind = "rest_api"
{ "authType": "none" | "bearer" | "api_key",
  "apiKeyName": "<header/query param name>",   // present only when authType = "api_key"
  "apiKeyPlacement": "header" | "query",         // present only when authType = "api_key"
  "defaultHeaders": { "...": "..." },            // optional, Decision 4
  "implicit": true | false                       // server-owned (Decision 1a revised, CR5);
                                                   // never read from client-supplied config
}
```

The credential *value* (bearer token, or api-key value) lives only in
`connector_credentials` via the normal `credentialId` FK, decrypted only through
`decryptForUse`. `RestApiConnectorDriver.buildRequest` reads `authType`/`apiKeyName`/
`apiKeyPlacement` from the Connector's `config`, reads the decrypted plaintext from
`decryptForUse`, and combines them exactly as `buildAuthHeaders`/`injectQueryParam` do today —
same three-way behavior (`none`/`bearer`/`api_key`×`header`/`query`), just sourced from two
places (shape from `config`, value from the decrypted credential) instead of one `RestApiAuth`
value. A unit test asserts `connectors.config` for a bearer/api-key Connector never contains
the string `token`/`value` as a JSON key, closing CR2 concretely rather than by convention.

### Decision 4: Header precedence — source overrides Connector, key-by-key

The Connector's `config` JSONB may carry default headers (HEL-821 Decision 1 anticipated this:
"REST's optional default headers"). Final headers = `connectorHeaders ++ sourceHeaders` (Scala
`Map` union semantics — right-hand operand wins on key collision), i.e. **source headers win**.
Rationale: the source is the more specific, more recently authored artifact; a source author
overriding a shared Connector default (e.g. a per-endpoint `Accept` header) is a legitimate,
expected use case, while a Connector silently overriding a source's explicit header would be
surprising. Documented in `RestApiConfig.headers`'s scaladoc and in the modified
`rest-api-connector` spec delta; tested with a colliding-key case asserting the source's value
wins.

### Decision 5: `dependentCount` — real query, reachable 409

**Revised (skeptic round 4, CR2) — the original closure could not be written, and the
"no further change needed" claim was false against source.** `ConnectorRepository.delete`'s
`dependentCount` collaborator is typed `ConnectorId => Future[Int]` (`ConnectorRepository.
scala:127`, `ConnectorEntityService.scala:19`) — no channel for a `user` — and
`ConnectorEntityService` is actually constructed at `ApiRoutes.scala:432-439` (app-lifetime,
not `Main.scala`), where no `AuthenticatedUser` exists to close over. The original
`(id: ConnectorId) => dataSourceRepo.countRestSourcesReferencing(id, user)` closure this
decision specified could not have been written at that site.

**No signature change to HEL-821 code is needed, though — the fix is in what the query itself
is allowed to assume.** By the time `dependentCount(id)` runs inside `delete`, ownership has
**already** been verified: `delete`'s own flow (`ConnectorRepository.scala:129-141`) calls
`findByIdOwned(id, user)` first and only reaches `dependentCount(id)` inside the `Some(existing)`
branch. Combined with Decision 2's app-layer rule that a source can only ever be created
referencing a `connectorId` the creating user already owns (task 2a.2a enforces this at decode
time — an unresolvable/foreign connectorId is rejected before a source can ever be persisted
with it), **any `data_sources` row whose `config->>'connectorId'` matches this id is
guaranteed, by construction, to belong to the same owner as the connector already verified
above.** So the count query needs no user-scoping at all: `dataSourceRepo.
countRestSourcesReferencing(connectorId: ConnectorId): Future[Int]` (no `user` parameter),
implemented to run under `ctx.withSystemContext` (the privileged pool — safe here because it
returns only a count, never row content, and the counted rows are owner-guaranteed by the
invariant above, not by an RLS check this query happens to bypass). This keeps the
`ConnectorId => Future[Int]` collaborator type **exactly as HEL-821 shipped it** — the
original "no further route/repository change needed... only a new collaborator wired in at
construction" claim turns out to be correct after all, just not with the `user`-closing
lambda originally written. Construction: `ApiRoutes.scala:432-439`'s existing
`connectorEntityServiceOpt` site (not `Main.scala` — correcting the earlier draft's wrong
file), where `dataSourceRepo` is already in scope, wires
`dependentCount = (id: ConnectorId) => dataSourceRepo.countRestSourcesReferencing(id)`.

Verified by a test that creates a Connector, creates a `rest_api` source referencing it, then
asserts `DELETE /api/connectors/:id` returns 409 and performs no deletion.

### Decision 6: Fail-loud decode — no silent corruption

`DataSourceConfigCodec.decodeRest`'s current behavior — catching `DeserializationException`/
`NoSuchElementException` and silently returning `RestApiConfig(url = "")` — is exactly the
defect class the ticket calls out (HEL-814/HEL-671: a decoder that tolerates a mismatched
config and quietly produces a wrong value). Post-migration, every stored `rest_api` config
**must** contain a valid `connectorId`; a config that doesn't (a genuinely malformed row, or —
transiently, mid-migration — an unmigrated legacy row the migration hasn't reached yet) must
never silently decode into a `RestApiConfig` with an empty/garbage `connectorId` that a
fetch attempt would then treat as "valid but pointing nowhere."

Chosen: `decodeRest` becomes `decodeRest(raw: String): Either[String, RestApiConfig]`
(propagating the `Either` the migration/read paths already need to handle explicitly), with
three distinct outcomes, never conflated:
1. **New shape, valid `connectorId`** → `Right(RestApiConfig(...))`.
2. **Legacy shape** (`url` present, no `connectorId`) → a distinguished `Left("legacy-unmigrated")`
   sentinel the migration path matches on explicitly (this is the *expected* transient state
   for a row the startup migration hasn't processed yet, not an error) — never silently
   coerced into the new shape with a synthesized empty `connectorId`.
3. **Genuinely malformed** (neither shape parses) → `Left("malformed: <curated message>")`,
   logged at `error`, never crashes the caller, never silently defaults.

Every call site of the old `decodeRest`/`encodeRest` (fetch, preview, refresh, wire responses)
is updated to handle the `Either` explicitly — most reject with a clear 5xx/log rather than
proceeding on a zero-value config. This is a wider blast radius than a minimal patch, but the
ticket explicitly asks to design against this defect class, and a `Left` that's silently
`.getOrElse`'d back to a zero value anywhere reintroduces exactly the bug being fixed.

**Revised (skeptic round 1, CR5) — the `rowToDomain`/`findAll` call site, named explicitly.**
`DataSourceRepository.rowToDomain` decodes every row synchronously while mapping
`findAll`/`findById` results — neither "drop the row" (a source silently vanishes from
`GET /api/sources`) nor "throw" (one bad row fails the whole account's list call) is
acceptable. Chosen: a row whose `decodeRest` returns `Left` is mapped to a **sentinel
`RestSource`** carrying a reserved `connectorId = "__unmigrated__"` (for
`Left("legacy-unmigrated")`, the expected transient pre-migration state) or
`connectorId = "__malformed__"` (for `Left("malformed: ...")`), both logged once per row at
`warn` (not `error` — this is a list-read path, not a fetch attempt) the first time they're
encountered in a process lifetime (a simple in-memory seen-set keyed by source id, to avoid
log-spamming every list call). The row still appears in `GET /api/sources` (nothing vanishes),
but any subsequent fetch/preview/refresh attempt against it fails fast at Decision 3's
Connector-resolution step (`connectorId` "__unmigrated__"/"__malformed__" resolves to
`findByIdOwned` returning `None`, hitting the existing curated-error path from task 2.3) rather
than silently succeeding against nothing. In steady state (post-migration, healthy rows) this
sentinel path is never exercised — it exists only for the transient window before the startup
migration (Decision 7) completes, or for a genuinely malformed row an operator must fix by hand.

**Revised (skeptic round 1, CR6) — no-auth REST sources remain creatable.**
`ConnectorEntityService.create` rejects an empty `credentialPlaintext` with `400 "credential is
required"` today, which would make a no-auth REST source (a normal case — many public JSON
APIs need no auth) uncreatable once every source must reference a Connector. Chosen: relax
`ConnectorEntityService.create`'s validation to accept an explicitly-empty credential **only**
when the request's `config.authType` (Decision 3's shape) is `"none"` — never for `bearer`/
`api_key`, where an empty value stays rejected exactly as today. This is a small, explicit
carve-out in existing HEL-821 code (not a new bypass path like the migration's direct
`ConnectorRepository.create` call), reviewable as its own diff hunk, with its own test
(`authType: "none"` + empty credential → 201; `authType: "bearer"` + empty credential → 400
unchanged).

**Revised (skeptic round 1, CR4) — the agent/MCP wire surface is not deferrable to HEL-828,
because it does not compile otherwise.** `AssistantProposalToolSchemas.scala` advertises a
`rest_api {url, method?, auth?, headers?}` tool schema (consumed by
`AssistantProposalToolSchemasSpec` and `PipelineProposalProtocol.scala`), and
`AssistantToolExecutor.test_connection` builds an **inline** (source-less, Connector-less)
`RestApiConfigPayload` to test a connection before a source exists. Both break at compile time
the moment `RestApiConfigPayload` drops `url`/`auth`. Scope, explicitly bounded to "keep it
compiling and behaviorally sane," not "build the HEL-828 agent-native Connector surface":
update `AssistantProposalToolSchemas`' advertised schema to the new
`{connectorId, endpoint, method?, queryParams?, headers?}` shape; for `test_connection` on an
inline rest config, the tool now requires a `connectorId` referencing an already-created
Connector (an agent testing a not-yet-created inline `url+auth` combination is no longer
expressible — this is the same capability boundary HEL-828 will formalize, just held to its
minimum compiling/correct shape here, not extended). Full agent-native Connector authoring
(creating a Connector via the assistant tool loop) stays HEL-828's scope.

### Decision 7: Migration mechanism — idempotent startup pass, not a Flyway SQL migration

Encryption requires the JVM-side `EncryptedSecretBackend`/`MasterKeyProvider` (the master key
never touches the DB layer) — a raw SQL Flyway migration cannot perform it. So the migration is
application code: `RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, logger)`,
invoked once from `Main.scala`'s guardian setup, after `Database.initApp` (Flyway) and before
`HttpServer.start` — the backend does not begin serving traffic on a REST source until any
legacy rows it owns have either been migrated or explicitly logged as failed-and-skipped.

**Idempotency:** for each `rest_api` `data_sources` row, `decodeRest` (Decision 6) is run
first. `Right(...)` → already migrated, skip. `Left("legacy-unmigrated")` → migrate: parse the
legacy `RestApiConfigPayload` (old shape, kept as a private `LegacyRestApiConfigPayload` for
exactly this one call site — not exposed on the public API), split `url` into
`baseUrl`/`endpoint` (scheme+authority → `baseUrl`; path+query → `endpoint` +
`queryParams`, using `pekko.http.scaladsl.model.Uri`'s existing parser — no new URL-parsing
code, and round-tripped through Decision 3's normalizing join so the migrated `baseUrl +
endpoint` reconstructs the original URL exactly), synthesize a Connector via
`ConnectorRepository.create(ownerId, name = s"Migrated: $sourceName", kind = "rest_api",
baseUrl, config = <Decision 3's ConnectorAuthShape JSON, populated from the legacy `auth`
value's discriminator/name/placement — never `"{}"`>, credentialPlaintext = <the legacy auth's
token/value, or `""` for NoAuth>, credentialName = s"Migrated credential: $sourceName")`, then
overwrite the source's `config` with the new shape via a new
`DataSourceRepository.updateConfigInternal(id: DataSourceId, config: String)(implicit ...):
Future[Boolean]` method — **revised (skeptic round 3, CR6)**, correcting the round-1/2 design's
reference to a non-existent `updateConfig`. `DataSourceRepository` has no such method today
(only `update(source, user)`, which requires an `AuthenticatedUser` the startup migration does
not have — the identical problem CR4 already forced onto the Connector side, resolved the same
way here). `updateConfigInternal` runs under `ctx.withSystemContext` (`DbContext`'s existing
privileged-pool path, already used elsewhere for system-initiated writes that have no
request-scoped user) rather than `withUserContext` — an explicit, named RLS-context choice for
a credential-bearing migration, not left to implementer inference. `Left("malformed: ...")` →
log at `error` with the source id, skip (never crashes startup, never touches the row) —
surfaced in the delivery report as a manual-follow-up item if any local/dev row hits this
branch during verification.

**Revised (skeptic round 3, CR5) — the ownerless-legacy-row case.** `data_sources.owner_id` is
nullable (`V35__rls_owner_only_tables.sql`, nullable since V14 for pre-ownership-model rows),
while `connectors.owner_id` is `NOT NULL` (`V93`). A legacy `rest_api` row with `owner_id =
NULL` has no owner to synthesize a Connector under — `ConnectorRepository.create(ownerId:
UserId, ...)` has no value to pass, and `ctx.withUserContext(ownerId.value)` has no id to set.
Treated as a fourth branch, alongside valid/legacy-unmigrated/malformed (Decision 6): an
ownerless legacy row is logged at `error` with the source id and **skipped**, identically to
the malformed branch — it is not attempted, not crashed on, and not silently mis-owned to some
default account. This is the explicit answer to the ticket's "a source whose config has no
credential, a malformed one, or one already migrated" enumeration's implicit fourth case.

**Revised (skeptic round 1, CR7) — round-trip proof methodology.** Task 4.5's verification
must capture the pre-migration baseline explicitly: fetch through the legacy path first and
record the response, run the migration, fetch again through the new path, and assert the two
responses match. Covers both a bearer-auth and an **api-key-in-query** legacy source (CR1
identified query-placement api-key as the case most likely to silently break, since the
placement/name info has nowhere to live without Decision 3's revision above).

Re-running (a restart) is a no-op for already-migrated rows (branch 1 above) — safe to run on
every boot rather than needing a separate one-shot admin trigger.

**NoAuth sources get a real (empty-string) credential**, not a nullable `credential_id`. This
avoids loosening HEL-821's `connectors.credential_id UUID NOT NULL` constraint (a schema
change to already-shipped, reviewed code) for a case (no-auth Connector) HEL-821's design
never anticipated needing. `ConnectorCredentialRepository.create` with `plaintext = ""` still
encrypts and stores that empty string exactly like any other value — this is a valid encrypted
row, not a special case in the encryption path.

### Decision 8: Reversibility — stated explicitly as not automatically reversible

No rollback tool is shipped in this PR. The migration is **technically** recoverable in
principle (a Connector's credential can be decrypted via the existing
`ConnectorCredentialRepository.decryptForUse` path and a legacy-shaped config reconstructed),
but no automated "undo" script exists, and building one is disproportionate to what the AC
requires (a stated decision with reasoning, not tooling). Stated explicitly, per the AC's
second branch: **this migration is not automatically reversible.** Rationale: reversal is a
rare, one-time operational need (a bad deploy) better served by restoring the pre-migration DB
snapshot/backup than by bespoke in-app rollback code that would itself need to be
trusted not to further corrupt data on the way back.

### Decision 9: `schemas/` — confirmed absent, not added here

Confirmed (as the ticket asked): no REST-source JSON Schema exists under `schemas/` today —
the wire contract lives only in the Scala formats (`DataSourceProtocol.scala`) plus
`openspec/specs/rest-api-connector/spec.md`. Adding one is out of scope for this ticket: every
other connector kind (`sql`, `csv`, `text`, `pdf`, `image`, `static`) has the identical gap
(no per-kind schema under `schemas/` either — this is a pre-existing, repo-wide pattern, not
something HEL-822 introduced), so fixing it for `rest_api` alone would be an inconsistent,
piecemeal application of a standard the rest of the codebase doesn't follow. Recorded as an
out-of-scope finding for the human (see delivery report), not fixed and not filed as a ticket
per this run's explicit instruction.

### Decision 10: `RestApiConnectorDriver.metadata.requiredFields` — a fifth published contract surface

**Added (skeptic round 3, CR4).** `RestApiConnectorDriver.metadata.requiredFields` still
declares `Vector("url")`; it is served to clients via `GET /api/connector-types`
(`ConnectorRoutes.scala`, HEL-825's kind-metadata surface) and is test-pinned by
`ConnectorRegistrySpec` (`rest.requiredFields.map(_.name) shouldBe Vector("url")`). The
ticket's AC ("wire contract updated in all four places") undercounts by one — this is the
fifth published surface the contract change touches. Chosen: `requiredFields` advertises
`Vector("connectorId")` as the primary required field for the new shape (`endpoint` stays
optional, matching `RestApiConfig`'s default); the legacy `url` alternative is **not** also
listed as a required field (a "required fields" list describing two mutually-exclusive
alternatives would be misleading to a client trying to satisfy it) — dual-support for `url` is
documented in prose in the metadata's `displayName`/description area (or left implicit, since
`requiredFields` is advertising the *primary*, forward path, not enumerating every legacy
compatibility branch) rather than encoded into this list. `ConnectorRegistrySpec`'s pinned
assertion is updated to `Vector("connectorId")` in the same PR, not left to silently pass on
stale data or silently fail CI.

### Decision 11: Pipeline-run connector resolution — internal lookup, not owner-scoped, mirroring `findByIdInternal`'s existing precedent

**Added (skeptic round 4, CR1) — a fourth live consumer, found only by broad grep, that
neither of the prior three rounds named.** `InProcessPipelineEngine.scala:127`'s `RestSource`
fetch (`connector.fetch(r.config, maxRunRows)`) carries no `AuthenticatedUser` at all — it is
neither `SourceService` nor a route, the two places task 2.2 named. Naively requiring
`findByIdOwned(connectorId, actingUser)` here would **regress an already-shipped capability**:
`PipelineRunService.submit` deliberately loads the source via `findByIdInternal`
(`PipelineRunService.scala:150-163`, an existing, already-reviewed comment: "pipeline ACL
confirmed by `findByIdShared`… so editor grantees are not blocked by V35 RLS") so that HEL-279
grantees who are not the resource owner can still run a shared pipeline — HEL-758 wired
`rest_api` through this exact path. `PipelineSchedulerService` has the mirror-image problem: a
cron-fired run authenticates as `pipeline.ownerId` (`PipelineSchedulerService.scala:110`),
which is not necessarily the *data source's* (or Connector's) owner.

Chosen: **mirror the precedent the codebase already established and already reviewed for the
identical shape of problem.** Add `ConnectorRepository.findByIdInternal(connectorId:
ConnectorId): Future[Option[Connector]]` — no ownership check, running under
`ctx.withSystemContext` — used **only** by the pipeline-execution path
(`InProcessPipelineEngine`/`PipelineRunService`), never by `SourceService`/routes/
`ConnectorEntityService`, which keep using `findByIdOwned` exactly as designed. The ACL
argument is identical to `DataSourceRepository.findByIdInternal`'s existing one: the pipeline
itself is the access-control boundary for a pipeline *run* (`findByIdShared` already gates who
may run it), not per-resource ownership of every artifact the run happens to touch — this
decision extends that already-accepted boundary to the Connector the run's REST source now
references, rather than inventing a second, stricter rule that would silently break a
capability that works today. `decryptForUse` (HEL-536) already has no ownership check of its
own — this was already an internal-use-only path, unaffected by this decision.

Threading (compile-level, alongside the semantic fix above): `fetch`'s new
Connector-resolving shape threads engine → `PipelineRunService` (which already holds the
context needed — `submit`/`previewStep`/`executeRun` all resolve a source before fetching) →
the `fetchOverride`/test seams, updated to match.

Not applicable — this change does not touch `.husky/**` or any script a pre-commit hook
invokes.
