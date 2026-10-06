## Standing Constraints

## 1. Workflow change (security job only)

### Backend
- [x] 1.1 Add `timeout-minutes: 2` to "Generate backend SBOM"; update the job-level timeout comment; verify with `git diff` that only lines inside the `security` job changed
- [x] 1.2 Add D2 step ids (`checkout`, `setup-java`, `setup-sbt`, `setup-node`, `npm-ci-root`, `npm-ci-frontend`, `sbom`, `sbom-control`, `osv-install`, `osv-scan`); verify with a YAML parse (`python3 -c 'import yaml'`)
- [x] 1.3 Add D2 `if: ${{ !cancelled() && ... }}` conditions to the five backend-chain steps per D2; verify each references only its D2 prerequisite ids (actionlint if available, else a YAML parse plus a manual review)
- [x] 1.4 Add D2 `if: ${{ !cancelled() && ... }}` conditions to setup-node, both npm installs, and the three npm audit steps; confirm npm-ci-frontend and the frontend/ audit do not reference npm-ci-root, only checkout/setup-java/setup-sbt/Cache sbt keep implicit success(), and every referenced id is declared (actionlint if available); verify the same way
- [x] 1.5 Commit (HEL-1296 prefix); confirm pre-commit passes and that playwright.config.ts, e2e/** and .gitignore are untouched

## 2. Proof on CI

### Tests
- [x] 2.1 Locally confirm `frontend/` audit-ci fails at `"moderate": true` (replacing `"high": true`) with a real advisory, not a config error (project-local `npm_config_cache` under the scratchpad); record the advisories
- [x] 2.2 Throwaway commit: frontend/.audit-ci.jsonc moderate + `Thread.sleep(600000)` in generateSbom; push; open a draft PR
- [x] 2.3 Wait for that run to complete; record run id, SBOM failure at about 2 min, backend chain steps skipped, frontend/ audit failure, helio-mcp audit executed with its audit-ci output lines quoted, job failure
- [x] 2.4 `git revert` the throwaway; push; wait for the run on the final head; record run id and security job success
- [x] 2.5 Write the evidence (run ids, step conclusions, durations, log excerpts) to `openspec/changes/security-job-timeout-unmask/ci-proof.md`, stating which scenarios are proved by expression review only
