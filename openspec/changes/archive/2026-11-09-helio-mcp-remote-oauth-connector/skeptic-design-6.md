## Skeptic Report — design gate (fold-in round, skeptic-design-6.md)

Scope: only the C6 fold-in (ticket.md "Added scope", proposal.md fold-in bullet and Non-goals, design.md D10,
tasks.md C6 + section 8). The original planning was confirmed earlier and is not reopened. Reviewed at HEAD
`e55f9265262cf24e7feee21b856924f3fb78adca` plus the uncommitted move of the change dir back from the archive.
The move does not put the archive back into `openspec/specs/`: commit 9c528a84e changed no file outside `openspec/changes/`.

### What I verified (with evidence)

- **e2e failure cause: confirmed.** PR #1110 run 42745872975: every `e2e (1..6)` leg and `e2e-prod-build` ran on
  `Image: ubuntu-26.04` / `26.04.1`, and setup failed with `BEWARE: your OS is not officially supported by Playwright` ->
  `Cannot install dependencies for ubuntu26.04-x64 with Playwright 1.55.1!` -> `ERROR: Playwright does not support
  chromium on ubuntu26.04-x64`. frontend, backend(0-3), docker-image and CodeQL passed on the same image. `ci-complete` fails
  only because of what it depends on.
- **Jobs that use e2e-setup: confirmed.** `uses: ./.github/actions/e2e-setup` appears at ci.yml:625 (job `e2e`, runs-on
  :560), ci.yml:726 (job `e2e-prod-build`, runs-on :676) and e2e-slow.yml:59 (runs-on :27). No other workflow installs
  Playwright.
- **No collision with #1094: confirmed, with one gap in the claim.** `gh pr diff 1094` (OPEN) changes `e2e-setup/action.yml`, ci.yml
  around lines 159-163 (selftest) and 626-631 (`save-apt-cache`), e2e-slow.yml lines 13-16 (`paths`), and **root
  `package.json` line ~18** (a `selftest:e2e-apt-deps` script). D10 does not list the `package.json` change. None of
  #1094's hunks touches the three `runs-on` lines (560, 676, 27), so the pin does not collide. Root `overrides` sit at
  package.json:74+, a separate hunk from #1094's.
- **Backend advisories: confirmed.** Step "Enforce backend CVSS >= 7" printed `Found 3 unsuppressed backend advisory
  group(s)`: guava GHSA-xxph-c9ww-hj94 (max 8.2), snappy-java GHSA-gwq9-9ffj-mvrv (7.5), snappy-java GHSA-q233-g92q-qxp6
  (7.5). GHSA-xqrx-qh46-34m7 (5.9) is below the threshold. The fixed versions come from `gh api /advisories/...`:
  guava 33.7.2, snappy-java 1.1.10.9. Both POMs are on Maven Central (HTTP 200). The SBOM resolves **guava
  `33.3.1-android`** and snappy-java `1.1.10.5`.
- **npm advisories: the claim is incomplete and partly infeasible.** All three `.audit-ci.jsonc` files set
  `"moderate": true`, so moderate advisories fail the job too. Failing advisories per lockfile:
  - root: glob GHSA-3g3m-2fjr-6pw4 (moderate), minimatch GHSA-g3hv-75wg-m249 (moderate), zod GHSA-mrhx-c7xc-m3w5 (high; root
    has zod 4.3.6 via eslint-plugin-react-hooks `^3.25||^4`).
  - frontend: glob GHSA-3g3m, minimatch GHSA-g3hv, follow-redirects GHSA-mrwp-f3q8-3g9p (high, 1.16.1 -> fixed 1.16.2),
    fast-uri GHSA-w74x-v6f9-j3xg and GHSA-wjr9-j795-jxcr (moderate, 3.1.8 -> 3.1.9).
  - helio-mcp: zod GHSA-mrhx (zod 3.25.76).
  Fixed versions (from `gh api`): **glob only 14.0.2** (vulnerable `>=9.0.0 <=14.0.1`), **minimatch only 11.0.1**
  (vulnerable `>=7.0.0 <11.0.1`), zod 4.6.6, follow-redirects 1.16.2, fast-uri 3.1.9.
- **There is no in-range fix for glob or minimatch.** From the lockfile and `npm view`: `@jest/reporters`, `jest-config` and
  `jest-runtime` declare `glob ^10.3.10` (installed glob 10.5.0, the last 10.x), and the **latest jest 30.5.2 still declares
  `glob ^13.0.6`**. glob 10 declares `minimatch ^9.0.4`. `@typescript-eslint/typescript-estree` declares `minimatch ^10.2.2`,
  including the latest 8.72.2. `workbox-build` 7.4.1 (latest, frontend PWA) declares `glob ^11.0.1`. npm audit's own
  `fixAvailable` in the CI log is `isSemVerMajor: true` downgrades for all of them (jest 25.1.0, typescript-eslint 8.36.0,
  vite-plugin-pwa 1.1.0).
- **The MCP SDK accepts zod 4: confirmed.** `npm view @modelcontextprotocol/sdk@1.32.2` (the installed version) has
  `dependencies.zod` and `peerDependencies.zod` = `^3.25 || ^4.0`. The latest zod is 4.6.7.
- **The cloud-run-cpu check and its selftest run in the hook: confirmed.** `.husky/pre-commit:17` runs `npm run check:cloud-run-cpu`
  and `:18` runs `npm run check:cloud-run-cpu:selftest`. CI runs both at ci.yml:57-58.
  `scripts/concertino/test-gate-in-isolation.sh` exists. `infra/deploy-mcp.sh:55` is a backslash-continued
  `gcloud run deploy helio-mcp` without `--no-cpu-throttling`, ending in `"$@"`. Today `checkDeployScript` is hard-wired to
  the `infra/deploy-backend.sh` label and returns a problem when no invocation is found.
- **Placeholders, contradictions and Non-goals.** ticket.md, proposal.md, D10 and tasks.md section 8 agree with each other
  and with C6. Non-goals match C6: no timeout raise, no allow-list, #1094's apt approach untouched. No TODO/TBD.

### Verdict: REFUTE

The e2e and CPU-guard parts are sound. The npm part rests on a premise the ground truth refutes, and three proof or
specification gaps would let the work pass with a hidden change.

### Change Requests

1. **D10 *security* and task 8.3: the npm plan is infeasible as written.** "`npm update`/`overrides` within compatible
   ranges" cannot clear glob GHSA-3g3m-2fjr-6pw4 or minimatch GHSA-g3hv-75wg-m249. No published jest, typescript-eslint or
   workbox-build release depends on a fixed version. The only route without an allow-list is a **cross-major transitive `overrides`**:
   `glob` >= 14.0.2 replacing ^10/^11/^13 consumers, and `minimatch` >= 11.0.1 replacing ^9/^10 consumers, in both root and
   `frontend/`. That route is exactly the "too large or risky" class the ticket says to escalate. The design must decide
   now, not leave it to execution:
   (a) either state that the forced majors are accepted and name their proof, for example the full root and frontend jest
   runs including coverage (`@jest/reporters` uses glob), `npm run lint` (typescript-estree uses minimatch), the frontend
   production build (workbox-build uses glob for the PWA precache manifest, so also show that the generated precache list
   is unchanged), and the scoping of each override (nested `"pkg": {"glob": ...}` versus global);
   (b) or record that this sub-item escalates.
   Also replace the vague "root, `frontend/` and helio-mcp npm audits" with the per-lockfile advisory list and fixed
   versions above, so the after-state is checkable line by line.
2. **D10 and task 8.2: the guava pin is not specified.** "guava >= 33.7.2" cannot be written as an sbt
   `dependencyOverrides` entry. Version `33.7.2` alone does not exist; it is `33.7.2-jre` or `33.7.2-android`. The
   resolved artifact today is `33.3.1-android`. Name the exact string. Keep `-android`, or switch to `-jre` with a one-line
   reason. Make "confirm resolved versions" check that string, because a wrong flavour silently resolves something else.
3. **D10 *zod 4* and task 8.4: the proof does not cover the advertised tool schemas.** The SDK derives each tool's
   `tools/list` `inputSchema` from the zod schema, and zod 4 converts to JSON Schema differently from zod 3 plus
   `zod-to-json-schema`. Possible differences include optional and nullable handling, unions, `$schema` and
   `additionalProperties`. Only `createConnector`'s schema is asserted today (`src/server.test.ts:221-232`). "Existing tool
   tests pass" therefore does not show that the client-visible contract is unchanged. Add to 8.4: dump `listTools()`
   `inputSchema` for every tool before and after the bump, diff the two dumps, and record the diff (ideally empty) in the
   PR body. Eliminate or justify any change. Also pin the floor as `zod@^4.6.6`, not `^4`, in helio-mcp's `package.json`.
   The root lock (zod 4.3.6) must also end at 4.6.6 or later. CR1's list covers that, but say so in 8.3 or 8.4.
4. **Task 8.5: the guard must not pass vacuously.** The new `infra/deploy-mcp.sh` rule must fail when the file is missing or
   has no non-comment `gcloud run deploy` invocation, the same way `checkDeployScript` does today. Otherwise renaming the
   command or moving the file turns the guard into a silent pass. Add a selftest case for that, alongside the
   present/absent `--no-cpu-throttling` cases. The selftest *is* hook-invoked (`.husky/pre-commit:18`), so replace "(and
   the selftest file if it is hook-invoked)" with a definite instruction to run `test-gate-in-isolation.sh` on both
   files.

### Non-blocking notes

- D10's list of #1094's edits omits root `package.json` (a scripts line near line 18). It does not collide with root
  `overrides` (line 74+), but correct the claim and keep 8.3's `package.json` edits out of the `scripts` block.
- Task order: 8.3's helio-mcp audit can only pass after 8.4's zod bump. Do 8.4 first or say so.
- Editing e2e-slow.yml makes its `pull_request` `paths` trigger fire on #1110. That is useful proof of the pin, and costs
  about 30 minutes.
- design.md is 194 lines. D10 is dense but readable, so its length does not hurt clarity.
