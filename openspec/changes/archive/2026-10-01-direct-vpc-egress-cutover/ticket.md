# HEL-1231: Replace the Serverless VPC Access connector with Cloud Run Direct VPC egress

## Description
Replace Serverless VPC Access connector `helio-vpc-connector` (e2-micro, min 2/max 10, 10.9.0.0/28; always-on VMs billed as Compute Engine E2 Instance Core) with Cloud Run Direct VPC egress (`--network`/`--subnet`, `--vpc-egress=private-ranges-only`). Egress only; DATABASE_URL (10.8.0.3) and app code unchanged. Cutover is checkpointed: `--no-traffic` revision, verify, `update-traffic`, validation window, then delete connector. Rollback criteria: subnet IP exhaustion, a Direct VPC egress feature gap/regional limit, or a measured regression attributable to direct egress; traffic growth alone is not a reason.

## Acceptance criteria
- [ ] Prod serves 100% from a Direct VPC egress revision, no --vpc-connector. (DRIVER CUTOVER)
- [ ] DB connectivity verified on the new revision pre-shift: /health, authenticated DB call, Flyway lines in Cloud Logging. (DRIVER)
- [ ] Anthropic-backed call and GCS upload/read succeed on the new revision. (DRIVER)
- [ ] A subsequent CD deploy keeps direct egress (describe). (DRIVER; CD trace in repo)
- [ ] After the validation window the connector is deleted; E2 Instance Core line drops to $0. (DRIVER)
- [ ] `infra/deploy-backend.sh`, its header comment, and `docs/deployment.md` describe direct egress, incl. subnet name/range and rollback criteria. (THIS PR)

Owner ruling 2026-10-01: this run delivers the repo-side change only; the prod cutover is performed by the driver with owner confirmation. Ticket is not set Done by this run; the auditor merges on the repo-side AC alone.
