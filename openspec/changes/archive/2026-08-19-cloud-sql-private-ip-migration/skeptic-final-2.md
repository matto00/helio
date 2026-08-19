## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### Scope note

Per the orchestrator's briefing: round 1's final-gate skeptic CONFIRMed `111512e4`.
During the actual `--no-traffic` cutover attempt (task 6.1) against live production,
the orchestrator found `deploy-backend.sh`'s `--set-env-vars` would have silently
dropped three live env vars and `--set-secrets` referenced a nonexistent secret —
neither caught by round 1. The executor fixed both in `67f1269d`; evaluator re-PASSed
(`evaluation-2.md`). This gate is explicitly instructed to re-verify **everything**
from scratch against live GCP — not just the two already-fixed keys — on the theory
that round 1 verified internal consistency but didn't fully cross-check the script
against live reality. I read all prior artifacts (ticket/proposal/design/tasks, all
four skeptic-design rounds, skeptic-final-1, evaluation-1/2) as claims only, and
independently re-pulled every piece of live state myself.

### What I verified (with fresh evidence, all commands re-run by me just now)

**gcloud identity/project** — `gcloud config get-value project` → `helio-493120`;
`gcloud auth list` → active account `mattheworr018@gmail.com`. Correct target.

**Full live env-var superset, re-derived from scratch (not by re-reading
evaluation-2's transcript):** `gcloud run services describe helio-backend
--region=us-west1 --project=helio-493120 --format=json`, parsed programmatically.
13 live keys: `ANTHROPIC_API_KEY, CLAUDE_MODEL, COOKIE_SECURE,
CORS_ALLOWED_ORIGINS, DATABASE_URL, DB_PASSWORD, DB_USER, GOOGLE_CLIENT_ID,
GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, HELIO_OWNER_EMAILS,
HELIO_UPLOADS_BACKEND, HELIO_UPLOADS_BUCKET`. Diffed against the script's full
`--set-env-vars`/`--set-secrets` key set myself: all 13 present; the only two
extra script keys (`LOG_FORMAT`, `HELIO_BETA_DAILY_MESSAGE_LIMIT`) are cycle-1
intentional additions, not drops. Confirms evaluation-2's superset claim, but
note: the live revision I pulled is **`helio-backend-00054-fzq`** (generation 54,
`commit-sha: 6b269a79...`, deployed 2026-08-19T03:03 via GitHub Actions CD,
`lastModifier: helio-github-sa@...`) — a **newer** revision than round 1's
`helio-backend-00053-hcj`. A routine CI/CD deploy landed between round 1 and now.
Its env-var set is unchanged from round 1 (13 keys, same values) so this doesn't
invalidate the fix, but it does mean I'm validating against genuinely current
state, not a stale snapshot.

**Secrets, re-pulled fresh:** `gcloud secrets list --project=helio-493120` →
exactly 3 secrets project-wide (`helio-anthropic-api-key`, `helio-db-password`,
`helio-google-client-secret`). `gcloud secrets describe helio-google-client-id` →
`NOT_FOUND`. All 3 secrets the script's `--set-secrets` references exist;
`helio-google-client-id` (removed from `--set-secrets` in cycle 2) is confirmed
absent. `GOOGLE_CLIENT_ID`'s live value
(`522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com`)
matches the script's literal byte-for-byte.

**`helio-db` state, re-pulled fresh:** `gcloud sql instances describe helio-db` →
`state: RUNNABLE`, `ipAddresses` includes `PRIVATE 10.8.0.3` (matches
`DATABASE_URL` in the script exactly), `sslMode: ENCRYPTED_ONLY` (matches
`?sslmode=require`), `requireSsl: false`, `privateNetwork: .../default`. Unchanged
since round 1.

**VPC connector + peering, re-pulled fresh:** `helio-vpc-connector` →
`state: READY`, `ipCidrRange: 10.9.0.0/28`, `network: default`. Peering to
`servicenetworking.googleapis.com` active, reserved range
`helio-private-services-range`. `vpcaccess.googleapis.com` and
`servicenetworking.googleapis.com` both confirmed enabled. Unchanged since round 1.

**Image tag:** confirmed the orchestrator's proposed override image
(`...:release-v1.6-6b269a79`) resolves to a real digest in Artifact Registry, and
**matches the currently-live revision's image exactly** — i.e. the cutover would
ship the exact code already running in prod, isolating this deploy to a pure
connectivity change. This directly and correctly addresses round 1's non-blocking
note about the stale hardcoded `:v3` tag.

**Verified the flag-override mechanism actually works, empirically (not assumed):**
gcloud's calliope-based CLI parser applies last-flag-wins for a repeated
single-value flag — confirmed with a safe, non-destructive real command:
`gcloud projects describe helio-493120 --format=json --format="value(projectId)"`
prints the plain value (second flag wins), and the reverse order prints JSON
(second flag wins again). `deploy-backend.sh` hardcodes `--image=...:v3` before
appending `"$@"`; simulating the *exact* command the orchestrator proposes
(`./infra/deploy-backend.sh --no-traffic --image=...:release-v1.6-6b269a79`, via
a copied script + a `.env.deploy` populated with the **real live values** for
`GOOGLE_REDIRECT_URI`/`CORS_ALLOWED_ORIGINS`/`HELIO_OWNER_EMAILS` + an
argv-dumping `gcloud` stub) confirms the passed `--image` lands last in the argv
(position 20 of 20), so it wins over the hardcoded one. This part of the plan is
sound.

**`bash -n infra/deploy-backend.sh`** — syntax OK, re-run myself.

### Two new, live-verified defects (the "looks internally consistent, doesn't
match live reality" gaps this round asked me to specifically hunt for)

**1. `infra/deploy-backend.sh:58` hardcodes `--max-instances=3`, which
contradicts the live, intentionally-set production value of `2` — and would
silently revert an already-fixed Cloud SQL connection-exhaustion incident.**

- Live, fresh: `gcloud run services describe helio-backend --format="value(spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'])"` → **`2`**.
- `infra/deploy-backend.sh:58`: `--max-instances=3` (unchanged by this diff —
  confirmed via `git diff main...HEAD -- infra/deploy-backend.sh | grep max-instances`,
  shows only unmodified context, no `+`/`-`).
- `.github/workflows/cd-backend.yml` (the actual routine deploy path — the live
  revision's `managed-by: github-actions` annotation confirms this is what's
  really been deploying prod) hardcodes `--max-instances=2`, added in commit
  `51f110c0` ("Pin production CLAUDE_MODEL to Haiku 4.5 and cap Cloud Run to 2
  instances"), whose own commit message states: *"the privileged DB pool (5
  connections/instance) was exhausting db-g1-small's connection budget once more
  than ~2 Cloud Run instances were serving concurrently, causing intermittent
  `SQLTransientConnectionException` on `/converse` — capping max-instances keeps
  total privileged-pool demand within budget without a Cloud SQL tier change."*
  The workflow's inline comment restates it: *"3+ instances previously exhausted
  it under load."*
- Corroborated in `application.conf`: `helio.db.privileged.maximumPoolSize = 5`
  (line 112), i.e. each instance really does hold 5 privileged connections, and
  the total (app + privileged) is 10/instance (line 100's comment). This capacity
  constraint is orthogonal to the transport mechanism (socketFactory vs.
  private-IP/VPC-connector) — HikariCP's pool size is unaffected by which network
  path the physical connection travels, and this ticket's own Non-Goals
  explicitly excludes any Cloud SQL tier change. So the `max-instances=2` cap
  remains just as necessary after this migration as before it.
- **Consequence:** task 6.1 itself (`--no-traffic`) is not immediately harmful —
  0% traffic means no load-driven autoscaling risk yet. But task 7.2
  (`update-traffic --to-latest`, this same ticket's very next checkpoint) would
  move 100% of production traffic onto a revision configured for
  `--max-instances=3` — i.e. it would silently reintroduce, on the exact deploy
  meant to *harden* Cloud SQL connectivity, the precise connection-exhaustion
  configuration a prior incident fix (Aug 16) deliberately capped away. Neither
  round 1's skeptic, evaluation-1, nor evaluation-2 caught this — evaluation-1
  checked that `--max-instances` was *byte-identical to the pre-HEL-749 script*
  (true, and irrelevant — the pre-HEL-749 script was already stale relative to
  the CD workflow's later fix) but never cross-checked it against live Cloud Run
  state, which is exactly the blind spot this round was convened to close.
- This is not a request to make a new capacity decision (which Non-Goals
  correctly reserves for HEL-751/752) — it's a request not to silently regress
  an *already-made*, *already-incident-driven* one via a stale literal. Same
  category as cycle 2's `HELIO_UPLOADS_BACKEND`/`CLAUDE_MODEL`/`GOOGLE_CLIENT_ID`
  fixes: making the script's hardcoded config match already-decided live reality.

**2. `infra/README.md` (and this change's own spec delta,
`specs/production-deployment-docs/spec.md`) still document `helio-google-client-id`
as a required Secret Manager secret and describe `GOOGLE_CLIENT_ID` as flowing
through `--set-secrets` — both now false, and never corrected after cycle 2's fix.**

- `infra/README.md:66-85` ("Secret Manager secrets" section) lists
  `helio-google-client-id | Google OAuth 2.0 Client ID` in its required-secrets
  table and gives explicit `gcloud secrets create/versions add
  helio-google-client-id` example commands.
- `infra/README.md:113` ("Run the deploy" section): *"Passes `DB_PASSWORD`,
  `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CLIENT_ID` to Cloud Run via
  `--set-secrets`"* — directly contradicts the actual script: cycle 2 moved
  `GOOGLE_CLIENT_ID` to `--set-env-vars` as a plain literal specifically *because*
  `helio-google-client-id` doesn't exist (confirmed above, live, again, right
  now: `NOT_FOUND`).
- `openspec/changes/cloud-sql-private-ip-migration/specs/production-deployment-docs/spec.md:7-8`
  — this change's own spec delta, which will merge into the canonical
  `openspec/specs/production-deployment-docs/spec.md` on archive — still
  requires: *"The prerequisite that a `helio-google-client-id` secret must exist
  in Google Secret Manager before the script can run"* and lists it among *"The
  list of Secret Manager secrets the script references."* Both clauses are now
  false against the actual, currently-correct script.
- `git diff main...HEAD --name-only` confirms `infra/README.md` was **not**
  touched by cycle 2 at all (only `infra/deploy-backend.sh`, plus
  `tasks.md`/`workflow-state.md` bookkeeping) — evaluation-2.md's claim that
  README.md was *"correctly unaffected, since neither fix changes anything the
  README documents"* is demonstrably wrong: the `GOOGLE_CLIENT_ID` fix directly
  changes which Secret Manager secrets are required and how the var is sourced,
  which is precisely what that README section documents.
- Root cause: `helio-google-client-id` was originally added to the canonical
  spec by an earlier, already-archived change
  (`openspec/changes/archive/2026-06-13-remove-hardcoded-deploy-identifiers`),
  and the secret must have since been deleted or never actually provisioned in
  Secret Manager — cycle 2 is the first time anyone checked live state and
  discovered the drift. Since this ticket's own cycle 2 is what discovered and
  fixed the underlying code bug, it owns correcting the docs/spec delta it
  otherwise ships wrong.
- **Consequence:** an operator following `infra/README.md`'s documented
  prerequisites would be misdirected into provisioning a secret the script
  doesn't use, and the archived spec would permanently encode a false
  requirement for future readers (human or agent) until someone else notices.

### Everything else re-verified and holds

- `DATABASE_URL` private IP + `sslmode=require`: correct, live-matched.
- `--vpc-connector`/`--vpc-egress`: correct, connector `READY`, live-matched.
- `--set-env-vars`/`--set-secrets` key coverage: correct, full superset confirmed
  fresh (see above).
- `"$@"` passthrough: present, correctly ordered last, confirmed by fresh
  simulation.
- `--image` override mechanism: confirmed via real gcloud last-flag-wins
  behavior; the orchestrator's proposed command would deploy the exact
  currently-running image.
- `--memory=1Gi`, `--cpu=1`, `--concurrency=80`, `--min-instances=0`,
  `--service-account`, `--allow-unauthenticated` (IAM policy shows `allUsers` /
  `roles/run.invoker`, confirmed live): all match live state exactly. Only
  `--max-instances` diverges (see Change Request 1).
- Current live revision (`helio-backend-00054-fzq`, 100% traffic) still carries
  the old `run.googleapis.com/cloudsql-instances` annotation, no VPC-connector
  annotation — confirmed no premature cutover has occurred; production is
  untouched by this change so far.

### Verdict: REFUTE

The script's core connectivity migration (private IP, SSL mode, VPC connector,
`"$@"` passthrough, env-var/secret superset) is genuinely correct against live
GCP state, re-verified independently and fresh. But exactly the failure mode this
round was convened to hunt for — "looks internally consistent, doesn't match live
reality" — recurred twice more, on a script literally about to be run against
production: a stale `--max-instances` value that would reintroduce an
already-fixed Cloud-SQL connection-exhaustion incident once traffic migrates, and
a stale Secret-Manager requirement in both the operator runbook and this
ticket's own spec delta. Neither is cosmetic; both are exactly the class of gap
round 1 missed. Do not proceed to task 6.1 until both are corrected.

### Change Requests

1. **Fix the `--max-instances` regression before any deploy.** Either change
   `infra/deploy-backend.sh:58`'s hardcoded `--max-instances=3` to `--max-instances=2`
   (matching the CD workflow's already-decided, incident-driven value — add a
   comment citing `51f110c0`/the `db-g1-small` connection-budget rationale, same
   as the CD workflow's own comment), or, if a genuinely fresh capacity decision is
   wanted now that the connector-library handshake cost is gone, get an explicit
   human go-ahead for a *different* number before task 6.1 runs — but do not let
   `3` reach task 7.2's traffic migration by default/inattention.
2. **Bring `infra/README.md` and this change's spec delta
   (`specs/production-deployment-docs/spec.md`) in line with cycle 2's
   `GOOGLE_CLIENT_ID` fix.** Remove `helio-google-client-id` from README's
   "Secret Manager secrets" table and its `gcloud secrets create/versions add`
   example; correct README's "Run the deploy" step 2 to state `GOOGLE_CLIENT_ID`
   is passed as a plain env var (`--set-env-vars`), not a secret; update
   `specs/production-deployment-docs/spec.md`'s "MODIFIED Requirements" to drop
   the `helio-google-client-id` prerequisite/list entry so the canonical spec
   isn't poisoned with a false requirement on archive.

### Non-blocking notes

1. Repeats prior rounds' already-flagged, still-uncorrected items: `design.md`'s
   "Current state (verified live, 2026-08-19)" header / `.openspec.yaml`'s
   `created:` date are one day ahead of clock (immaterial, all live facts
   independently re-verified again this round); task 6.3's DB-touching
   verification endpoint would be marginally tighter if it specifically
   exercised the privileged/BYPASSRLS pool.
2. This worktree's `scripts/concertino/` is a stale/partial copy of the main
   checkout's (missing `next-report-number.sh`, `persist-evidence.sh`,
   `emit-event.sh`); worked around by invoking the main checkout's copies by
   full path, consistent with every prior round.
3. Worth a follow-up ticket (evaluation-2.md already flagged this,
   independently corroborated here): a `--set-env-vars`/`--set-secrets`
   full-replace deploy script is a structural footgun that will recur for the
   next unrelated env-var addition unless the script gains a pre-deploy
   live-diff check or the footgun is documented prominently in
   `infra/README.md`'s "Run the deploy" section.
