## Why

HEL-749 reaches Cloud SQL Private IP through a Serverless VPC Access connector (`helio-vpc-connector`, e2-micro, min 2 / max 10, 10.9.0.0/28): always-on Google-managed VMs with a fixed monthly floor. Cloud Run Direct VPC egress gives each instance its own interface in a subnet and bills nothing while scaled to zero, while keeping the private-IP path.

## What Changes

Repo-side only (owner ruling 2026-10-01). The prod cutover is performed by hand by the driver after merge, with the owner confirming every production change. No mutating gcloud/gsutil command is run by this change.

- `infra/deploy-backend.sh`: `--vpc-connector=helio-vpc-connector` becomes `--network=default --subnet=helio-run-egress`; `--vpc-egress=private-ranges-only` is kept. Header comment rewritten to describe direct egress, and to state that until the subnet exists a manual run fails loudly (CD does not use this script).
- `docs/deployment.md`: new cutover runbook (create subnet, `--no-traffic` tagged revision on the image prod already runs, verify via tag URL, shift traffic with `--to-latest`, rollback, later connector delete) plus rollback criteria and CD trace.
- `infra/README.md`: networking prerequisite describes the subnet instead of the connector.
- Delta to the `production-deployment-docs` spec (the requirement currently mandates the connector wording).
- Subnet proposal: `helio-run-egress`, us-west1, network `default`, `10.10.0.0/26`, proven non-overlapping read-only.
- CD trace: `cd-backend.yml` uses `deploy-cloudrun@v3`, which runs `gcloud run deploy` with the given flags and no network flags; unspecified template settings are preserved (live revision deployed by CD still carries the connector). So CD preserves direct egress and cannot reintroduce the connector. No CD change needed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `production-deployment-docs`: the Cloud Run deployment documentation requirement now describes Direct VPC egress (subnet) instead of a Serverless VPC Access connector.

## Impact

`infra/deploy-backend.sh`, `infra/README.md`, `docs/deployment.md`, one openspec spec. No backend/frontend code, no schema, no CD workflow change. Acceptance criteria satisfied by this PR: the documentation AC (script, header, docs incl. subnet and rollback criteria). Remaining for the driver's cutover: prod serves from direct-egress revision; DB/Flyway verification; Anthropic and GCS egress; post-cutover CD describe; connector deletion and billing drop.
