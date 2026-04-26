# Deployment Runbook

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
