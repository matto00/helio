## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/production-deployment-docs/spec.md`, `workflow-state.md` in full.
- Independently re-verified (not trusted from the design doc) the live GCP state via `gcloud`,
  authenticated as `mattheworr018@gmail.com`, project `helio-493120`:
  - `gcloud compute networks list` / `subnets list` — confirms `default` is an **auto-mode**
    VPC with a `us-west1` subnet at `10.138.0.0/20`, matching design.md's "Current state" —
    **but also reveals ~40 other regional subnets auto-allocated in the same VPC**, spanning
    `10.128.0.0/20` through `10.232.0.0/20` (us-central1, europe-west1, asia-east1, etc.).
  - `gcloud services list --enabled | grep vpcaccess|servicenetworking` — both absent; direct
    attempts to list peerings/connectors return `SERVICE_DISABLED` — confirms neither API is
    enabled and nothing exists yet, matching design.md.
  - `gcloud sql instances describe helio-db` — `db-g1-small`, `POSTGRES_16`, `ZONAL`, public IP
    only (`ipv4Enabled: true`), **`sslMode: ENCRYPTED_ONLY`**, `requireSsl: false` (legacy flag,
    superseded by `sslMode`), `serverCaMode: GOOGLE_MANAGED_INTERNAL_CA`, 0 client SSL certs
    provisioned. Confirms design.md's stated current state — and surfaces a fact the design
    never accounts for (see CR1 below).
  - `gcloud run services describe helio-backend` — confirms current annotations:
    `run.googleapis.com/cloudsql-instances: helio-493120:us-west1:helio-db`, no VPC connector
    annotation. Matches design.md.
- Read `backend/src/main/resources/application.conf` (full `helio.db` + `helio.db.privileged`
  stanzas) and `backend/src/main/scala/com/helio/infrastructure/Database.scala` — ground-truthed
  Decision 5's claim that only "transport" changes.
- Read `infra/deploy-backend.sh` in full — this is where `DATABASE_URL` is actually constructed
  today (`--set-env-vars`), not in `application.conf`.
- `git log --all --oneline | grep HEL-748` + `git merge-base --is-ancestor 8ea2e5fe main` — checked
  whether proposal.md's "HEL-748 ... already landed" claim is true on the ground.

### Findings

**CR1 — SSL/TLS requirement for the private-IP `DATABASE_URL` is unaddressed (blocking).**
`helio-db`'s live `ipConfiguration.sslMode` is `ENCRYPTED_ONLY` — the server rejects any
unencrypted connection, regardless of whether it arrives over public or private IP (this is a
Postgres-session-level enforcement, not scoped to the public-IP path). The current connector
library (`postgres-socket-factory`) handles TLS transparently via its own ephemeral-cert
mechanism, which is exactly why today's `DATABASE_URL`
(`jdbc:postgresql:///helio?cloudSqlInstance=...&socketFactory=...`) carries no host and no SSL
params. Design.md's Decision 4/5 and tasks.md 5.1 describe the replacement as "direct `host:port`
against the private IP ... no `socketFactory`/`cloudSqlInstance` params" — with **no mention of
SSL at all**. The pgjdbc driver does not enable SSL by default; a bare
`jdbc:postgresql://<private-ip>:5432/helio` URL will negotiate a plaintext connection, which
`ENCRYPTED_ONLY` will reject outright. As written, task 6 (the `--no-traffic` verification step)
would fail on its first attempt for a reason the design never anticipated. This is fail-safe
(caught pre-cutover, not a production incident) but it means the "sound and complete" cutover plan
is not actually complete — the executor would be improvising a fix mid-checkpointed-execution
instead of following a plan that already accounts for it. Required: add explicit SSL guidance to
design.md/tasks.md — e.g. `?sslmode=require` (matches `ENCRYPTED_ONLY`'s requirement without
needing a client cert — 0 client SSL certs exist on the instance today) — spelled out in the new
`DATABASE_URL` form before execution, not discovered during task 6.

**CR2 — IP-range non-overlap guidance is scoped to the wrong VPC surface.**
tasks.md 2.1 and 3.1 both instruct picking ranges "non-overlapping with `default`'s existing
`10.138.0.0/20` subnet" — i.e. only the local `us-west1` subnet. But `default` is a single
**auto-mode** VPC network with regional subnets already consuming `10.128.0.0/20` through
`10.232.0.0/20` across ~40 regions (verified live above). A private-services-access peering range
or VPC connector `/28` allocated against only the local subnet (e.g. picking `10.128.0.0/20`,
which is free relative to `10.138.0.0/20` but is actually us-central1's subnet) risks a GCP-side
overlap rejection at allocation time. Worst case this just fails the `gcloud` call cleanly and
needs a retry with a different range (additive step, no live-traffic impact) — but for a ticket
explicitly asking for deliberate, non-improvised execution, the guidance should be correct the
first time. Required: update 2.1/3.1 to state the non-overlap constraint against the network's
full allocated range (not just the local region), and ideally give a concrete candidate (e.g.
something in `10.0.0.0/9` outside the `10.128.0.0/17`-ish auto-subnet band, such as
`10.8.0.0/20` for the peering range and a `/28` carved from it for the connector).

**CR3 — design.md/tasks.md misstate where the code change actually lives.**
Design.md's "Impact" section and tasks.md 5.1 both describe the change as
`application.conf`'s `helio.db.url` construction gaining "the private-IP form." I read
`application.conf` line-by-line: `url = "jdbc:postgresql://"${helio.db.host}...`, then
`url = ${?DATABASE_URL}` — the file already fully defers to the `DATABASE_URL` env var with no
socketFactory-specific logic present anywhere in it. The actual (and only) place the connection
string is constructed today is `infra/deploy-backend.sh`'s `--set-env-vars` string. As written,
task 5.1 could plausibly send an implementer looking for a code change in `application.conf` that
doesn't need to exist, or worse, tempt an unnecessary edit there (conflicts with CLAUDE.md's "keep
changes focused ... avoid unrelated refactors"). Required: correct 5.1 to state plainly that
`application.conf` requires **no change** (env-var override already covers this) and the task is
entirely in `infra/deploy-backend.sh`'s `--set-env-vars` (new `DATABASE_URL` value, per CR1 for the
SSL param) plus the `--vpc-connector`/`--vpc-egress` flags.

**CR4 — proposal.md's "HEL-748 already landed" premise is false as of live `git log`.**
Proposal.md's Non-Goals section states: "HikariCP pool tuning (HEL-748, already in flight
separately) — this ticket assumes that fix has already landed." I checked: `8ea2e5fe HEL-748
Raise HikariCP maxLifetime to 30min on both db pools` exists only on branch
`bug/hikaricp-maxlifetime-connection-churn/HEL-748` — `git merge-base --is-ancestor 8ea2e5fe main`
returns false, and this worktree's `application.conf` still shows `maxLifetime = 60000` (1 minute,
the pre-fix value), not 30 minutes. HEL-748 has **not** landed on `main`. This does not block
HEL-749's technical soundness — Private IP removes the TLS-handshake/cert-fetch cost from the
connection path regardless of `maxLifetime`, which is the actual mechanism the proposal's own
"Why" section credits as the failure point — so HEL-749 doesn't structurally depend on HEL-748
landing first. But an infra-migration design document asserting a related production mitigation
is "already landed" when it demonstrably isn't is exactly the kind of unverified claim this gate
exists to catch. Required: correct the wording (e.g. "in flight, not yet merged — HEL-749 does not
depend on it landing first") so nobody executing this plan assumes HEL-748's mitigation is already
active in production.

### Positive findings (design elements that hold up)

- Decision 2's checkpoint placement is correct: task ordering (APIs → peering → connector →
  **checkpoint** → private-IP patch) means the one step with genuine documented restart risk
  happens only after every prerequisite it depends on already exists and is verified — the patch
  isn't racing ahead of its own dependencies.
- Decision 3 (keep public IP enabled) is correctly load-bearing for Decision 4's rollback path
  (old revision keeps working on the public-IP/connector path if cutover needs reverting) —
  correctly cross-referenced, not just asserted independently.
- Decision 4's `--no-traffic` → direct per-revision verification → `update-traffic` sequence is
  the right shape and the ordering is executable as written (nothing in step 6 depends on
  anything not yet true by that point, once CR1 is fixed).
- Decision 5 (RLS/`helio_privileged` unaffected) is correctly reasoned: I confirmed in
  `application.conf` that both the app pool and privileged pool share the same `helio.db.url` /
  `${helio.db.url}` value and differ only in `connectionInitSql` — the network transport (and
  therefore CR1's SSL fix) is common to both, so there's no separate privileged-pool-specific
  transport risk. The design's claim that "no code change is anticipated" for this is accurate.
- `--vpc-egress=private-ranges-only` (task 5.2) is the right choice and doesn't jeopardize the
  app's other outbound calls (Anthropic, Resend, GCS) — those are public-internet destinations and
  bypass the VPC connector under this egress mode; only RFC1918-destined traffic (i.e. the new
  private-IP Cloud SQL path) routes through it.
- The two human checkpoints (task 4.1, task 7.1) satisfy the ticket's explicit requirement for
  "deliberate, checkpointed execution ... not a blind automated cycle."

### Verdict: REFUTE

### Change Requests

1. (CR1, blocking) Add explicit SSL/TLS configuration to the private-IP `DATABASE_URL` plan in
   design.md and tasks.md 5.1 — `helio-db`'s live `sslMode` is `ENCRYPTED_ONLY`; a bare
   `host:port` JDBC URL with no SSL params will fail. Specify `sslmode=require` (or equivalent)
   explicitly, matching the instance's actual enforcement level and its 0-client-certs state.
2. (CR2) Correct tasks.md 2.1/3.1's IP-range non-overlap guidance — it must account for all of
   `default`'s auto-mode regional subnets (~40 of them, `10.128.0.0/20`–`10.232.0.0/20`), not just
   the local `us-west1` subnet. Give a concrete candidate range outside that band.
3. (CR3) Correct design.md's Impact section and tasks.md 5.1 — `application.conf` requires no code
   change (it already fully defers to `DATABASE_URL` via `${?DATABASE_URL}`); the change is
   entirely in `infra/deploy-backend.sh`'s `--set-env-vars` string plus the VPC connector flags.
4. (CR4) Correct proposal.md's Non-Goals claim that HEL-748 "already landed" — it hasn't (verified
   via `git merge-base --is-ancestor` against `main`); state that HEL-749 doesn't depend on it
   landing first, rather than asserting a false current-state fact.

### Non-blocking notes

- Task 6.3 ("hit a real authenticated, DB-touching endpoint") would be a slightly tighter
  verification if it specifically targeted an endpoint known to invoke the privileged
  (`withSystemContext`/BYPASSRLS) pool rather than a generic authenticated GET — though since both
  pools share the same underlying `helio.db.url` transport, the risk this misses something the
  generic GET wouldn't is low, not blocking.
- Consider `--tag=` on the `--no-traffic` deploy in task 6.1 for a stable, human-friendly
  per-revision URL for the manual verification steps (Cloud Run does generate a default
  per-revision URL either way, so this is cosmetic).
