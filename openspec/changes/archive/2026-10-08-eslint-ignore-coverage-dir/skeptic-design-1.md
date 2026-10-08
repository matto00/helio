## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 002249226fadcbbe8d33eb0f00000c89de80cf73 (planning artifacts untracked under
openspec/changes/eslint-ignore-coverage-dir/). Spawn-cwd guard: READY.

### What I verified (with evidence)

All runs in the worktree, `nice -n 19`, jest `--maxWorkers=2`, npm cache/logs in session scratchpad. Every
coverage dir I created was removed by exact path; `git status --short` is back to only
`?? openspec/changes/eslint-ignore-coverage-dir/`.

- **Precondition (1.1):** `ls -d coverage frontend/coverage` gives "No such file or directory" for both.
- **Root red (1.2/1.3) reproduces exactly as the plan says:** the jest subset gives `Test Suites: 1 passed`, `Tests: 2 passed`
  and creates `coverage/lcov-report/block-navigation.js`. `npm run lint` gives
  `.../HEL-1375/coverage/lcov-report/block-navigation.js  1:1 warning Unused eslint-disable directive (no problems
  were reported)`, `✖ 1 problem (0 errors, 1 warning)`, `ESLint found too many warnings (maximum: 0).`, `exit=1`.
- **The verbatim 2.2 text is applied as the plan specifies:** I applied it with a script that checks the anchor `      ".concertino/**",\n` appears once and is
  followed directly by `    ],`. The patched copy is in scratch, and the tracked file was not edited. `diff` shows exactly 7 inserted lines at
  36a37,43. With the root coverage dir present, `eslint -c <patched> . --max-warnings=0` gave exit 0. I also ran the
  control with `eslint -c <unpatched copy>` the same way: exit 1, same single warning. So the exit 0 comes from the
  patch, not from the `-c` mechanism. `prettier --check` on the patched file passed; the longest line is 81 chars.
- **Nested red (4.2/4.3) reproduces:** the frontend jest subset gives `Tests: 5 passed`. With only `frontend/coverage/` present,
  root `npm run lint` gives `exit=1` on `.../frontend/coverage/lcov-report/block-navigation.js`, `✖ 1 problem (0 errors,
  1 warning)`. The patched config gives exit 0. `frontend`'s own `npm run lint` gives exit 0 in that state (as the design says).
- **Every factual claim in the 2.2 comment is true:**
  - The coverage output includes the istanbul HTML report (`lcov-report/` with index.html etc.).
  - It lands in `coverage/` for the root suite and `frontend/coverage/` for the frontend suite. Both were observed.
  - Line 1 of `block-navigation.js` is `/* eslint-disable */`, which ESLint 9.39.3 reports as unused.
  - `.husky/pre-commit` is `set -e` and runs `npm run lint`.
  - `.gitignore:23` is `coverage/`.
  - ESLint 9 flat config does not read .gitignore. The existing comment in the same file makes the same claim, and the red run confirms it.
- **The other proposal/design claims are true:**
  - `format:check` exits 0 with root coverage present.
  - `git ls-files | grep -c '/coverage/\|^coverage/'` prints `0`.
  - The 5.3 `find` command prints only `./eslint.config.cjs`.
  - helio-mcp/package.json has no `lint` script.
  - Running `eslint --debug` from `frontend/` shows `Using config file .../HEL-1375/eslint.config.cjs and base path .../HEL-1375`. So the
    root `**/coverage/**` glob is evaluated from the repo root and covers `frontend/coverage/`.
  - The root jest.config.cjs ignores `/frontend/`, so helio-mcp tests are what root jest runs.
- **The frontend/helio-mcp AC is answered correctly.** Neither package has an ESLint config of its own. frontend's lint
  resolves the root config, and helio-mcp is linted only by root `eslint .`. One root glob closes the gap for both.
- **The stash dance runs correctly in isolation.** I simulated it in a throwaway scratch repo:
  - `git stash push eslint.config.cjs` stashes only that path and leaves the untracked openspec dir alone.
  - `git diff --stat` is empty while stashed.
  - After `pop`, `git diff --stat` is ` eslint.config.cjs | 7 +++++++` / `1 file changed, 7 insertions(+)`. That is the 2.3 expectation exactly.
- **Scope:** one file, no contract or schema surface, and `skip_specs: true` is appropriate. No placeholders, no TBDs, and no
  contradictions between proposal, design and tasks.

### Verdict: REFUTE

The design is sound and every factual claim and expected output checks out against the live worktree. The plan's
*commands* are not yet fully exact for a Haiku executor that will run them literally. Three small revisions are needed:

### Change Requests

1. **tasks.md 6.1 never says what to stage.** As written, `git commit -m ...` with nothing staged fails with "no changes
   added to commit". The executor then has to improvise the staging set, which is exactly the improvisation this trial
   is trying to avoid. Spell out the exact command(s), e.g.
   `git add eslint.config.cjs openspec/changes/eslint-ignore-coverage-dir && git commit -m "HEL-1375 Ignore **/coverage/** in root ESLint config"`.
   Choose deliberately whether the change dir is committed in this commit, as recent deliveries #852/#854 did.
   Then state the expected `git status --short` after the commit (empty).
2. **Replace the stash dance in section 4 with a stash-free ordering.** `refs/stash` is shared by every worktree of
   this repository. `git worktree list` shows 8 right now, with parallel lanes possible. So `git stash pop` pops whatever
   stash is newest repo-wide, not necessarily the one 4.1 pushed. Also, a "stop and report" at 4.2/4.3 leaves the fix
   stashed and the working tree silently reverted. The simplest exact fix is to do both red proofs before
   editing and both green proofs after:
   - 1.x: root red, then delete root coverage, then frontend red, keeping `frontend/coverage`. Alternatively, keep both dirs and expect `✖ 2 problems`. Both paths were verified to warn independently.
   - 2.x: edit.
   - 3.x: green with each dir present, then delete each by exact path.

   If you keep stash, at minimum add `git stash list` (expect empty) before 4.1, and use `git stash pop` only after confirming `stash@{0}`
   is the 4.1 entry.
3. **Pin the remaining unstated executor outputs.**
   - 0.4 permits "your own `files-modified.md` handoff" but gives no path. Give the exact path
     (`openspec/changes/eslint-ignore-coverage-dir/files-modified.md`).
   - Say whether the executor ticks the `- [ ]` boxes in tasks.md. The hygiene check reads task completion, and an
     executor that ticks or doesn't tick unprompted is exactly where improvised text creeps in.

### Non-blocking notes

- The 2.2 comment text, the glob choice (`**/coverage/**`), the placement, and every `expect` string (1.2, 1.3, 2.3, 3.1, 4.2,
  4.3, 5.1-5.3) are all verified true. Keep them verbatim through the revision.
- `grep -c` in 5.2 prints `0` but exits 1. That's harmless with the `; echo "exit=$?"` pattern, but if 5.2 is captured via 0.3, say
  "expect `0` and `exit=1`" so the executor doesn't read that as a failure.
- The pre-commit hook's `npm test` runs the full root and frontend jest suites at default worker count. The 600000 ms
  timeout is the right call. If the hook times out, the executor should report that rather than retry with `-n`.
