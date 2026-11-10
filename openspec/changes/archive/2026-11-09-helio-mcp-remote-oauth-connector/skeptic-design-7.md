## Skeptic Report — design gate (round 7, skeptic-design-7.md)

Scope: the owner fold-in only (ticket.md "Added scope", proposal.md fold-in bullet + Non-goals, design.md D10,
tasks.md section 8, C6). Reviewed at HEAD `e55f9265262cf24e7feee21b856924f3fb78adca`.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/helio-mcp-remote-oauth-connector/HEL-1709`.
- **The failing CI set is exactly what the plan targets.** `gh pr checks 1110`: failing are e2e (1)-(6), e2e-prod-build,
  security and ci-complete. Every other job passes (backend 0-3, frontend, docker-image, CodeQL/Analyze).
- **e2e root cause.** Job 129602660183 log: `Image: ubuntu-26.04`, then `Cannot install dependencies for ubuntu26.04-x64
  with Playwright 1.55.1!` / `Playwright does not support chromium on ubuntu26.04-x64`. The root lock resolves
  `@playwright/test` 1.55.1. The e2e-slow scheduled runs on main (2026-11-02 and 2026-11-09) fail at the same step on
  ubuntu-26.04. The last success was 2026-10-26.
- **Only three jobs use e2e-setup:** ci.yml `e2e` (runs-on at :560, the action at :625), `e2e-prod-build` (:676/:726)
  and e2e-slow.yml (:27/:59). That matches 8.1.
- **No conflict with #1094** (`gh pr diff 1094`, read only). Its workflow hunks are at ci.yml @@159 (selftest list) and
  @@626 (`save-apt-cache` input), plus e2e-slow.yml @@13 (`paths`). It also edits e2e-setup/action.yml and one root
  `package.json` `scripts` line. The runs-on lines at ci.yml:560/:676 and e2e-slow.yml:27 are outside all of these
  hunks. #1094 itself targets 24.04 (its measurements show `ImageOS=ubuntu24`), so the pin is compatible with it.
- **Backend security.** The security log shows osv-scanner flagged guava `33.3.1-android` (fixed 33.7.2) and
  snappy-java `1.1.10.5` (fixed 1.1.10.9, covering all three snappy GHSAs), with "Found 3 unsuppressed backend advisory
  group(s)". Maven Central returns 200 for `guava-33.7.2-android.pom` and `snappy-java-1.1.10.9.pom`. `build.sbt:346`
  already uses `dependencyOverrides` (the Jackson pins), so D10 follows the existing convention. Under Maven version
  ordering, `33.7.2-android` sorts after `33.7.2`, so the pin satisfies "fixed 33.7.2". CI on the PR is the final proof.
- **npm advisories match D10 for each lockfile.**
  - Root: GHSA-3g3m (glob), GHSA-g3hv (minimatch) and GHSA-mrhx (zod, range `<4.6.6`).
  - frontend: glob, minimatch, follow-redirects GHSA-mrwp (`>=1.16.0 <=1.16.1`), and fast-uri GHSA-w74x, GHSA-wjr9,
    GHSA-xhq7 and GHSA-333x (`<3.1.9`).
  - helio-mcp: GHSA-mrhx only.
  - Registry check: zod 4.6.7, follow-redirects 1.16.2 and fast-uri 3.1.9 all exist.
- **"No in-range glob/minimatch fix" is true.** On the npm registry, the latest @jest/reporters, jest-config and
  jest-runtime (30.5.2) depend on `glob ^13.0.6`, and every 13.x is vulnerable (range `9.0.0-14.0.1`). The latest
  typescript-estree (8.72.2) depends on `minimatch ^10.2.2`, which is vulnerable below 11.0.1. workbox-build 7.4.1
  depends on `glob ^11.0.1`. The fix therefore needs a forced cross-major override, and 8.3a's probe-then-escalate is
  the correct C6 handling.
- **zod 4 is feasible.**
  - The installed SDK is 1.32.2, with `zod: "^3.25 || ^4.0"` as both dependency and peerDependency.
  - helio-mcp's lock has a single `node_modules/zod`, with no nested copy that could keep the advisory alive.
  - The SDK's `zod-compat.js` validates through the tool's own schema object, or `z4mini.object(shape)` for raw shapes;
    unknown keys are stripped either way, the same default as v3.
  - `restDataSourceSchema.ts:55` uses `required_error` (removed in zod 4) and `connectorSchema.ts:97` uses
    `.strict(MSG)`. These are the two typecheck sites D10 names.
  - No `.uuid()`, `.url()` or `.datetime()` is used in `src/`, so zod 4's stricter string formats cannot silently
    narrow acceptance.
  - The `listTools()` before/after `inputSchema` diff closes the JSON-Schema-conversion gap that skeptic-design-6 CR3
    raised.
- **CPU guard.** `scripts/check-cloud-run-cpu.mjs` has `checkDeployScript` (backend only, `infra/deploy-backend.sh`).
  `.husky/pre-commit:17-18` runs both the guard and its selftest, so 8.5's isolation runs for both files are required
  and are planned. `infra/deploy-mcp.sh:55` has one `gcloud run deploy`, and the file contains no `--no-cpu-throttling`.
- **Prior REFUTE (skeptic-design-6, CR1-CR4).** I re-derived each point independently. All four are now reflected in
  D10 and section 8: the per-lockfile list, the exact guava string, the inputSchema diff with `^4.6.6`, and the
  non-vacuous guard.

### Verdict: CONFIRM

The plan is complete: every red job is covered, plus e2e-slow, which this PR will trigger. It is minimal: a runs-on pin
rather than a Playwright bump, patch-level dependency overrides, and only the zod migration the advisory forces. Its
claims are correct against ground truth. Its proof is adequate: resolved-artifact strings, CI-equivalent `audit-ci`
runs, an inputSchema diff, and an isolation transcript for each gate file. The one item that cannot be fixed in range
(glob/minimatch) escalates with measured data rather than expanding silently.

### Non-blocking notes

1. **Constraint wording vs. the fold-in.** proposal.md's Non-goal "No Scala backend or Flyway change" and C1's "no Scala
   or Flyway change" read as forbidding the `backend/build.sbt` pins in 8.2. C4's "existing tests pass unmodified" reads
   as forbidding the zod-message-text test edits in 8.4. The owner's Added scope authorises both. To keep a later gate
   or the auditor from tripping on the literal text, add one clause to the Non-goal and to D10, along the lines of
   "build.sbt dependency pins and zod-owned message-text test edits are owner-ruled fold-in scope (C6), not a C1/C4
   breach". This records the reconciliation; it does not reopen C1, C4 or C6.
2. **e2e-slow will run on this PR.** Its `pull_request.paths` includes `.github/workflows/e2e-slow.yml`, so 8.1's edit
   adds a 30-minute e2e-slow check to #1110. That is desirable, because it proves the pin. The PR body should expect it
   and count it as one of the "all CI checks".
3. **Re-archive mechanics.** Commit `9c528a84e` already synced the three spec deltas into `openspec/specs/`, and the
   working tree has the change un-archived. The main specs and the deltas are identical apart from the Purpose line.
   Unless a delta changes, re-archive with `--skip-specs` or an equivalent, or the second sync will try to ADD
   requirements that already exist.
4. **Optional spec scenario.** The `mcp-remote-http-transport` "Deployable as its own Cloud Run service" requirement
   says "without `--no-cpu-throttling`" but has no guard scenario. The backend's equivalent in
   `production-deployment-docs` does have one ("a static guard fails if it is removed"). One scenario would make 8.5
   traceable to the spec. If you add it, note 3 changes: the delta must then be re-synced.
5. **zod 4 behaviour sweep.** Beyond the tests and the inputSchema diff, the executor should check the schemas against
   zod 4's documented behaviour changes and record the result in the PR body: `.default()` short-circuit, `.int()` now
   limited to safe integers, the `message`/`required_error` to `error` customisation, refine on optional fields, and
   `.strict()` to `z.strictObject`.
   - For `connectorSchema.ts`, keep `UNRECOGNIZED_KEY_MESSAGE` as the unrecognized-key message. It is a helio-owned
     string, not zod text, so its tests must not change.
   - The `__proto__` regression guard (`connectorSchema.test.ts:74`) must pass unmodified.
6. **node_modules cache key.** The e2e cache key (`e2e-node-modules-v1-${runner.os}-...`) does not include the image
   version. This PR changes both lockfiles, so the key changes anyway and there is no cross-image restore here. A
   follow-up could add the image to the key.
7. design.md's length does not harm clarity: D10 is self-contained and maps one-to-one to tasks 8.1-8.7.
