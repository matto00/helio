## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 5da00bf4a0e565ddbfcebead9985f836e30a7dde. Base resolved live via resolve-review-base.sh (main/origin): 6e334120a704930ead9780ddc3f51834726b4c5c.

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/ci-prod-only-audit/HEL-1753`.
- Diff scope (`git diff BASE...HEAD --stat`): `.github/workflows/ci.yml` (+28/-1, security job only), `.audit-ci.jsonc` and `frontend/.audit-ci.jsonc` (comment lines only, read in full in the diff), plus the change dir. No package.json or lockfile in the diff.
- AC1 (step in `security` for all three trees, green on main): ci.yml lines 536-551 add three steps, "Production-only npm audit (root | frontend/ | helio-mcp/)", each running `npm audit --omit=dev --audit-level=moderate` with `working-directory` per tree, `timeout-minutes: 1`, and gated on `steps.setup-node.outcome == 'success'` (the `setup-node` id exists at the job's setup-node step). This decouples them from `npm ci`, matching the HEL-1296 independent-reporting convention. I re-ran the command myself in all three worktree trees (npm 10.9.8, node v22.23.2): "found 0 vulnerabilities", exit 0 in `.`, `frontend`, `helio-mcp`. Sanity check: a full (non-omit) root `npm audit` does report the dev-only advisories, so the 0 comes from `--omit=dev` and not from a blind audit.
- AC2 (fails first), independently reproduced in `/home/matt/Development/helio/.concertino/scratch/HEL-1753/final/`:
  - root: I copied package.json and the lockfile, then ran `npm install --package-lock-only micromatch@4.0.8`. The lockfile shows micromatch as a production dependency (no `dev` flag). The current gate, `audit-ci --config <worktree>/.audit-ci.jsonc --directory <scratch>/root`, printed "Passed npm security audit." and exited 0. The new command reported "2 high severity vulnerabilities" (picomatch via node_modules/micromatch) and exited 1.
  - frontend: I added `anymatch@3.1.3` as a production dependency (no `dev` flag) and tested it against the worktree's `frontend/.audit-ci.jsonc`. The current gate exited 0. The new command listed GHSA-fc5q-39xc-vjpf and exited 1.
  - helio-mcp has an empty allowlist, so this gap does not exist there. Its step is defense in depth and is green on main.
- AC3 (no-exceptions decision): stated in the ci.yml step comment ("POLICY: no exceptions ... owner call in a SEPARATE ticket"), in design.md D4, and as an ADDED requirement in specs/production-dependency-audit/spec.md. There is no `continue-on-error` and no config input on the steps.
- AC4 (comment names HEL-1753, HEL-1751, HEL-1246): present in the step comment block, and the job header comment is updated.
- Comment edits in both `.audit-ci.jsonc` files: they correct a sentence that had become false ("A production path ... still fails") and point to the new guard. Only `//` lines changed.
- Gates re-run: check-ci-complete-needs, check-precommit-ci-parity, check-ci-sbt-no-pattern-kill and check-openspec-version all exited 0. Prettier `--check` on every changed file passed. The worktree is clean apart from the evaluator's untracked report.
- Job budget: three steps of about 1 s each, bounded at 1 minute each, inside the 5-minute job timeout against a measured 69-90 s. That is fine.

### Verdict: CONFIRM

### Non-blocking notes
- None of this evidence comes from the GitHub Actions runner yet. The PR's first `security` job log is the real confirmation that the three steps run and pass there. On the runner, root and frontend will have node_modules from `npm ci` and helio-mcp will not; I exercised both shapes locally (helio-mcp lockfile-only per evidence 2.1, scratch trees without node_modules).
- No UI changes, so step 4 (design judgment) does not apply. I started no servers.
