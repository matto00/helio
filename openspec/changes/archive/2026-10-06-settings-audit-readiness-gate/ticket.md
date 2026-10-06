# HEL-1336: e2e: /settings measurements need a readiness gate on the audit-log table

## Description

origin_kind: followup
origin_ticket: HEL-1288

HEL-1288 found that the `/settings` audit-log table's sort buttons render about 300 ms after the Appearance heading.
A spec that counts or measures `/settings` elements as soon as the heading appears can therefore see a partial page.
The guard specs now wait for the table (on HEL-1288's draft PR #774 — not yet on main), but other specs that measure
`/settings` may not.

## Acceptance Criteria

- Inventory the specs that measure or count on `/settings`.
- Add a shared readiness helper that waits for the audit table, for example the table and its sort controls being
  present, and use it in those specs.
- Do not change any assertion or timeout.
- Run `--repeat-each 10` at 2 workers.

## Driver constraints (binding for this run)

- Out of scope, do NOT edit: `e2e/focus-presence-guard.spec.ts`, `e2e/state-surface-contrast-guard.spec.ts`
  (rewritten by HEL-1288 draft PR #774; tracked by HEL-1330).
- Do not touch `.github/workflows/ci.yml`, `playwright.config.ts`, `.gitignore`, `frontend/package-lock.json`.
- If no non-guard spec measures/counts on `/settings`, say so with grep evidence and still add the helper in
  `e2e/support/`.
- Prove the helper is needed (a count taken before the table renders sees fewer elements) and that it fixes it.
- `--repeat-each 10` at 2 workers on each touched spec. Local Playwright: at most 2 workers, under `nice -n 19`.
- Own headless browser context, own allocated ports (DEV_PORT 6768 / BACKEND_PORT 9675), use `isolateLivePage` in
  any probe.
- Record the exact id of every row/user created on the shared dev DB; delete by those ids. Never touch
  `matt@helio.dev`.
- Never select deletion targets (incl. processes) by pattern/name/time window; never `pkill`/`pgrep`/`killall`.
- npm cache project-local and out of the commit. Scratch logs in the session scratchpad with a `hel1336-` prefix;
  keep full logs of any failing run. At most one CI run at a time.
