# CI proof (HEL-1296)

Draft PR: https://github.com/matto00/helio/pull/782. Commits: real change `9b1df7cda`, throwaway `5ef060b57`,
revert `65b09ffd1` (its tree is identical to `9b1df7cda`).
Workflow linted with actionlint 1.7.12 (release binary, scratchpad): exit 0.

## 2.1 Local pre-check
`frontend/.audit-ci.jsonc` with `"moderate": true` replacing `"high": true`, run with a scratchpad `npm_config_cache`:
`audit-ci` exit 1, "Failed security audit due to moderate vulnerabilities", advisory
https://github.com/advisories/GHSA-hp3w-g68c-fv3c (js-yaml>argparse>sprintf-js via jest). A real advisory, not a config error.

## Red run: 37430487422 (head 5ef060b57: moderate frontend audit + `Thread.sleep(600000)` in generateSbom)
Run conclusion `failure` (ci-complete failed because security failed; backend/frontend/e2e succeeded).
Security job 112159948344: 07:34:18Z -> 07:37:07Z (2 min 49 s, well under the 5 min job timeout), conclusion `failure`.

| Step | Conclusion | Start - end (UTC) |
|---|---|---|
| checkout, setup-java, setup-sbt, Cache sbt, setup-node, npm ci, npm --prefix frontend ci | success | 07:34:19 - 07:34:50 |
| Generate backend SBOM | **failure** | 07:34:50 - 07:37:03 |
| Backend SBOM positive control | skipped | 07:37:03 |
| Install osv-scanner | skipped | 07:37:03 |
| Scan backend SBOM (osv-scanner) | skipped | 07:37:03 |
| Enforce backend CVSS >= 7 threshold | skipped | 07:37:03 |
| Frontend audit (root) | success | 07:37:03 - 07:37:04 |
| Frontend audit (frontend/) | **failure** | 07:37:04 - 07:37:05 |
| helio-mcp audit (helio-mcp/) | **success (executed and reported)** | 07:37:05 |

- SBOM step log: `##[error]The action 'Generate backend SBOM' has timed out after 2 minutes.` (the step started at 07:34:50, the
  last sbt output was "set current project to helio-backend" at 07:35:03, then silence until the timeout; same shape as the hung run).
- frontend/ audit: `Failed security audit due to moderate vulnerabilities.` / `##[error]Process completed with exit code 1.`
- helio-mcp audit ran after that failure: command `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`,
  output ends `Passed npm security audit.`
- Job conclusion `failure` (D3 confirmed, no continue-on-error).
- sbt background server (skeptic note 3): after the timeout the following npm audits ran at normal speed (about 1 s each),
  so the server neither slowed nor blocked them. It outlived the killed client until job cleanup, where the log shows
  `Terminate orphan process: pid (2329) (sbtn-x86_64-pc-linux)` and `pid (2397) (java)`.

## Final-head run: 37432926643 (head 65b09ffd1)
Security job: `success` (07:57:29Z -> 07:59:00Z, 91 s). Every step success: SBOM, positive control, osv install, osv scan,
CVSS gate, all three audits. (The sbt cache key changed with the throwaway's build.sbt edit, but its
restore-key fallback and the reverted tree gave a normal run; no misreading.)
Run conclusion `failure`, but NOT from this change: `backend (0)` failed one test in the backend suite
("replaces the plaintext resolvable via decryptForUse and makes the old credential id unresolvable", 1264 succeeded, 1 failed);
ci-complete failed because of it. frontend, e2e and the other backend shards succeeded. Likely a flaky backend test; unrelated
to ci.yml's security job.

## Proved by expression review only (not on CI)
- A setup prerequisite fails: an audit's own install step fails, so that audit is skipped (`== 'success'` test).
- The backend chain still runs after a failed `npm ci` / `npm --prefix frontend ci`.
- The npm audits still run after a failed java/sbt setup or Cache sbt step.
- The frontend/ audit still runs after a failed root `npm ci`.
- Accepted per skeptic note 1: setup-sbt and Cache sbt keep implicit `success()`, so a setup-java failure skips them; both
  serve only the SBOM step, which is skipped in that case anyway.
- "All audits pass" is proved by the final-head run's security job.
