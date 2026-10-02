## Context

Prod `helio-backend` (revision helio-backend-00083-7cz, image `release-v0.8.6-e690399e`, read-only describe 2026-10-01) runs with connector `helio-vpc-connector` and `private-ranges-only`. Cloud SQL `helio-db` is private IP 10.8.0.3 in reserved range `helio-private-services-range` 10.8.0.0/20 (peering `servicenetworking-googleapis-com`, ACTIVE). `default` is an auto-mode VPC; its us-west1 subnet is 10.138.0.0/20. Service traffic is `latestRevision: true` plus a stale tag `cutover-verify` (rev 00055). Owner ruling: this change edits the repo only; the driver performs the cutover by hand.

## Goals / Non-Goals

**Goals:** direct-egress flags in the manual deploy script; a precise, verified cutover runbook; proof of a non-overlapping subnet; a conclusion on CD behavior.
**Non-Goals:** any prod mutation; changing CD flags (unless the trace shows a need); switching to `all-traffic`/Cloud NAT; app code; changing `--max-instances=2`; the stale `cloudsql-instances` template annotation and stale `cutover-verify` tag (noted in the runbook, not fixed here).

## Decisions

1. **Subnet `helio-run-egress`, us-west1, network `default`, `10.10.0.0/26`.** /26 is the gcloud-documented minimum for `--subnet`. Outside `10.128.0.0/9` (required for manual subnets in an auto-mode network), outside 10.8.0.0/20 (private services), 10.9.0.0/28 (connector), every auto subnet and every route destination listed (verified read-only with a script; only 0.0.0.0/0 overlaps, trivially). Alternative: reuse the 10.138.0.0/20 default subnet (rejected: a shared /20 with other consumers, and Cloud Run IP blocks would fragment it; a dedicated subnet is Google's guidance). No subnet flags beyond `--network`, `--range`, `--region` are needed; Private Google Access is unnecessary for `private-ranges-only`.
2. **`--vpc-egress=private-ranges-only` kept.** Anthropic and GCS use public Google/Internet addresses and keep egressing directly; `all-traffic` would need Cloud NAT.
3. **Cutover mechanism: `gcloud run services update helio-backend --network=default --subnet=helio-run-egress --vpc-egress=private-ranges-only --clear-vpc-connector --no-traffic --tag=direct-egress`.** `update` changes only the named template fields, so the new revision runs the same image and env as prod (no new code; v0.8.7 is held). `--clear-vpc-connector` is required since a revision cannot carry both. Flags verified present on the installed gcloud 565.0.0 for both `run services update` and `run deploy`. Alternative `deploy-backend.sh --no-traffic --image=<live image>` rejected: it `--set-env-vars` replaces everything from `.env.deploy` and could drift from live config.
4. **Traffic shift with `update-traffic --to-latest`, not `--to-revisions`.** The service is `latestRevision: true`; `--no-traffic` pins traffic to the current revision, and `--to-revisions=X=100` would leave it pinned so every later CD deploy would create a revision that receives no traffic. `--to-latest` restores the latest-revision routing. Precondition: the tagged revision is the latest created revision (no CD run in between).
5. **Rollback.** Instant (only while the connector exists): `update-traffic --to-revisions=<last connector revision, currently helio-backend-00083-7cz>=100`. This pins traffic by revision name; while pinned, any CD deploy creates a revision that receives NO traffic. Rollback therefore ends with a fix-forward that restores latest-routing: `services update --vpc-connector=helio-vpc-connector --clear-network --vpc-egress=private-ranges-only --no-traffic --tag=rollback-verify`, verify via the tag URL, then `update-traffic --to-latest`, and confirm with `describe` that traffic shows `latestRevision: true`. The same `describe` check follows the forward `--to-latest` in the cutover. Connector is deleted only after the validation window.
6. **CD trace.** `cd-backend.yml` calls `google-github-actions/deploy-cloudrun@v3` with `image` and `flags` (env/secrets/max-instances only); the action's README states `flags` are passed to `gcloud run deploy`. `gcloud run deploy` carries forward template settings it is not told to change. Empirical evidence: live revision 00083 was created by `helio-github-sa` via CD and still carries `run.googleapis.com/vpc-access-connector` and egress annotations. Conclusion: a CD deploy preserves direct egress, and cannot reintroduce the connector, because it passes no `--vpc-connector`. No CD change. Residual verification (AC) after cutover: `describe` shows `network-interfaces` annotation after a CD deploy; owned by the driver.
7. **`deploy-backend.sh` hard-codes `--subnet=helio-run-egress`.** Until the subnet exists a manual run fails loudly at gcloud (acceptable: CD does not use the script); documented in header and infra/README.md.

## Risks / Trade-offs

- DB unreachable from the new path → verified on a no-traffic tag first (health, DB-backed call, Flyway lines); instant rollback while the connector exists.
- Subnet IP exhaustion at higher instance counts → max-instances=2 is far below capacity; first fix is a larger subnet.
- Revision pinning mistake (Decision 4) → runbook uses `--to-latest` and a precondition check.
- The runbook cannot be executed here (owner ruling); correctness is verified by gcloud `--help` flag checks, `bash -n`, and a dry rendering of the script's gcloud invocation. Residual risk is borne by the driver's step-by-step verification.

## Migration Plan

See docs/deployment.md runbook (authored by this change): create subnet; tagged no-traffic revision; verify; `--to-latest`; validation window; delete connector.
