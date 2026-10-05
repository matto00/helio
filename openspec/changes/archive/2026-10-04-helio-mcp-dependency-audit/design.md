## Context

helio-mcp is a standalone npm package (own lockfile, not a root workspace). Its tests (`helio-mcp/src/**/*.test.ts`)
are collected by the ROOT `jest.config.cjs`; it has no `test` script of its own. CI's `frontend` job already runs
`npm --prefix helio-mcp ci` and `check:helio-mcp-types`; the `security` job (`ci.yml` ~l.158-283) runs
`npx audit-ci --config .audit-ci.jsonc` for root and for `frontend/` (working-directory), both at `"high": true`.
`audit-ci` (^7.1.0) is a devDependency of the root and `frontend/` packages only.

Dependency paths (`npm ls`, at Setup): `@modelcontextprotocol/sdk@1.29.0` -> `hono@4.13.2` (direct and via
`@hono/node-server`), `-> ajv@8.20.0 -> fast-uri@3.1.7` (pinned by helio-mcp's `overrides: {"fast-uri": "^3.1.6"}`),
`-> express-rate-limit@8.5.2 -> ip-address@10.5.0`. helio-mcp's `src/index.ts` uses `StdioServerTransport` only.

## Goals / Non-Goals

**Goals:** zero open advisories in helio-mcp's lockfile via real patches; a CI step that fails on the next one;
measured proof that step fails red on a vulnerable lockfile; recorded reachability per package.

**Non-Goals:** root/frontend audit policy; helio-mcp source changes; `dist` rebuild for the live session server.

## Decisions

**D1 — Lockfile-only remediation.** `npm audit fix` (never `--force`) inside the worktree's `helio-mcp/`, then confirm
with `git diff helio-mcp/package.json` that `package.json` is unchanged. Each advisory's resolved version must be at or
above its patched version (fast-uri >=3.1.8, ip-address >=10.7.1, hono >=4.13.7 or whatever the live advisory's first
patched version is). The existing `fast-uri` override floor `^3.1.6` already admits 3.1.8, so it is left alone; the
new CI gate (not an override floor) is what prevents regression. If any advisory cannot be fixed without a
`package.json` change, the change is made only with a written justification in this file. Alternative rejected:
raising override floors for all three packages — extra `package.json` surface for no added protection once CI gates it.

**D2 — helio-mcp gates at moderate, not high.** Root and `frontend/` use `"high": true`. Every advisory in this
ticket is MODERATE, so a `"high": true` config is green on the current vulnerable lockfile — it could never satisfy
the red-first AC nor keep Dependabot at 0. `helio-mcp/.audit-ci.jsonc` therefore sets `"moderate": true`. This is
deliberately scoped to helio-mcp (a small, runtime-only dependency tree that ships to agent hosts), and does not
change the other two trees. The config's header comment states this and why.

**D3 — Allowlist policy.** Empty by default. An entry is added only for an advisory with no patched version
published, in the HEL-1246 form: `"<GHSA>|<path-scope>*"` with an inline comment carrying HEL-1204, the reason,
the dependency path, and a review-by date. Never a bare GHSA id, never a package-wide wildcard.

**D4 — CI wiring.** A new step in the `security` job, after "Frontend audit (frontend/)", named
"helio-mcp audit (helio-mcp/)". It must run the ROOT-pinned `audit-ci` binary (installed by the job's existing
root `npm ci`) against `helio-mcp/`'s lockfile and config — never a floating `npx` download resolved from inside a
package that does not declare audit-ci. The executor verifies the exact invocation (e.g. `npx audit-ci --config
helio-mcp/.audit-ci.jsonc --directory helio-mcp` from the repo root, or the root binary path) actually reads
helio-mcp's lockfile, by observing it go red on the vulnerable lockfile (D5). `helio-mcp/package-lock.json` is added
to the job's `setup-node` `cache-dependency-path`. No `npm --prefix helio-mcp ci` is needed for an audit (it reads
the lockfile) — the executor confirms this empirically.

**D5 — Proof the gate is real (evidence, not assertion).** Recorded verbatim in `audit-evidence.md` in this change
directory: (a) red-first — the exact CI command against the ORIGINAL (main) lockfile, exit non-zero, listing the
advisories; (b) control — the same lockfile under a `"high": true` config exits 0, proving D2 is necessary;
(c) post-bump — exit 0 and `npm audit` "found 0 vulnerabilities"; (d) red-gate — temporarily reintroduce a vulnerable
version into the bumped lockfile (e.g. restore `hono` to 4.13.2), run the exact CI command, exit non-zero; then revert
and show exit 0 plus `git status`/`git diff` proving the revert is byte-identical. Before/after `npm ls` for the
three packages.

**D6 — Reachability (record, patch regardless).** helio-mcp imports `StdioServerTransport` only; hono /
`@hono/node-server` back the SDK's Streamable HTTP server transport, and express-rate-limit / ip-address back the
SDK's server auth router — expected unreachable from helio-mcp. ajv / fast-uri back the SDK's JSON-schema validation
— plausibly reachable at runtime. The executor verifies each claim by grepping helio-mcp `src/` and the SDK's
`dist` import graph, and records the result here under Planner Notes / in the evidence file.

**D7 — Regression testing.** helio-mcp's full suite via the root jest (`helio-mcp/src`), `check:helio-mcp-types`,
`npm --prefix helio-mcp run build`, and the `npm run verify` stdio smoke against a worktree-local backend
(`start-servers.sh`), using a PAT created for the dev account and deleted by exact id afterwards.

## Risks / Trade-offs

- A hono minor bump could change SDK transport behaviour -> mitigated by D7's stdio smoke and full suite; helio-mcp does
  not use the HTTP transport (D6).
- Moderate threshold means a future moderate advisory turns PRs red with no repo change — the same "the world moved"
  behaviour MISTAKES.md already documents for high/critical; the entry is updated to say so.

## Planner Notes

Self-approved: D2's moderate threshold (needed for the ticket's own red-first AC; scoped to helio-mcp only);
lockfile-only remediation; MISTAKES.md wording update.
