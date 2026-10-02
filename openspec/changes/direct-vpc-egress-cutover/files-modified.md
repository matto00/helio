- `infra/deploy-backend.sh` — `--vpc-connector` replaced by `--network=default --subnet=helio-run-egress`; HEL-1231 header paragraph added
- `infra/README.md` — private-networking prerequisite now the `helio-run-egress` subnet; connector only as history
- `docs/deployment.md` — new cutover runbook (subnet, no-traffic tag, verification, `--to-latest`, rollback, connector delete), CD trace, subnet overlap evidence
- `openspec/changes/direct-vpc-egress-cutover/tasks.md` — tasks ticked

Flag check (installed gcloud 565.0.0, `--help` ANSI-stripped): `run services update` has --network, --subnet, --clear-vpc-connector, --clear-network, --no-traffic, --tag, --vpc-egress, --vpc-connector; `run services update-traffic` has --to-latest, --to-revisions, --remove-tags; `compute networks subnets create` has --network, --range, --region; `subnets delete`, `vpc-access connectors create/delete` have the documented flags; `logging read` has --freshness, --limit, --order. --project/--format are global flags.
Dry render: stub gcloud argv contains `--network=default --subnet=helio-run-egress --vpc-egress=private-ranges-only`, 0 occurrences of `vpc-connector`. shellcheck not installed; `bash -n` ok. Prettier check passed (main checkout binary).
