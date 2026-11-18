## Context

The `security` job (`.github/workflows/ci.yml`) runs three audit-ci steps: "Frontend audit (root)" against
`.audit-ci.jsonc`, "Frontend audit (frontend/)" against `frontend/.audit-ci.jsonc`, and "helio-mcp audit
(helio-mcp/)" (root-pinned audit-ci with `--directory helio-mcp` against `helio-mcp/.audit-ci.jsonc`, empty
allowlist; helio-mcp has its own `package-lock.json` and is never `npm ci`-installed in this job). HEL-1751's
per-package entries (`"GHSA-fc5q-39xc-vjpf|micromatch>*"` etc.) are matched against audit-ci's dependency path
strings, which carry no dev/prod information. HEL-1296 / `ci-security-job-reporting` requires every audit step to
report independently (`if: ${{ !cancelled() && <own prerequisite>.outcome == 'success' }}`), and HEL-1339 requires
step-level timeouts on bounded steps. Job `timeout-minutes: 5`, measured 69-90 s. No `.npmrc` exists in any of the
three trees (verified at planning), so `npm audit` flags are not overridden by config.

Planning-time measurement on main 6e334120a: `npm audit --omit=dev --audit-level=moderate` reports
"found 0 vulnerabilities" in all three trees.

## Goals / Non-Goals

**Goals:**
- A production advisory at moderate+ in any of the three trees fails `security`, regardless of any `.audit-ci.jsonc`.
- Fail-first proof that the gap is real today and closed by the new steps.
- Explicit no-exceptions policy, written in the workflow comment.

**Non-Goals:**
- Changing or narrowing the existing audit-ci allowlists (they still govern the full tree incl. dev deps).
- Any lockfile / `package.json` change, `npm audit fix`, or dependency bump.
- A structural guard script asserting the step exists in ci.yml (no existing guard covers individual security steps;
  out of scope, can be a follow-up if wanted).
- Backend (sbt/osv-scanner) audit changes.

## Decisions

**D1 — Tool: plain `npm audit --omit=dev --audit-level=moderate`, not audit-ci.** With no allowlist, audit-ci adds
nothing but a second layer of semantics (its `skip-dev` option) to trust. `npm audit --omit=dev` excludes exactly the
packages the lockfile marks `"dev": true` (the same flag HEL-1751's justification relies on) and exits non-zero when
any advisory is at or above `--audit-level`. It also exits non-zero when the registry audit endpoint errors, so it
fails closed. Alternative (audit-ci `--skip-dev` with an empty config) rejected: an extra indirection, and a future
editor could be tempted to point it at the allowlisted config.

**D2 — Three separate steps, one per tree**, named "Production-only npm audit (root)", "Production-only npm audit
(frontend/)", "Production-only npm audit (helio-mcp/)". Separate steps keep each tree's result independently visible
(HEL-1296 convention) and match the existing step layout. Each uses `working-directory:` for its tree rather than
`--prefix`.

**D3 — Prerequisites and bounds.** `npm audit` needs only the committed lockfile and the registry, not
`node_modules` (verify during execution in a tree with no `node_modules`). So each step gates on
`${{ !cancelled() && steps.setup-node.outcome == 'success' }}` (setup-node already implies checkout succeeded), not
on `npm ci` — an `npm ci` failure must not skip the production audit. Each step declares `timeout-minutes: 1`
(measure locally; registry round-trip is seconds; the 1-minute floor matches HEL-1339's convention). Three 1-minute
bounds still fit the job's 5-minute budget alongside the measured 69-90 s.

**D4 — No exceptions, ever, in-repo.** If a production dependency gains a moderate+ advisory with no patched
release, these steps stay red. There is deliberately no allowlist, no `continue-on-error`, no config file. Handling is
an owner call recorded in a separate ticket: remove or replace the dependency, or — only with the owner's explicit
approval in that ticket — change this gate. Never by adding entries to a `.audit-ci.jsonc` (those do not apply here)
and never by downgrading `--audit-level`. This is stated in the workflow comment.

**D5 — Comments.** The step comment names HEL-1753 (this gate), HEL-1751 (the per-package dev-only allowlist that
motivated it) and HEL-1246 (the first dev-only allowlist precedent, braces GHSA-vfj7-8cjw-p6xm), explains the gap
(audit-ci paths carry no dev/prod marker), and states D4. The job's header comment block is updated to list the
production-only audits.

**D6 — Fail-first proof (scratch only).** In `/home/matt/Development/helio/.concertino/scratch/HEL-1753/` (main
checkout scratch, never the worktree tree or the real lockfiles): copy the root `package.json` +
`package-lock.json`, add `micromatch@4.0.8` as a production dependency with `npm install --package-lock-only`
(lockfile-only, no install), then run (a) the current gate exactly as ci.yml invokes it but pointed at the scratch
dir (`npx audit-ci --config <worktree>/.audit-ci.jsonc --directory <scratch>` using the worktree's root-installed
audit-ci) → expect exit 0, and (b) the new step's exact `run:` command, extracted verbatim from the edited ci.yml, in
the scratch dir → expect non-zero with GHSA-fc5q-39xc-vjpf listed. Repeat for `frontend/` with an allowlisted
frontend package (e.g. `micromatch` is not in the frontend set; use one that is, e.g. `anymatch` or `tinyglobby`, as
a production dependency) for the same green/red pair. Record command, exit code and relevant output of every run.
Also record the green-on-main runs of the new commands in all three real trees.

## Risks / Trade-offs

- **Unpatched production advisory blocks every PR.** Intended (D4); the remedy is a dependency change or an
  owner-approved ticket, not a suppression.
- **Registry flakiness.** `npm audit` hits the registry; the existing audit-ci steps already do the same, so no new
  class of flake. Fails closed.
- **`--omit=dev` correctness depends on lockfile `dev` flags.** These are computed by npm from the dependency graph;
  a package reachable from both prod and dev is not marked dev, so it is audited. That is the desired direction.
- **Optional/peer deps.** `--omit=dev` keeps optional and peer production deps in scope (stricter, desired).
