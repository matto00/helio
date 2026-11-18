## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 5da00bf4a0e565ddbfcebead9985f836e30a7dde, against live-resolved base 6e334120a704930ead9780ddc3f51834726b4c5c.
Diff: `.github/workflows/ci.yml` (security job only), `.audit-ci.jsonc` and `frontend/.audit-ci.jsonc` (comment-only), and the change dir.

### Phase 1: Spec Review — PASS
- AC1 (step in `security` for all three trees, green on main, output recorded): three steps "Production-only npm audit (root | frontend/ | helio-mcp/)" run `npm audit --omit=dev --audit-level=moderate` with `working-directory` set per tree. evidence.md section 2.2 records them. I re-ran them myself: "found 0 vulnerabilities", exit 0 in all three trees.
- AC2 (fail-first): evidence.md sections 2.3 and 2.4 cover both. I reproduced them independently in `/home/matt/Development/helio/.concertino/scratch/HEL-1753/eval/`, with lockfile-only installs of `micromatch@4.0.8` (root) and `anymatch@3.1.3` (frontend) as production deps:
  - The current audit-ci gate, using the main checkout's pinned audit-ci with the worktree configs, passed with exit 0 in both trees.
  - The new command failed with exit 1 in both trees and named GHSA-fc5q-39xc-vjpf.
  - The executor also recorded a mutation (moving the dep to devDependencies makes the new command go green), a check that the old gate's green comes from the allowlist match, and a fail-closed run (unreachable registry gives exit 1).
- AC3 (no-exceptions decision): stated in the ci.yml step comment ("POLICY: no exceptions ... owner call in a SEPARATE ticket"), in design.md D4, and as a spec requirement.
- AC4 (comment names HEL-1753, HEL-1751, HEL-1246): present at ci.yml:528-529. The job header comment is also updated.
- All tasks are checked and match the diff. There is no scope creep. The `.audit-ci.jsonc` comment correction was planned in task 1.3 and fixes a sentence that had become false. I verified the non-comment lines are byte-identical to base in both files.
- Spec deltas: `production-dependency-audit` is ADDED and `ci-security-job-reporting` is MODIFIED to list the new steps. `openspec validate prod-only-npm-audit-gate --type change` reports the change as valid.
- CONSTRAINTS in workflow-state.md: `[]`. Driver constraints were honored: no lockfile or package.json diff, scratch only under `.concertino/scratch/HEL-1753/`, and the worktree is clean after my reproduction.

### Phase 2: Code Review — PASS
Gates I ran myself:
- Prettier `--check` on every changed file (ci.yml, both `.audit-ci.jsonc`, the change dir): clean.
- `node scripts/check-ci-complete-needs.mjs`, `check-precommit-ci-parity.mjs`, `check-ci-sbt-no-pattern-kill.mjs` and `check-openspec-version.mjs`: all exit 0. These are every `scripts/check-*.mjs` that reads ci.yml.
- YAML parse of ci.yml: OK, and the three new steps are present in `jobs.security.steps`.
- Not re-run: `npm run lint`, `npm test` and `npm --prefix frontend run build`. The only `frontend/**` file changed is `frontend/.audit-ci.jsonc`, a CI audit config with a comment-only change. ESLint, Jest and Vite do not consume it; `git grep` finds it referenced only by ci.yml and `helio-mcp/.dockerignore`. The worktree has no node_modules. This is a reasoned scope reduction, not a skipped check of affected code.

Code review:
- Step gating `if: ${{ !cancelled() && steps.setup-node.outcome == 'success' }}` correctly decouples these steps from `npm ci`. This matches design D3: `npm audit` reads only the lockfile, which the executor showed in evidence 2.1. It also matches the HEL-1296 independent-reporting convention.
- `timeout-minutes: 1` on each step follows the HEL-1339 convention. Three 1-minute bounds fit the job's 5-minute budget.
- There is no `continue-on-error` and no config/allowlist input, so the step fails closed as specified.
- Comments are accurate and explain why the gate exists.
- No dead code and no over-engineering.

### Phase 3: UI Review — N/A
No trigger path changed (no frontend source, ApiRoutes, schemas or openspec/specs). `frontend/.audit-ci.jsonc` is a CI config comment with no UI effect.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- None of the recorded evidence comes from the GitHub Actions runner (Node 22 / npm 10 there; local runs used npm 10.9.8). The first CI run of the PR is the real confirmation that the three steps appear and pass in the `security` job log.
