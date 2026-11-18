## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 6e334120a704930ead9780ddc3f51834726b4c5c (planning artifacts untracked under the change dir).

### What I verified (with evidence)

- **Context claims in design.md match ci.yml.** Read the `security` job (ci.yml lines ~360-530): three audit-ci
  steps exactly as described; `setup-node` has `id: setup-node` and gates on checkout; npm-ci-root/frontend gate on
  setup-node; job `timeout-minutes: 5` with the HEL-1287 69-90 s comment; HEL-1339 1-minute-floor convention on
  osv steps. `security` is in `ci-complete.needs` (ci.yml:813), so the new steps block merges.
- **No `.npmrc`** in root, frontend/ or helio-mcp/ (`ls -a`). Root has 1 prod dep, frontend 14, helio-mcp 5.
- **Green on main reproduced:** `npm audit --omit=dev --audit-level=moderate` in each of the three worktree trees
  (no node_modules in the worktree) -> "found 0 vulnerabilities", exit 0, ~0.3 s each. This also confirms D3's
  claim that the command needs only the lockfile, not node_modules.
- **Fails closed (spec scenario "Audit cannot complete"):** same command with `--registry=http://127.0.0.1:9/` in
  root and frontend/ -> "npm error audit endpoint returned an error", exit 1.
- **Fail-first premise reproduced (the core of the design)** in
  `/home/matt/Development/helio/.concertino/scratch/HEL-1753/skeptic-design/`: copied root package.json + lockfile,
  `npm install --package-lock-only --ignore-scripts micromatch@4.0.8` -> micromatch 4.0.8 entry with no `dev` flag.
  - Current gate (`audit-ci --config <worktree>/.audit-ci.jsonc --directory <scratch>`, main checkout's audit-ci):
    "Passed npm security audit.", exit 0.
  - New command: "2 high severity vulnerabilities" (micromatch / picomatch), exit 1.
  So the gap the ticket describes is real and the proposed command closes it. GHSA-fc5q-39xc-vjpf is severity
  `high` (from `npm audit --json`), so the moderate threshold catches it.
- **AC trace:** AC1 (all three trees, green on main, recorded) -> tasks 1.1, 2.2; AC2 (fail-first green/red pair)
  -> tasks 2.3/2.4 (+2.5 mutation); AC3 (no-exceptions decision + owner/separate-ticket handling) -> design D4, spec
  requirement "Unpatched production advisories allow no in-repo exception", task 1.2; AC4 (comment names HEL-1753,
  HEL-1751, HEL-1246) -> D5, task 1.2. Every AC covered; no scope beyond the ticket.
- **Spec deltas:** MODIFIED `ci-security-job-reporting` requirement reproduces the full existing text and all six
  existing scenarios, adds the three production-only audits to the list and one new scenario — no dropped scenario.
  `openspec validate prod-only-npm-audit-gate --type change --strict` -> "is valid".
- **Internal consistency:** proposal, design, tasks and specs agree on tool, step names, `if:` condition
  (`steps.setup-node.outcome == 'success'`), `timeout-minutes: 1`, and the no-allowlist rule. No TODO/TBD.
- `check-precommit-ci-parity.mjs` checks hook -> CI coverage only, so a CI-only step does not trip it.

### Verdict: CONFIRM

### Non-blocking notes

1. D6 says to use "the worktree's root-installed audit-ci", but the worktree has no `node_modules`
   (`<worktree>/node_modules/.bin/audit-ci`: No such file). Either `npm ci` in the worktree (no lockfile change) or
   use `/home/matt/Development/helio/node_modules/.bin/audit-ci`, and record which in evidence.md.
2. The HEL-1751 comment in both `.audit-ci.jsonc` files states "A production path starts at a production package,
   which is not listed, so it still fails." That is the exact assumption this ticket refutes (a production
   `micromatch` IS listed). Task 1.3 forbids any `.audit-ci.jsonc` diff; a comment-only correction pointing at the
   new gate would not touch the allowlist. Consider it, or file a follow-up — the comment now misleads future
   editors.
3. Add the fail-closed run (bad `--registry`, exit 1) to evidence.md so the spec's "Audit cannot complete" scenario
   has recorded proof, not just the design's assertion.
4. For the frontend fail-first (2.4), confirm the chosen package (tinyglobby/anymatch) actually lands with no `dev`
   flag and that the audit-ci path is matched by the allowlist (old gate green) before treating the pair as proof.
