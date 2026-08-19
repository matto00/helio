# Files Modified — HEL-749 (tasks.md section 5 only)

- `infra/deploy-backend.sh` — Task 5.2: `--set-env-vars`'s `DATABASE_URL` changed from the
  `socketFactory`/`cloudSqlInstance` form to the private-IP form
  (`jdbc:postgresql://10.8.0.3:5432/helio?sslmode=require`, design.md Decision 4a). Task 5.3:
  replaced `--add-cloudsql-instances=...` with `--vpc-connector=helio-vpc-connector
  --vpc-egress=private-ranges-only`; removed the old connector flag cleanly (not gated behind a
  fallback flag — reasoning in the script's new comment block: rollback goes through Cloud Run's
  existing prior revision, not a re-invocation of this script with a different flag). Task 5.3b:
  appended `"$@"` to the end of the `gcloud run deploy` invocation (design.md Decision 4c) so
  `./infra/deploy-backend.sh --no-traffic` can forward the cutover flag while ordinary deploys are
  unaffected — implemented exactly as the round-4 skeptic's simulation validated, verified again
  independently with a stubbed `gcloud` (no-args → 18 identical args; `--no-traffic` → 19 args,
  appended last).
  - **Cycle 2 fix**: discovered during the actual task 6.1 cutover-deploy attempt, not by
    design/code review — the script's `--set-env-vars`/`--set-secrets` fully *replace* the live
    Cloud Run revision's env vars on every deploy, so anything present live but missing from the
    script is silently dropped, not merged. Independently confirmed via `gcloud run services
    describe helio-backend --format="yaml(spec.template.spec.containers[0].env)"` that the live
    service carries `HELIO_UPLOADS_BACKEND=gcs`, `HELIO_UPLOADS_BUCKET=helio-uploads-prod`, and
    `CLAUDE_MODEL=claude-haiku-4-5-20251001` that the script did not set — added all three as
    literal values (stable, non-environment-specific production config, same rationale as
    `COOKIE_SECURE`/`LOG_FORMAT`, unlike the env-varying `GOOGLE_REDIRECT_URI`/
    `CORS_ALLOWED_ORIGINS`, which correctly stay sourced from `.env.deploy`). Separately,
    independently confirmed via `gcloud secrets describe helio-google-client-id` (`NOT_FOUND`)
    that the script's `--set-secrets=...GOOGLE_CLIENT_ID=helio-google-client-id:latest...` entry
    referenced a Secret Manager secret that does not exist, which would have made the script fail
    outright; moved `GOOGLE_CLIENT_ID` from `--set-secrets` to `--set-env-vars` as a literal value
    matching the live service's actual (plain, non-secret) configuration. Re-verified the fixed
    script's combined `--set-env-vars`/`--set-secrets` key set is a strict superset of every key
    name currently live (`comm -23` diff against the live `env[].name` list — empty output,
    nothing dropped; two additions, `LOG_FORMAT`/`HELIO_BETA_DAILY_MESSAGE_LIMIT`, are pre-existing
    cycle-1 additions, not new drops), and re-ran the `"$@"`-passthrough simulation against the
    updated script (still 18/19 args as expected).
  - **Cycle 3 fix**: found by the final-gate skeptic's second round hunting specifically for
    "looks internally consistent, doesn't match live reality" gaps. (1) `--max-instances=3` was
    stale — independently confirmed live via `gcloud run services describe helio-backend
    --format="value(...maxScale...)"` → `2`, and via `git show 51f110c0` that commit
    intentionally capped production at 2 instances after the privileged DB pool (5
    connections/instance) exhausted `db-g1-small`'s connection budget with 3+ concurrent
    instances. Changed to `--max-instances=2` with a comment citing `51f110c0` and the
    connection-budget rationale, matching the CD workflow's (`.github/workflows/cd-backend.yml`)
    own comment style — this capacity constraint is orthogonal to the DB-transport change this
    ticket makes (HikariCP pool size doesn't care which network path the connection travels), so
    it remains necessary post-migration. (2) `infra/deploy-backend.sh`'s comments were already
    accurate (cycle 2 already documented the `GOOGLE_CLIENT_ID`/secret-removal reasoning inline);
    the drift was in `infra/README.md` and the spec delta, not the script itself — see below.
  - **Cycle 4 fix**: the evaluator's cycle-3 re-check found that cycle 2's hardcoded
    `GOOGLE_CLIENT_ID` literal value violated a *different*, pre-existing, still-binding
    canonical requirement (`openspec/specs/production-deployment-docs/spec.md`'s "deploy-backend.sh
    contains no hardcoded environment-specific identifiers"), not the requirement any prior cycle
    was checking. `GOOGLE_CLIENT_ID` is now sourced from `.env.deploy` via a `${GOOGLE_CLIENT_ID}`
    reference in `--set-env-vars`, matching the existing `GOOGLE_REDIRECT_URI`/
    `CORS_ALLOWED_ORIGINS` pattern exactly (same file, same `set -a; source .env.deploy; set +a`
    mechanism). It remains a plain `--set-env-vars` value, not `--set-secrets` — that part of
    cycle 2's fix (the secret doesn't exist; OAuth Client IDs aren't confidential) is unaffected
    and still correct; only *where the value comes from* changed.
    **Grep-test finding, flagged rather than silently claimed as passing**: the spec's own
    scenario ("`grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh` output SHALL be empty") is
    mechanically unsatisfiable as literally worded for any script that sets `GOOGLE_CLIENT_ID` as
    a *named* Cloud Run env var — the `KEY=` assignment syntax in `--set-env-vars` always contains
    the literal substring `GOOGLE_CLIENT_ID=` regardless of whether the value is hardcoded or a
    `${...}` reference. Proved this isn't specific to my fix: `grep -E 'GOOGLE_REDIRECT_URI='`
    matches the *exact same line* for the *exact same already-blessed* variable-reference pattern
    the coordinator told me to replicate. The scenario's own parenthetical clarifies the actual
    intent: "(the variable name may appear as a Secret Manager mapping key but no literal value
    SHALL be present)" — i.e. no hardcoded *credential value*, which is satisfied
    (`GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}` is a variable reference, not a literal). Removed one
    avoidable extra match (my own comment had quoted the grep pattern literally); the remaining
    single match (`infra/deploy-backend.sh:72`, the `--set-env-vars` line itself) is unavoidable.
    Also updated this change's own spec delta
    (`specs/production-deployment-docs/spec.md`) to list `GOOGLE_CLIENT_ID` among the
    `.env.deploy`-populated variables (its own requirement text and scenario would otherwise have
    gone stale the moment this commit lands, same class of bug as cycle 3's finding) and added it
    to `infra/.env.deploy.example` (with the real prod value as a documented placeholder — not
    confidential, a public OAuth Client ID) and `infra/README.md`'s `.env.deploy` variable table
    and "Run the deploy" step 1. Re-verified the env-var superset check still holds after this
    change (`comm -23` against fresh live `gcloud run services describe` output — empty, nothing
    dropped) by simulating the script with `.env.deploy.example`'s values populated.
- `infra/README.md` — Task 5.5: added a new "Private networking" prerequisite section documenting
  the Serverless VPC Access connector (`helio-vpc-connector`) + Cloud SQL Private IP requirement
  ahead of running `deploy-backend.sh`; renumbered the following two prerequisite sections
  (Secret Manager secrets, `.env.deploy`) from 1/2 to 2/3. The `postgres-socket-factory`/
  `cloudSqlInstance` connector library is mentioned only as historical context for why the
  connectivity path changed, not as the current/primary connectivity method — satisfies
  `specs/production-deployment-docs/spec.md`'s three scenarios (verified line-by-line against the
  spec delta).
  - **Cycle 3 fix**: this file was never touched in cycle 2 despite evaluation-2.md's claim that
    it was "correctly unaffected" — independently confirmed via `git diff main...HEAD --
    infra/README.md` that it still listed `helio-google-client-id` in the Secret Manager
    prerequisites table (with `gcloud secrets create/versions add helio-google-client-id`
    examples) and described `GOOGLE_CLIENT_ID` as flowing through `--set-secrets`, both false
    since cycle 2 moved `GOOGLE_CLIENT_ID` to a plain env-var literal (re-confirmed fresh this
    cycle: `gcloud secrets describe helio-google-client-id` → `NOT_FOUND`; `gcloud secrets list`
    → exactly `helio-anthropic-api-key`, `helio-db-password`, `helio-google-client-secret`).
    Removed the `helio-google-client-id` row and its `gcloud secrets create/versions add` example
    (repointed the example at `helio-google-client-secret`, one of the two real remaining
    secrets); added an explicit note that `GOOGLE_CLIENT_ID` is a public identifier passed via
    `--set-env-vars`, not Secret Manager; corrected the "Run the deploy" step-2 sentence to drop
    `GOOGLE_CLIENT_ID` from the `--set-secrets` list and state its actual (plain env-var)
    handling. Did not add the also-missing `ANTHROPIC_API_KEY` to either the table or that
    sentence — that's a separate, pre-existing doc gap predating this ticket, out of this change
    request's scope; flagged as a non-blocking spinoff candidate instead of fixed inline.
  - **Cycle 4 fix**: added `GOOGLE_CLIENT_ID` to the `.env.deploy` variable table (§3, alongside
    `GOOGLE_REDIRECT_URI`/`CORS_ALLOWED_ORIGINS`) and to "Run the deploy" step 1's list of
    variables sourced from `.env.deploy`, reflecting that it's no longer a hardcoded literal.
- `infra/.env.deploy.example` — **Cycle 4, new**: added `GOOGLE_CLIENT_ID` as a documented
  operator-fillable variable, with the real production value as the placeholder (not a secret —
  a public OAuth Client ID — so committing it as an example is not a credential leak, consistent
  with it already being visible in the live Cloud Run service's env-var listing to anyone with
  read access to the project).
- `openspec/changes/cloud-sql-private-ip-migration/specs/production-deployment-docs/spec.md` —
  **Cycle 3 fix**: the change's own spec delta's "MODIFIED Requirements" prose (not its
  scenarios, which were already scenario-based and didn't name the secret) still required *"The
  prerequisite that a `helio-google-client-id` secret must exist..."* and listed it among *"The
  list of Secret Manager secrets the script references."* Both now false; removed both. Verified
  the delta's three scenarios still hold unedited against the corrected README content (deploy
  prereqs, Secret Manager prereqs, private-networking prereqs) — none of them name a specific
  secret, so no scenario text needed to change, only the requirement's own prose bullets.
  - **Cycle 4 fix**: added `GOOGLE_CLIENT_ID` to the delta's own "list of variables that must be
    populated in `infra/.env.deploy`" bullet and to the "Operator reads deploy prerequisites"
    scenario's THEN clause — otherwise this delta's own requirement text would have gone stale
    the instant this commit landed (the same self-inconsistency class cycle 3 found and fixed
    for the Secret Manager list), since `GOOGLE_CLIENT_ID` is now genuinely one of the variables
    an operator must populate in `.env.deploy`.

## Not modified (verified, no change needed)

- `backend/src/main/resources/application.conf` — Task 5.1: confirmed independently by reading the
  file that `helio.db.url` already fully defers to `${?DATABASE_URL}` (`url = ${?DATABASE_URL}`
  on the line immediately after the `helio.db.host`/`port`/`name`-composed default), with no
  `socketFactory`-specific logic anywhere in the file. No edit made.
