# Deployment Runbook

## One-time env var backfill: `COOKIE_SECURE` (HEL-287)

`cd-backend.yml` (the automated CD pipeline that deploys on push to `release/**`) only builds and
pushes a new image via `deploy-cloudrun@v2` — it does **not** set any env vars, so it relies
entirely on whatever was last configured on the live Cloud Run service (i.e. whatever the most
recent `infra/deploy-backend.sh` run, or a manual `gcloud` command, set).

`infra/deploy-backend.sh` now sets `COOKIE_SECURE=true` on every run, but if the _first_ deploy of
this change reaches prod via `cd-backend.yml` alone (without an `infra/deploy-backend.sh` run in
between), the live Cloud Run service will not have `COOKIE_SECURE` set at all, and the backend will
silently fall back to `Secure=false`/`SameSite=Lax` — which cannot function in this app's
cross-site prod topology (see `CLAUDE.md`'s "Production environment variables" table). Login/
register will appear to succeed (`200`/`201`), but the session cookie will never attach, and every
subsequent authenticated request will `401`.

Before (or immediately after) the first deploy of the HEL-287 cookie migration, run this once
against the live service to guarantee the variable is actually set, regardless of which deploy path
runs next:

```bash
gcloud run services update helio-backend \
  --region=us-west1 \
  --project=helio-493120 \
  --update-env-vars=COOKIE_SECURE=true
```

After this one-time backfill, the variable persists on the Cloud Run service across
`cd-backend.yml`-only deploys (Cloud Run carries forward existing env vars on revisions that don't
explicitly override them), and every future `infra/deploy-backend.sh` run also re-asserts it.

## Rolling back a bad Cloud Run deploy

Cloud Run keeps all previous revisions. To roll back, redirect traffic to the last known-good revision.

**1. Find the previous revision:**

```bash
gcloud run revisions list --service=helio-backend --region=us-west1 --project=helio-493120
```

**2. Route 100% of traffic to it:**

```bash
gcloud run services update-traffic helio-backend \
  --to-revisions=REVISION_NAME=100 \
  --region=us-west1 \
  --project=helio-493120
```

**3. Verify:**

```bash
curl https://helio-backend-522265251224.us-west1.run.app/health
```

Once confirmed stable, delete the bad revision:

```bash
gcloud run revisions delete BAD_REVISION_NAME --region=us-west1 --project=helio-493120 --quiet
```

## Cutting over from the VPC connector to Direct VPC egress (HEL-1231)

Repo-side change only: the cutover below is run by hand by the driver, with owner confirmation.
Nothing in this repo creates the subnet or shifts traffic. Every `gcloud` flag below was checked
against the installed gcloud (565.0.0) `--help` output. All commands assume
`--project=helio-493120 --region=us-west1`; the service is `helio-backend`.

Background: the service egresses to Cloud SQL (`10.8.0.3`, reserved range
`helio-private-services-range` 10.8.0.0/20) through the Serverless VPC Access connector
`helio-vpc-connector` (e2-micro, min 2 / max 10, 10.9.0.0/28, always-on VMs). Direct VPC egress
(`--network`/`--subnet`, `--vpc-egress=private-ranges-only`) replaces it. Only egress changes:
`DATABASE_URL` (10.8.0.3), app code and image are untouched. The existing "Rolling back a bad
Cloud Run deploy" section below uses `--to-revisions`, which **pins** traffic to a named revision;
see step (e) for what that means here.

### Subnet proposal and non-overlap evidence

Proposal: subnet `helio-run-egress`, us-west1, network `default`, `10.10.0.0/26` (a /26 is the
minimum `--subnet` accepts). `default` is an auto-mode network, so a manual subnet must sit outside
`10.128.0.0/9`. Read-only evidence gathered 2026-10-01:

```bash
gcloud compute networks describe default --project=helio-493120 --format="yaml(autoCreateSubnetworks)"
# autoCreateSubnetworks: true
gcloud compute networks subnets list --project=helio-493120 --filter="region:us-west1"
# default  us-west1  default  10.138.0.0/20  IPV4_ONLY       (the only us-west1 subnet)
gcloud compute networks subnets list --project=helio-493120 --format="value(ipCidrRange)"
# 42 auto subnets, every one 10.128-10.232.x.0/20
gcloud compute addresses list --global --filter="purpose=VPC_PEERING" --project=helio-493120
# helio-private-services-range  10.8.0.0/20  INTERNAL  VPC_PEERING  RESERVED
gcloud compute networks vpc-access connectors describe helio-vpc-connector --region=us-west1 \
  --project=helio-493120 --format="yaml(ipCidrRange,machineType,minInstances,maxInstances,state)"
# ipCidrRange: 10.9.0.0/28, machineType: e2-micro, minInstances: 2, maxInstances: 10, state: READY
gcloud compute routes list --project=helio-493120 --format="value(destRange)"
# 0.0.0.0/0, every auto subnet, 10.9.0.0/28 (connector), 10.8.0.0/24 (private services peering)
```

Overlap check (inputs: the route and subnet lists above plus 10.8.0.0/20 and 10.9.0.0/28):

```python
import ipaddress as ip
c = ip.ip_network("10.10.0.0/26")
others = [l.strip() for f in ("routes.txt", "subnets.txt") for l in open(f) if l.strip()] \
    + ["10.8.0.0/20", "10.9.0.0/28"]
print([o for o in others if c.overlaps(ip.ip_network(o))])        # ['0.0.0.0/0'] (trivial default route)
print(c.subnet_of(ip.ip_network("10.128.0.0/9")))                 # False -> allowed for a manual subnet
```

Only the default route overlaps. The driver should re-run these reads before creating the subnet.

### (a) Create the subnet

Pre-check: `gcloud compute networks subnets describe helio-run-egress --region=us-west1 --project=helio-493120`
must return NOT_FOUND.

```bash
gcloud compute networks subnets create helio-run-egress \
  --network=default --range=10.10.0.0/26 --region=us-west1 --project=helio-493120
```

- VERIFY: `gcloud compute networks subnets describe helio-run-egress --region=us-west1 --project=helio-493120 --format="yaml(ipCidrRange,network,state)"` shows `10.10.0.0/26` on `default`.
- ROLLBACK: `gcloud compute networks subnets delete helio-run-egress --region=us-west1 --project=helio-493120` (only valid while no revision uses it).

### (b) Create a tagged, no-traffic revision on the live image

Do not trust image/revision names in this document; read them live:

```bash
gcloud run services describe helio-backend --region=us-west1 --project=helio-493120 \
  --format="yaml(status.latestCreatedRevisionName,status.traffic,spec.template.metadata.annotations)"
gcloud run services describe helio-backend --region=us-west1 --project=helio-493120 \
  --format="value(spec.template.spec.containers[0].image)"
```

On 2026-10-01 this was revision `helio-backend-00083-7cz`, image `release-v0.8.6-e690399e`, traffic
`latestRevision: true` 100%. Record the revision name as `CONNECTOR_REV`.

Pre-checks: (1) no `cd-backend.yml` run is in flight (`gh run list --workflow=cd-backend.yml --limit 3`);
(2) the live revision is the latest created one (`latestCreatedRevisionName` equals the traffic revision),
otherwise step (d)'s `--to-latest` would promote an unrelated revision.

```bash
gcloud run services update helio-backend \
  --network=default --subnet=helio-run-egress --vpc-egress=private-ranges-only \
  --clear-vpc-connector --no-traffic --tag=direct-egress \
  --region=us-west1 --project=helio-493120
```

`update` changes only the named template fields, so the revision keeps the live image and env
(no new code; v0.8.7 is held). `--clear-vpc-connector` is needed because a revision cannot carry both.

- VERIFY: `gcloud run services describe ... --format="yaml(status.latestCreatedRevisionName,status.traffic)"` shows a new latest revision (record it as `NEW_REV`) tagged `direct-egress` with no percent, and `CONNECTOR_REV` still holding 100%. `gcloud run revisions describe NEW_REV --region=us-west1 --project=helio-493120 --format="yaml(metadata.annotations)"` shows a `run.googleapis.com/network-interfaces` annotation and no `vpc-access-connector`.
- ROLLBACK: nothing serves traffic yet, so there is nothing to undo. Optionally drop the tag: `gcloud run services update-traffic helio-backend --remove-tags=direct-egress --region=us-west1 --project=helio-493120`.

### (c) Verify on the tag URL before any traffic shift

Tag URL (same pattern as the existing tags): `https://direct-egress---helio-backend-s5psdhr47q-uw.a.run.app`.
Set `TAG_URL` to it. With `min-instances=0` the first request cold-starts the revision, which runs Flyway.

1. Health: `curl -fsS "$TAG_URL/health"`.
2. Authenticated DB-backed call. The session cookie is `Secure`/cross-site and unusable from curl, so use a
   Helio personal access token (mint one in the app's API-token settings; `POST /api/tokens` needs a session).
   Unscoped PATs work on the normal authenticated routes; scoped tokens are confined to `/api/hooks/*`.
   ```bash
   curl -fsS -H "Authorization: Bearer $HELIO_PAT" "$TAG_URL/api/dashboards"
   ```
   A 200 with JSON proves the revision reached 10.8.0.3 over Direct VPC egress.
3. Flyway lines in Cloud Logging, scoped to the new revision (read-only). The backend logs JSON
   (`LOG_FORMAT=json`, LogstashEncoder, level renamed to `severity`, logger in `logger_name`; HEL-1128 fixed
   logback silently dropping all output, so also confirm the revision logged anything at all):
   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND resource.labels.service_name="helio-backend" AND resource.labels.revision_name="NEW_REV" AND jsonPayload.logger_name=~"flyway"' \
     --project=helio-493120 --freshness=1h --limit=20 --order=desc
   ```
   Expect lines such as "Successfully validated N migrations" and "Schema ... is up to date". If empty, broaden to
   `... AND resource.labels.revision_name="NEW_REV"` alone (any log line) and look for startup errors.
4. Anthropic-backed call (cheap: the service pins Haiku 4.5). `POST /api/assistant-conversations/:id/converse`
   is PAT-callable but tier-gated: use an owner/beta token (free tier is rejected, beta has a daily cap). Create a
   conversation, then send one short message:
   ```bash
   CONV=$(curl -fsS -X POST -H "Authorization: Bearer $HELIO_PAT" -H 'Content-Type: application/json' -d '{}' \
     "$TAG_URL/api/assistant-conversations")        # note the returned id
   curl -fsS -X POST -H "Authorization: Bearer $HELIO_PAT" -H 'Content-Type: application/json' \
     -d '{"message":"Reply with the single word ok."}' "$TAG_URL/api/assistant-conversations/<id>/converse"
   ```
   A 200 means the instance reached Anthropic (public egress under `private-ranges-only`). `503` means the
   assistant is unconfigured, not a networking verdict.
5. GCS upload then read (`HELIO_UPLOADS_BACKEND=gcs`). `POST /api/uploads/image` (multipart, field `file`,
   png/jpg/jpeg/gif/webp, max 10 MiB) then the public `GET /api/uploads/image/:id`:
   ```bash
   printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > /tmp/pixel.png
   curl -fsS -H "Authorization: Bearer $HELIO_PAT" -F "file=@/tmp/pixel.png;type=image/png" "$TAG_URL/api/uploads/image"   # 201 {id,url}
   curl -fsS -o /tmp/pixel-back.png -w '%{http_code} %{content_type}\n' "$TAG_URL/api/uploads/image/<id>"
   ```
   Expect 200 `image/png`. The upload leaves one small object in `helio-uploads-prod`; acceptable, delete if desired.

- ROLLBACK for all of (c): nothing to do; traffic is unaffected. If any check fails, stop and treat it per the
  rollback criteria below (the tagged revision can simply be left unrouted).

### (d) Shift traffic

```bash
gcloud run services update-traffic helio-backend --to-latest --region=us-west1 --project=helio-493120
```

`--to-latest`, not `--to-revisions=NEW_REV=100`: `--no-traffic` pinned the service to `CONNECTOR_REV`, and a
by-name pin would leave it pinned so every later CD deploy creates a revision that gets no traffic.

- VERIFY: `gcloud run services describe helio-backend --region=us-west1 --project=helio-493120 --format="yaml(status.traffic)"` shows an entry with `latestRevision: true` and `percent: 100` (the stale `cutover-verify` tag entry may remain), and `curl -fsS https://helio-backend-s5psdhr47q-uw.a.run.app/health` passes.
- ROLLBACK: step (e).

### (e) Rollback

Instant (valid only while the connector still exists, and moot if step (d)'s `--to-latest` has not run yet,
because traffic is then still pinned to `CONNECTOR_REV`):

```bash
gcloud run services update-traffic helio-backend --to-revisions=CONNECTOR_REV=100 \
  --region=us-west1 --project=helio-493120
```

This **pins** traffic by revision name. While pinned, any CD deploy creates a revision that receives NO traffic,
so always follow with the fix-forward that restores latest-routing. The fix-forward relies on `--clear-network`
in the same command as `--vpc-connector`:

```bash
gcloud run services update helio-backend \
  --vpc-connector=helio-vpc-connector --clear-network --vpc-egress=private-ranges-only \
  --no-traffic --tag=rollback-verify --region=us-west1 --project=helio-493120
# verify via https://rollback-verify---helio-backend-s5psdhr47q-uw.a.run.app (same checks as step (c) 1-2)
gcloud run services update-traffic helio-backend --to-latest --region=us-west1 --project=helio-493120
gcloud run services describe helio-backend --region=us-west1 --project=helio-493120 --format="yaml(status.traffic)"
```

VERIFY: traffic shows `latestRevision: true` at 100%. If the connector was already deleted, re-provision it first
(see below). Rollback is justified by: subnet IP exhaustion (first fix: a larger subnet, not a rollback), a Direct VPC
egress feature gap or regional limit, or a measured regression attributable to direct egress. Traffic growth alone is
not a reason. Re-provision command (live-verified settings):

```bash
gcloud compute networks vpc-access connectors create helio-vpc-connector \
  --network=default --region=us-west1 --range=10.9.0.0/28 \
  --machine-type=e2-micro --min-instances=2 --max-instances=10 --project=helio-493120
```

### (f) After the validation window: delete the connector

Only after the owner-agreed validation window with prod healthy on direct egress and no rollback criterion met:

```bash
gcloud compute networks vpc-access connectors delete helio-vpc-connector --region=us-west1 --project=helio-493120
```

- VERIFY: the E2 Instance Core billing line drops to $0; `connectors list` no longer shows it.
- ROLLBACK: the re-provision command above (then the fix-forward in (e)).
- Post-cutover CD check: after the next `cd-backend.yml` deploy, `gcloud run revisions describe <new revision> --format="yaml(metadata.annotations)"` must show the `run.googleapis.com/network-interfaces` annotation and no `run.googleapis.com/vpc-access-connector`.

### CD trace (design Decision 6)

`cd-backend.yml` calls `google-github-actions/deploy-cloudrun@v3` with `image` and `flags`
(`--update-env-vars`, `--update-secrets`, `--max-instances=2`; no network flags), which the action passes to
`gcloud run deploy`. `gcloud run deploy` carries forward template settings it is not told to change. Empirical evidence:
live revision 00083 was created by `helio-github-sa` via CD and still carries the `vpc-access-connector` and egress
annotations. Conclusion: a CD deploy preserves direct egress and cannot reintroduce the connector. No CD change;
the post-cutover describe check above is the residual verification.

### Pre-existing oddities (noted, not fixed here)

- A stale `cutover-verify` tag points at revision 00055.
- The template still carries a stale `run.googleapis.com/cloudsql-instances` annotation from the pre-HEL-749 path.

## Rolling back a bad Firebase Hosting deploy

Firebase Hosting keeps a full history of deploys and supports one-click rollback.

1. Go to the [Firebase console](https://console.firebase.google.com/project/helio-493120/hosting/sites)
2. Click the **Hosting** tab → **Release history**
3. Find the last good release and click **Rollback**

That's it — no rebuild required, Firebase re-serves the previous bundle instantly.

## When to use each

| Scenario                                   | Action                                       |
| ------------------------------------------ | -------------------------------------------- |
| Bad backend deploy (app crash, DB errors)  | Cloud Run traffic split to previous revision |
| Bad frontend deploy (broken UI, JS errors) | Firebase console rollback                    |
| Both broken after a release                | Roll back backend first, then frontend       |
