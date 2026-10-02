## 1. deploy-backend.sh

- [x] 1.1 Replace `--vpc-connector=helio-vpc-connector` with `--network=default --subnet=helio-run-egress`, keep `--vpc-egress=private-ranges-only`. Verify: `grep -n -E 'vpc-connector|--network|--subnet|--vpc-egress' infra/deploy-backend.sh`; `bash -n infra/deploy-backend.sh`; shellcheck if installed.
- [x] 1.2 Rewrite the HEL-749 header paragraph to describe direct egress, the subnet name/range, that a manual run fails loudly until the subnet exists, and that CD does not use this script. Verify: read the header.
- [x] 1.3 Dry-render the exact gcloud invocation (stub `gcloud` on PATH printing argv, dummy `.env.deploy` in a temp copy) and confirm the flags. Verify: captured argv contains `--network=default --subnet=helio-run-egress --vpc-egress=private-ranges-only` and no `--vpc-connector`.

## 2. Docs

- [x] 2.1 `docs/deployment.md`: add the cutover runbook (subnet create, tagged no-traffic revision on the live image, verification via tag URL incl. /health, authenticated DB call (curl against the tag URL with a Helio PAT as `Authorization: Bearer <token>` hitting a DB-backed route such as `GET /api/dashboards`; the session cookie is Secure/cross-site so is unusable from curl), Flyway log filter, Anthropic call, GCS upload/read, `update-traffic --to-latest`, rollback incl. the fix-forward ending in `--to-latest` and a `describe` check of `latestRevision: true`, later connector delete), each step with verify and rollback, rollback criteria, CD trace, subnet non-overlap evidence. Verify: every gcloud flag in it exists per `gcloud ... --help` (record the check).
- [x] 2.2 `infra/README.md`: replace connector prerequisite with the subnet prerequisite. Verify: `grep -i -c "vpc-connector\|Serverless VPC" infra/README.md` shows only rollback/history-context mentions (the spec permits those, not a current-path description).
- [x] 2.3 `npx prettier --check` on the changed md files. Verify: exit 0.

## 3. Evidence

- [x] 3.1 Write `files-modified.md` handoff; commit. No backend/frontend change, so no sbt gate. Verify: `git diff --stat` touches only infra/, docs/, openspec/.

- [x] 2.4 Runbook notes from design-gate round 2: the instant-rollback step is moot if `--to-latest` has not yet run (traffic is still pinned to the connector revision); the fix-forward relies on `--clear-network` in the same command as `--vpc-connector`. Verify: both statements present in docs/deployment.md.

## Standing Constraints

- [C1] No mutating gcloud/gsutil/Cloud command may be run by any role (no create, deploy, update, update-traffic, delete, services replace; never execute infra/deploy-backend.sh without a stubbed gcloud). Read-only describe/list/logs/--help only.
