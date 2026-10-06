## Context

See proposal.md — Why. Verified against the live tree at base `2c49bdba` (Setup premise validation):

- `frontend/package-lock.json` (lockfileVersion 3) has exactly one `node_modules/source-map-js` entry, 1.2.1, whose
  only dependent is `node_modules/postcss` 8.5.26 (`"source-map-js": "^1.2.1"`), itself from `vite@8.0.16`.
- `helio-mcp/package-lock.json` has exactly one `node_modules/proxy-addr` entry, 2.0.7, whose only dependent is
  `node_modules/express` 5.2.1 (`"proxy-addr": "^2.0.7"`).
- Neither package appears in the root lockfile; the root audit step is already green.
- CI `security` job steps (ci.yml, not modified here): `npx audit-ci --config .audit-ci.jsonc` with
  working-directory `frontend` (`"high": true`), and `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory
  helio-mcp` from the root (`"moderate": true`). Local red baseline: frontend exit 1 (GHSA-68fv-2mgg-jv7q,
  1 high / 20 moderate), helio-mcp exit 1 (GHSA-jqcg-44mw-7w3h, critical).

## Goals / Non-Goals

**Goals:** both audit steps green; the lockfile diff touches only the two vulnerable entries.

**Non-Goals:** see proposal.md — Non-goals.

## Decisions

1. **Targeted lockfile update, not an override and not a parent bump.** Both patched versions already satisfy the
   parent's declared range, so the parent need not move and `overrides` (whose ticket bar is "only if the parent
   can't move") is unjustified. Use `npm update <pkg> --package-lock-only` in each directory (npm 10.9.8, as in
   CI's Node 22). If npm also moves anything else, fall back to editing only that package's lockfile entry
   (`version`, `resolved`, `integrity`) to the registry metadata from `npm view <pkg>@<ver> dist` (this would not
   reproduce the `funding` block npm adds to proxy-addr's entry — harmless). Either way the
   acceptance check is the diff, not the command.
   Alternatives rejected: `npm audit fix` (moves arbitrary other packages); bumping postcss/express (unnecessary
   churn, and they are not what is vulnerable).
2. **Churn check is mechanical.** Compute the set of `packages` keys whose `version` differs between base and
   branch for each lockfile (jq over `git show <base>:<file>`). The expected set is exactly
   `{node_modules/source-map-js}` and `{node_modules/proxy-addr}`. Any other key, added or removed, fails the task.
3. **Comments describe state without a fragile count.** The stale lines say "Empty today: npm audit is 0...".
   Replace them with wording that stays true: the allowlist is empty, and the frontend tree carries moderate
   advisories below the `"high"` threshold, tracked in HEL-1320; helio-mcp is clean at the moderate threshold
   after HEL-1319. Drop the stale "see ticket.md Dependencies" back-reference too. No JSON keys change, so a parse of each file before and after yields identical
   `high`/`moderate`/`allowlist` values.
4. **Red→green proof uses the exact CI commands.** Run each step's command verbatim from the same working
   directory as CI (root: `npx audit-ci --config .audit-ci.jsonc` with no `--directory`), on base and on branch, with a scratchpad `npm_config_cache` (no writes under `~`). The root
   `node_modules` is not installed in the worktree, so the helio-mcp step uses the frontend-installed `audit-ci`
   binary with the identical `--config`/`--directory` arguments. CI's own `security` job on the PR is the final
   authority.
5. **Installed tree must match the lockfile before gates.** Per MISTAKES.md ("A local gate that fails where CI
   passes..."), run `npm ci` in `frontend/` after the lockfile change and before build/lint/typecheck/Jest, so
   local gates measure the declared set.

## Risks / Trade-offs

- [npm update re-resolves extra packages] → Decision 2's mechanical diff check; fall back to a single-entry edit.
- [A behavior change in a patch release] → source-map-js is consumed by postcss at build time: the frontend build,
  Jest and the e2e job exercise it. proxy-addr is NOT on helio-mcp's code path (stdio transport only,
  `helio-mcp/src/index.ts`; express arrives only via `@modelcontextprotocol/sdk`'s unimported express helper), so
  no helio-mcp test exercises it; build + typecheck + the root-jest helio-mcp suite are run only to show the
  lockfile still installs and nothing regresses, not as coverage of proxy-addr.
- [Another advisory is published mid-run] → re-run all three audits immediately before the PR; out-of-scope
  findings are escalated, not silently fixed.

## Planner Notes

- Self-approved: lockfile-only patch-level bumps within the declared ranges; no new dependency, no API change.
- Owner-approved (escalation HEL-1319-1791251499649-f7bf3f, fold-in): the proxy-addr scope addition and the comment
  updates.
- Concurrency constraint from the driver: do not touch ci.yml, playwright.config.ts, or any source file. At most
  one CI run at a time. Local Playwright runs at most 2 workers under `nice -n 19`.
