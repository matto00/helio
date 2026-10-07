## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 5f3990f8ee873b3124e936875bbfb1cef2335d25 (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/frontend-dependency-audit/spec.md).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/frontend-moderate-npm-advisories/hel-1320`.
- **Owner rulings exist:** main checkout `.concertino/runs/HEL-1320/events.jsonl` line 5, `escalation.answered`,
  `sub_answers ["override-js-yaml-4","moderate"]`, `answer_source: human`. The plan executes both as ruled.
- **Base audit (D-Context claim):** scratch copy of base `frontend/package.json` + lockfile, `npm audit --json`:
  `{moderate: 20, high: 0, total: 20}`, single advisory URL GHSA-hp3w-g68c-fv3c. Claim confirmed.
- **Dev-only (AC1 runtime/dev claim):** `npm ls --omit=dev sprintf-js js-yaml` in worktree frontend/ -> `(empty)`. Confirmed.
- **Lockfile delta (D1 claim):** scratch copy, override retargeted to `^4.1.1`, `npm install --package-lock-only
  --ignore-scripts` (npm 10.9.8), `.packages` diff = exactly: js-yaml 3.15.2->4.3.2, argparse 1.0.10->2.0.1,
  esprima 4.0.1 removed, sprintf-js 1.0.3 removed. No other entry changed. Post-change `npm audit` -> total 0. Confirmed.
- **Only one js-yaml in tree:** lockfile has a single `node_modules/js-yaml` key, depended on only by
  `@istanbuljs/load-nyc-config@1.1.0` (declares `^3.13.1`; override forces out-of-range, accepted per ruling).
- **js-yaml 4 compatibility (D1/D4):** load-nyc-config's only use is `require('js-yaml').load(...)` for
  `.nycrc.yml`/`.nycrc.yaml` (index.js:78-80). Scratch probe: load-nyc-config@1.1.0 resolving js-yaml 4.3.2, a
  `.nycrc.yaml` with `all: true` / `reporter: [text]` -> `loadNycConfig` returned `true [ 'text' ]`. No nycrc file is
  tracked in the repo. Confirmed.
- **Red/green feasibility (D3):** audit-ci from frontend/node_modules: base lockfile + moderate config exit=1; base +
  current high config exit=0; new lockfile + moderate exit=0; new + high exit=0. The planned proof is sound and bites.
- **Spec delta:** `openspec validate frontend-moderate-npm-advisories --strict` -> valid. New-capability shape mirrors
  `openspec/specs/helio-mcp-dependency-audit/spec.md`; no existing spec pins the frontend threshold at high
  (`ci-security-job-reporting`, `dependency-security-patch` checked), so ADDED rather than MODIFIED is correct.
- **Docs surface:** repo-wide grep for the frontend threshold statement: hits in `docs/dependency-management.md`
  (102-104, 138; planned) and `MISTAKES.md:228-236` (NOT planned) plus `.github/workflows/ci.yml:261-266` (planned).
- **fixAvailable (design table claim):** base `npm audit --json` per-package `fixAvailable` checked row by row (see CR 2).

### Verdict: REFUTE

The technical plan (D1-D4) is sound and every load-bearing claim reproduced. Two artifact defects must be fixed
before execution because they would ship an AC1 deliverable that answers the wrong question and leave a binding
standards doc false.

### Change Requests

1. **AC1 "parent dependency that pulls it in" is answered backwards.** design.md's triage table column
   "parent (via)" lists npm's `via` — the *dependency* that makes a package vulnerable (child direction) — not the
   package that pulls it in (dependent direction). E.g. the row `sprintf-js | advisory itself` should name
   `argparse@1.0.10` as its parent; `argparse`'s parent is `js-yaml@3.15.2`, `js-yaml`'s is
   `@istanbuljs/load-nyc-config@1.1.0`, etc. Revise the table so the parent column is the dependent that requires
   the package (derive from the lockfile / `npm ls <pkg>`), optionally keeping `via` as a separate column. Also add
   an explicit per-row runtime-vs-dev column (all "dev", grounded by `npm ls --omit=dev` being empty) since AC1 asks
   for it per advisory row, and have tasks.md carry a task to regenerate this table from fresh `npm audit --json` at
   execution time for the PR body.
2. **"Fix available" column contradicts npm's own output.** At base, `npm audit --json` reports
   `fixAvailable: true` for `@jest/expect`, `@jest/globals`, `jest-runtime` and `jest-runner`, but the table labels
   all four "jest downgrade only" (while labelling other `true` rows "via ancestors"). Make the column consistent
   with the raw `fixAvailable` value (and the design's own stated rule that `true` rows resolve only via ancestors),
   or state the column is the planner's interpretation and give the raw value alongside it.
3. **MISTAKES.md is left stating the old threshold.** `MISTAKES.md:228-236` ("The security gate is unconditional on
   high/critical (moderate for helio-mcp)") says audit-ci runs `"high": true` in the `frontend/` tree. After this
   change that is false in a binding canonical doc agents are told to read. Add it to proposal.md Impact, design.md
   D5, and a tasks.md item (update the heading and body so frontend/ is listed at moderate alongside helio-mcp).

### Non-blocking notes

- tasks 1.1 `npm ls js-yaml` will print `overridden` for js-yaml 4 under a `^3.13.1` range — expected, not a failure.
- The `^4.1.1` floor is consistent with MISTAKES.md's note that js-yaml needs a separate override floor per major.
- Risk note about babel-plugin-istanbul later moving to load-nyc-config 2 is fine as stated.
