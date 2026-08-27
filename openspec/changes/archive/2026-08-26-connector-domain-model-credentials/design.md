## Context

`data_sources` (V4, owner_id added V14, RLS V35) stores all per-kind config in one opaque
`config` JSONB column, `owner_id UUID` nullable, `FORCE ROW LEVEL SECURITY` with a single
`USING (owner_id = current_setting('app.current_user_id')::uuid)` policy. HEL-536 (landed,
eab2afdb) shipped `connector_credentials` (V92): `id, user_id, name, key_id,
wrapped_data_key, nonce_dek, ciphertext, nonce_value, created_at, updated_at`, same RLS
pattern, plus `EncryptedSecretBackend`/`MasterKeyProvider`/`ConnectorCredentialRepository`
in `com.helio.services.auth` / `com.helio.infrastructure.persistence.auth`.
`ConnectorCredentialRepository.create/get/list/decryptForUse/delete` already exist and are
consumed as-is — no second encryption mechanism. HEL-825 (landed, 4a9ce2c9) freed
`Connector` and shipped `ConnectorRegistry`/`DataSourceKind` as the kind vocabulary.

## Goals / Non-Goals

**Goals:** a `connectors` table + domain type + REST CRUD that (a) proves encryption at rest
against real DB bytes, (b) proves no read path leaks the secret, (c) proves outbound auth
still works against a real endpoint, (d) makes delete-with-dependents a deliberate decision.

**Non-goals:** sources referencing Connectors (HEL-822), UI (HEL-824), templating (HEL-823),
HEL-616's log-scrubbing guard (coordinate only), provisioning any GCP resource.

## Decisions

### Decision 1: `connectors` table — real columns for identity/query fields, `config` JSONB for the rest

`data_sources.config` is fully opaque because a `DataSource` also carries pipeline-shape
concerns (field mappings, pagination, etc.) that vary wildly per kind and are rarely queried
independently of the whole row. A Connector's surface is narrower and mostly *is* the
queryable/displayable identity (name, kind, base host) — hiding those inside JSONB would
force every list/display call to parse JSON for data that's structurally just... a column.
So: **real columns for `name`, `kind`, `base_url`; `config` JSONB for kind-specific
non-secret extras** (e.g. SQL's port/database name, REST's optional default headers) that
genuinely vary per kind and aren't queried independently. This is a deliberate middle ground,
not a re-litigation of the `data_sources` pattern — `data_sources` is unmodified.

```sql
-- V93__connectors.sql
CREATE TABLE connectors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,               -- DataSourceKind vocabulary (rest_api first)
  base_url      TEXT NOT NULL,
  config        JSONB NOT NULL DEFAULT '{}', -- kind-specific non-secret extras only
  credential_id UUID NOT NULL REFERENCES connector_credentials(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_connectors_owner_id ON connectors (owner_id);
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors FORCE ROW LEVEL SECURITY;
CREATE POLICY connectors_owner ON connectors
  USING (owner_id = current_setting('app.current_user_id')::uuid);
```

`owner_id` is `NOT NULL` (unlike `data_sources.owner_id`, nullable for historical
pre-ownership rows) — every Connector is created post-ownership-model, so there's no
legacy-row case to accommodate.

### Decision 2: `connectors` references `connector_credentials` by FK, never duplicates the secret

`connectors.credential_id → connector_credentials.id`, `ON DELETE RESTRICT`. The secret's
encrypted bytes live in exactly one place (V92); `connectors` never stores
`wrapped_data_key`/`ciphertext` itself.

**Revised (skeptic round 1, CR1) — two-transaction reality, not a false single-transaction
claim.** `ConnectorCredentialRepository.create(userId, name, plaintext): Future[...]` already
runs its own committed `.transactionally` session (`DbContext.withUserContext`) and exposes
no `DBIO`, so composing it with a second insert cannot be made atomic without modifying
HEL-536 code — which the ticket says to consume as-is, not modify. Chosen: **(a)** two
transactions plus compensation — `ConnectorRepository.create` calls
`ConnectorCredentialRepository.create` first; if the subsequent `connectors` row insert
fails, it calls `ConnectorCredentialRepository.delete` on the just-created credential as a
best-effort compensating action. If the compensating delete *also* fails (e.g. a transient DB
error immediately following the first failure), the orphaned `connector_credentials` row is
left in place — it is inert (nothing references it, `connectors.credential_id` FK can never
point at it) and is a known, accepted gap: a small periodic reaper for
`connector_credentials` rows with no referencing `connectors.credential_id` is a reasonable
HEL-822+ follow-up, not built here. This never risks a *plaintext* leak — the row that might
orphan is already-encrypted ciphertext, which is exactly the failure mode Decision 3's
fail-closed contract is designed to tolerate (an extra encrypted row, never an unencrypted
one). `connector_credentials.user_id` and `connectors.owner_id` are always the same value —
the route/repository layer enforces this explicitly (see the note below on FK not being
RLS-aware), a Connector can never reference another user's credential.

**Load-bearing note (skeptic non-blocking finding, promoted here since it's safety-relevant):**
Postgres FK validation runs as the table owner and bypasses RLS — the `credential_id` FK
alone does not stop a cross-tenant reference. `ConnectorRepository.create` must pass the
`credential_id` it just minted itself (never a caller-supplied one), and any future update
path must never accept a caller-supplied `credential_id`, so cross-tenant reference is
prevented by construction (there is no code path that accepts an arbitrary id), not by a
runtime ownership check that could be skipped.

### Decision 3: Update never touches the credential

`PATCH /api/connectors/:id` accepts `name`/`baseUrl`/`config` only; a request body containing
a credential/secret field is rejected (400), not silently ignored — silently ignoring it
would let a caller believe a rotation happened when it didn't. Credential rotation is a
distinct, not-yet-built operation (create a new `connector_credentials` row, repoint
`credential_id`, delete the old row) — out of scope for this ticket since nothing in the
acceptance criteria requires rotation via this entity yet; noted as a follow-up finding.

### Decision 4: Delete blocks on dependents (not cascade)

No dependent-source relationship exists yet in this ticket's scope (HEL-822 builds it), so
today "dependents" is necessarily zero for every Connector this ticket can create — this
decision is about the *shape* the FK/route takes so HEL-822 doesn't have to relitigate it.
Chosen: **block** (409 `ConnectorHasDependents`), not cascade — an auth credential silently
disappearing out from under a live source is a worse failure mode (source starts failing
outbound calls with no visible cause) than an explicit, actionable 409 telling the caller to
repoint or remove dependents first. `data_sources`'s own `ON DELETE SET NULL` toward
`data_types` is a *softer* relationship (a type losing its source is inert, not silently
broken); a Connector losing its credential referent while a source still calls out with it is
not equivalent, so this ticket does not mirror that FK action. **Revised (skeptic round 1, CR6) — concrete, testable seam instead of a vacuous always-true
check.** `ConnectorRepository.delete` takes a `dependentCount: ConnectorId => Future[Int]`
collaborator (default implementation returns `Future.successful(0)`, since no referencing
column exists in this ticket's scope); `delete` calls it first and returns
`Left(ConnectorHasDependents)` when the count is nonzero, `Right(())` otherwise. This makes
the 409 branch genuinely reachable and testable *today* — task 4.6 tests it by injecting a
collaborator that returns a nonzero count and asserting the route returns 409 and performs no
deletion, which exercises the real `ConnectorRepository.delete`/route code path (not a
stand-in), not merely a stub in isolation. HEL-822 supplies the real
dependent-source-counting query as its own `dependentCount` implementation when it adds the
referencing column — no further route/repository change needed at that point, only a new
collaborator wired in at construction.

### Decision 5: Local dev / CI master key

Reuses HEL-536 Decision 4 verbatim — `CONNECTOR_MASTER_KEY` is already an ordinary required
env var with no environment-conditional code. This ticket adds no new key-resolution logic;
worktree/dev/CI already inherit whatever HEL-536 established. If a worktree/CI environment
has no `CONNECTOR_MASTER_KEY` set, credential-bearing tests fail loudly (Decision 3
fail-closed), which is itself proof of Decision 4's fail-closed contract, not a gap to patch
around.

### Decision 6: Enumerating every read path (both directions)

**Revised (skeptic round 1, CR4/CR5) — both passes widened.**

**Forward (start from each caller-facing surface this ticket adds, confirm each excludes the
secret in every response, including error bodies):** `POST /api/connectors` (create
response), `GET /api/connectors` (list), `GET /api/connectors/:id` (single), `PATCH
/api/connectors/:id` (update response), `DELETE /api/connectors/:id` (delete response,
including the 409 `ConnectorHasDependents` error body). All five call only
`ConnectorRepository.create/get/list/update/delete`, none of which touch
`ConnectorCredentialRepository.decryptForUse`/`EncryptedSecretBackend.decrypt` — this is
proven by the wire-response type (`ConnectorMeta`/equivalent) structurally excluding any
ciphertext/plaintext field, mirroring `ConnectorCredentialMeta`'s existing shape. No MCP tool
exists for Connectors in this ticket's scope (HEL-822+ may add one). No preview/test endpoint
exists for Connectors in this ticket's scope.

**Backward (start from every method that can produce plaintext or key material, confirm
every caller is non-route):** three methods, not one —
`ConnectorCredentialRepository.decryptForUse` (calls `EncryptedSecretBackend.decrypt`),
`EncryptedSecretBackend.decrypt` directly (any new code could call it, bypassing the
repository), and `MasterKeyProvider.unwrapDataKey` (used by `rewrapAllBelow`, which runs on
the **RLS-bypassing** privileged pool via `withSystemContext` — a background/operator path,
never request-scoped, but still a plaintext-adjacent surface worth naming explicitly). This
ticket's own new code calls `decryptForUse` from exactly one place: the AC5 outbound-auth
integration **test only** (see Decision 6a below) — unambiguously never from
`ConnectorRoutes`'s (or any route's) JSON-serializing handlers, and this ticket adds no new
`withSystemContext` call of its own. The mechanical check the evaluator/skeptic re-run is
three greps, not one: `decryptForUse`, `secretBackend.decrypt` / `EncryptedSecretBackend`
usage, and `unwrapDataKey`/`withSystemContext` — confirming every call site outside
`ConnectorCredentialRepository`/`EncryptedSecretBackend`/`MasterKeyProvider` themselves is
either test-only or the existing `rewrapAllBelow` maintenance path (untouched by this
ticket).

### Decision 6a: The AC5 proof is test-only, and network-independent

**Revised (skeptic round 1, CR5).** No route in this ticket ever calls `decryptForUse` — a
route that decrypted would itself be the read-path leak AC3 forbids. The AC5 "real fetch
against a live endpoint" proof runs entirely inside the integration test process: the test
starts a small locally-hosted stub HTTP server (in-process, e.g. Pekko HTTP `Route` bound to
an ephemeral port) that asserts the incoming request's `Authorization`/API-key header equals
the exact plaintext credential value, returns 200 only on a match. The test then calls
`ConnectorCredentialRepository.decryptForUse` directly (test-only caller, per the backward
enumeration above) and issues a real outbound HTTP request carrying the decrypted value
against that local stub. This satisfies the AC's actual intent — genuine decryption, not a
stubbed decryptor — without depending on a third-party network endpoint (flaky, and a
needless external dependency for CI).

### Decision 7: Naming — `ConnectorEntityRoutes`/`ConnectorEntityProtocol`, not `ConnectorRoutes`

**New (skeptic round 1, CR2) — corrects a false "genuinely additive" claim.** HEL-825 moved
`GET /api/connector-types` off `/api/connectors` but kept the class name:
`backend/src/main/scala/com/helio/api/routes/sources/ConnectorRoutes.scala` and
`api/protocols/sources/ConnectorProtocol.scala` (`ConnectorMetadataResponse`, etc.) already
exist and are unrelated to this ticket's entity. This ticket adds **new, distinctly-named**
classes rather than colliding with or renaming those: `ConnectorEntityRoutes` (mounted at
`/api/connectors`, sibling file in `api/routes/sources/`) and `ConnectorEntityProtocol`
(sibling trait in `api/protocols/sources/`, mixed into the `JsonProtocols` aggregator).
`ConnectorRoutes`/`ConnectorProtocol`/`GET /api/connector-types` are entirely untouched — the
existing connector-*kind*-metadata surface and this ticket's connector-*entity* surface are
deliberately distinct names for distinct concepts sharing a word.

## Risks / Trade-offs

- [Risk] `config` JSONB reintroduces some of the same "what's in there" opacity `data_sources`
  has → Mitigation: `config` here is scoped to genuinely kind-specific non-secret extras only;
  every field the read-path/ACL/query surface needs is a real column.
- [Risk] Blocking delete could surprise a future HEL-822 implementation that expects
  cascade → Mitigation: documented here explicitly as the deliberate choice + reasoning, so
  HEL-822's own design doesn't have to re-derive it.
- [Risk] No `CONNECTOR_MASTER_KEY` in this worktree's `.env` → Mitigation: verify during
  Execution before treating a fail-closed test failure as a real defect; if genuinely absent,
  set a worktree-local test-only value per HEL-536 Decision 4, never a production value.

## Migration Plan

Additive only: one new Flyway migration (`V93__connectors.sql`), one new route tree mounted
at a previously-free path. No existing table, route, or client code is touched. Rollback is
`DROP TABLE connectors` (no other table references it yet) — safe pre-release.

## Open Questions

None — every decision above is resolved for this ticket's scope; delete semantics for the
*real* dependent-source relationship still belongs to HEL-822's own design, not reopened here.

## Gate-Chain Implications Checklist

This change does not touch `.husky/**` or any script a pre-commit hook invokes — no
gate-chain script is added or modified. N/A.
