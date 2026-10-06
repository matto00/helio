## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD e043566d1a0534c5aa98085dfa2b94431775ad28. The change dir is untracked, and no workflow edit exists yet.
I read ticket.md, proposal.md, design.md, tasks.md, specs/ci-security-job-reporting/spec.md, skeptic-design-2.md,
and `.github/workflows/ci.yml` lines 240-366 in the worktree.

### What I verified (with evidence)

- **Round-2 CR1 is addressed as requested.**
  - D2 now gives ids to `checkout`, `setup-node`, `npm-ci-root` and `npm-ci-frontend`.
  - setup-node is gated on `!cancelled() && steps.checkout.outcome == 'success'`, and npm ci is gated on setup-node.
  - Only checkout, setup-java, setup-sbt and Cache sbt stay on implicit `success()`, with a stated reason.
  - The spec adds the mirror scenario ("A java or sbt setup step fails ..."), task 1.4 covers it, and D4 lists it as
    proved by expression review only.

  A java/sbt/cache failure therefore no longer skips any npm audit.
- **Per-step test: can a failure in a step that is not a prerequisite skip an audit?** I applied it to every step in
  the real order (ci.yml 251-366):
  - checkout: first step, and a genuine prerequisite of everything.
  - setup-java, setup-sbt and Cache sbt (implicit `success()`): only checkout can skip them, and they feed only the
    backend chain. The SBOM step needs java and sbt and not the cache. OK.
  - SBOM → positive control → osv install → scan → CVSS: each step needs the artifact or binary from the step
    before. OK.
  - setup-node depends on checkout, and npm ci depends on setup-node. OK.
  - The root audit and the helio-mcp audit depend on `npm-ci-root`. That is genuine: both use the root-pinned
    audit-ci (`helio-mcp/package.json` has no audit-ci devDependency). OK.
  - **`npm --prefix frontend ci`, and with it "Frontend audit (frontend/)", depend on `npm-ci-root`. That is not a
    genuine dependency.** See CR1.
- **Ground truth on the frontend path's independence from the root install:**
  - Neither `package.json` nor `frontend/package.json` declares `workspaces`, and `frontend/package.json` has no
    install or prepare scripts.
  - `frontend/package-lock.json` has no `file:` or `link:` entries. Its only `hasInstallScript` packages are
    fsevents and unrs-resolver.
  - `frontend/package.json` declares `audit-ci ^7.1.0` itself, and it is locked at `node_modules/audit-ci` 7.1.0.
  - Live probe: this worktree has **no root `node_modules`** (`ls node_modules` fails) but does have
    `frontend/node_modules`. From `frontend/`, `npx --no -- audit-ci --help` exits 0 and prints audit-ci's options,
    and `npm exec --no -c 'command -v audit-ci'` resolves to `.../HEL-1296/frontend/node_modules/.bin/audit-ci`.
    The project-local npm_config_cache is under the scratchpad. So the frontend/ audit runs with the root install
    entirely absent.
- **D1 budget:** unchanged since round 2 (48 s + 120 s + about 15 s + post-steps, about 3 min, under the 5-min job
  timeout). OK.
- **D3/D4:** unchanged and still sound. D4 tests on real CI whether a step timeout keeps `!cancelled()` true, instead
  of assuming it.

### Verdict: REFUTE

### Change Requests

1. **A root `npm ci` failure still masks the frontend/ audit. The design gates it on a step that is not one of its
   prerequisites.**
   - D2 gates "`npm --prefix frontend ci` (`npm-ci-frontend`)" on `steps.npm-ci-root.outcome == 'success'`, and gates
     "Frontend audit (frontend/)" on "`npm-ci-root` **and** `npm-ci-frontend`".
   - As shown above, the frontend install and the frontend/ audit do not use anything the root install produces.
     D2's own justification ("runs `npx audit-ci` from `frontend/`, where audit-ci is a declared devDependency")
     names the frontend-local binary.
   - So if root `npm ci` fails for a root-only reason (root lockfile drift, a `husky` prepare failure, or a registry
     flake on a root-only package), the frontend/ install and audit are skipped. The frontend/ advisories go
     unreported.
   - This breaks the spec's own sentence, "No setup step SHALL be skipped merely because a setup step that is not its
     own prerequisite failed." It also breaks the owner's "every audit step reports on every run". It is the same
     defect class as rounds 1 and 2.

   **Required revision** (design.md D2 bullets and the "node/npm setup is gated" list, tasks.md 1.4, and spec.md):
   - Gate `npm-ci-frontend` on `${{ !cancelled() && steps.setup-node.outcome == 'success' }}`.
   - Gate "Frontend audit (frontend/)" on `${{ !cancelled() && steps.npm-ci-frontend.outcome == 'success' }}` only.
   - Add a spec scenario: "WHEN root `npm ci` fails while setup-node and `npm --prefix frontend ci` succeed, THEN
     'Frontend audit (frontend/)' still runs and reports, AND the job is `failure`."
   - List that scenario among the expression-review-only cases in D4 and ci-proof.md.

   No other step fails the test.

### Non-blocking notes

- The round-2 notes still apply. A build.sbt throwaway changes the sbt cache key, so do not misread a restore-key hit
  in the revert run. ci-proof.md should quote helio-mcp's audit-ci output lines.
- When writing the `if:` expressions, keep each one wrapped in `${{ }}`. Reference only ids that are actually
  declared: an undeclared id evaluates to an empty outcome and silently skips the step. Run actionlint if it is
  available.
