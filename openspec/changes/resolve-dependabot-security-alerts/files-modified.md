# Files modified — resolve-dependabot-security-alerts (HEL-688)

## Source/config changes

- `frontend/package.json` — direct-dep range bumps: `axios` `^1.15.0` → `^1.18.0` (installed 1.19.0),
  `react-router-dom` `^7.16.0` → `^7.18.2` (installed 7.18.2). New `overrides` entry
  `"@vite-pwa/assets-generator": { "sharp": "^0.35.0" }` — that package's latest release (1.0.2, already
  the installed/declared version) still pins `sharp ^0.33.5` (< the required 0.35.0 floor; verified no newer
  `@vite-pwa/assets-generator` release exists that natively depends on `sharp >= 0.35.0`, per the skeptic's
  non-blocking note). Also tightened the pre-existing `@istanbuljs/load-nyc-config` → `js-yaml` override from
  `^3.15.0` to `^3.15.1` so a fresh install can't regress below the alert's patched floor.
- `frontend/package-lock.json` — resulting lockfile refresh (direct bumps + targeted `npm update postcss
  fast-uri brace-expansion js-yaml` + the sharp override cascading through `sharp-ico`'s own `sharp: "*"` dep).
- `helio-mcp/package-lock.json` — targeted `npm update hono ip-address fast-uri @hono/node-server` (all
  transitive via `@modelcontextprotocol/sdk`); no `overrides` needed, the parent's semver ranges already
  admitted the patched versions.
- `package-lock.json` (root) — targeted `npm update js-yaml`; both root instances (via `@eslint/eslintrc`'s
  4.x-line override and `@istanbuljs/load-nyc-config`'s 3.x-line override) moved to their patched floors. Root
  `node_modules` did not exist in this worktree; ran `npm install` first (per the ticket's environmental note).
- `jest.config.cjs` — added `/helio-mcp/dist/` to `testPathIgnorePatterns`. **Root-cause fix, not scope creep**:
  root `npm test` (task 5.1, a required gate) was failing on a pre-existing gap — `helio-mcp/tsconfig.json`'s
  `include: ["src/**/*.ts"]` has no test-file exclusion, so any `npm run build` in `helio-mcp/` (task 5.2, also
  required) always emits compiled `*.test.js` files into `dist/`, which root's Jest `testMatch` then picks up
  and fails to parse (ESM `import` syntax, since `helio-mcp/package.json` declares `"type": "module"`). Verified
  pre-existing: `helio-mcp/dist/tools/*.test.js` predates this session's work (only `npm install`/`npm update`
  ran in `helio-mcp/` before this fix — neither invokes `tsc`), and the failure reproduces on a clean checkout
  any time `helio-mcp/` has been built. Probe: removed `dist/`, ran root `npm test` → passed; rebuilt
  `helio-mcp/` (`npm run build`) → `dist/*.test.js` regenerated; re-ran root `npm test` with the one-line
  `testPathIgnorePatterns` addition → passed (186 + 1820 tests, exit 0). Without this fix the gate is
  order-dependent and breaks for anyone (including a later evaluator/skeptic re-run) who builds `helio-mcp/`
  before running root `npm test`.

## Local-environment-only change (not committed)

- `backend/.env` (gitignored) — `DATABASE_URL` repointed from the shared `helio` dev database to a new,
  worktree-local `helio_hel688` database. **Why**: the shared local Postgres `helio` database already had
  migration V86 applied by the parallel HEL-412 worktree (a migration not present on this branch), leaving a
  gap at V85 (this branch's newest migration) that Flyway's default `outOfOrder=false` refuses to bridge —
  confirmed via `psql ... SELECT version FROM flyway_schema_history` (showed `..., 84, 86` with no 85) and via
  `git show HEAD:package-lock.json`-style pre-existing-state checks unrelated to this ticket's dependency
  edits. Per the orchestrator's explicit instruction not to disturb the parallel worktree's shared state,
  created an isolated `helio_hel688` database (`CREATE DATABASE helio_hel688 TEMPLATE template0`) instead of
  touching the shared one. This is local-only (`.env` is gitignored, confirmed via `git check-ignore`) and does
  not affect any other worktree.

## Task 4.1 — per-alert version-floor verification evidence

All commands run fresh in this session; full `npm ls <pkg>` output captured in the session transcript. Summary
(every table row from design.md, actual installed version vs. required floor):

| Manifest | Package | Required | Installed | `npm ls` evidence |
| --- | --- | --- | --- | --- |
| frontend | axios | >= 1.18.0 | **1.19.0** | `axios@1.19.0` (direct dep, single instance) |
| frontend | react-router | >= 7.18.2 | **7.18.2** | `react-router-dom@7.18.2 └─ react-router@7.18.2` |
| frontend | postcss | >= 8.5.23 | **8.5.26** | `vite@8.0.16 └─ postcss@8.5.26` (single instance) |
| frontend | fast-uri | >= 3.1.5 | **3.1.5** | `vite-plugin-pwa → workbox-build → ajv@8.20.0 └─ fast-uri@3.1.5` |
| frontend | brace-expansion (1.x) | >= 1.1.16 | **1.1.18** | `ts-jest → ... → minimatch@3.1.5 └─ brace-expansion@1.1.18` |
| frontend | brace-expansion (2.x) | >= 2.1.2 | **2.1.4** | `jest → ... → minimatch@9.0.9 └─ brace-expansion@2.1.4` (also the `vite-plugin-pwa` instance, deduped) |
| frontend | brace-expansion (5.x, unscoped) | n/a — out of range both ways | 5.0.9 | `glob@11.1.0 → minimatch@10.2.5 └─ brace-expansion@5.0.9` — not one of the 35 alerts (design.md/ticket explicitly notes this instance needs no action) |
| frontend | js-yaml | >= 3.15.1 | **3.15.1** | `ts-jest → ... → @istanbuljs/load-nyc-config@1.1.0 overridden └─ js-yaml@3.15.1 overridden` |
| frontend | sharp | >= 0.35.0 | **0.35.3** | `@vite-pwa/assets-generator@1.0.2 overridden └─ sharp@0.35.3 overridden` (and the `sharp-ico` instance, deduped to the same 0.35.3) |
| helio-mcp | hono | >= 4.12.34 | **4.13.2** | `@modelcontextprotocol/sdk@1.29.0 └─ hono@4.13.2` (both direct and via `@hono/node-server`, deduped) |
| helio-mcp | ip-address | >= 10.3.1 | **10.5.0** | `@modelcontextprotocol/sdk → express-rate-limit@8.5.2 └─ ip-address@10.5.0` |
| helio-mcp | fast-uri | >= 3.1.5 | **3.1.5** | `@modelcontextprotocol/sdk → ajv@8.20.0 └─ fast-uri@3.1.5` |
| helio-mcp | @hono/node-server | >= 1.19.15 | **1.19.17** | `@modelcontextprotocol/sdk └─ @hono/node-server@1.19.17` |
| root | js-yaml (3.x) | >= 3.15.1 | **3.15.1** | `ts-jest → ... → @istanbuljs/load-nyc-config@1.1.0 overridden └─ js-yaml@3.15.1 overridden` |
| root | js-yaml (4.x) | >= 4.3.1 | **4.3.1** | `eslint@9.39.3 → @eslint/eslintrc@3.3.4 overridden └─ js-yaml@4.3.1 overridden` |

No vulnerable duplicate found at any other tree position for any of the above (`npm ls <pkg> --all` shows every
instance; each list above is exhaustive per package per workspace).

## Task 4.2 — `npm audit` corroboration

- **frontend**: `npm audit` → `found 0 vulnerabilities`.
- **helio-mcp**: `npm audit` → `found 0 vulnerabilities`.
- **root**: `npm audit` → 1 residual high-severity finding, `brace-expansion` (GHSA-mh99-v99m-4gvg /
  GHSA-rgw5-rvv9-x895), at `node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion`
  (5.0.7), `node_modules/glob/node_modules/brace-expansion` (2.1.2), and
  `node_modules/minimatch/node_modules/brace-expansion` (2.1.2, already flagged by npm as `invalid` against its
  parent's own `^1.1.7` range — a pre-existing lockfile dedup quirk, confirmed present in `git show
  HEAD:package-lock.json` *before* any edit in this session, i.e. not introduced by this change).
  **Out of scope**: cross-checked against the live `gh api repos/matto00/helio/dependabot/alerts?state=open`
  pull (35 alerts total, matching design.md's table exactly) — root's manifest only carries the two js-yaml
  alerts (#97, #99); no brace-expansion alert is scoped to `package-lock.json` (root). This is a different,
  newer GHSA pair than the one actually in scope for frontend's brace-expansion alerts (#70/#71,
  GHSA-3jxr-9vmj-r5cp), not one of the 35 scoped alerts, and per the ticket's "Out of scope" section ("Any
  alerts that open after this ticket is scoped ... are a separate follow-up, not scope creep"), left untouched.
  Flagging as a spinoff candidate, not fixed inline.

## Runtime spot-check (tasks 6.1-6.5)

Ran via a throwaway Playwright spec (`e2e/hel688-spotcheck.spec.ts`, deleted after use — not part of this
change's diff) against the worktree dev servers (ports 6120/9027, backend pointed at the isolated
`helio_hel688` DB per above). All steps passed on a clean run with zero unexpected console errors:

- Login (`POST /api/auth/login` → 200)
- axios GET (dashboard list load → 200)
- axios POST (create dashboard → 201)
- axios PATCH (rename dashboard via the real rename UI flow → 200)
- axios error path #1: GET a bogus dashboard id's export → 404
- axios error path #2: cleared the session cookie, reloaded → `httpClient.ts`'s global 401 interceptor
  correctly redirected to `/login` (exercises exactly the interceptor risk design.md flags for the axios
  1.15→1.19 bump)
- react-router: `<Link>` navigation between sections (Data Sources, Data Pipelines), direct-URL load
  (`/settings`), and back/forward — all resolved correctly
- Cleanup: deleted the spot-check dashboard (`DELETE` → 204); confirmed `GET /api/dashboards` returns an empty
  list afterward

Registered a throwaway `matt@helio.dev` / `heliodev123` account in the isolated DB first (that account is
normally seeded manually in the shared dev DB, not by `DemoData`, and doesn't exist on a fresh database).
