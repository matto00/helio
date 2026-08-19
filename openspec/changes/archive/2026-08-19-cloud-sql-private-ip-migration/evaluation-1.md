## Evaluation Report — Cycle 1 (evaluation-1.md)

### Scope note

Per the orchestrator's briefing, this cycle's executor scope was deliberately
narrow: tasks.md section 5 only (deploy-script + docs). Tasks.md sections 1-4
(API enablement, VPC peering, VPC connector, Private IP on `helio-db`) were
completed live against real GCP infrastructure by the orchestrator directly,
outside this git diff, before this cycle started; sections 6-9 (cutover
deploy, verification, traffic migration, follow-up) have not happened yet.
This review is scoped accordingly — it evaluates the diff at commit
`111512e4` against tasks.md 5.1-5.5 only.

### Phase 1: Spec Review — PASS

- All ticket AC bullets relevant to this cycle's scope (bullet 3: "Update
  `DATABASE_URL`/connection config ... update `infra/deploy-backend.sh` and
  Cloud Run service annotations accordingly") are addressed exactly, not
  partially. The other three AC bullets (VPC connector provisioning, Private
  IP enablement, RLS verification) are out of this cycle's scope by the
  orchestrator's own explicit instruction and tasks.md's task-ownership split
  (sections 1-4/6-9 are not executor-driven).
- No AC silently reinterpreted.
- tasks.md 5.1-5.5 are all marked `[x]` and match what's actually in the
  diff:
  - 5.1: `application.conf` genuinely untouched — `git diff main...HEAD --
    backend/src/main/resources/application.conf` is empty. Confirmed by
    direct read: `helio.db.url` still fully defers to `${?DATABASE_URL}`.
  - 5.2: `DATABASE_URL` changed to
    `jdbc:postgresql://10.8.0.3:5432/helio?sslmode=require`
    (`infra/deploy-backend.sh:42`) — exactly matches design.md Decision 4a's
    specified form (private IP, port 5432, `?sslmode=require`, no
    `socketFactory`/`cloudSqlInstance` params). Confirmed no residual
    `socketFactory=`/`cloudSqlInstance=` string anywhere in the file.
  - 5.3: `--add-cloudsql-instances=...` removed; `--vpc-connector=helio-vpc-connector`
    and `--vpc-egress=private-ranges-only` added (`infra/deploy-backend.sh:39-40`).
    Executor's call (clean removal, not gated behind a flag) is explicitly
    justified in a comment (lines 23-27) and matches the round-2 skeptic's
    non-blocking guidance that the annotation is vestigial once
    `DATABASE_URL` no longer references it.
  - 5.3b: `"$@"` appended as the literal last line after `--project=helio-493120 \`
    (`infra/deploy-backend.sh:50-51`) — matches design.md Decision 4c and the
    round-4 skeptic's simulated-and-verified fix exactly (same edit shape:
    trailing `\` added to the previously-last flag line, new `"$@"` line
    after it). `bash -n infra/deploy-backend.sh` passes (syntactically
    valid); no pre-existing `$@`/`getopts`/positional-param handling existed
    to conflict with it.
  - 5.4: Fresh `sbt test` run (see Phase 2) — 3281/3281 tests passed, 0
    failed. No application code changed, as anticipated.
  - 5.5: `infra/README.md` adds a new "Private networking" prerequisite
    section (now item 1 of 3, correctly renumbering the following two
    sections from 1/2 to 2/3) documenting the VPC connector + Private IP
    requirement. Verified against `specs/production-deployment-docs/spec.md`'s
    three scenarios line-by-line — all three satisfied (deploy-prereqs
    scenario, Secret-Manager-prereqs scenario, and the new
    private-networking-prereqs scenario, including its "SHALL NOT find any
    remaining reference to the `postgres-socket-factory`/`cloudSqlInstance`
    connector path as the primary connectivity method" clause — the two
    remaining mentions of that path, in README.md:43-44 and
    deploy-backend.sh:18-19, are both explicitly framed as historical/"why
    it changed" context, not as the current method).
- No unnecessary changes outside ticket scope: `git diff main...HEAD
  --name-only` (excluding the openspec change dir) shows exactly
  `infra/README.md` and `infra/deploy-backend.sh` — nothing else.
- No regressions to existing behavior: diffed every other flag/env-var in
  `deploy-backend.sh` (`DB_USER`, `GOOGLE_REDIRECT_URI`,
  `CORS_ALLOWED_ORIGINS`, `COOKIE_SECURE`, `LOG_FORMAT`, `HELIO_OWNER_EMAILS`,
  `HELIO_BETA_DAILY_MESSAGE_LIMIT`, `--set-secrets`, `--memory`, `--cpu`,
  `--concurrency`, `--max-instances`, `--min-instances`,
  `--allow-unauthenticated`, `--project`) — all byte-identical to before.
  `infra/.env.deploy.example` untouched (confirmed empty diff).
- No API contract/schema changes needed or made — this is a deploy-script/
  docs-only change with no application-facing surface.
- Planning artifacts reflect final implemented behavior: `files-modified.md`'s
  description of the change matches the actual diff exactly (private IP
  value, flag names, `"$@"` placement, README section numbering).

### Phase 2: Code Review — PASS

Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` — default speed):

- Changed files (`infra/README.md`, `infra/deploy-backend.sh`) match neither
  `frontend/**` nor `backend/**`, so neither trigger's gate list technically
  applies. Ran the ones explicitly required by tasks.md 5.4 and the
  orchestrator's briefing anyway, as fresh evidence:
  - `cd backend && sbt test` — **3281 tests, 0 failed, 0 canceled.
    All tests passed. [success] Total time: 174s.**
  - `bash -n infra/deploy-backend.sh` — syntax OK.
  - `npx prettier --check infra/README.md` — "All matched files use Prettier
    code style!" (`infra/deploy-backend.sh` has no Prettier parser for
    shell scripts — not a gap introduced by this change; no shell linter is
    configured in this repo's pre-commit chain).
- `CONTRIBUTING.md`'s mechanical rules (inline-FQN ban, `check:scala-quality`,
  file-size budgets) target Scala/TS source; not applicable to a bash script
  and a markdown doc. No violations to cite.
- `DESIGN.md` is frontend-scoped; not applicable (no `frontend/**` files
  touched).
- DRY: no duplication introduced; the old `--add-cloudsql-instances` flag was
  cleanly removed rather than left dead alongside the new flags.
- Readable: the new comment block (`deploy-backend.sh:18-34`) explains the
  private-IP value, the SSL requirement, and the `"$@"` passthrough's
  purpose and default-empty behavior — no magic values left unexplained.
- Modular / no over-engineering: the `"$@"` passthrough is the minimal,
  human-directed fix for design.md Decision 4c's gap — not a speculative
  abstraction.
- Type safety: N/A (bash + markdown).
- Security: `DATABASE_URL`'s private IP is not a secret (RFC1918 address,
  same class of literal the old script already hardcoded for
  `cloudSqlInstance`); `DB_PASSWORD` continues to flow only via
  `--set-secrets` (Secret Manager reference), never inlined. No new
  plaintext credential exposure.
- Error handling: `set -euo pipefail` unchanged; empty `"$@"` under
  `set -u` is safe (positional params are exempt from nounset) — already
  independently verified by the round-4 skeptic's simulation, and confirmed
  here via the passing `bash -n` check and the unaffected pre-existing gate
  behavior.
- Tests meaningful: no new application code paths exist to test (deploy-
  script-only change); `sbt test` green is the correct and sufficient bar per
  task 5.4.
- No dead code / no leftover TODO/FIXME.
- Behavior-preserving where expected: `application.conf` and `build.sbt` are
  both genuinely untouched (empty diffs), matching the plan's explicit
  "no application code change" requirement.

### Phase 3: UI Review — N/A

No changed files match any Phase 3 trigger (`frontend/**`,
`backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`,
`openspec/specs/**`). The spec delta lives under
`openspec/changes/cloud-sql-private-ip-migration/specs/**`, a different path
than the triggering `openspec/specs/**` (the archived-spec directory).
Consistent with the orchestrator's guidance that no live/Playwright
verification is needed this cycle.

### Overall: PASS

### Non-blocking Suggestions

- `.openspec.yaml`'s `created: 2026-08-19` and `design.md`'s "Current state
  (verified live, 2026-08-19)" header are both one day ahead of the actual
  system clock (2026-08-18) — already flagged non-blocking by
  skeptic-design-2/3/4 across three rounds; still uncorrected but immaterial
  to correctness (every live-state claim was independently re-verified
  against GCP by the skeptics, not trusted from the date label). Worth a
  one-line tidy whenever this change is next touched.
- This worktree's `scripts/concertino/` directory is a stale/partial copy of
  the main checkout's (missing `next-report-number.sh`, `persist-evidence.sh`,
  `emit-event.sh`, and others) — already flagged by skeptic-design-3/4 as an
  environmental note, not a plan defect. I worked around it the same way they
  did (invoking the main checkout's copies by full path), so it did not block
  this evaluation, but future cycles in this worktree will hit the same gap.
