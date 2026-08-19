## Skeptic Report — final gate (round 3, skeptic-final-3.md)

### Scope note

This is a confirmation pass at commit `68ad21f9` (cycle 4), run after two fix
cycles beyond this run's formal `SKEPTIC_FINAL_ROUNDS` budget (2): round 2
REFUTEd (stale `--max-instances=3`, stale Secret Manager docs), both fixed in
cycle 3; cycle 3's own evaluator then found a new regression (`GOOGLE_CLIENT_ID`
hardcoded, violating the pre-existing, unmodified base-spec requirement), fixed
in cycle 4, PASSed by `evaluation-4.md`. The orchestrator asked for one more
independent pass given production-cutover stakes, explicitly instructing me to
re-verify **everything** from scratch against live GCP and current committed
code — not defer to `evaluation-4.md`'s conclusion on the GOOGLE_CLIENT_ID
question, and not treat the round-2/3 history as license to either wave this
through or manufacture new findings. I read all prior artifacts (ticket,
proposal, design, tasks, all four skeptic-design rounds, skeptic-final-1/2,
evaluation-1 through evaluation-4) as claims only, and independently re-derived
every conclusion below from live GCP state and the current committed diff,
run by me, just now.

### What I verified (with fresh evidence)

**Live GCP state, independently re-pulled (project `helio-493120`, account
`mattheworr018@gmail.com`):**
- `gcloud sql instances describe helio-db` → `ipAddresses` includes
  `PRIVATE 10.8.0.3`, `sslMode: ENCRYPTED_ONLY`, `requireSsl: false`,
  `privateNetwork: .../default`, `state: RUNNABLE`. Matches
  `deploy-backend.sh`'s `DATABASE_URL` (`10.8.0.3`, `?sslmode=require`)
  exactly.
- `gcloud compute networks vpc-access connectors describe helio-vpc-connector
  --region=us-west1` → `state: READY`, `ipCidrRange: 10.9.0.0/28`,
  `network: default`.
- `gcloud services vpc-peerings list --network=default` → active peering to
  `servicenetworking.googleapis.com`, reserved range
  `helio-private-services-range`.
- `gcloud services list --enabled | grep -E "vpcaccess|servicenetworking"` →
  both enabled.
- `gcloud run services describe helio-backend --format=json`, parsed
  programmatically myself (not by re-reading any prior report's transcript):
  live revision `helio-backend-00054-fzq` (generation 54, image
  `...:release-v1.6-6b269a79`, 100% traffic, deployed via GitHub Actions CD —
  `run.googleapis.com/cloudsql-instances` annotation still present, no VPC
  connector annotation, `autoscaling.knative.dev/maxScale: '2'`). 13 live env
  keys extracted: `ANTHROPIC_API_KEY, CLAUDE_MODEL, COOKIE_SECURE,
  CORS_ALLOWED_ORIGINS, DATABASE_URL, DB_PASSWORD, DB_USER, GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, HELIO_OWNER_EMAILS,
  HELIO_UPLOADS_BACKEND, HELIO_UPLOADS_BUCKET`.
- `gcloud run revisions list --service=helio-backend --limit=6
  --sort-by="~metadata.creationTimestamp"` → newest revision is still
  `-00054-fzq`; no stray `--no-traffic` revision exists from any earlier
  attempted cutover. `status.traffic` confirms 100% still on `-00054-fzq`.
  Production is untouched by this change so far — task 6.1 genuinely has not
  succeeded yet.
- `gcloud secrets list --project=helio-493120` → exactly 3 secrets
  (`helio-anthropic-api-key`, `helio-db-password`, `helio-google-client-secret`).
  `gcloud secrets describe helio-google-client-id` → `NOT_FOUND`, confirmed
  fresh, again.
- `gcloud artifacts docker images describe ...:release-v1.6-6b269a79` →
  resolves to digest `sha256:7199f0a5...`; matches the currently-live
  revision's image string exactly (same tag) — the orchestrator's proposed
  `--image` override would deploy the exact code already running in prod,
  isolating the deploy to a pure connectivity/config change.
- `gcloud run services get-iam-policy helio-backend` → `allUsers` /
  `roles/run.invoker`, matches `--allow-unauthenticated`.
- Live container resources (`resources.limits.cpu=1, memory=1Gi`,
  `containerConcurrency=80`, service account
  `helio-backend-sa@...`) — all match the script's
  `--memory/--cpu/--concurrency/--service-account` flags exactly.
- `gcloud projects get-iam-policy` filtered to `mattheworr018@gmail.com` (the
  identity that will actually run the manual cutover command) → `roles/owner`.
  No IAM gap for using the VPC connector or any other flag in this deploy.

**Current committed code (`git diff main...HEAD`, read in full):**
- Exactly 3 non-openspec files touched across all 4 cycles:
  `infra/.env.deploy.example`, `infra/README.md`, `infra/deploy-backend.sh`.
  `git diff main...HEAD -- backend/` is empty — backend genuinely untouched
  across all 4 cycles (re-confirmed, not re-run `sbt test` since there is no
  new surface to exercise — consistent with skeptic-final-1's reasoning).
- Independently parsed `deploy-backend.sh`'s `--set-env-vars` (12 keys) and
  `--set-secrets` (3 keys) into a script-key-set myself (Python, not by eye)
  and diffed against the live 13-key set pulled above:
  `live_keys - script_keys = []` (zero drops), `script_keys - live_keys =
  {HELIO_BETA_DAILY_MESSAGE_LIMIT, LOG_FORMAT}` (both pre-existing,
  intentional cycle-1 additions, not new). Full superset confirmed, from
  scratch.
- `--max-instances=2` in the script (`deploy-backend.sh:58`, with a comment
  citing `51f110c0`) matches the live revision's
  `autoscaling.knative.dev/maxScale: '2'` exactly — the round-2 regression
  is genuinely fixed and still fixed at `HEAD`.
- `infra/README.md`'s Secret Manager table now lists exactly
  `helio-db-password`, `helio-google-client-secret` — no
  `helio-google-client-id` reference remains as a current requirement
  anywhere in README or the change's own spec delta
  (`specs/production-deployment-docs/spec.md`, read in full): its "MODIFIED
  Requirements" section now says `helio-google-client-secret` only, and lists
  `GOOGLE_CLIENT_ID` among the `.env.deploy` variables, matching the actual
  script.
- `GOOGLE_CLIENT_ID`'s value is now sourced via `${GOOGLE_CLIENT_ID}` from
  `infra/.env.deploy` (`deploy-backend.sh:66`), not hardcoded — matches
  `GOOGLE_REDIRECT_URI`/`CORS_ALLOWED_ORIGINS`'s existing pattern.
  `infra/.env.deploy.example` now documents it, with the real prod value as
  the example placeholder (not a secret — a public OAuth Client ID, reasoning
  independently sound).

**Re-derived my own judgment on the GOOGLE_CLIENT_ID/canonical-spec question
(not deferred to evaluation-4's conclusion):**
- Ran the spec's literal headline scenario myself:
  `grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh` → **non-empty**
  (matches the `--set-env-vars` line, `GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}`).
  Taken completely literally, the scenario "fails."
- Ran the same pattern against `GOOGLE_REDIRECT_URI`, a variable that has
  **never** been hardcoded (both in the current script and in `main`'s
  pre-HEL-749 version, confirmed via `git show main:infra/deploy-backend.sh |
  grep 'GOOGLE_REDIRECT_URI='`) → also non-empty. This proves the headline
  pattern (`KEY=`, no anchor distinguishing a literal from a `${...}`
  reference) cannot be the author's actual intended test — it would flag an
  already-correct, never-disputed pattern as a violation.
  - I read the archived change that originated this requirement
  (`openspec/changes/archive/2026-06-13-remove-hardcoded-deploy-identifiers/tasks.md`,
  in full) myself: tasks 1.6 and 4.3 both specify the actual verification
  command as `grep -E 'GOOGLE_CLIENT_ID=[0-9]'` — anchored to a
  digit-leading literal (real Google OAuth Client IDs always start with a
  numeric project number), which a `${...}` reference can never match.
- Ran that pattern myself against the current script:
  `grep -E 'GOOGLE_CLIENT_ID=[0-9]' infra/deploy-backend.sh` → **empty**
  (exit 1) — passes.
- **My own independent conclusion, reached by re-deriving from the archived
  change's own original acceptance test rather than accepting evaluation-4's
  citation of it at face value**: cycle 4's fix genuinely satisfies the
  requirement's real, traceable intent (no hardcoded literal OAuth Client ID
  value). The canonical spec's headline scenario text is imprecise
  (independent of this ticket, not something this change's delta is
  responsible for fixing) but the substantive requirement — the thing the
  scenario exists to test — is met.

**Directly re-simulated the exact command the orchestrator plans to run,
end-to-end, myself:** copied the current `deploy-backend.sh` to a scratch
dir, wrote a `.env.deploy` with the real live values for
`GOOGLE_CLIENT_ID`/`GOOGLE_REDIRECT_URI`/`CORS_ALLOWED_ORIGINS`/
`HELIO_OWNER_EMAILS`, replaced `gcloud` on `PATH` with an argv-dumping shim,
and ran `bash deploy-backend.sh --no-traffic
--image=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:release-v1.6-6b269a79`:
produces a 20-argument `gcloud run deploy` invocation with every value
matching live state (private-IP `DATABASE_URL`, `--vpc-connector`/
`--vpc-egress=private-ranges-only`, `--max-instances=2`, the full env-var/
secret superset, `--project=helio-493120`), `--no-traffic` at position 19,
and the overriding `--image` at position 20 (last-flag-wins over the
hardcoded `:v3` default). Independently confirmed gcloud's calliope parser
genuinely applies last-flag-wins for a repeated single-value flag via a safe,
non-destructive real command (`gcloud projects describe ... --format=json
--format="value(projectId)"` vs. the reverse order — second flag wins both
times). `--vpc-connector`/`--vpc-egress` confirmed as real flags with
`private-ranges-only` confirmed as a valid value via `gcloud run deploy
--help` (and confirmed by the help text itself that private-ranges-only
sends only RFC1918/private traffic through the connector — public
destinations like Anthropic/Resend/GCS/Google OAuth are unaffected).
`bash -n infra/deploy-backend.sh` and `npx prettier --check infra/README.md`
both pass, re-run myself.

### One new operational finding (not a code defect — a pre-flight check)

No `infra/.env.deploy` file exists anywhere in this worktree (confirmed:
`ls infra/`, only `.env.deploy.example` present — correctly gitignored,
operator-managed, never committed). I tested what happens if the script is
run against a `.env.deploy` populated the way it would have been for the
round-2/3 cutover attempts (i.e., before cycle 4 added `GOOGLE_CLIENT_ID` as
a required `.env.deploy` variable) — missing only `GOOGLE_CLIENT_ID`:
`infra/deploy-backend.sh: line 65: GOOGLE_CLIENT_ID: unbound variable`, exit
1, **before `gcloud` is ever invoked**. This is a safe failure mode (no
partial/misconfigured revision gets created — `set -u` aborts the script at
argument-construction time), not a defect in the script. But since cycle 4
changed the `.env.deploy` contract *after* the round-2 live cutover attempt
already happened, whatever real `.env.deploy` file the orchestrator uses to
run the actual command (necessarily outside this worktree, since it's
gitignored) may predate that change. **Action before running the real
command: confirm the operator's actual `infra/.env.deploy` includes
`GOOGLE_CLIENT_ID=522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com`**
— if it does, this is moot; if it doesn't, the command will fail loudly and
harmlessly, just not on the first try.

### Acceptance-criteria trace (ticket.md Scope)

1. "Provision a Serverless VPC Access connector in the same region" — **met**,
   live-verified fresh (`READY`, `us-west1`, `network=default`).
2. "Enable Private IP on `helio-db`... check for any downtime window" —
   **met**, live-verified fresh (`10.8.0.3`, `RUNNABLE`).
3. "Update `DATABASE_URL`/connection config... update
   `infra/deploy-backend.sh` and Cloud Run service annotations accordingly" —
   script half **met**, verified correct by direct simulation against live
   values. Live Cloud Run annotation half **correctly still pending** — the
   live revision still shows the old `cloudsql-instances` annotation and
   100% traffic on the pre-migration image; this is exactly what task 6.1
   (not yet run) is for, and this gate's job is to confirm it's safe to run.
4. "Verify RLS/`helio_privileged` role behavior is unaffected" — correctly
   deferred to task 6.3; `application.conf` diff is empty (re-confirmed),
   consistent with Decision 5's "transport only" claim.

### Would `./infra/deploy-backend.sh --no-traffic
--image=...:release-v1.6-6b269a79`, run right now, be safe and correct?

Yes, on the evidence above, with the one caveat noted (real `.env.deploy`
must include `GOOGLE_CLIENT_ID`, or the script safely refuses to run rather
than deploying anything wrong). Every generated flag value matches live GCP
state exactly; the image override lands correctly and pins the deploy to the
already-running, already-verified build; `--no-traffic` means Cloud Run adds
the new revision at 0% without touching the current 100%-traffic revision;
no IAM gap exists for the identity that will run it.

### Verdict: CONFIRM

Round 2 found two real, live-verifiable defects; cycle 3's evaluator found a
third (a genuine regression cycle 2 introduced); all three are now correctly
fixed and I independently re-confirmed each fix against live GCP state and
the current committed code myself, from scratch, rather than trusting any
prior round's transcript — including re-deriving my own judgment on the
GOOGLE_CLIENT_ID spec-compliance question from the archived change's original
acceptance test, not evaluation-4's citation of it. I found no new defect in
the script, docs, or spec delta. This is safe to proceed to the actual
`--no-traffic` cutover deploy, contingent only on the operational pre-flight
check above (which is not a code/design gap — it is an artifact of
`.env.deploy` being deliberately outside version control).

### Non-blocking notes

1. **Pre-flight, addressed to the orchestrator directly**: verify the real
   `infra/.env.deploy` (wherever it lives — not this worktree) contains
   `GOOGLE_CLIENT_ID` before running the actual command (see above). If it's
   missing, the script will fail safely and immediately — just update the
   file and re-run.
2. Repeats prior rounds' still-open, non-blocking items: `design.md`'s
   "Current state (verified live, 2026-08-19)" header / `.openspec.yaml`'s
   `created:` date are one day ahead of clock (immaterial); task 6.3's
   DB-touching verification endpoint would be marginally tighter if it
   specifically exercised the privileged/BYPASSRLS pool; the
   `--set-env-vars`/`--set-secrets` full-replace footgun is worth a
   standalone follow-up ticket; `HELIO_UPLOADS_BUCKET`'s hardcoded literal is
   arguably in the same spirit as the now-fixed `GOOGLE_CLIENT_ID` issue but
   isn't covered by any formal spec scenario; `ANTHROPIC_API_KEY`'s README
   documentation gap is pre-existing and out of this ticket's scope; the
   canonical spec's "Grep confirms no hardcoded OAuth Client ID" scenario
   text itself is imprecisely worded (missing the `[0-9]` anchor its own
   originating change used) — worth a small independent spec-hygiene fix,
   not this ticket's to make.
3. Environmental, repeated from every round: this worktree's
   `scripts/concertino/` is a stale/partial copy of the main checkout's
   (confirmed missing `next-report-number.sh`, `persist-evidence.sh`,
   `emit-event.sh`, present only in the main checkout). Worked around by
   invoking the main checkout's copies by full path, consistent with every
   prior round.
