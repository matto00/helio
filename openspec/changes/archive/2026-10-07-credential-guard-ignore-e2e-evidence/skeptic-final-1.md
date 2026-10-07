## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: e14d898aedb5b1f7918d7424f2d2d0f7ce66c5be. The review base was resolved live with
`resolve-review-base.sh` and came back as d125b6541. `origin/main` (36b074f27) has no changes to `.gitignore` or
to the gate script since that base, so there is no merge-side drift. The diff touches only scripts, `.gitignore`
and openspec, so there is no UI and step 4 does not apply.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned READY.
- **AC1: `e2e-evidence` is in `IGNORED_TOP_LEVEL`.**
  - It is at `scripts/check-no-credential-in-agent-surface.mjs`, in the `IGNORED_TOP_LEVEL` set (around line 767),
    and the set is now `export`ed.
  - The header table was checked against `cat -n .gitignore`. The line numbers 6/8/10/23/24/25/107 are all
    correct, so the earlier stale numbers 17/18/19 are fixed.
  - The import has no side effects: the gate's main body sits behind the `import.meta.url` entry guard
    (lines 996–1023), so importing it from the self-test does not run the gate.
- **AC2: a real red/green that I ran myself, not taken from the evaluator.**
  - Setup: I put the BASE gate (`git show d125b6541:scripts/...`) in a temp file under `scripts/` and created a real
    `e2e-evidence/` holding a file.
  - **Red:** the BASE gate exited 1 with `COVERAGE DRIFT: top-level directory "e2e-evidence" is not classified ...`.
  - **Green:** the HEAD gate exited 0 against the same tree and did not mention e2e-evidence.
  - I then deleted the temp file.
  - In-repo self-test: `node scripts/check-no-credential-in-agent-surface.selftest.mjs` exited 0 and printed `OK`.
    Its HEL-1369 cases are: the real gate passes with e2e-evidence present; a mutated copy without the entry exits 1
    and names `COVERAGE DRIFT ... "e2e-evidence"`; and `runMutatedScript` throws unless the find string occurs
    exactly once, so the mutation cannot silently do nothing.
- **AC3: other gitignored root directories.**
  - I listed every `.gitignore` line ending in `/`. The only root-matching non-dot directories are node_modules,
    dist, build, coverage, playwright-report, test-results, e2e-evidence, plus the two HEL-956 probe dirs (which are
    meant to trip the guard).
  - Nothing else needs adding. The new consistency check makes this mechanical instead of a one-off grep.
- **The consistency check fails in both directions (tested by mutation):**
  - Appending `/skeptic-probe-dir/` to `.gitignore` made the self-test exit 1 with
    `not excluded by the gate: skeptic-probe-dir`.
  - Deleting the `/e2e-evidence/` line made it exit 1 with `not in .gitignore: e2e-evidence`.
  - I restored `.gitignore` both times with `git checkout -- .gitignore`, and `git status` was clean afterwards.
- **C1: the self-test does not destroy existing `e2e-evidence` content.**
  - With a pre-existing `e2e-evidence/lane-shot.png`, the sha1 was 4849269459af67f66e27a5b16b2e20b50e707c80 both
    before and after a full self-test run. The directory was kept.
  - A pre-existing empty `e2e-evidence/` was also kept after the run, because `rmdir` only runs when the marker
    file is present.
  - When the directory was absent, the self-test created it and then removed it, leaving nothing behind.
  - Every `e2e-evidence` directory or file mentioned above was created by me for these tests. None existed in the
    worktree beforehand, and I removed only my own artifacts.
- **Other gates:**
  - prettier `--check` on both scripts: clean.
  - eslint `--max-warnings=0`: clean.
  - `check:openspec`: clean.
  - `check:spec-structure`: passed.
  - The modified requirement "Coverage drift fails" exists in the canonical `agent-surface-credential-gate` spec at
    line 49.
  - The gate and the self-test are both wired into `.husky/pre-commit` (lines 23–24) and `ci.yml` (lines 70–71).
- **Evaluator claims:** evaluation-2.md says PASS. Every load-bearing claim above was re-derived independently.
  evaluation-2.md is untracked in the worktree, which is normal for an in-flight report.

### Verdict: CONFIRM

### Non-blocking notes

- A single consistency mismatch shows up as 3 failures, because the self-test re-spawns itself for the HEL-996
  forced-skip cases. Each failure still names the right cause, so this is noise, not a defect.
- The first sentence of the spec delta ("Every directory that `.gitignore` ignores at the repository root SHALL be
  in that exclusion") is stricter than the code. The code deliberately exempts the self-test's probe dirs and
  dot-prefixed dirs, and only the next sentence mentions the probe-dir exception. A wording nit only.
- The parser only handles `name/` and `/name/`. A future root pattern that is globbed or has no trailing slash
  would not be caught. This limit is documented in the code.
