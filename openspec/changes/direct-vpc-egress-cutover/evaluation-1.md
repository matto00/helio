## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD e9bddc584a15c74d6d3f4e87b37dc0d895dc1859 against live base 8022ff73.
No mutating gcloud/gsutil command was run; only read-only describe/list/--help.

### Phase 1: Spec Review — PASS
Repo-side AC (script, header comment, docs/deployment.md describe direct egress incl. subnet name/range and rollback criteria): met.
Prod cutover ACs are the driver's per owner ruling and were not judged. Tasks all ticked and match the diff. Scope is
infra/, docs/, openspec/ only. Spec delta matches the docs: infra/README.md names the subnet (helio-run-egress, 10.10.0.0/26),
and mentions the connector only in negation/history context (README lines 43, 67-68), which the delta permits; no current-path
connector description. The delta's MODIFIED requirement name exists in openspec/specs/production-deployment-docs/spec.md:27.

### Phase 2: Code Review — PASS
- `bash -n infra/deploy-backend.sh`: OK.
- Stub-gcloud dry render (stub on PATH only, temp copy, dummy .env.deploy): argv contains `--network=default --subnet=helio-run-egress --vpc-egress=private-ranges-only`, no `--vpc-connector`; "$@" passthrough intact.
- Prettier check on docs/deployment.md, infra/README.md and the change dir: clean.
- Flag verification via `gcloud ... --help` (ANSI-stripped): run services update/run deploy have --network, --subnet, --clear-vpc-connector, --clear-network (mutually exclusive group with --network/--subnet, not with --vpc-connector), --no-traffic, --tag, --vpc-egress, --vpc-connector; update-traffic has --to-latest, --to-revisions, --remove-tags; subnets create has --network/--range; connectors create has --machine-type/--min-instances/--max-instances/--network/--range; logging read has --freshness/--limit/--order. --no-traffic help text confirms the pinning behavior and the --to-latest restore the runbook relies on. --subnet help confirms /26 minimum.
- Live read-only facts re-checked: subnet helio-run-egress NOT_FOUND (pre-check valid); connector 10.9.0.0/28 e2-micro 2/10 matches; only us-west1 subnet is default 10.138.0.0/20; service shows 00083-7cz at latestRevision 100% plus stale cutover-verify tag at 00055; URL host s5psdhr47q-uw matches the tag-URL pattern.
- Runbook order is executable: (a) create subnet, (b) no-traffic tagged revision, (c) tag-URL verification, (d) --to-latest, (e) rollback, (f) delete connector; VERIFY/ROLLBACK present per step ((c) has a collective rollback note).
- Repo routes cited exist and behave as documented: GET /api/dashboards (DashboardRoutes, paged); PAT unscoped passes, scoped tokens confined to first segment `hooks` (AuthDirectives.confineScopedToken:141-163); CSRF header exempt for no-cookie PAT requests (AuthDirectives:179); POST /api/assistant-conversations (optional title/firstMessage, so `{}` works) and /:id/converse (ConverseRequest{message}, tier-gated via chatAccessService.guard, 503 when assistant service unconfigured); POST /api/uploads/image (multipart field `file`, 10 MiB default cap, 201 {id,url}); GET /api/uploads/image/:id is public optional-auth (PublicUploadRoutes).
- Flyway log filter: logback.xml uses LogstashEncoder with level renamed to `severity`; `logger_name` is the default Logstash field; Flyway loggers are org.flywaydb.*, so `jsonPayload.logger_name=~"flyway"` is consistent. The HEL-1128 caveat is accurate.

### Phase 3: UI Review — N/A
No frontend/**, ApiRoutes.scala, schemas/** or openspec/specs/** change. No backend/frontend change, so sbt testFull and the frontend gates do not apply (diff touches only infra/, docs/, openspec/changes/).

### Overall: PASS

### Non-blocking Suggestions
- docs/deployment.md step (c)4: the create-conversation curl does not capture the id into a variable (uses a literal `<id>` placeholder); a `jq -r .id` would make it copy-paste safe.
- Runbook says the flag check is against gcloud 565.0.0; I confirmed flags on the installed version, not the number.
