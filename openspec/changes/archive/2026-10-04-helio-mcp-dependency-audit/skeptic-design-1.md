## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 0090b1341cce9200b822ad6b393c5646399f6efd (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Advisory count and packages (ticket "Driver additions").** I ran a fresh `npm audit --package-lock-only --json` in
  `helio-mcp/`, using a scratch npm cache. It exited 1 with `{"moderate":3,"high":0,"critical":0}`, which is 3 packages
  carrying 9 advisories:
  - hono: GHSA-gqvv/g6gw/crvj (<4.13.5) and GHSA-hxh3-vqpv-xpqv (<4.13.7).
  - ip-address: GHSA-rpw4/2vr4 (<=10.5.0) and GHSA-j6r3/h3mg (<=10.7.0).
  - fast-uri: GHSA-hrr3 (<3.1.8).

  All 9 are `fixAvailable: true`, which means none needs a breaking change. This matches proposal.md and D1's targets
  (hono >=4.13.7, ip-address >=10.7.1, fast-uri >=3.1.8).
- **D1, lockfile-only remediation is feasible.** The lockfile has these declared ranges:
  - SDK 1.29.0 declares `hono ^4.11.4` and `express-rate-limit ^8.2.1`.
  - `@hono/node-server` declares `hono ^4`.
  - express-rate-limit 8.5.2 declares `ip-address ^10.2.0`.
  - ajv declares `fast-uri ^3.0.1`, and helio-mcp has the override `fast-uri ^3.1.6`.

  Every range admits its patched version, so no `package.json` change should be needed. The resolved versions are
  hono 4.13.2, ip-address 10.5.0 and fast-uri 3.1.7, as design.md Context says.
- **D2, the moderate threshold is necessary, not scope drift.** Root `.audit-ci.jsonc` and `frontend/.audit-ci.jsonc`
  both use `"high": true`. All 9 advisories are moderate, so a high-threshold config would be green on the vulnerable
  lockfile. It would fail the red-first AC and could not prevent the next Dependabot alert. The change is scoped to
  helio-mcp, and D5(b) proves the need with a control run. Sound.
- **D3, allowlist policy.** It matches the existing HEL-1246 root entry (`"GHSA-vfj7-8cjw-p6xm|*micromatch>braces*"`
  with ticket, reason and review-by date). Since every advisory has a fix, the allowlist should stay empty.
- **D4, CI wiring.**
  - The security job (`ci.yml`) runs `npm ci` at the root, so the root devDependency `audit-ci ^7.1.0`
    (`package.json:65`) is installed there.
  - I unpacked audit-ci 7.1.0: it has a `directory` option (`-d`, default `"./"`), so
    `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` from the repo root is a real invocation.
  - helio-mcp does not declare audit-ci, so D4's ban on running npx from inside helio-mcp is correct. Run there, npx
    would fall back to a floating download.
  - D5(a) requires the executor to watch this exact command go red, which covers the remaining uncertainty about which
    lockfile it reads.
  - `cache-dependency-path` currently lists only the root and frontend lockfiles. Task 2.2 adds helio-mcp's.
- **D6, reachability.** I grepped `helio-mcp/src`. Its runtime SDK imports are `server/stdio.js` and `server/mcp.js`;
  everything else is type-only imports of `types.js`. That makes the claim plausible, and task 2.4 has the executor
  check it against the SDK's import graph.
- **D7, regression commands exist.**
  - `check:helio-mcp-types` is defined in root `package.json:40`.
  - `helio-mcp/scripts/verify.ts` exists, run via `npm run verify`.
  - Root `jest.config.cjs` collects `helio-mcp/src/**`.
- **MISTAKES.md.** Lines 214-220 say both trees have an empty allowlist. That is already stale, because root has the
  HEL-1246 entry. Task 2.3 fixes it.
- **AC coverage.**
  - Red-first → tasks 1.4 and 3.1.
  - Dependabot 0 → the post-bump audit (1.5) plus the CI gate.
  - Tests unchanged → 3.2 and 3.3.
  - Driver additions (fresh audit, allowlist rules, red-gate, verify smoke) → 1.2, 1.6, 3.1 and 3.3.

  No AC is left uncovered. I found no placeholders, TBDs or contradictions between proposal, design, tasks and spec.

### Verdict: CONFIRM

### Non-blocking notes

1. D5(d)'s "byte-identical revert" uses `git status`/`git diff`. If the bumped lockfile is not committed before the
   red-gate experiment, `git diff` will show the bump rather than prove the revert. Record a `sha256sum` of the bumped
   lockfile before and after, or commit the bump first.
2. The `security` job's header comment in `ci.yml` (~l.160-168) says "HEL-459: fails the build on a new high/critical
   CVE … audit-ci … for both the root and frontend/ lockfiles". Update it to name helio-mcp and its moderate threshold,
   so the comment and behaviour don't diverge. This is the same staleness task 2.3 fixes in MISTAKES.md.
3. The "Dependabot shows 0 open alerts after merge" AC can only be observed after merge. The evidence file should say
   that the pre-merge proxy is `npm audit` "found 0 vulnerabilities" on the same advisory database, rather than claim
   the AC is met before merge.
4. The red-gate example rolls hono back to 4.13.2, which means hand-editing the version/resolved/integrity entries in
   the lockfile. Running `npm audit --package-lock-only` reads only the lockfile, so this is fine. Make sure the
   CI-equivalent command is what's run, not a bare `npm audit`.
