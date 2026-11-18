## 1. Workflow change

- [x] 1.1 Add three steps to the `security` job in `.github/workflows/ci.yml`, after "helio-mcp audit (helio-mcp/)":
  "Production-only npm audit (root)", "(frontend/)", "(helio-mcp/)", each `npm audit --omit=dev --audit-level=moderate`
  with `working-directory:` set to its tree, `if: ${{ !cancelled() && steps.setup-node.outcome == 'success' }}`, and
  `timeout-minutes: 1` (design D2/D3).
- [x] 1.2 Add the step comment naming HEL-1753, HEL-1751, HEL-1246, the dev/prod path gap and the no-exceptions
  policy (D4/D5); update the `security` job header comment to list the production-only audits.
- [x] 1.3 Comment-only correction in the root and `frontend/` `.audit-ci.jsonc` (design-gate note 2): the HEL-1751
  comment says "A production path starts at a production package, which is not listed, so it still fails." That is
  false for a listed package that becomes a production dependency (e.g. `micromatch`). Replace that sentence with an
  accurate one pointing at the HEL-1753 production-only audit as the guard for that case. No allowlist entry, threshold
  or other JSON value may change (verify with a diff that touches only `//` comment lines).
- [x] 1.4 Confirm no other file changes: no lockfile or `package.json` diff, and the `.audit-ci.jsonc` diff is
  comment-only.

## 2. Evidence

- [x] 2.1 Verify `npm audit` works from the lockfile alone: run the new command in a scratch copy of `helio-mcp/`
  (package.json + package-lock.json, no node_modules) and record it.
- [x] 2.2 Green on main: run each new step's exact `run:` command in the three real trees; record output showing 0
  production advisories and exit 0. Record the wall time of each.
- [x] 2.3 Fail-first (root): scratch lockfile with `micromatch@4.0.8` as a production dependency (lockfile-only). Run
  the current root audit-ci gate against it (exit 0 expected) and the new command (non-zero expected, naming
  GHSA-fc5q-39xc-vjpf). Record both.
- [x] 2.4 Fail-first (frontend/): same with a package from the frontend allowlist set added as a production
  dependency. Record both.
- [x] 2.4a Fail-closed: run the new command with `--registry=http://127.0.0.1:9/` in one tree; record the non-zero
  exit (spec scenario "Audit cannot complete").
- [x] 2.5 Mutation: confirm the red in 2.3 comes from `--omit=dev` not dropping the production path (e.g. the same
  scratch tree with the dependency moved to devDependencies is green under the new command). Record it.
- [x] 2.5a For the old-gate runs, the worktree has no `node_modules`: use
  `/home/matt/Development/helio/node_modules/.bin/audit-ci` (main checkout's, same pinned version as the lockfile) or
  `npm ci` in the worktree; record which. For 2.4, confirm the added package lands with no `dev` flag in the scratch
  lockfile and that the old gate's green is due to an allowlist match (not a missing advisory).
- [x] 2.6 Write all recorded runs to `openspec/changes/prod-only-npm-audit-gate/evidence.md` (commands, exit codes,
  trimmed output).

## 3. Gates

- [x] 3.1 Run the repo's workflow guards that parse ci.yml (`node scripts/check-ci-complete-needs.mjs`,
  `node scripts/check-precommit-ci-parity.mjs`, `node scripts/check-ci-sbt-no-pattern-kill.mjs` and any other
  `scripts/check-*.mjs` that reads ci.yml) and a YAML parse of ci.yml; all green.
- [x] 3.2 `openspec validate prod-only-npm-audit-gate --type change` exits zero.
- [x] 3.3 Commit with the pre-commit hook (no `-n`).

## Driver Constraints

These come from the driver's brief and bind every role for this run (not CON-161 standing constraints):
- Never read, cat, grep, source or print any .env file; never run env-dumping commands. `scripts/concertino/.concertino.env` may be read by scripts but never printed.
- Quoted heredocs only (`<<'EOF'`) or Write/Edit; no backticks or `$(...)` inside echo strings.
- No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh.
- jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- `timeout: 600000` on long calls.
- No `npm audit fix`, no lockfile or package.json changes in the real tree. Scratch lockfiles live only in `/home/matt/Development/helio/.concertino/scratch/HEL-1753/`.
- Fail-first proof with recorded runs for every guard.
- No prod actions, no release cut, no `concertino sync`.
