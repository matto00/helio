## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `1cac4d68860eef42e83a4b056b775d4216726a6b` against the live-resolved base `38acc608331e9dcf84127cf9ada4e035a460a0e2`
(`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/e2e-delete-throwaway-users/HEL-1301`.

### What I verified (with evidence)

**Every user-creating e2e path records its user (AC 1).**
- I enumerated every `/api/auth/register` occurrence under `e2e/` with awk, file by file. There are 22 API sites in 14 spec files, plus the shared `support/auth.ts` `registerUser`. Each one is followed within 2-8 lines by its **own** `recordRegisteredUser(<thatResponse>)` call. No site shares a record call with another one, so the 40-line window is not covering two sites with one record anywhere in the tree. Quarantined specs (hel665, hel666, hel716, hel908-tail-attach) are covered too.
- The UI signup (`auth-cookie-migration.spec.ts:47` `goto("/register")`) records from the awaited register `Response` at line 61. The OAuth test mocks `/api/auth/google/callback` with `page.route`, so it creates no user.
- No other creation path exists in `e2e/`. Zero hits for `INSERT INTO users`, invite redemption or beta-access signup. hel503 uses the shared helper.
- Every email domain used is `example.com` or `example.test`. That covers the `uniqueEmail` default, 21 explicit `example.com` arguments and the literals in hel1007, hel1345 and hel516. A run therefore never trips the builder's domain refusal on legitimate data.
- `recordRegisteredUser` records only on a 201, using `user.id` and `user.email` from the body. A 201 without those fields throws. `recordCreatedUser` throws when no registry env is set, so it fails closed.

**Teardown can delete only the run's recorded ids (AC 2, C1).**
- `userCleanupCore.cjs` selects users by `id IN (SELECT id FROM hel1301_doomed)` only. Email is a second equality check in the guard JOIN. The guard also excludes the system user, excludes `matt@helio.dev` and requires an e2e domain. A matched-count mismatch raises an exception, which deletes nothing, and the deleted-count assertion sits inside the same transaction. There is no LIKE, regex or time predicate. All 13 child deletes are scoped `WHERE <owner col> IN (SELECT id FROM hel1301_doomed)`.
- Live FK catalog (read-only `pg_constraint` query): the non-cascade FKs to `users` are alert_events, alert_rules, assistant_conversations, assistant_daily_usage, authoring_conversations, dashboards, invite_codes, outputs, panels, patch_set_applications, pipeline_run_rate_window and pipelines. That matches `BLOCKING_OWNED_TABLES` exactly; `connectors` is extra and harmless.
- Isolation between runs and lanes: each run gets a fresh `<worktree>/.e2e-user-registry/<ts>-<pid>/`, created with a non-recursive `mkdir` so an existing directory throws. Teardown reads only `*.jsonl` files directly inside its own directory. Other worktrees and lanes have separate registry roots and separate ids.
- Fail-closed: input is validated before any SQL is built (UUID, plain email, domain, owner, duplicates, empty). On failure the registry directory is kept and the error is thrown.

**No credential output (C2).** `db.cjs` never interpolates the execFileSync error. It emits only psql stderr, scrubbed of the URL, user and password and capped at 600 characters. My own malformed probe query failed through this path, and the error showed only the SQL error text. The core selftest's leak-probe checks pass. Teardown logs only a count.

**No product surface (C3).** The diff stat touches no `backend/` file.

**Gates, re-run fresh, all exit 0:** `check:e2e-user-cleanup`, `check:e2e-user-cleanup:selftest`, `check:e2e-user-cleanup-core:selftest` (40 passed, 0 failed), `check:precommit-ci-parity`, `check:e2e-types`.

**Live spot-check (2 workers, nice -n 19, DEV_PORT 6733 / BACKEND_PORT 9640, MemAvailable about 53 GB).**
- Specs: `auth-cookie-migration.spec.ts` (UI signup plus 6 direct sites, 1 mocked OAuth) and `hel958-join-step-editor.spec.ts`.
- Result: `9 passed (16.0s)`, and the teardown logged `[HEL-1301 e2e] deleted 8 recorded throwaway user(s)`. 8 is the expected count: 7 + 1.
- I snapshotted the `users` id set before and after: 13120 and 13120, and `diff` reported them identical. `.e2e-user-registry/` was empty afterwards.
- I started the servers with start-servers.sh and stopped them by exact PID.

**Before/after AC evidence (AC 3).** measurements.md reports 222 users added on the base commit and 0 on the branch. The full-suite run is a claim I did not re-run, as instructed. It is consistent with my own spot-check: 8 recorded, 8 deleted, id set unchanged. The before count rests on an exact set difference of id snapshots, not on mtime or positional evidence.

**CI shards.**
- `DATABASE_URL`, `DB_USER` and `DB_PASSWORD` are set at e2e job level (ci.yml:545-548).
- psql is already relied on by historySeed specs that are not quarantined (hel1275, hel1350, hel1277).
- `scripts/e2e-shard.mjs` runs `npx playwright test` with the default config, so each shard runs the setup and teardown hooks.
- A shard that records no user makes no psql call (`records.length > 0` guard).
- The only added cost is one psql transaction per shard. measurements.md reports 672 s on the branch against 698 s on the base (claim).

**Out of scope respected (AC 4, C4).** No residue cleanup is in the diff. The only deletions in measurements.md are of the executor's own measured run, by exact (id, email) pair.

### Verdict: CONFIRM

### Non-blocking notes
- The static check is weaker than the ground truth it guards. Its window looks forward, so two register sites followed by a single record call would pass. A register URL built by string concatenation (`"/api/auth/" + "register"`) is not detected; I confirmed both with `checkSource` probes. The tree is 1:1 today. A follow-up could require one record call per site, for example the first record call after the site and before the next site.
- If one recorded email ever fell outside `example.test` or `example.com`, the whole teardown set would be refused. That shard would go red and none of its users would be deleted. The behavior is loud and correct, but the README could say that new specs must use those domains.
- If an in-flight backend run holds row locks past the 10 s `lock_timeout` at teardown, a CI shard could go red. This is documented as intended, and it is a low-likelihood flake source to watch on the first CI runs.
- D1's test-only DB path is an assumed product call. The PR must carry the "OWNER REVIEW: assumed product call(s)" section and must not be agent-merged.
- measurements.md:53 still says "39 checks"; the suite now has 40.
