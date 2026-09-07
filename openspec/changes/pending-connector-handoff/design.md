# Design — Pending-connector handoff

## Context

See proposal.md — Why. Ground truth probed at base `8231b191`:

- `connectors.credential_id` is `UUID NOT NULL REFERENCES connector_credentials(id) ON DELETE RESTRICT`
  (V93); `Connector.credentialId` is non-optional. `ConnectorRepository.create` mints the credential first,
  then inserts, compensating on failure; `credential_id` is never caller-supplied.
- `ConnectorRepository.findByIdOwned`/`findByIdInternal` have exactly **three** callers:
  `RestApiConnectorDriver.resolveConnector` (77, 78), `SourceService.checkConnectorKind` (182), and
  `ConnectorEntityService` (45, 100). `WorkspaceContextService` is **not** one — it calls `findAll`
  (253) to build the agent's workspace context, a separate exposure (D4a).
- `credentialId` is further consumed inside `ConnectorRepository` by `rotateCredential` and `delete` (both
  `credentialRepo.delete(existing.credentialId, …)`), and at `RestApiConnectorDriver:125`
  (`decryptForUse`). `RestSourceConnectorMigration:131` is a *write* site (legacy implicit backfill).
- `SqlConnectorDriver` holds no `ConnectorRepository` — `SqlSourceConfig` carries its own credentials. Not a
  chokepoint.
- HEL-590's `share_tokens` (V101) stores only `TokenHashing.sha256Hex` of a 256-bit `SecureRandom` token,
  checks `expires_at`/`revoked_at` **in Scala** (`ShareToken.isActive`) after one privileged-pool lookup
  (`findActiveByHash` via `ctx.withSystemContext`), and collapses every failure to one `false`.
- `PublicDashboardRoutes` is the only optional-auth tree, mounted in `ApiRoutes` inside
  `authDirectives.optionalAuthenticate`, still behind rate-limiting and CSRF. `AppRoutes.tsx` places
  `/dashboards/:dashboardId/panels` outside `ProtectedRoute` as the public frontend precedent.
- `helio-mcp`'s `helioApi.createConnector` hardcodes `credential: ""` — no secret is parameterizable.

## Goals / Non-Goals

**Goals.** Pendingness structural, not conventional; the HEL-590 token contract reused in shape; no second
credential-write path. **Non-Goals.** No agent polling tool, no SQL-connector handoff, no change to envelope
encryption or key rotation, no relaxation of the direct authenticated create path.

## Decisions

### D1 — Pendingness is the absence of a credential, not a status column

`credential_id` becomes `NULL`-able; `Connector.credentialId` becomes `Option[ConnectorCredentialId]`;
`isPending` is `credentialId.isEmpty`. *Alternative rejected:* a `status TEXT` column, which can disagree
with credential presence and gives every consumer a check it can forget. `Option` forces the compiler to
surface every site that assumed a credential — that error list **is** the chokepoint enumeration.

**Asymmetry with `authType: "none"`:** a no-auth Connector still gets a real credential row holding an
encrypted empty string (`ImplicitConnectorConfig:20-22`). Pending is genuinely *no row*. A no-auth Connector
is complete and usable; a pending one is neither. Do not conflate them.

### D2 — Completion tokens mirror `share_tokens` exactly

New table `connector_completion_tokens(id, connector_id FK, user_id FK, token_hash TEXT UNIQUE,
expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ NULL, superseded_at TIMESTAMPTZ NULL,
created_at)`, identical owner-only RLS shape,
explicit `GRANT SELECT, UPDATE` to `helio_privileged`. Token = 32 bytes `SecureRandom`, url-safe Base64,
stored only as `TokenHashing.sha256Hex` — reuse it, do not add a second hashing helper. Two deliberate
divergences, both tightening: `expires_at NOT NULL` (never an unbounded slot) and consumption replacing
revocation (single-use, D3).

### D3 — Single-use, consumed on successful bind, atomically

Binding and consumption must be atomic; a crash between them leaves a live token against a completed
Connector. Consume via a conditional `UPDATE … WHERE consumed_at IS NULL AND superseded_at IS NULL AND expires_at >
now()`, treating a zero-row result as "no longer usable" — this closes the concurrent double-submit race a
read-then-write check would leave open. **Every** validity condition must appear in this predicate, not only
in the in-memory validator: otherwise a token validated as live, then superseded by a concurrent re-mint
(D9), would still satisfy a `consumed_at IS NULL`-only predicate and bind — reopening for supersession
exactly the race this decision closes for double-submit. A submission rejected for an empty/invalid
credential must **not** consume the token.

### D4 — Guard at every chokepoint independently; fetch-time is authoritative

Three guards, deliberately not factored into one shared call so removing one does not silently disable the
others (the HEL-845 doc comment makes the same argument for its kind check):

1. `RestApiConnectorDriver.resolveConnector` — **authoritative**, on both the `Owned` and `Internal`
   branches, placed *beside* the existing kind guard, before URI composition and before any
   `decryptForUse` call.
2. `SourceService.checkConnectorKind`'s caller — a create-time refusal, as a separate check from the kind
   check, so a pending Connector of the *correct* kind is still refused.
3. `ConnectorEntityService` read paths permit reading a pending Connector's metadata (the owner must see
   it) while the driver still refuses to use it.

`SqlConnectorDriver` is out of scope with a stated reason (Context), not silently.

### D4a — The other credential-binding and Connector-lifecycle paths (skeptic CR1/CR2)

Three further paths touch `credentialId` and must be decided here, not improvised from a compile error:

- **`rotateCredential` refuses a pending Connector.** Rotation is not completion. Running it against a
  pending Connector would bind a credential through a path that knows nothing about completion tokens,
  leaving an outstanding token live against a now-usable Connector — exactly the open slot D3 exists to
  close. It returns a 400-class error directing the caller to the completion path. *Alternative rejected:*
  treating rotation as completion-plus-token-invalidation, which duplicates the binding logic and gives two
  ways to complete.
- **`delete` handles a pending Connector.** `credentialRepo.delete(existing.credentialId, …)` becomes
  conditional on the `Option`; deleting a pending Connector removes the row and cascades its outstanding
  completion tokens (`ON DELETE CASCADE`), binding nothing. This is what makes the Risks note's claim that
  an abandoned pending Connector is "deletable through the existing owner CRUD path" actually true.
- **`RestSourceConnectorMigration` and `ImplicitConnectorConfig` never produce a pending Connector.** The
  legacy backfill always creates a complete (implicit no-auth) Connector; it is a write site, not a
  chokepoint, and must be asserted to still produce a bound credential.

**Agent-visible listing.** `WorkspaceContextService.buildConnectors` (253) projects `ConnectorSummary`
into the agent's workspace context via `findAll`. It carries the same `pending: Boolean` as D6, so an agent
cannot see a pending Connector indistinguishable from a usable one and bind a source to it.

### D5 — The completion endpoint is optional-auth, mounted beside `PublicDashboardRoutes`

`POST /api/connectors/completion` carrying `{token, credential, ...auth shape}` in the **body**, not the
query string — a query-string credential lands in access logs and `Referer` headers. The URL handed to the
human carries only the token (`/connectors/complete?token=…`), which is itself a bearer secret but is
single-use and short-lived. Mounting inside `optionalAuthenticate` keeps rate-limiting and CSRF in force.
Completion does not require the human to be logged in — that is the whole point of an out-of-band handoff.

**Validator shape** mirrors `ShareTokenValidator`: one privileged-pool lookup by hash, all state checks in
memory, every failure returning one indistinguishable result, so the endpoint is not an existence oracle for
another owner's pending Connectors.

### D6 — What the agent may see of a pending Connector

The agent-facing projection stays `ConnectorSummary` (id/name/kind/host) plus a `pending: Boolean`. It gains
**no** field describing the auth shape a human is mid-configuring, and never the completion token — the token
is returned exactly once, in the `create_connector` result that mints it. A pending row must not become an
oracle for in-progress configuration.

### D7 — The agent learns of completion implicitly

No poll tool, no webhook. `create_rest_data_source` against a pending Connector fails with a message naming
the pending state; the same call simply succeeds once completed. This is the ticket's own stated acceptable
option and adds no surface.

### D8 — Frontend completion page reuses HEL-829's field

New route outside `ProtectedRoute` (`AppRoutes.tsx`'s public-dashboard precedent), rendering
`ConnectorCredentialField` — already presentational, already used for create and rotate. The credential
stays in local `useState` for the submit's lifetime only, as `InlineConnectorSetup` documents. Needs a new
unauthenticated service call; must not reuse the authenticated `connectorEntityService` thunks.

### D9 — Expiry recovery: re-mint, never a dead end (skeptic round 2 CR1)

A completion token that expires must not strand the pending Connector permanently. With rotation refusing a
pending Connector (D4a), single-use consumption (D3) and no status endpoint, an expired token would
otherwise leave a row that can never be completed, rotated, or used — in a flow whose defining property is
that the human is *elsewhere*, so this is the expected path, not an edge case. Two recovery routes, both
supported:

- **Agent re-initiates.** `create_connector` re-mints a fresh token on an existing pending row rather than
  creating a duplicate, which bounds — but does not eliminate — row accumulation: a re-initiation naming a
  *different* auth shape deliberately forks a second pending row (below), and there is no reaper by design. It grants no new
  capability: the caller could already mint by creating another pending Connector.
  **Match key = owner + kind + normalized base URL + intended auth shape.** Normalization: lowercase scheme
  and host, drop a default port for the scheme, strip a single trailing slash, compare path/query
  case-sensitively; no DNS resolution and no other canonicalization. **The auth shape is part of the key**
  — a pending row persists its intended auth shape and the completion page renders from it, so re-initiating
  with a different auth type must *not* re-mint onto the old row and strand the human on a form for the
  wrong credential type; it creates a separate pending Connector. If more than one pending Connector still
  matches, the **most recently created** wins and the others are left untouched (they remain independently
  completable or deletable).
- **Owner re-mints.** `POST /api/connectors/:id/completion-token`, authenticated and owner-scoped, refused
  with the standard not-found mapping if the caller does not own it or it is not pending — except that an
  owner is told distinctly when their Connector is **already completed** (D10). The response body
  carries the token secret and its `expiresAt` — the only response that ever does, under the same
  "disclosed only at mint time" rule as the original mint, and it is never re-readable afterwards. This does
  not weaken the threat model: the secret is disclosed to the owner's own authenticated session, not to the
  agent's context.

**Two distinct invalidation events, two distinct columns** (resolving the ambiguity D2/D3 would otherwise
leave): `consumed_at` means *this token was successfully used to bind a credential* — D3's meaning,
unchanged, and never set by a rejected submission. `superseded_at` means *a newer token was minted for this
Connector*, with no bind and no submission. A token is valid only if both are `NULL` and it has not expired.
Minting is atomic with superseding, exactly as D3 requires binding to be atomic with consumption: one
transaction sets `superseded_at` on every currently-live token for that Connector and inserts the new one,
so there is never a window with two live tokens or none. **The full validity predicate must live in the
conditional write, not only in the in-memory validator** — see D3. Both states remain caller-indistinguishable from
expired and nonexistent.

**Expiry: 60-minute default, operator-configurable in either direction, hard-capped at 24 hours.** Fifteen
minutes (the earlier value) is impractical for an out-of-band human handoff and would make expiry the normal
outcome. An operator may configure a *shorter or longer* value; the implementation clamps to a hard-coded
24-hour ceiling (`min(configured, 24h)`), which is therefore reachable and is the worst case the
residual-risk statement below is argued against.

### D10 — Completion is visible to the owner (skeptic round 4 CR3)

Caller-indistinguishability (D5) exists to stop an *anonymous token presenter* using the endpoint as an
existence oracle. An **authenticated owner** is not that adversary — they already know their own Connectors
exist — so surfacing completion state to them costs nothing, and it is what makes the residual-risk
acceptance in Risks actually true rather than asserted:

- The Connector list (task 6.3) shows **when and by whom** a Connector was completed through the handoff
  path. Storage: a `completed_at` and `completed_by` pair on `connectors` (`completed_by` records the
  authenticated principal, or an explicit `anonymous`), *not* derived from
  `connector_completion_tokens.consumed_at` — derivation would tie the signal's lifetime to a token row
  that D4a cascades on delete, and a bare timestamp cannot distinguish "my teammate finished it" from
  "someone who read the transcript finished it", which is precisely the discrimination this decision
  exists to support.
- The owner re-mint endpoint's refusal **is** distinguishable to the authenticated owner: "already
  completed" is reported distinctly from "not found". The anonymous completion endpoint's responses are
  unchanged and remain byte-identical across every failure mode.

This is the narrowest signal that makes misuse observable without weakening the anonymous surface at all.

## Risks / Trade-offs

- **A nullable `credential_id` weakens a previously-total invariant.** → The `Option` forces compile-time
  enumeration of every consumer; D4/D4a's guards are each independently tested, and the fetch-time one is
  asserted with a *recording* credential repository so "no decryption occurred" can actually fail (a
  repo-less fixture never decrypts and would pass vacuously — the HEL-845 lesson).
- **THREAT: the completion token transits the model context.** This is the change's central security
  assumption, so it is stated rather than implied. The token is returned in the `create_connector` result —
  that result *is* the agent's context, and by extension its transcript, any logging around it, and any
  party who can read either. **Adversary:** anyone who reads the agent transcript or its logs. **Capability
  gained:** bind an *attacker-chosen* credential to the owner's pending Connector, completing it — after
  which the owner's workspace may fetch against a host the attacker controls the credential for.
  **Capability NOT gained:** reading any existing secret; the token is scoped to one pending Connector that
  by definition holds no credential, no read path returns credential material, and the token cannot address
  any other Connector. **Mitigations judged sufficient:** single-use with atomic consumption (a leaked token
  is spent the moment the legitimate human uses it, making misuse detectable rather than silent), a
  **60-minute default expiry**, no application-level logging or echoing of the token, and no re-read after
  minting. (Skeptic-final-1.md non-blocking note: the GET completion-lookup endpoint added at evaluation-1.md
  CR4 carries the token in a query string, so it *will* appear in infra-level access logs — e.g. Cloud Run's
  request logs — even though the application itself never logs it. The completion URL already contains the
  token by construction, so this adds no new capability beyond what possessing the URL already grants; it
  does mean "no logging" is an application-layer property, not an infrastructure-wide one.) **Additional
  control:** when the completing request *does* carry an authenticated session, that user must be the
  Connector's owner — an authenticated non-owner is refused. An unauthenticated completion remains allowed,
  because out-of-band completion by a human who is not logged in is the ticket's whole purpose.
  **Residual risk accepted, stated against the worst case an operator can configure:** a token read from the
  agent's context or logs and used before the legitimate human completes it binds an attacker-chosen
  credential. The window is 60 minutes by default and **up to 24 hours** if an operator raises it to the
  ceiling. **Is the mitigation set still sufficient at 24 hours?** Only because of D10's owner-visible completion
  signal. Without it, "misuse is detectable" would be **false under this design's own rules**:
  indistinguishability deliberately makes a consumed token look identical to an expired one, so the
  legitimate human sees only what a benign expiry looks like — the likelier reading in a flow where expiry
  is expected — and once an attacker binds, the Connector is no longer pending, so owner re-mint is refused
  and agent re-initiation forks a new row, leaving the attacker-bound Connector live and silent. D10
  supplies that missing signal. The token also never discloses an existing secret and is scoped to one
  credential-less Connector, so what a longer window costs is *time-to-detection*, not capability. If that
  is judged unacceptable in review, the **ceiling** is the wrong number, not this paragraph.
- **An abandoned pending Connector lingers as a credential-less row.** → Accepted; inert by construction
  and deletable through the owner CRUD path (D4a makes that actually true). No reaper in this change.
- **Migration touches a shared dev database.** → Derive the version from the tree at write time (V102 is
  current, so V103 unless something lands first); never edit an applied migration.
- **`helio-mcp` is not selected by CI (HEL-1004).** → It has no `test` script of its own, but the root
  `jest.config.cjs` does collect its 24 test files (verified with `npx jest --listTests` at planning time),
  so the root suite covers them locally. The executor must still run `npm run check:helio-mcp-types` and
  name the helio-mcp results explicitly rather than inferring coverage from a green CI summary.

## Migration Plan

Forward-only: `ALTER TABLE connectors ALTER COLUMN credential_id DROP NOT NULL;` plus the token table with
its RLS policy and privileged grants (single file acceptable). Additive — existing rows keep a non-null
`credential_id` and every existing guard behaves identically, so rollback is "stop creating pending
Connectors", not a schema revert.

## Planner Notes

Self-approved: token table naming, the body-not-query-string decision (D5), `expires_at NOT NULL` (D2), and
excluding a pending-row reaper. Escalation-worthy items — the expiry duration's default value and whether
`list_connectors` should hide pending rows entirely rather than flag them — are resolved here as: expiry
default 60 minutes, operator-configurable in either direction but clamped by a hard-coded 24-hour ceiling (D9), and flag rather than hide (hiding would strand an
agent that just created one). Both are recorded so a reviewer can contest them. **Expiry default is a concrete value, not a placeholder:
60 minutes**, lowerable by configuration but capped at a hard-coded 24-hour ceiling (D9). Task 4.4's owner status endpoint is dropped per the
skeptic's non-blocking note — the owner already sees pendingness through the connectors list (task 6.3) and
the agent learns of completion implicitly (D7).

**Line budget:** this document exceeds the 150-line guidance (256 lines). The overage is entirely the
explicit threat statement in Risks plus decisions D4a, D9 and D10, all added at the design gate's request
(skeptic rounds 1-4). Cutting security reasoning to satisfy a length rule would invert the priority;
flagged here so a reviewer can contest the trade rather than have it made silently.
