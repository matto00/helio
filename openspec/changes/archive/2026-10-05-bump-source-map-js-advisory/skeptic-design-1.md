## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b`. The change dir is untracked, and no implementation exists yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/bump-source-map-js-advisory/HEL-1319`.
- **Lockfile inventory:** `git ls-files '*package-lock.json'` lists only the root, `frontend/` and `helio-mcp/` lockfiles, all lockfileVersion 3.
  - A jq scan across all three found exactly one `node_modules/source-map-js` entry, 1.2.1, in `frontend/` only.
  - It also found exactly one `node_modules/proxy-addr` entry, 2.0.7, in `helio-mcp/` only.
  - The root lockfile has neither package. Claim confirmed.
- **Parents and ranges:**
  - The only dependent of `source-map-js` is `node_modules/postcss` 8.5.26, which declares `^1.2.1`. postcss is pulled in by `vite` 8.0.16 (`^8.5.15`).
  - The only dependent of `proxy-addr` is `node_modules/express` 5.2.1, which declares `^2.0.7`.
  - Claims confirmed. Both patched versions satisfy their parent's range, so a parent bump or override is correctly rejected.
- **Registry:**
  - `source-map-js@1.2.2` exists (published 2026-09-30) and has no dependencies.
  - `proxy-addr@2.0.8` exists and has the same dependencies as 2.0.7 (`forwarded 0.2.0`, `ipaddr.js 1.9.1`), which already match the lockfile.
  - Both are the latest published versions.
- **CI commands:** I read these in `.github/workflows/ci.yml` lines 287-299 (read only).
  - Root: `npx audit-ci --config .audit-ci.jsonc`
  - Frontend: `working-directory: frontend`, `npx audit-ci --config .audit-ci.jsonc`
  - helio-mcp: `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`
  - Thresholds are `high`, `high` and `moderate`. Design Context is accurate.
- **Red baseline:** I reproduced it with the worktree's `frontend/node_modules/.bin/audit-ci` (v7.1.0, the same version the root lockfile pins).
  - Frontend: exit 1 on GHSA-68fv-2mgg-jv7q.
  - helio-mcp: exit 1 on GHSA-jqcg-44mw-7w3h (critical).
  - Root: exit 0.
  - `npm audit --package-lock-only` on a scratch copy of the frontend lockfile gives `moderate 20, high 1`. The "1 high / 20 moderate" claim is confirmed.
- **Decision 1 / 2 dry run:** I ran it on scratch copies, not the worktree, with the scratchpad npm cache, npm 10.9.8 and Node 22.
  - `npm update source-map-js --package-lock-only` changed the version of exactly `{node_modules/source-map-js}`.
  - `npm update proxy-addr --package-lock-only` changed the version of exactly `{node_modules/proxy-addr}`. It also added a `funding` metadata block to that same entry, which is harmless.
  - After the updates, the helio-mcp moderate-level audit exits 0, and the frontend shows `high 0, moderate 20`.
  - The plan is executable as written and should yield the expected churn sets.
- **Comment targets:** both `.audit-ci.jsonc` files do contain the stale "Empty today: npm audit is 0" wording, so Decision 3 is targeted correctly. HEL-1320 exists in Linear (Backlog, Follow-up) and matches the scope it is cited for.
- **Root `node_modules` missing in the worktree:** confirmed (`ls node_modules` is empty). Decision 4's use of the frontend's audit-ci binary is sound.
- **Placeholders / TODO / TBD:** none found.

### Verdict: REFUTE

The fix itself is correct and I proved it executable. The required revisions are narrow and text-only. Three things need correcting: a false factual claim, the risk mitigation built on it, and one acceptance criterion that no task covers.

### Change Requests

1. **False runtime-path claim (proposal.md Impact, design.md Risks).** The artifacts state that proxy-addr is "helio-mcp's HTTP-transport runtime dependency (via express)" and that "helio-mcp's own tests cover the HTTP transport." Neither is true.
   - `helio-mcp/src/index.ts:17,37` uses `StdioServerTransport` only.
   - `express` is not a dependency in `helio-mcp/package.json`. It arrives transitively through `@modelcontextprotocol/sdk`, whose optional `dist/*/server/express.js` helper helio-mcp never imports.
   - Required fix: say this plainly. proxy-addr sits in the lockfile, and therefore in the audit gate, but helio-mcp's stdio server never calls it. Remove the claim that tests cover the HTTP transport, so a delivery report does not later cite coverage that does not exist.
2. **Task 1.3 is ambiguous and its acceptance signal is wrong.** The task says "Run helio-mcp's own test/build scripts (per its package.json)", but `helio-mcp/package.json` has no `test` script. It has only `build`, `typecheck`, `dev`, `start` and `verify`.
   - helio-mcp's `*.test.ts` files run under the root `jest.config.cjs` (via root `npm test`, which is `jest && npm --prefix frontend test`). That needs root `node_modules`, which design Decision 4 notes is not installed in the worktree.
   - An implementer could read the task as build+typecheck only, or as "run the tests". The second reading cannot run as specified.
   - Required fix: name the exact commands and their working directory. I recommend `npm ci` and `npm run build` + `npm run typecheck` in `helio-mcp/`, which mirrors CI's `check:helio-mcp-types`.
   - Also state explicitly whether the root-jest helio-mcp tests are run. If they are, say how, including the root `npm ci` with a scratchpad cache. If they are not, say why that is acceptable, given that the bumped package is not on helio-mcp's code path.
3. **The e2e AC has no task.** ticket.md requires "Frontend build, lint, typecheck, Jest, and the e2e job pass." Task 3.1 covers everything except e2e, and C3 only conditionally mentions local Playwright.
   - Required fix: add a task with an explicit acceptance signal. For example: "the PR's CI `e2e` job is green, cited by run id in `files-modified.md`". Alternatively, a scoped local run under C3.
   - In the same task (or in 3.3), require the PR's CI `security` job to be cited by run id as green. The ticket AC asks for green "on the PR", and Decision 4 names CI as the final authority, but no task carries that through.

### Non-blocking notes

- Task 3.2 writes the root audit as `--config .audit-ci.jsonc --directory .`, but CI runs `npx audit-ci --config .audit-ci.jsonc` with no `--directory`. They are equivalent, but Decision 4 promises "verbatim". Use CI's exact form.
- Design Decision 1's fallback (a hand edit of `version`/`resolved`/`integrity`) would not reproduce the `funding` block that npm adds to the proxy-addr entry. That is harmless, and the primary `npm update` path produced exactly the expected set in my dry run, so the fallback should not be needed.
- The new comment in `frontend/.audit-ci.jsonc` should also drop the stale "see ticket.md Dependencies" back-reference. It points at a ticket.md that will not exist after archive.
- Dry-run evidence (scratch copies, not persisted): the changed-version key sets were `["node_modules/source-map-js"]` and `["node_modules/proxy-addr"]`. New integrity values: source-map-js `sha512-KGj/8Y43...NXP3Vw==`, proxy-addr `sha512-5nnx0yGy...7AVyQ==`. Both match `npm view <pkg>@<ver> dist.integrity`.
