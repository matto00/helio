## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `skeptic-design-1.md` and `skeptic-design-2.md` in full (treated as claims to
  re-verify, not fact).
- Read the current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/production-deployment-docs/spec.md`, `workflow-state.md`, and the base spec
  `openspec/specs/production-deployment-docs/spec.md` end-to-end, as if seeing them for
  the first time.
- Independently re-ran live GCP checks (project `helio-493120`, authenticated as
  `mattheworr018@gmail.com`):
  - `gcloud compute addresses list` (both `--global` and unfiltered) → **zero reserved
    addresses of any kind exist** — confirms the candidate ranges (`10.8.0.0/20`,
    `10.9.0.0/28`) are free at the address-reservation level, not just against the
    ~40-subnet auto-mode footprint round 2 already checked.
  - `gcloud compute routes list --filter="destRange~10.8. OR destRange~10.9."` → empty.
  - `gcloud compute networks vpc-access connectors list --region=us-west1` →
    `PERMISSION_DENIED: ... has not been used ... or it is disabled` — confirms
    `vpcaccess.googleapis.com` is still not enabled, matching design.md's "Current
    state."
  - Read `infra/README.md` in full and `infra/deploy-backend.sh` in full — grounded the
    CR6 fix (task 5.5) and a new finding (CR7, below) against the actual files.
  - `grep -n -E "no-traffic|--tag|forward.*arg"` and `grep -n '"\$@"|\${@}|\$1|getopts'`
    across `design.md`/`tasks.md`/`infra/deploy-backend.sh` — zero hits for any
    argument-forwarding mechanism in the script, and zero hits for any task specifying
    how `--no-traffic` (task 6.1) actually attaches to the deploy invocation. Grounds
    CR7.
  - `date` → `2026-08-18 18:xx PDT`, confirming round 2's non-blocking date-label note
    still applies unchanged (not re-litigated below).

### CR5/CR6 re-verification (this round's stated fixes)

- **CR5 (design.md:122 self-contradiction) — FIXED, confirmed against current file
  content, not the orchestrator's summary.** `design.md`'s "Task sequence" item 5 now
  reads: *"Deploy-script change (executor-driven, normal review loop):
  `application.conf` requires no change (already defers to `${?DATABASE_URL}`);
  `infra/deploy-backend.sh`'s `--set-env-vars` gains the private-IP `DATABASE_URL`
  (with `?sslmode=require`, Decision 4a) and the VPC connector flags. `infra/README.md`
  is updated to document the new private-networking prerequisite..."* I grepped every
  `application.conf` mention across `design.md`/`tasks.md`/`proposal.md` (4 hits) and
  all four are now consistent: "no change" / "requires NO change" / "no change needed."
  No remaining contradiction. Addressed.
- **CR6 (missing infra/README.md task) — FIXED, confirmed against current file
  content.** `tasks.md` now has task 5.5: *"`infra/README.md`: document the Serverless
  VPC Access connector + Cloud SQL Private IP prerequisite for `deploy-backend.sh`, and
  remove any remaining reference to the `postgres-socket-factory`/`cloudSqlInstance`
  connector path as the primary connectivity method — required by this change's own
  spec delta."* I compared this against the spec delta's third scenario verbatim
  (`specs/production-deployment-docs/spec.md`'s "Operator reads private networking
  prerequisites" scenario, which requires both documenting the new prerequisite AND
  the absence of any remaining `postgres-socket-factory`/`cloudSqlInstance` reference)
  — task 5.5 covers both halves exactly. I also diffed the change's spec delta against
  the base spec (`openspec/specs/production-deployment-docs/spec.md`) and confirmed the
  delta is a proper superset (preserves all four original bullets + both original
  scenarios verbatim, adds the fifth bullet + third scenario) — a correctly-formed
  MODIFIED requirement, no regression to the two pre-existing scenarios. Addressed.

### Fresh full-plan pass — one new blocking finding

**CR7 (blocking, new) — no task specifies how `--no-traffic` actually attaches to the
cutover deploy, and the literal default behavior of the plan as written defeats
Decision 4's entire safety premise.**

`design.md` Decision 4 and `tasks.md` task 6.1 both say the cutover deploy must use
`--no-traffic` so the new (unverified) revision receives zero live traffic until
verification (6.2–6.4) and the human checkpoint (7.1) clear it. I read
`infra/deploy-backend.sh` in full: it is a fixed script with a single hardcoded
`gcloud run deploy` invocation (line 18) and **no argument-forwarding mechanism**
(`"$@"`, `getopts`, or any positional-parameter handling — I grepped for all three,
zero hits). Task 5.3 modifies this same script's flags (`--vpc-connector`,
`--vpc-egress`, remove `--add-cloudsql-instances`) and design.md's task-sequence item 8
explicitly frames the *result* as becoming "the" deploy path: *"Step 5's
`infra/deploy-backend.sh`/`infra/README.md` changes mean future ordinary deploys use
this path by default"* — and by Cloud Run's own default behavior, running that script
unmodified ships the new revision at **100% traffic immediately** (only an explicit
`--no-traffic` flag suppresses that).

So: nothing in `design.md` or `tasks.md` tells the executor *how* to get `--no-traffic`
into the one deploy invocation (task 6.1) that specifically needs it, and design.md's
own "future ordinary deploys" phrasing implies `--no-traffic` is explicitly *not*
meant to become a permanent part of the script — it's a one-off for this cutover only.
If task 6.1 is executed by simply running the task-5.3-modified script as-is (the most
literal reading of "deploy" once the script has already been edited per task 5), the
new, not-yet-verified revision goes live to 100% of production traffic in that single
step — skipping both the direct-verification steps (6.2–6.4) and the human checkpoint
(7.1) entirely. That is precisely the "blind redeploy" scenario Decision 4's header
says this design avoids, and precisely the "a botched change could cut off DB access
entirely" risk `ticket.md`'s "Not urgent-hotfix scope" section names as the reason this
migration must be deliberate and checkpointed, not a blind automated cycle. Round 1's
CR1 established the bar for this gate at "a task would fail/behave wrong for a reason
the design never anticipated" — this is the same category of gap, but here the failure
mode is a live-traffic safety violation rather than a failed `gcloud` call.

**Required:** add an explicit instruction — either in Decision 4/task 5.3 or as a new
task 6.0 — for how the cutover's `--no-traffic` deploy is actually invoked. Two
concrete, non-improvised options that would resolve this:
1. Task 6.1 explicitly instructs running the underlying `gcloud run deploy ...`
   command directly (documented inline, mirroring `deploy-backend.sh`'s post-5.3
   flags) with `--no-traffic` appended, rather than invoking the script — keeping
   `infra/deploy-backend.sh` itself as the "ordinary" (immediate-100%-traffic) path for
   all future normal deploys, consistent with design.md item 8's phrasing.
2. Modify `infra/deploy-backend.sh` (as part of task 5.3) to accept an optional
   passthrough (e.g. `"$@"` forwarded into the `gcloud run deploy` call), so
   `bash infra/deploy-backend.sh --no-traffic` is the documented cutover invocation and
   `bash infra/deploy-backend.sh` (no args) is the documented ordinary one.

Either is fine — what's missing is that neither is specified, and the plan's own
"deliberate, non-improvised execution" standard (which this gate has already held CR1
and CR5/CR6 to) requires picking one before this reaches execution, not leaving the
cutover's most safety-critical single command to be improvised in the moment.

### Positive findings (re-confirmed fresh, not just diffed against prior rounds)

- Decision 1 (reuse `default` VPC), Decision 2 (checkpoint placement before the one
  real-risk step), Decision 3 (public IP stays enabled as the rollback fallback),
  Decision 4a (`sslmode=require`, matches live `ENCRYPTED_ONLY` + 0-client-certs
  state), Decision 4b (IP ranges, now hand-verified against a live address/route scan
  with zero conflicts found), and Decision 5 (RLS/`helio_privileged` unaffected by
  construction, verified against `application.conf`'s shared `helio.db.url`) all hold
  up on a fresh, first-principles read against the live GCP state and the actual repo
  files — no regressions from the round-1/round-2 fixes.
- Ticket AC trace: all four `ticket.md` Scope bullets map to concrete tasks (VPC
  connector → 3.1–3.2; Private IP + downtime check → Decision 2/task 4; DATABASE_URL +
  Cloud Run annotation update → 5.2/5.3, matching the exact `--add-cloudsql-instances`/
  `DATABASE_URL` string I read live in `infra/deploy-backend.sh`; RLS verification →
  Decision 5/task 6.3). The two required human checkpoints (4.1, 7.1) satisfy the
  ticket's explicit "deliberate, checkpointed execution... not a blind automated cycle"
  demand — modulo CR7's gap in exactly that checkpoint sequence.
- `infra/README.md`'s current content (read in full) has zero existing mention of
  `socketFactory`/`cloudSqlInstance`/VPC — task 5.5's "remove any remaining reference"
  clause is therefore a no-op safety net today (nothing to remove yet) rather than a
  contradiction; not a defect, just noted for completeness.

### Verdict: REFUTE

### Change Requests

1. (CR7, blocking, new) Specify the exact mechanism for attaching `--no-traffic` to the
   cutover deploy (task 6.1). `infra/deploy-backend.sh` has no argument-forwarding
   (verified: no `"$@"`/`getopts`/positional handling anywhere in the file), and
   design.md's task-sequence item 8 implies `--no-traffic` is *not* meant to become
   part of the script's steady-state behavior — so nothing currently tells the executor
   how the one deploy that specifically must not receive live traffic actually avoids
   it. As written, the literal action of "deploy" after task 5.3's script edits ships
   the new, unverified revision to 100% of production traffic immediately (Cloud Run's
   default), skipping the direct-verification steps (6.2–6.4) and the human checkpoint
   (7.1) — the exact "blind redeploy" outcome Decision 4 exists to prevent. Add either
   (a) an explicit documented `gcloud run deploy ...` invocation for the cutover step,
   run directly rather than via the script, with `--no-traffic` appended, or (b) an
   optional argument-passthrough in `infra/deploy-backend.sh` itself (task 5.3) so
   `bash infra/deploy-backend.sh --no-traffic` is the documented cutover command.

### Non-blocking notes

- Repeats round 2's non-blocking note: `design.md`'s "Current state" header and
  `.openspec.yaml`'s `created:` both say `2026-08-19`, one day ahead of the actual
  system clock (`2026-08-18`). Still doesn't affect correctness (every live-state claim
  was independently re-verified against GCP this round too) but still worth tidying.
- Repeats round 2's non-blocking note on task 5.3's `--add-cloudsql-instances`
  removal-vs-flag punt ("executor's call, confirm with orchestrator") — still not
  safety-relevant (the new revision's connectivity doesn't depend on this annotation
  either way; the real rollback path is Decision 4's traffic-split), still not
  blocking.
- Repeats round 1's non-blocking note on task 6.3 (a privileged-pool-specific endpoint
  would be a marginally tighter verification than a generic authenticated GET) — still
  true, still not blocking.
- Environmental note (not a plan defect, flagged for the orchestrator): this worktree's
  `scripts/concertino/` directory is a stale/partial copy from the branch's base commit
  — it is missing `next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`, and
  several other procedure scripts present in the main checkout's `scripts/concertino/`.
  I resolved this by invoking the main checkout's copies directly (they resolve paths
  via git/explicit arguments, not their own script location, so this is safe) rather
  than guessing a fallback filename or skipping evidence persistence. Future rounds in
  this worktree will hit the same gap.
