# HEL-536: Connector credential storage standard: encrypted at rest, reusable by v1.9 connectors

## Description

Data sources today (REST/SQL/CSV via `DataSourceRepository` and the source routes) will grow into first-class connectors in v1.9 (HEL-429), which need to store per-user third-party credentials (API keys, DB passwords, OAuth refresh tokens). There is no standard for storing such secrets encrypted at rest — the RLS owner-only model protects rows logically but the values are plaintext in Postgres. This ticket establishes the encryption-at-rest standard so v1.9 builds on it rather than inventing per-connector schemes.

Being delivered now, standalone, because HEL-821 (Connector domain model, spine of epic HEL-820) names it as a hard dependency: "fold it in or land it first. Do not build a second parallel mechanism." Landing it first gets the encryption substrate its own adversarial review. HEL-821 follows immediately as its first consumer.

## Scope

* Define and implement an application-layer envelope-encryption helper: encrypt credential blobs with a data key, wrap the key with a KMS/Secret-Manager-held master key (evaluate Google Cloud KMS vs. a Secret-Manager pepper — document the choice and rotation story).
* Provide a reusable storage shape (a table or a reusable encrypted-column pattern via Flyway migration — next available VNN, V92, confirmed against the live tree; the ticket's own "V59" figure is stale) keyed by owner, following the existing RLS owner-only policy conventions (`V35`/`V42`) and `DbContext` `withUserContext` write path.
* Ensure decryption happens only in the privileged/server context needed to actually make the outbound connector call, never returned to the client (write-only from the API's perspective; values are never echoed back, mirroring how PAT raw tokens appear only at creation).
* Document key rotation for the master key (re-wrap data keys) in the runbook/inventory.
* Build on the existing `SecretField`/`HasSecrets`/`SecretBackend` seam (`backend/src/main/scala/com/helio/services/auth/SecretField.scala`) — do not invent a parallel mechanism.

## Acceptance Criteria

* A credential written via the helper is stored ciphertext (a DB-level assertion shows no plaintext), decryptable only with the configured master key.
* Round-trip encrypt/decrypt tested; wrong/rotated master key handling tested.
* RLS owner scoping enforced on the storage (cross-user read denied) — proven under real RLS (non-bypassing role), not only app-level filtering.
* Master-key rotation procedure documented; `sbt compile test` green.
* Writing a credential with no configured master key fails hard/loud — never silently degrades to plaintext storage. This is the single most important negative test in this ticket.
* Local dev and CI work without any production secret; the dev-only key path cannot leak into a production deployment path.

## Out of Scope

* Building the actual v1.9 connectors (HEL-429/HEL-821 own those; this provides the storage substrate).
* The Anthropic/DB/OAuth secret rotation (sibling tickets).
* Provisioning any GCP resources (Secret Manager secret creation, `infra/deploy-backend.sh` wiring) — document exactly what's needed; the user provisions it.

## Design Decisions Already Made (do not re-open)

* **Master key lives as a Secret Manager pepper, not Cloud KMS.** Envelope encryption is done in-app (data key per credential, wrapped by the master key); the master key is a Secret Manager secret injected like `helio-anthropic-api-key`. Rationale: no new GCP service, no new IAM surface, no new failure mode in the outbound-request path. The `SecretBackend` seam must be designed so a KMS-backed implementation can be added later without redesigning callers; document what a future KMS swap requires (re-wrapping existing data keys).
