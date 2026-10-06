# HEL-1346: Fix GHSA-wq5f-xc86-pv6w: bump sharp to ≥0.35.5 in frontend (CI security job red)

## Description

The CI `security` job is failing at "Frontend audit (frontend/)" on **GHSA-wq5f-xc86-pv6w**, a high-severity
advisory: sharp is affected by a librsvg vulnerability (CVE-2026-96889). The advisory was published 2026-10-06 13:43Z.
It blocks every PR's `ci-complete`, as seen on PR matto00/helio#798 (HEL-1286) and HEL-1291's run 37486012121.

The dependency path is `@vite-pwa/assets-generator > sharp`. `frontend/package-lock.json` resolves `node_modules/sharp`
at **0.35.4**, and the first patched version is **0.35.5**. `@vite-pwa/assets-generator@1.0.2` declares
`sharp ^0.33.5`, yet the lock resolves 0.35.4, so check for an existing `overrides` entry and explain why.

The same thing happened with HEL-1319. The owner's ruling then was to fix it immediately in its own lane.

## Acceptance Criteria

* `sharp` resolves to ≥ 0.35.5. Use the smallest change that works: update the existing override or the parent. Do not
  add an allowlist entry; allowlisting needs an owner ruling.
* No unrelated churn. List every lockfile package whose version changed.
* Show the frontend audit step on CI going from red to green.
* Frontend build, lint, typecheck, Jest and e2e pass. The PWA asset generation that uses sharp still works, if it runs
  in the build.

## Driver constraints (this run)

* No allowlist entry; if no patched version is installable, escalate.
* Check helio-mcp and the root lockfile for sharp too.
* Show the audit red→green locally with the exact CI command (`npx audit-ci --config .audit-ci.jsonc` from
  `frontend/`) and on CI.
* Do not touch `frontend/src`, `ci.yml`, `playwright.config.ts`, `.gitignore`. At most one CI run at a time.
* No writes under `~` outside the repo/worktrees: project-local `npm_config_cache` and logs, kept out of the commit.
* Never select deletion/kill targets by pattern; no `pkill`/`pgrep`/`killall`.
