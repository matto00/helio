# Design: Cloud SQL Private IP + Serverless VPC Access migration

## Current state (verified live, 2026-08-19)

- One VPC network exists: `default` (auto-mode), with a `default` subnet in `us-west1`
  (`10.138.0.0/20`). No need to create a new network — reuse `default`.
- `vpcaccess.googleapis.com` (Serverless VPC Access) is **not enabled** on the project.
- `servicenetworking.googleapis.com` (Service Networking / Private Services Access — required for
  Cloud SQL Private IP peering) is **not enabled**.
- No existing VPC peering for Google-managed services, no existing Serverless VPC Access
  connector.
- `helio-db` (`db-g1-small`, `POSTGRES_16`, zonal) currently has a public IP only, and
  **`sslMode: ENCRYPTED_ONLY`** (server rejects any unencrypted connection, over any network path —
  this is a Postgres-session-level enforcement, not scoped to public IP). 0 client SSL certs are
  provisioned on the instance.
- `default` is an **auto-mode** VPC — besides the `us-west1` subnet above, it has ~40 other
  regional subnets auto-allocated across `10.128.0.0/20`–`10.232.0.0/20` (every GCP region). Any
  new range (the private-services-access peering, the VPC connector's own `/28`) must avoid all of
  them, not just the local one.
- `helio-backend` Cloud Run service currently has `run.googleapis.com/cloudsql-instances:
  helio-493120:us-west1:helio-db` and no VPC connector annotation.
- `backend/src/main/resources/application.conf` already fully defers `helio.db.url` to
  `${?DATABASE_URL}` — no socketFactory-specific logic lives in the file. The connection string is
  actually constructed in `infra/deploy-backend.sh`'s `--set-env-vars`. This is the **only** code
  surface this migration touches (see Decision 4a).

## Decision 1: reuse the `default` VPC network, do not create a new one

A dedicated VPC would be marginally cleaner isolation, but this project has no other workloads on
`default` to conflict with, and introducing a second network adds real migration complexity
(subnet planning, firewall rules, a second thing that can be misconfigured) for no concrete
benefit here. Reuse `default`.

## Decision 2: the actual risk point is enabling Private IP on the existing instance

Every step up through creating the private-services peering and the VPC connector is purely
additive — nothing about the app's current connectivity changes, and all of it is trivially
reversible (delete the connector, delete the peering, no data or running service is touched).

**Enabling Private IP on an *existing* Cloud SQL instance is the one step with a real,
documented risk**: Google's own docs note this can require the instance to restart to apply the
new network configuration, causing a brief availability gap. Given the current connector-based
path already fails intermittently, a short *planned* gap during a low-traffic window is a better
trade than continuing to absorb *unplanned* gaps indefinitely — but it must be done deliberately,
not folded silently into an otherwise-additive sequence.

**Human checkpoint required before this specific step** (`gcloud sql instances patch helio-db
--network=default --no-assign-ip=false`, i.e. keep public IP, add private IP) — everything before
it in the task list proceeds without a checkpoint (purely additive, zero risk to the running
service); this one step pauses for an explicit go-ahead first.

## Decision 3: keep Public IP enabled through this migration; disable it in a later, separate follow-up

Disabling public IP now would remove the fallback path the safety strategy below depends on (see
Decision 4) and isn't required to fix the actual incident (the connector library's handshake is
the failure point, not the public IP itself — once the app stops *using* the public-IP connector
path, whether the IP itself is later disabled is a pure attack-surface/hygiene question,
independent of reliability). File a follow-up ticket for that once the private-IP path has run
clean in production for a validation window.

## Decision 4: zero-downtime cutover via `--no-traffic`, not a blind redeploy

The existing `helio-backend` revision (public IP + connector) keeps serving 100% of traffic
throughout provisioning. The new configuration (VPC connector + private-IP `DATABASE_URL`) is
deployed as a **new revision with `--no-traffic`** — it exists, is fully configured, and is
directly reachable at its own per-revision URL, but receives zero production traffic until
independently verified:

1. Hit the new revision's own URL directly: `/health`, then a real DB round-trip (e.g.
   `GET /api/dashboards` with a valid session, or any authenticated GET) — confirm success, check
   Cloud Run logs for that revision for connection errors.
2. Only once verified, migrate traffic: `gcloud run services update-traffic helio-backend
   --to-latest`.
3. The old revision is **not deleted** immediately — Cloud Run keeps prior revisions available, so
   an instant rollback (`update-traffic --to-revisions <old-revision>=100`) stays available if
   anything surfaces post-cutover that step 1's direct verification didn't catch.

This means the only moment of real user-facing risk in the entire migration is Decision 2's single
instance-patch step — everything else is either additive-and-reversible or gated behind explicit
verification before it can affect live traffic.

## Decision 4c: `deploy-backend.sh` needs an argument-passthrough for the `--no-traffic` cutover deploy (human-directed, resolved 2026-08-19)

Round 3 of the design gate found a real structural gap: `infra/deploy-backend.sh`'s `gcloud run
deploy` invocation is fully hardcoded with no `"$@"` forwarding (confirmed via grep — zero hits),
so nothing in the plan actually specified how Decision 4's required `--no-traffic` flag reaches the
one deploy that must not receive live traffic. Run as-is, the script always deploys with Cloud
Run's default (100% traffic immediately) — exactly the blind-cutover outcome Decision 4 exists to
prevent.

**Resolution (escalated to the human, answered — add-passthrough):** append `"$@"` to the end of
the `gcloud run deploy` invocation in `deploy-backend.sh`, so any caller can forward extra flags.
The cutover deploy (task 6.1) becomes `./infra/deploy-backend.sh --no-traffic`; every ordinary
future deploy (task 8) is invoked with no extra args and behaves exactly as it does today. This
keeps the cutover going through the same officially-blessed deploy path instead of a one-off manual
`gcloud` command (avoiding config drift between the script and a hand-typed invocation), and the
passthrough itself is a generically useful capability for any future canary-style deploy, not a
one-off hack scoped only to this migration.

## Decision 4a: the private-IP `DATABASE_URL` must explicitly request SSL

`helio-db`'s `sslMode: ENCRYPTED_ONLY` rejects any unencrypted connection, regardless of transport
path — the current connector library handles this transparently via its own ephemeral-cert
mechanism, which is why today's `DATABASE_URL` carries no SSL params at all. A bare
`jdbc:postgresql://<private-ip>:5432/helio` URL would negotiate a plaintext connection by default
(pgjdbc does not enable SSL unless asked) and be rejected outright. The new `DATABASE_URL` must
carry `?sslmode=require` explicitly — this matches `ENCRYPTED_ONLY`'s enforcement level and needs
no client certificate (the instance has 0 client SSL certs provisioned; `sslmode=require` encrypts
the connection without verifying the server cert against a specific CA, which is an acceptable
posture for a same-VPC private-IP connection — full `verify-ca`/`verify-full` is not required
here). Concretely: `jdbc:postgresql://<private-ip>:5432/helio?sslmode=require`.

## Decision 4b: IP range allocation must avoid the full auto-mode VPC footprint

`default`'s ~40 auto-allocated regional subnets span `10.128.0.0/20`–`10.232.0.0/20`. Both the
private-services-access peering range (task 2.1) and the VPC connector's own range (task 3.1) must
avoid that entire band, not just the local `us-west1` subnet. Concrete candidates, both outside the
auto-subnet band and non-overlapping with each other:
- Private-services-access peering range: `10.8.0.0/20`
- VPC connector range: `10.9.0.0/28` (a `/28` is the minimum/expected size for a Serverless VPC
  Access connector)

## Decision 5: RLS/`helio_privileged` role is unaffected by construction

`connectionInitSql = "SET ROLE helio_privileged"` and the `helio.db.user`/`password` credentials
are unchanged — only the JDBC URL's *transport* changes (private IP + port instead of the
socketFactory form). No RLS policy, role grant, or connection-init behavior needs to change; this
still needs to be *verified* post-cutover (Decision 4 step 1's real DB round-trip should exercise
a query that would fail if RLS/role assumption broke), but no code change is anticipated for it.

## Task sequence (see tasks.md for the full checklist)

1. Enable `vpcaccess.googleapis.com` + `servicenetworking.googleapis.com` (additive, no
   checkpoint).
2. Allocate a private-services-access IP range + create the peering to `default` (additive, no
   checkpoint).
3. Create the Serverless VPC Access connector in `us-west1` on `default` (additive, no
   checkpoint).
4. **Checkpoint** → enable Private IP on `helio-db` (Decision 2's risk point).
5. Deploy-script change (executor-driven, normal review loop): `application.conf` requires no
   change (already defers to `${?DATABASE_URL}`); `infra/deploy-backend.sh`'s `--set-env-vars`
   gains the private-IP `DATABASE_URL` (with `?sslmode=require`, Decision 4a) and the VPC
   connector flags. `infra/README.md` is updated to document the new private-networking
   prerequisite (this change's own spec delta requires it).
6. Deploy the new revision with `--no-traffic`, verify directly (Decision 4 step 1).
7. **Checkpoint** → migrate traffic to the new revision (Decision 4 step 2).
8. Step 5's `infra/deploy-backend.sh`/`infra/README.md` changes mean future ordinary deploys use
   this path by default, confirmed working end-to-end before merge.
9. Monitor (via HEL-118's new alerting) for a window post-cutover; file the public-IP-disable
   follow-up once confident.
