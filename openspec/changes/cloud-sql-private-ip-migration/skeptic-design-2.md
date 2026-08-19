## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `skeptic-design-1.md` in full (treated as claims to re-verify, not fact) and the current
  `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/production-deployment-docs/spec.md`,
  `workflow-state.md`.
- Independently re-ran the same live-GCP checks round 1 ran, from scratch, project `helio-493120`,
  authenticated as `mattheworr018@gmail.com`:
  - `gcloud sql instances describe helio-db --format="value(settings.ipConfiguration.sslMode,...)"`
    → `ENCRYPTED_ONLY  False  True` — confirms `sslMode: ENCRYPTED_ONLY`, `requireSsl: false`,
    `ipv4Enabled: true`, exactly as design.md's "Current state" and Decision 4a state.
  - `gcloud sql ssl-certs list --instance=helio-db` → empty (0 certs) — confirms Decision 4a's
    "0 client SSL certs provisioned" claim, which is load-bearing for the `sslmode=require`
    (no client cert needed) reasoning.
  - `gcloud compute networks subnets list --filter="network:default"` → 40 rows, `10.128.0.0/20`
    through `10.232.0.0/20` — confirms design.md's stated auto-mode subnet footprint exactly.
    Cross-checked the new candidate ranges (Decision 4b: peering `10.8.0.0/20`, connector
    `10.9.0.0/28`) against this list by hand: neither falls inside any listed subnet, and the two
    new ranges don't overlap each other (`10.8.0.0/20` = `10.8.0.0`–`10.8.15.255`; `10.9.0.0/28` is
    outside that block). Correct.
  - `gcloud services list --enabled | grep vpcaccess|servicenetworking` → no match — still neither
    API enabled, matches "Current state."
  - `grep -n "helio.db" backend/src/main/resources/application.conf` (full read of the stanza) →
    confirms `url = ${?DATABASE_URL}` with no socketFactory-specific logic anywhere in the file —
    matches proposal.md/tasks.md 5.1's "no change needed" claim.
  - `grep -n "maxLifetime\|DATABASE_URL\|url = "` on `application.conf` → `maxLifetime = 60000` (1
    min) on both the app and privileged pools — still the pre-HEL-748 value.
  - `git log --all --oneline | grep HEL-748` + `git merge-base --is-ancestor 8ea2e5fe main` → commit
    exists only on `bug/hikaricp-maxlifetime-connection-churn/HEL-748`; `is-ancestor` against `main`
    returns exit 1 (false). HEL-748 is still not merged — confirms proposal.md's revised wording is
    now factually accurate.
  - Read `infra/deploy-backend.sh` in full and `backend/build.sbt:121` — confirms the current
    `--set-env-vars` DATABASE_URL construction and the `postgres-socket-factory` dependency
    location, matching design.md's Impact section.
  - Read `infra/README.md` in full and grepped it for `socketFactory`/`VPC` (no hits) — used to
    ground-truth the change's own spec delta (see finding below).
  - `date` (2026-08-18 PDT) vs. design.md's "Current state (verified live, 2026-08-19)" header and
    `.openspec.yaml`'s `created: 2026-08-19` — both are one day ahead of the actual clock. Not a
    correctness issue (I independently re-verified every live fact myself above, not trusting the
    date label), noted below as non-blocking.

### CR-by-CR re-verification

- **CR1 (SSL, blocking) — FIXED.** Design.md Decision 4a now specifies
  `jdbc:postgresql://<private-ip>:5432/helio?sslmode=require` explicitly, with correct reasoning
  (`ENCRYPTED_ONLY` requires transport encryption but not a client cert; 0 certs exist; `require`
  doesn't need one). tasks.md 5.2 carries the same value through. Matches live state I re-confirmed
  above. Addressed.
- **CR2 (IP-range scope) — FIXED.** Design.md Decision 4b and tasks.md 2.1/3.1 now state the
  non-overlap constraint against the full ~40-subnet auto-mode footprint (not just `us-west1`) and
  give concrete, verified-non-overlapping candidate ranges. Addressed.
- **CR3 (application.conf) — PARTIALLY FIXED, new internal contradiction found (see CR5 below).**
  proposal.md's Impact section and tasks.md 5.1 were correctly corrected. But design.md's own
  "Task sequence" section (a different section of the *same* document) was not updated and still
  asserts the false claim CR3 was about. Not fully addressed — see CR5.
- **CR4 (HEL-748 claim) — FIXED.** proposal.md's Non-Goals now says HEL-748 is "in flight, not yet
  merged to `main` (verified via `git merge-base --is-ancestor`)" and explains why HEL-749 doesn't
  depend on it. Matches live git state I re-confirmed above. Addressed.

### Fresh full-plan pass (not just CR diffing)

Beyond re-checking the four CRs, I re-read every artifact end-to-end as if seeing it for the first
time and found two issues round 1 didn't catch:

**CR5 (blocking) — design.md contradicts itself: the CR3 defect still lives in one place.**
`design.md:122` ("Task sequence," item 5) reads: *"Application code change (executor-driven, normal
review loop): `application.conf`'s `helio.db.url` gains a private-IP form; `infra/deploy-backend.sh`
gains the VPC connector flags."* This is the exact same false claim CR3 flagged — and it directly
contradicts three other places in the *current* artifact set that were correctly fixed:
`design.md:22-25` ("Current state," which says application.conf "already fully defers ... This is
the **only** code surface this migration touches"), `design.md`'s Decision 4a section, and
`tasks.md:40` ("5.1 `application.conf` requires NO change ... Do not edit this file"). I grepped
`design.md`/`proposal.md`/`tasks.md` for every `application.conf` mention (4 hits total) and
confirmed line 122 is the sole remaining stale one. This is a real internal contradiction within a
single document, not a stylistic nit — the "Task sequence" section is explicitly framed as staying
in sync with tasks.md ("see tasks.md for the full checklist"), so an implementer skimming design.md
top-to-bottom hits a directly false instruction after having just read the correct one three
sections earlier. Given this ticket's explicit demand for deliberate, non-improvised execution, a
self-contradicting design doc is exactly what the design gate exists to catch before it reaches an
execution cycle. **Required:** rewrite `design.md:122` to match the corrected language elsewhere
(e.g. "No application code change — `application.conf` already defers to `DATABASE_URL`; the
change is entirely in `infra/deploy-backend.sh`'s `--set-env-vars` plus the VPC connector flags").

**CR6 (blocking) — a real spec-delta requirement has zero corresponding task.**
`specs/production-deployment-docs/spec.md` is part of this change and adds a MODIFIED requirement
with a concrete scenario: *"an operator reads the Cloud Run deployment section of infra/README.md
... THEN they SHALL find that the backend requires a Serverless VPC Access connector and Cloud SQL
Private IP already provisioned."* I read `infra/README.md` in full — its current "Prerequisites"
section lists exactly two items (Secret Manager secrets, `.env.deploy`) and has zero mention of VPC
connectivity today. I then grepped `tasks.md`/`design.md`/`proposal.md` for `readme` (case
-insensitive) — zero hits anywhere in the three planning documents. There is no task instructing
anyone to update `infra/README.md`. As currently planned, an executor working strictly off
`tasks.md`'s checklist (1 → 9, all present) would never satisfy this change's own declared spec
delta — the eventual archive/spec-sync step would either fail a spec-vs-implementation check or
silently ship a documentation gap for the next operator who runs `deploy-backend.sh` without
knowing the VPC connector/Private IP prerequisite now exists. This is precisely CLAUDE.md's "Keep
schema updates in the same change as related client/server code" principle, applied to the docs
contract this change itself opted into. **Required:** add a task (e.g. under section 5 or 8) to
update `infra/README.md`'s Prerequisites section with the new VPC connector + Private IP
prerequisite, per the spec delta's scenario, before the change is considered task-complete.

### Positive findings (still hold, independently re-confirmed)

- Decision 2's checkpoint placement, Decision 3's public-IP-stays-enabled rollback rationale,
  Decision 4's `--no-traffic` → verify → `update-traffic` sequence, and Decision 5's RLS/privileged-
  pool reasoning all check out on a fresh read and against the live state I re-pulled myself — no
  regressions introduced by the round-1 fixes.
- Decision 4b's chosen ranges are not just "outside the band" in the abstract — I hand-verified them
  against the actual 40-row subnet list pulled live just now, not against round 1's transcription of
  it.
- `--vpc-egress=private-ranges-only` reasoning (doesn't affect Anthropic/Resend/GCS calls) still
  holds; those are public-internet destinations, unaffected by this egress mode.
- Task 5.3's punted decision ("gate both behind a flag ... executor's call, confirm with
  orchestrator") is not load-bearing for safety — the new revision's `DATABASE_URL` no longer
  references `cloudSqlInstance`/`socketFactory` regardless of whether the stale
  `--add-cloudsql-instances` annotation is kept or removed, and Decision 4's revision-level
  traffic-split is the actual rollback mechanism, not this annotation. Non-blocking (see below).

### Verdict: REFUTE

### Change Requests

1. (CR5, blocking) Fix `design.md:122` — the "Task sequence" section's item 5 still asserts
   `application.conf`'s `helio.db.url` "gains a private-IP form," directly contradicting the
   correctly-fixed "Current state" section (`design.md:22-25`), Decision 4a, and `tasks.md:40` in
   the same/sibling documents. Reword to state no application code change is needed; the change is
   entirely in `infra/deploy-backend.sh`.
2. (CR6, blocking) Add a task to update `infra/README.md`'s Prerequisites section to document the
   new VPC connector + Cloud SQL Private IP requirement, satisfying the MODIFIED requirement already
   declared in `specs/production-deployment-docs/spec.md`. No task currently covers this; `readme`
   has zero mentions across `tasks.md`/`design.md`/`proposal.md`.

### Non-blocking notes

- `design.md`'s "Current state" header and `.openspec.yaml`'s `created:` both say `2026-08-19`,
  one day ahead of the actual system clock (`2026-08-18`). Doesn't affect correctness — I
  independently re-verified every live-state claim against GCP myself rather than trusting the
  date label — but worth tidying so the artifact's self-reported verification date is accurate.
- Task 5.3's "gate both behind a flag ... executor's call, confirm with orchestrator before
  finalizing" language is a minor scope-of-judgment punt. It isn't a safety-relevant ambiguity
  (the new revision's connectivity doesn't depend on whether the old `--add-cloudsql-instances`
  annotation is retained), but for a ticket this explicit about "no improvisation," it would read
  more cleanly as a direct instruction: remove `--add-cloudsql-instances` on the new revision (it's
  vestigial once `DATABASE_URL` no longer references `cloudSqlInstance`/`socketFactory`); the real
  rollback path is Decision 4's traffic-split, not this flag.
- Repeats round 1's non-blocking note on task 6.3 (a privileged-pool-specific endpoint would be a
  marginally tighter verification than a generic authenticated GET) — still true, still not
  blocking.
