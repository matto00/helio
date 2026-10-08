## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 002249226fadcbbe8d33eb0f00000c89de80cf73. The planning artifacts are untracked under
openspec/changes/eslint-ignore-coverage-dir/. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=task/eslint-ignore-coverage-dir/HEL-1375`.

All my probes ran in the worktree with `nice -n 19`, jest `--maxWorkers=2`, and npm cache/logs in the session
scratchpad. I removed both coverage dirs by exact path afterwards. The final `git status --short` is only
`?? openspec/changes/eslint-ignore-coverage-dir/`. I did not edit any tracked file.

### What I verified (with evidence)

- **Round-1 change requests are addressed.**
  - 6.1 now stages an exact set.
  - The stash dance is gone. Both red proofs run before the edit and both green proofs after it.
  - 0.4 gives the exact path for `files-modified.md`.
  - 0.5 states the checkbox rule.
  - 5.2 says "expect `0` and `exit=1`".
- **1.1:** `ls -d coverage frontend/coverage` reports "No such file or directory" for both paths.
- **1.2/1.3 (root red):**
  - The jest command prints `Test Suites: 1 passed, 1 total` and `Tests: 2 passed, 2 total`, and creates
    `coverage/lcov-report/block-navigation.js`.
  - `npm run lint` then prints `.../HEL-1375/coverage/lcov-report/block-navigation.js`, `1:1 warning Unused
    eslint-disable directive (no problems were reported)` and `✖ 1 problem (0 errors, 1 warning)`, and exits 1.
  - All of this matches tasks.md exactly.
- **1.5/1.6 (frontend red, with root coverage deleted):**
  - The frontend jest command prints `Tests: 5 passed, 5 total`.
  - Root `npm run lint` flags `.../HEL-1375/frontend/coverage/lcov-report/block-navigation.js` with
    `✖ 1 problem (0 errors, 1 warning)` and exits 1. This matches.
- **2.1/2.2 (the edit):**
  - I extracted the fenced block from tasks.md programmatically (7 lines) and inserted it into a scratch copy. The
    anchor `      ".concertino/**",` occurs exactly once and is followed directly by `    ],`.
  - `diff` shows exactly `36a37,43` with the 7 lines. That is consistent with 2.3's
    `eslint.config.cjs | 7 +++++++`.
  - `prettier --check` on the patched copy passes. The longest line is 81 characters.
- **Green proofs (the equivalent of 3.1/3.3):**
  - With root coverage present, `eslint -c <patched copy> . --max-warnings=0` exits 0. The control,
    `-c <unpatched copy>`, exits 1 with the same single warning. So the exit 0 comes from the patch, not from `-c`.
  - The same pair holds with only `frontend/coverage/` present: patched exits 0.
- **2.2 comment claims are all true:**
  - The output is an istanbul HTML report in `lcov-report/`.
  - It lands in `coverage/` for the root suite and in `frontend/coverage/` for the frontend suite. I observed both.
  - `block-navigation.js` carries a directive that ESLint reports as unused.
  - `.husky/pre-commit` is `set -e` and runs `npm run lint`.
  - `.gitignore:23` is `coverage/`.
  - Flat config does not read .gitignore. The red run itself proves this: the dir is gitignored and is still linted.
- **5.x checks:**
  - `npm run format:check` exits 0 with frontend coverage present.
  - `git ls-files | grep -c ...` prints `0` with exit 1.
  - The 5.3 `find` prints only `./eslint.config.cjs`.
  - `npm run check:openspec` prints "openspec/ is clean". A partially-ticked change is not flagged, so committing
    with unticked 6.x boxes passes the hook.
  - frontend's `lint` is `eslint src` and helio-mcp has no lint script, so the frontend/helio-mcp AC resolution holds.
- **Scope and contracts:** one config file, no API or schema surface, `skip_specs: true` is appropriate. No
  placeholders and no contradictions between proposal and design.

### Verdict: REFUTE

The design and every factual claim and expected output are correct. Two command-level defects remain. A literal
executor will hit both.

### Change Requests

1. **tasks.md 0.1/0.2 assume shell state persists between Bash calls, and `$SCRATCH` is never defined.**
   - In the agent harness, environment variables do not survive from one Bash call to the next. Subagents also get
     their cwd reset.
   - So `W=...` set once in 0.1 is empty in every later call. `cd "$W"` then fails (`cd: null directory`, rc=1;
     I reproduced this).
   - Because 0.1 says "run every command with `cd "$W"`" and not `cd "$W" &&`, the commands that follow run in the
     ambient cwd. For a spawned agent that is the main checkout `/home/matt/Development/helio`. The consequences:
     - `npx jest --coverage` writes `coverage/` into the main checkout.
     - The green `npm run lint` runs (and passes trivially) against the wrong tree. That is evidence-shaped
       non-evidence.
     - Relative `eslint.config.cjs` edits resolve against the wrong tree.
   - `$SCRATCH` in 0.2 is unset, so the executor must improvise a path.
   - Fix: replace 0.1/0.2 with one literal preamble that the executor must paste at the start of EVERY Bash call,
     with a fixed scratch path, for example:
     `W=/home/matt/Development/helio/.claude/worktrees/task/eslint-ignore-coverage-dir/HEL-1375; S=/tmp/hel-1375-scratch; mkdir -p "$S"; export npm_config_cache="$S/npm-cache" npm_config_logs_dir="$S/npm-logs"; cd "$W" || exit 1`
   - Also state explicitly that variables do not carry over between calls.
2. **0.5 contradicts 6.3.**
   - 0.5 says to tick each box only after its step ran. 6.1–6.3 can only run at or after `git add`/`git commit`.
   - So ticking 6.1/6.2 leaves `M openspec/changes/eslint-ignore-coverage-dir/tasks.md` in the working tree, and
     6.3's "`git status --short` → empty output" is false by construction.
   - A literal executor either violates 0.5 or fails 6.3.
   - Fix: state the exact rule. For example: "Do not tick 6.1–6.3. They stay unchecked in the commit, and the
     orchestrator ticks them." `check:openspec` passes with them unticked. Or: "after 6.2, tick 6.1–6.3, then
     `git add` tasks.md and `git commit --amend --no-edit` (full hook)", and adjust the 6.3 expectation to match.
     Either works, but the plan must choose one.

### Non-blocking notes

- Section numbering jumps from 3 to 5 (there is no section 4). Renumber to avoid confusing a literal executor.
- 0.3 runs `scripts/concertino/persist-evidence.sh` with a relative script path. This is fine once CR1's
  `cd "$W" || exit 1` preamble is in place.
- The worktree has no `node_modules`. `npx`/`eslint` resolve through the parent checkout's `node_modules`, and
  everything works as-is. Any patched-config probe placed outside the repo needs
  `NODE_PATH=/home/matt/Development/helio/node_modules`.
- Keep the 2.2 comment text, the glob, the placement, and all `expect` strings verbatim. They are all verified true.
