## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `b1f9768c85674017e4c9212a499a2ba3e9c575db`, diff base `5af3a438c` (resolved live by `resolve-review-base.sh`).
Evaluator scratch: `/home/matt/Development/helio/.concertino/scratch/HEL-1817/eval1/` (TMPDIR for every run below).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (item 1): `deleteUsersAndFolders` (`e2e/support/userCleanupRun.cjs:32-74`) never throws once psql has returned. The root
  resolution and each folder are caught and counted, and the function returns `{removed, failed, total}`. Its log line
  carries numbers only. `deleteRegistryRun` (`:81-97`) removes the registry dir before the count-only throw, and keeps
  the dir when psql throws. The test came first: in a detached checkout of red commit `b12a634ab` I ran
  `userCleanup.selftest.mjs` myself and got 54 passed, 8 failed. "Next run accepts the left state" is covered by
  "registry: a second run on the cleared dir returns 0 without calling psql".
- AC2 (item 2): the prune script maps the credentials through the shared `credentialEnv` (`e2e/support/db.cjs:31`), which
  `dbConnection` also uses, and adds `DB_USER`/`DB_PASSWORD` to the scrub list. The fake-psql selftest covers the mapping,
  scrubbing on both the success and failure paths, and the no-credential case. On the red commit I got 16 passed,
  2 failed.
- AC3 (item 3): before is 23 tests in one suite (`split-counts-before.txt`, commit `5755a851c`, which precedes the split
  commit `b1f9768c8`). After is 8+4+6+5=23, and my own run below gives the same counts. The sorted test names are equal.
- Tasks 1.1–4.1 are all checked and match the diff. The spec deltas match the implemented behaviour.
- Scope: the edits to `layoutPreconditionSeam.ts`, `landing-captures/run.mjs`, `ClaudeConfigSpec.scala` (comment only)
  and `e2e/README.md` are all named in proposal/design Decisions 3 and 6. No creep.
- CONSTRAINTS C1–C10: I found no `.env` read or print in the diff. The new code reads `process.env.DB_USER`/`DB_PASSWORD`
  only and never `backend/.env` (Decision 4). C10 holds: the root-resolution-failure test calls psql first (`calls === "psql"`)
  and then throws inside the post-commit phase. See deviation (c) below for C8.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself (all in `WORKTREE_PATH`, TMPDIR set to the eval scratch):
- `node e2e/support/userCleanup.selftest.mjs`: 62 passed, 0 failed.
- `node scripts/prune-orphan-conversation-folders.selftest.mjs`: 18 passed, 0 failed.
- `nice -n 19 sbt -J-Xmx3g 'set Test / javaOptions += "-Duser.home=<scratch>/home"' testOnly LocalFileSystemSpec
  LocalFileSystemAtomicWriteSpec LocalFileSystemPruneSpec LocalFileSystemFromEnvSpec ClaudeConfigSpec`: 36 succeeded,
  0 failed. Per suite: Spec 8, AtomicWrite 4, Prune 6, FromEnv 5, ClaudeConfig 13. `<scratch>/home/.helio` did not exist
  before the run, and `<scratch>/home/.helio/uploads` exists afterwards, so the redirect took effect.
- `node scripts/check-scala-quality.mjs`: clean. None of the four LocalFileSystem files gets a soft warning (they are
  100/200/82/118 lines).
- `npm run lint`: exit 0. `npm run typecheck`: exit 0. `npm run format:check`: exit 0.
- Extra checks: `npm --prefix helio-mcp run typecheck` (covers `scripts/layoutPreconditionSeam.ts`) exit 0;
  `tsc --noEmit -p e2e/tsconfig.json` (covers `userCleanup.ts`) exit 0.
- I did not run `npm test` (jest) or the frontend build: there are no `frontend/**` changes, and the brief did not list them.

Red-first and mutations. I re-ran four mutations in a throwaway detached worktree under the eval scratch, which I have
since removed:
1. `rmSync(dir)` moved after the throw: 3 registry cases FAIL (59/3).
2. `PGUSER` mapping dropped from `credentialEnv`: "CLI maps DB_USER/DB_PASSWORD…" FAILs, `seen=user=false pass=true`.
3. `user`/`password` dropped from the prune `secrets` list: "CLI failure output redacts…" FAILs.
4. The root-resolution catch made to rethrow (not in `mutations.txt`; my own): 2 root-resolution cases FAIL.

`mutations.txt` honestly records that its first "drop credential scrubbing" mutation was a no-op (18/0). The catch's
`scrubSecrets` is redundant with `psql()`'s own scrub, which uses the same list. The executor replaced it with mutation 3
above, which does go red.

Split behaviour-preservation: I compared the sorted non-blank lines of the old `LocalFileSystemSpec.scala` against all four
new files concatenated. The comparison shows only additions (package/import/class scaffolding, a duplicated `await`/`ec`
helper, the split doc comments) and no removed or altered line. The test bodies moved verbatim.

Code quality: no dead code, no `any`, and no new id or path in any message. The new error text in
`deleteRegistryRun` and the messages in the seam and landing-captures scripts are count-only. The one exception,
`landing-captures/run.mjs:127` logging `created.user.id`, was there before this change.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The `openspec/changes/**` spec deltas
are planning artifacts, not the trigger path.

### Executor-reported deviations (judged)
- (a) Four suites instead of three: accepted. The core suite alone would have been 275 lines, over the 250 soft budget,
  which the ticket's own motivation forbids. The sum is 23 = 23, test names are identical, and the deviation is recorded
  in tasks.md and split-counts-after.txt.
- (b) `--no-verify` on commits 1–2: accepted. Commit 1 is red by design: its selftests fail, and the hook runs them.
  Commit 2 is evidence-only (one `.txt`). Commits 3 and 4 went through the hook, and every gate it runs that I re-ran
  above passes at HEAD. This is consistent with CLAUDE.md's "call out bypass, follow with a fix commit" rule.
- (c) Hook TMPDIR under the session scratchpad `/tmp/claude-1000/...`, not `.concertino/scratch/HEL-1817`: this is a
  process deviation from C8, not a code defect. Nothing in the deliverable depends on it. Both new selftests use
  `os.tmpdir()` and ran green for me with TMPDIR in the main-checkout scratch. The executor's reason checks out:
  `scripts/check-openspec-hygiene.selftest.mjs:276-302` builds a temp dir under `tmpdir()` and asserts
  `is not a git repository`, which cannot hold when TMPDIR sits inside the helio checkout. So C8 as written conflicts
  with the pre-commit hook. That is a real environmental finding for the constraint's owner, not something the executor
  could fix.
  Leftovers: no `hel1817-*` temp dir exists anywhere under `/tmp/claude-1000`. There are 14 `jest-timing-{test,report}-*`
  dirs and a `tsx-1000` dir in the shared session scratchpad newer than this ticket. They are plausibly hook-jest residue,
  but other lanes share the same scratchpad, so I cannot attribute them to HEL-1817. They are not in `~`, not in the
  worktree, and not in the diff. `git status` in the worktree is clean.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The `scrubSecrets` in `databaseQuery`'s catch (`scripts/prune-orphan-conversation-folders.mjs:115`) is redundant with
  `psql()`'s own scrub (`mutations.txt` shows that removing it is undetectable). Keep it as defence in depth, or drop it.
  Either is fine.
- Orchestrator: amend or retire C8 for hook runs. The openspec-hygiene selftest needs a non-git TMPDIR, so for hooks,
  name a non-git scratch location (for example a per-lane dir under the session scratchpad) explicitly.
