# Proposal: Cloud SQL Private IP + Serverless VPC Access migration

## Why

`helio-backend` reaches Cloud SQL over its public IP via the `com.google.cloud.sql:postgres-socket-factory`
connector library. Every new physical connection pays for a TLS handshake plus an ephemeral-cert
fetch through the Cloud SQL Admin API. That handshake is the confirmed failure point in two
separate production incidents (HEL-696, and a recurrence just tonight): `SocketException: Broken
pipe` mid-handshake, `SQLTransientConnectionException` with `total=0` (the pool can't establish a
single connection), surfacing to users as a confusing CORS error.

Moving to Private IP + a Serverless VPC Access connector removes the connector library, the
Cloud SQL Admin API dependency, and the cert-refresh/handshake dance from the request path
entirely — a direct network connection over the VPC instead. This is Google's own recommended
production setup for Cloud Run → Cloud SQL traffic.

## What Changes

- Provision a Serverless VPC Access connector (`helio-vpc-connector`) in `us-west1`.
- Enable Private IP on the `helio-db` Cloud SQL instance, peered to that VPC.
- Add a new Cloud Run revision configured with `--vpc-connector` + a private-IP `DATABASE_URL`,
  deployed with `--no-traffic` so it never receives live requests until independently verified.
- Verify the new revision directly (its own per-revision URL) against `/health` and a real
  DB-touching endpoint before moving any traffic to it.
- Only then migrate 100% of traffic to the new revision.
- Update `infra/deploy-backend.sh` so future deploys use the VPC connector path by default.
- **Public IP on `helio-db` is left enabled** for this change (see design.md Decision 3) —
  disabling it is an explicit, separate follow-up once the private-IP path has run in production
  for a validation window, not part of this ticket's blast radius.

## Non-Goals

- Disabling Cloud SQL's public IP (tracked as a follow-up, not this ticket).
- Any Cloud SQL tier or `maxScale` change (HEL-751/HEL-752 — separate tickets, separate human
  cost/scale decisions).
- Changing RLS policy logic or the `helio_privileged` role mechanism — only the network path to
  the database changes, not how the app authenticates/authorizes once connected.
- HikariCP pool tuning (HEL-748) — in flight, **not yet merged to `main`** (verified via
  `git merge-base --is-ancestor`). This ticket does not depend on it landing first: HEL-748
  addresses `maxLifetime`-driven connection churn, while this ticket removes the TLS-handshake/
  cert-fetch cost from the connection path entirely regardless of churn rate — the two are
  independent, complementary mitigations for related but distinct mechanisms.

## Impact

- `backend/src/main/resources/application.conf` — **no change needed.** Verified: the file already
  fully defers `helio.db.url` to the `DATABASE_URL` env var (`url = ${?DATABASE_URL}`), with no
  socketFactory-specific logic present anywhere in it.
- `infra/deploy-backend.sh` — this is the actual (and only) place the connection string is
  constructed today, via `--set-env-vars`. The `DATABASE_URL` value changes to a private-IP form
  with explicit SSL (see design.md Decision 4a), Cloud Run service flags change (remove
  `--add-cloudsql-instances`, add `--vpc-connector` / `--vpc-egress=private-ranges-only`).
- `backend/build.sbt` — the `postgres-socket-factory` dependency becomes unused once the
  migration completes; removal is deferred to a follow-up cleanup pass, not required for
  correctness (an unused dependency is not a functional risk).
- GCP infrastructure: new VPC network resources (or reuse of the project's default VPC — see
  design.md Decision 1), new Serverless VPC Access connector, `helio-db`'s networking
  configuration (adds Private IP; Public IP unchanged).
