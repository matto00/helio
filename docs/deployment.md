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
