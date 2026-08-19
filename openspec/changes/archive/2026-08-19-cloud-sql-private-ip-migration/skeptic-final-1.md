## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### Scope note

Per the orchestrator's briefing: this is the final gate on `111512e4` (executor's
implementation of tasks.md section 5 only — `infra/deploy-backend.sh` +
`infra/README.md`), immediately before the orchestrator proceeds to the live
`--no-traffic` cutover deploy (tasks.md section 6) against production. Sections
1-4 (VPC APIs, peering, connector, Private IP on `helio-db`) were already
executed live by the orchestrator, outside this git diff. Sections 6-8 have not
happened. I independently re-verified all of it — live GCP state, the committed
diff, and the exact behavior of the script — rather than trusting any prior
report's transcription, per the task brief's explicit instruction.

### What I verified (with evidence)

**Planning artifacts (read in full):** `ticket.md`, `proposal.md`, `design.md`
(all decisions, esp. 2/3/4/4a/4b/4c/5), `tasks.md`, all four
`skeptic-design-{1,2,3,4}.md`, `evaluation-1.md`, `files-modified.md`,
`specs/production-deployment-docs/spec.md` — treated as claims, not fact.

**Live GCP state (project `helio-493120`, account `mattheworr018@gmail.com`,
independently re-pulled, not trusted from any report):**
- `gcloud sql instances describe helio-db` →
  `ipAddresses: [PRIMARY 35.230.112.237, OUTGOING 136.118.136.153, PRIVATE
  10.8.0.3]`, `ipConfiguration.sslMode: ENCRYPTED_ONLY`, `requireSsl: false`,
  `privateNetwork: projects/helio-493120/global/networks/default`,
  `state: RUNNABLE`. Confirms the private IP is genuinely `10.8.0.3` — matches
  `infra/deploy-backend.sh:42`'s `DATABASE_URL` value exactly — and the
  instance is healthy post-restart.
- `gcloud compute networks vpc-access connectors describe helio-vpc-connector
  --region=us-west1` → `state: READY`, `ipCidrRange: 10.9.0.0/28`,
  `network: default`. Matches design.md Decision 4b and `--vpc-connector`
  flag exactly.
- `gcloud services vpc-peerings list --network=default` → active peering to
  `servicenetworking.googleapis.com`, reserved range
  `helio-private-services-range`; `gcloud compute addresses describe
  helio-private-services-range --global` → `address: 10.8.0.0,
  prefixLength: 20, status: RESERVED`. Matches design.md Decision 4b.
- `gcloud services list --enabled | grep -E "vpcaccess|servicenetworking"` →
  both enabled.
- `gcloud run services describe helio-backend` → current **live** revision
  (`helio-backend-00053-hcj`, 100% traffic) still carries the **old**
  `run.googleapis.com/cloudsql-instances` annotation and no VPC-connector
  annotation — confirms, as the brief states, no cutover revision exists yet
  and production traffic is untouched by this change so far.
- `gcloud artifacts docker tags list ... --filter="tag:v3"` → the
  `--image=...:v3` tag the script references resolves to a real, existing
  digest (`sha256:ffeea809...`) in Artifact Registry — the deploy will not
  fail on a missing image.
- `gcloud projects get-iam-policy` — no evidence of a missing
  `vpcaccess.user` grant; same-project VPC-connector usage requires no
  extra binding beyond what's already present (`roles/run.serviceAgent`,
  `roles/vpcaccess.serviceAgent`), consistent with documented GCP behavior.

**Committed diff (`git diff main...HEAD`, read in full, not summarized):**
- `infra/deploy-backend.sh`: `--add-cloudsql-instances=...` replaced with
  `--vpc-connector=helio-vpc-connector --vpc-egress=private-ranges-only`;
  `DATABASE_URL` changed from the `socketFactory`/`cloudSqlInstance` form to
  `jdbc:postgresql://10.8.0.3:5432/helio?sslmode=require`; `"$@"` appended as
  the new final line after a trailing `\` added to `--project=helio-493120`.
  `--vpc-connector`/`--vpc-egress` confirmed as real `gcloud run deploy` flags
  via `gcloud run deploy --help`.
- `infra/README.md`: new "1. Private networking" prerequisite section,
  correct renumbering of the following two sections (1/2 → 2/3), matches the
  spec delta's three scenarios exactly (confirmed by direct read against
  `specs/production-deployment-docs/spec.md`).
- `backend/src/main/resources/application.conf`, `backend/build.sbt`: **empty
  diffs**, confirmed via `git diff main...HEAD -- <path>` — genuinely
  untouched, matching task 5.1's claim and Decision 5's "transport only"
  reasoning. `git diff main...HEAD --name-only` (excluding the openspec change
  dir) shows exactly `infra/README.md` and `infra/deploy-backend.sh` — no
  other files touched, no scope drift.
- `grep -n "socketFactory\|cloudSqlInstance\|add-cloudsql-instances"` across
  `infra/README.md` and `infra/deploy-backend.sh` → both remaining hits are
  explicitly framed as historical ("moved from... to...", "This replaces the
  older...") — no current-path implication remains. Satisfies the spec
  delta's "SHALL NOT find any remaining reference... as the primary
  connectivity method" clause.

**Directly simulated the script (not just read it) — the crux of this gate's
brief ("trace through exactly what gcloud command it would generate"):**
copied the real `infra/deploy-backend.sh` into a scratch dir, wrote a stub
`.env.deploy` with realistic values, replaced `gcloud` on `PATH` with an
argv-dumping shim, and ran it two ways:
- `bash deploy-backend.sh` (no args) → 18 args, byte-identical in content and
  order to the pre-HEL-749 script's invocation (region, platform,
  vpc-connector/egress, service-account, the full `--set-env-vars` string
  with the new private-IP `DATABASE_URL`, `--set-secrets`, memory/cpu/
  concurrency/scale flags, `--allow-unauthenticated`, `--project`). Exit 0.
- `bash deploy-backend.sh --no-traffic` → the same 18 args plus `--no-traffic`
  appended as arg 19, exactly matching the cutover invocation task 6.1
  specifies. Exit 0. No `set -u` nounset error from empty/populated `"$@"`
  (positional params are exempt from nounset, confirmed by exit code, not
  just by claim).

This independently reproduces (not merely re-reads) the round-4 skeptic's
simulation and evaluator's own separate stub-`gcloud` check, on the current
committed file, from a cold read.

- `bash -n infra/deploy-backend.sh` → syntax OK, re-run myself.
- `sbt test` was not re-run: backend source is provably untouched (empty
  diffs on the only two files that could matter, `application.conf` and
  `build.sbt`, confirmed above), so there is no code path evaluation-1.md's
  pasted `3281 tests, 0 failed` result could have missed. Re-running an
  expensive 174s suite against a zero-diff surface would not produce new
  evidence.

### Acceptance-criteria trace (ticket.md Scope, scoped to what's live/committed
so far)

1. "Provision a Serverless VPC Access connector in the same region" — **met**,
   live-verified (`helio-vpc-connector`, `READY`, `us-west1`).
2. "Enable Private IP on `helio-db`... check for any downtime window" — **met**,
   live-verified (`10.8.0.3` assigned, `state: RUNNABLE`, i.e. healthy
   post-restart, matching the orchestrator's brief).
3. "Update `DATABASE_URL`/connection config... update `infra/deploy-backend.sh`
   and Cloud Run service annotations accordingly" — **the script half is met**,
   confirmed in the diff and by simulation above. **The live Cloud Run
   annotation half is intentionally not yet done** — that's tasks.md section 6,
   explicitly out of this cycle's scope per the orchestrator's brief, and the
   live `describe` above confirms the current 100%-traffic revision is
   correctly untouched (no premature cutover).
4. "Verify RLS/`helio_privileged` role behavior is unaffected" — not yet
   applicable; correctly deferred to task 6.3 (post-cutover verification,
   Decision 5). `application.conf`'s empty diff confirms nothing about role
   assumption mechanics changed at the code level, which is what Decision 5
   actually claims at this stage.

### Would `./infra/deploy-backend.sh --no-traffic`, run right now, produce a
working, safe, zero-traffic revision?

Yes, on the evidence gathered above: every value in the generated `gcloud run
deploy` command is genuinely correct against live state, not just internally
consistent with the design doc —
- `--vpc-connector=helio-vpc-connector` → connector exists, `READY`, correct
  region/network.
- `--vpc-egress=private-ranges-only` → valid flag/value; doesn't affect
  Anthropic/Resend/GCS (public-internet destinations bypass the connector
  under this egress mode).
- `DATABASE_URL=...10.8.0.3...?sslmode=require` → private IP matches the
  instance's actual live private IP exactly; `sslmode=require` matches the
  instance's actual live `sslMode: ENCRYPTED_ONLY` enforcement.
- `--image=...:v3` → resolves to a real, existing Artifact Registry digest.
- `--no-traffic` → reaches the invocation as the final argument, confirmed by
  direct simulation; Cloud Run's documented behavior for `--no-traffic` on an
  existing service is to add the new revision at 0% while leaving current
  traffic distribution untouched — the current live revision still shows
  100%/old-annotations, so there is nothing for this deploy to disturb.

### Verdict: CONFIRM

The design-gate process (four rounds) caught and fixed four real blocking
defects across the plan (missing SSL param, wrong IP-range scope, a
self-contradicting `application.conf` instruction, a missing README task) and
one genuine safety gap in the cutover mechanism itself (no `--no-traffic`
passthrough). I did not take that history on faith — I independently
re-verified the *current* state of every one of those fixed points against
live GCP and the actual committed files, plus reproduced the `"$@"`
simulation myself rather than re-reading the prior report's transcript of it.
Everything holds. Sections 1-4's live infrastructure and section 5's script
change are both genuinely correct and consistent with each other and with
design.md's decisions. This is safe to proceed to task 6.1 (`--no-traffic`
cutover deploy).

### Non-blocking notes

1. **`tasks.md` checkbox hygiene**: sections 1-4 (all actually completed live
   against production) are still shown unchecked (`- [ ]`) in the committed
   `tasks.md`, while section 5 is correctly checked. This is understandable —
   those steps were executed by the orchestrator directly, outside the
   executor/git loop — but leaving them unchecked risks a future reader
   (human or agent) believing Private IP/the connector aren't provisioned yet.
   Worth updating `tasks.md` to `[x]` for 1.1-4.4 before or alongside the
   cutover, for an accurate record.
2. **Image tag staleness (pre-existing, not introduced by this diff)**: the
   hardcoded `--image=...:v3` tag's current digest
   (`sha256:ffeea809...`) does not match the currently-running production
   revision's digest (`sha256:f9859d86...`). This line is unchanged by
   HEL-749 (confirmed via diff — no `+`/`-` on that line), so it's not a
   defect this change introduced, but it means the cutover deploy will ship
   whatever build `v3` currently points to, not necessarily today's latest
   `main`. Worth a conscious check by the orchestrator before running task
   6.1 — confirm `v3` is the intended build, or repoint it first — since this
   is genuinely a distinct decision from the DB-connectivity migration itself.
3. Repeats the design-gate's already-flagged, still-uncorrected non-blocking
   items: `design.md`'s "Current state (verified live, 2026-08-19)" header and
   `.openspec.yaml`'s `created:` are one day ahead of the actual clock
   (immaterial — all live facts were independently re-verified against GCP,
   not trusted from the label, across every round including this one); task
   6.3's DB-touching verification endpoint would be marginally tighter if it
   specifically exercised the privileged/BYPASSRLS pool rather than a generic
   authenticated GET.
4. Environmental, repeated from every design-gate round and evaluation-1.md:
   this worktree's `scripts/concertino/` is a stale/partial copy of the main
   checkout's (missing `next-report-number.sh`, `persist-evidence.sh`,
   `emit-event.sh`). I worked around it the same way — invoking the main
   checkout's copies by full path — which is safe since they resolve paths
   via explicit arguments, not their own script location.
