# Secrets inventory & rotation runbook

Every production secret the backend depends on, where it lives, and how to rotate it. New secrets
should be added here as a new entry rather than documented only in `CLAUDE.md`'s env-var table.

## `helio-anthropic-api-key`

- **What it is**: Anthropic API key for the server-side Claude client (`com.helio.infrastructure.ai`).
- **Where it lives**: Secret Manager secret `helio-anthropic-api-key`, injected into the backend
  process as `ANTHROPIC_API_KEY` by `infra/deploy-backend.sh`'s `--set-secrets`. Never committed,
  never set in `infra/.env.deploy.example`.
- **Local dev / CI**: unset — the endpoints that need it (`POST /api/authoring/dashboard` and
  friends) degrade to `503` when it is absent; the rest of the backend boots normally. See HEL-390.
- **Rotation**: generate a new key in the Anthropic console, add it as a new Secret Manager secret
  version, redeploy (`infra/deploy-backend.sh` always reads the latest version), then revoke the
  old key in the Anthropic console once the new deploy is confirmed healthy. No re-wrap step —
  this key is used directly, not to wrap other key material.

## `helio-resend-api-key`

- **What it is**: Resend API key for the backend's outbound email (`com.helio.infrastructure.email`,
  HEL-704). A sending-access key restricted to the `helioapp.dev` domain, not a full-access key.
- **Where it lives**: Secret Manager secret `helio-resend-api-key`, injected into the backend
  process as `RESEND_API_KEY` by `.github/workflows/cd-backend.yml`'s `--update-secrets` and
  `infra/deploy-backend.sh`'s `--set-secrets`. Read by the backend's service account
  `helio-backend-sa` (`roles/secretmanager.secretAccessor` on this secret only). Never committed,
  never logged (redacted from `EmailConfig.toString`).
- **Partner setting**: `HELIO_EMAIL_FROM`, the sender address (prod: `Helio <noreply@helioapp.dev>`).
  Not a secret; set on the service and in `infra/.env.deploy` (see `infra/.env.deploy.example`).
  Either one missing degrades `POST /api/beta-access/request` to `503`; the rest of the backend
  boots normally.
- **DNS it depends on**: the sending domain must stay verified in Resend: the `resend._domainkey`
  DKIM TXT record and the `send` subdomain's MX and SPF records, all in Cloudflare with the proxy
  off. `_dmarc.helioapp.dev` is `p=quarantine`, so mail that fails DKIM lands in spam.
- **Local dev / CI**: unset, so the endpoint answers `503`. See HEL-704.
- **Rotation**: create a new sending key in Resend, then add it as a new secret version without
  echoing it:

  ```bash
  read -rs KEY && printf '%s' "$KEY" | gcloud secrets versions add helio-resend-api-key \
    --data-file=- --project=helio-493120 && unset KEY
  ```

  Cloud Run resolves `:latest` when a revision starts, so roll a new revision, either with the next
  release or directly:

  ```bash
  gcloud run services update helio-backend --region=us-west1 --project=helio-493120 \
    --update-secrets=RESEND_API_KEY=helio-resend-api-key:latest
  ```

  Confirm a beta-access request email arrives, then delete the old key in Resend.

## `helio-mcp-token-key`

- **What it is**: the sealing key of the `helio-mcp` OAuth connector (HEL-1709): base64 of 32
  random bytes. AES-256-GCM-seals every access token (the user's PAT), every registered client id
  and every pending authorization code. Nothing else is stored, so this key is the connector's
  whole state.
- **Where it lives**: Secret Manager secret `helio-mcp-token-key`, injected into the separate
  `helio-mcp` Cloud Run service as `HELIO_MCP_TOKEN_KEY` by `infra/deploy-mcp.sh`'s
  `--set-secrets`. Read by the `helio-mcp-sa` service account (`roles/secretmanager.secretAccessor`
  on this secret only); the backend never sees it. The server exits at start naming the variable,
  never its value, if it is missing or not exactly 32 bytes.
- **Local dev / CI**: any generated value (`openssl rand -base64 32`) in the environment of
  `npm run dev:http`; see `helio-mcp/README.md`.
- **Rotation**: replacing the key with no overlap signs out every connector (each re-registers and
  asks the user to Allow again) and leaves their old PATs live until revoked or expired. To rotate
  without that:
  1. Copy the current value into a new secret `helio-mcp-token-key-previous` and grant
     `helio-mcp-sa` access to it.
  2. Add a new version of `helio-mcp-token-key`:

     ```bash
     openssl rand -base64 32 | gcloud secrets versions add helio-mcp-token-key \
       --data-file=- --project=helio-493120
     ```

  3. Redeploy with `USE_PREVIOUS_KEY=1 bash infra/deploy-mcp.sh --image=<current image>`. New tokens
     are sealed with the new key; tokens and client ids sealed with the old one still open.
  4. After the longest-lived token has expired (90 days, the PAT lifetime), redeploy without
     `USE_PREVIOUS_KEY` and delete `helio-mcp-token-key-previous`. Anything still sealed with the old
     key then re-authorizes.

## `CONNECTOR_MASTER_KEY`

- **What it is**: the envelope-encryption master key for `connector_credentials` (HEL-536) — a
  single symmetric (AES-256) key, base64-encoded. Every connector credential gets its own random
  per-row data key; this master key only ever wraps/unwraps those data keys, never the credential
  values directly. See `openspec/changes/connector-credential-encryption/design.md` for the full
  envelope-encryption design.
- **Where it lives**: Secret Manager secret (name TBD by the operator provisioning it — see
  "Provisioning still required" below), injected into the backend process as `CONNECTOR_MASTER_KEY`
  by `infra/deploy-backend.sh`'s `--set-secrets`, exactly like `helio-anthropic-api-key`.
  `CONNECTOR_MASTER_KEY_ID` (an operator-assigned label, e.g. `env-2026-08` — NOT derived from the
  key bytes) is set alongside it as an ordinary (non-secret) env var, identifying which key value
  is currently active.
- **Local dev / CI**: set your own value directly in `backend/.env` (dev) or the CI environment
  (CI) — see `docs/cloud-dev-setup.md`. Resolved by the exact same code path as production; there
  is no dev/prod branch, so there is no way for a dev value to accidentally activate under
  production configuration.
- **Fail-closed**: if `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` is missing or invalid, every
  connector-credential write fails hard and loud — never a silent fallback to plaintext storage.
  See `EncryptedSecretBackendSpec`/`ConnectorCredentialRepositorySpec` for the tests proving this.

### Rotation procedure (executable)

1. Generate a new master key value (32 random bytes, base64-encoded — e.g.
   `openssl rand -base64 32`) and a new `key_id` label (e.g. `env-2026-09`). Store the new value as
   a **new version** of the Secret Manager secret.
2. Set `CONNECTOR_MASTER_KEY_PREVIOUS`/`CONNECTOR_MASTER_KEY_PREVIOUS_ID` to the **old** key/id, and
   `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` to the **new** key/id, then redeploy. From this
   point: `wrapDataKey` (new writes) wraps under the new key; `unwrapDataKey` (reads) still resolves
   rows still carrying the old `key_id` via the `_PREVIOUS` pair, so existing rows remain
   decryptable throughout the rotation window.
3. Run the re-wrap job:

   ```bash
   cd backend && sbt "runMain com.helio.maintenance.RewrapConnectorCredentialsJob"
   ```

   For every `connector_credentials` row whose `key_id` is not the new current id, this unwraps the
   row's data key under the resolvable (old, via `_PREVIOUS`) key and re-wraps it under the new
   current key, updating `wrapped_data_key`/`nonce_dek`/`key_id`/`updated_at` in place. The
   `ciphertext` column itself (wrapped by the per-row data key, not the master key) is never
   touched — only the data-key wrapping layer changes, which is the entire point of envelope
   encryption.

4. Once every row's `key_id` equals the new id (verify with
   `SELECT DISTINCT key_id FROM connector_credentials;` — should show only the new id), unset
   `CONNECTOR_MASTER_KEY_PREVIOUS`/`CONNECTOR_MASTER_KEY_PREVIOUS_ID` and redeploy, then retire the
   old Secret Manager secret version.
5. A future Cloud-KMS swap (see design.md Decision 1) follows the same procedure, generalized: the
   "previous" provider is the Secret-Manager-pepper `MasterKeyProvider`, the "current" provider is
   a `KmsMasterKeyProvider`; steps 2–4 are unchanged because both providers implement the same
   `wrapDataKey`/`unwrapDataKey` shape (`MasterKeyProvider`, `backend/src/main/scala/com/helio/services/auth/MasterKeyProvider.scala`).

### Provisioning still required (not done by this change)

This ticket (HEL-536) deliberately does not provision any GCP resource. Before this can run in
production, an operator needs to:

1. Generate a master key value (`openssl rand -base64 32`) and choose an initial `key_id` (e.g.
   `env-2026-08`).
2. Create a Secret Manager secret holding that value (name of your choosing, e.g.
   `helio-connector-master-key`).
3. Add `--set-secrets` wiring for it in `infra/deploy-backend.sh`, mirroring the existing
   `helio-anthropic-api-key` wiring, and set `CONNECTOR_MASTER_KEY_ID` as a plain (non-secret) env
   var alongside it.
4. Grant the Cloud Run service account `roles/secretmanager.secretAccessor` on the new secret (same
   IAM pattern as the existing Anthropic-key secret).

None of the above is performed by this change.
