## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c19ef1f17bbc1be41c946019cbcd925472c3ae74` against live-resolved base
`38acc608331e9dcf84127cf9ada4e035a460a0e2` (3 commits, 40 files, 0 under `backend/`).

### Phase 1: Spec Review — FAIL

- ACs: every registration site is recorded (shared `registerUser`, 24 direct `/api/auth/register` sites in 13
  spec files including quarantined ones, the UI signup in `auth-cookie-migration.spec.ts:47-60`; `hel503`'s
  wrapper goes through `registerAndLogin`). Deletion is by exact recorded id, with no pattern, name or
  time-window predicate. Before/after counts are in measurements.md (I did not re-run the full suite; see the
  spot-check in Phase 2). Existing residue is not touched. PASS.
- C1 (exact id only): PASS. Users are selected by `id IN (SELECT id FROM hel1301_doomed)` only, and every
  child delete is scoped the same way (`userCleanupCore.cjs:612-638`). My measurement used read-only id
  snapshots only.
- C2 (no credentials): PASS. `db.cjs` never logs. Its error carries only bounded, scrubbed psql stderr. The
  README names no values. `check:no-credential-leak` is clean.
- C3 (no product surface): PASS. The diff contains no `backend/` file.
- C4 (no residue deletion): PASS.
- **Issue (blocks PASS):** task 4.1 is checked done and says "disable each refusal (... email check ...) ... and
  show the selftest goes red". The spec scenario "Recorded id with a mismatched email -> the transaction aborts,
  no user is deleted" is the core `(id, email)` guard (design D3). That guard is **not pinned by any standing
  test.** I removed `AND u.email = d.email` from the guard JOIN (`userCleanupCore.cjs:624`) in a copy and ran
  `HEL1301_CORE_PATH=<copy> node e2e/support/userCleanup.selftest.mjs`. Result: **exit 0, 39 passed, 0
  failed.** The mutation survives. The measurements.md mutation table has no row for it. Its only proof is the
  one-off real-DB `dbproof.cjs` run (task 4.2), which nothing re-runs. The other refusals I mutated did go red:
  system-user, UUID, duplicate-id, plain-email, SQL domain exclusion, SQL owner exclusion, user delete by email
  instead of id, and the matched-count assertion.

### Phase 2: Code Review — PASS (one coverage gap, reported in Phase 1)

Gates I ran fresh in `WORKTREE_PATH` (no `frontend/**` or `backend/**` files changed, so the frontend build
and `sbt testFull` triggers do not apply):

- `npm run lint` exit 0; `npm run format:check` exit 0; `npm run check:e2e-types` exit 0
- `check:e2e-user-cleanup` clean (74 files); `:selftest` 11/11; `check:e2e-user-cleanup-core:selftest` 39/39
- `check:precommit-ci-parity` OK; it lists all three new scripts in both the hook and `ci-complete` coverage
- `check:e2e-evidence-paths` clean; `check:no-credential-leak` OK

Spot checks:

- **Static check, injected red.** In a copied e2e tree I tried three changes. (a) A new spec with an unrecorded
  `request.post("/api/auth/register")`: exit 1, names `e2e/zz-injected.spec.ts:3`. (b) Removing the second
  `recordRegisteredUser` in `hel908-tail-attach.spec.ts`: exit 1, names line 131. (c) Removing the record in
  `support/auth.ts`: exit 1, names line 55.
- **Live run on DEV_PORT 6733 / BACKEND_PORT 9640.** I started the servers with `start-servers.sh` (fresh
  PIDs, not reused) and stopped them by exact PID afterwards (1161748, 1161732, 1160903, 1160253, 1160200;
  ports confirmed free). I ran `auth-cookie-migration.spec.ts` (8 passed, UI signup plus 6 direct sites;
  teardown logged `deleted 7`), then `hel1230` + `hel1189` via the shared helper (3 passed, `deleted 3`; these
  users owned pipelines, outputs, dashboards and panels). The `users` id set was 13120 before and 13120 after,
  with **0 ids added and 0 removed** (exact `comm` set difference of read-only id snapshots). The
  `.e2e-user-registry/` directory was empty afterwards.
- **CI wiring.** The `e2e` job has `DATABASE_URL` / `DB_USER` / `DB_PASSWORD` at job level (`ci.yml:545-548`).
  psql is already relied on by `historySeed.ts` in CI. `scripts/e2e-shard.mjs` spawns one `playwright test`
  per shard, so each shard makes one psql call at teardown. The new checks sit in the `frontend` job next to
  `check:e2e-evidence-paths` (`ci.yml:131-135`) and in `.husky/pre-commit`.
- **Guard.** The builder refuses non-UUID ids, the system user, duplicates, quote, backslash, whitespace and
  control characters, non-throwaway domains and the owner account. The SQL repeats the domain, owner and
  system-user exclusions. `readRegistryDir` reads only `*.jsonl` directly inside its own directory. Recording
  with no registry set throws (fail closed).
- **`.cjs` choice.** This is justified in `db.cjs:8-10`. `e2e/tsconfig.json` has `allowJs` set, so the TS
  importers get inferred types, and `check:e2e-types` passes.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed (the change's own spec
delta lives under `openspec/changes/`). This is test-harness-only work.

### Overall: FAIL

### Change Requests

1. Pin the email-equality half of the `(id, email)` guard so the selftest is failable by its removal.
   - In `e2e/support/userCleanup.selftest.mjs` (next to the "matched count" check, around line 360), add an
     assertion that the guard JOIN carries the email equality, e.g.
     `record("guard matches on exact id AND exact email", /JOIN hel1301_doomed d ON u\.id = d\.id AND u\.email = d\.email/.test(sql));`
   - Re-run the mutation (`ON u.id = d.id AND u.email = d.email` -> `ON u.id = d.id` in a copy of
     `userCleanupCore.cjs`). Show it goes RED, and add that row to the measurements.md mutation table. It is
     the "email check" task 4.1 promises.

### Non-blocking Suggestions

- `e2e/support/db.cjs:172-175`: for any failure other than ENOENT with empty stderr, the reason collapses to
  `exit status unknown`. I hit this myself: an id+email `SELECT` over 13k users overflowed `execFileSync`'s
  default 1 MB `maxBuffer` (ENOBUFS) and surfaced only as "exit status unknown". Including `e.code` (it holds
  no secret) would make that diagnosable. The teardown's own output is tiny, so this does not affect it.
- `scripts/check-e2e-user-cleanup.mjs:47`: the 40-line proximity window lets two register calls within 40
  lines share one `record...(` call. Consider counting record calls against register sites per window.
- `userCleanup.selftest.mjs` and the check selftest write under `os.tmpdir()`. The design permits this
  (existing precedent). Noted only because HEL-1442 moved other caches off tmpfs.
