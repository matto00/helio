## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 5f3990f8ee873b3124e936875bbfb1cef2335d25 (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/frontend-dependency-audit/spec.md). Prior round: skeptic-design-1.md (REFUTE, CR1-CR3).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/frontend-moderate-npm-advisories/hel-1320`.
- **Base audit:** scratch copy of the worktree's `frontend/package.json` + `package-lock.json` (worktree frontend/ is
  unmodified vs HEAD), `npm audit --json` with npm 10.9.8: `{moderate: 20, high: 0, total: 20}`.
- **CR1 (parent column): FIXED.** I derived each vulnerable package's dependents straight from the lockfile `packages`
  map (every entry whose `dependencies` names the package, plus the root for direct devDeps). All 20 rows of the
  design.md "parent (dependent)" column match exactly, e.g. sprintf-js -> argparse, argparse -> js-yaml,
  js-yaml -> @istanbuljs/load-nyc-config, @jest/transform -> @jest/core, @jest/reporters, babel-jest, jest-runner,
  jest-runtime, jest-snapshot. The runtime/dev column is present per row, and task 3.4 regenerates the table at
  execution time. C1 is recorded in tasks.md and workflow-state.md.
- **CR3 (MISTAKES.md): FIXED in the plan.** proposal Impact, D5 and task 2.3 all name the `MISTAKES.md:228-236` entry
  (heading and body).
- **CR2 (raw fixAvailable): NOT FIXED. 4 of the 20 "raw" values are wrong.** I ran base `npm audit --json` 3 times
  with the normal cache, then once more with `--cache <fresh dir> --prefer-online`. All 4 runs agreed:

  | package | design.md "npm fixAvailable" | actual raw `fixAvailable` |
  | --- | --- | --- |
  | `@jest/expect` | true | `{name: jest, version: 25.0.0, isSemVerMajor: true}` |
  | `@jest/globals` | true | `{name: jest, version: 25.0.0, isSemVerMajor: true}` |
  | `jest-runner` | true | `{name: jest, version: 25.0.0, isSemVerMajor: true}` |
  | `jest-runtime` | true | `{name: jest, version: 25.0.0, isSemVerMajor: true}` |

  The other 16 rows match: `true` for @jest/reporters, jest-circus, jest-cli, jest-config and
  jest-resolve-dependencies, and the stated major objects for the rest. These are the same four packages that
  round 1 asserted were `true`. The planner seems to have copied round 1's claim instead of reading the raw output.
  Round 1's reading does not reproduce here, even with a fresh cache. That makes the column inaccurate, and C1
  requires raw values. It also shows the raw value should not be trusted from any earlier narrative.
- **Old frontend-threshold statements, re-grepped:** planned sites are `.github/workflows/ci.yml:262-263`,
  `docs/dependency-management.md:102-104,136-137`, `MISTAKES.md:228-236` and `frontend/.audit-ci.jsonc` (D2). One
  statement is **not planned**: `helio-mcp/.audit-ci.jsonc:2-3` says "Deliberately stricter than the root and
  frontend/ configs (`"high": true`)". After this change it is false, and it is not in proposal Impact, D5 or tasks
  2.x. Task 2.3's grep might catch it, but it is not named. Also, `docs/dependency-management.md:104,137` already
  wrongly says the root allowlist is empty (it has the HEL-1246 braces entry). Task 2.2's "accurate current state"
  wording covers that.
- **Spec delta:** `openspec validate frontend-moderate-npm-advisories --strict` -> valid. The step name
  "Frontend audit (frontend/)" exists at `.github/workflows/ci.yml:411`.
- **Override target:** `frontend/package.json:37-39` currently has `@istanbuljs/load-nyc-config: { js-yaml: ^3.15.2 }`,
  as D1 describes. I did not re-probe D1's lockfile delta, js-yaml 4 compatibility or the red/green proof. Round 1
  reproduced them with transcripts, and nothing in the artifacts or the tree has changed in a way that affects them.
  The executor and evaluator will re-measure them anyway (tasks 1.2, 3.1, 3.3).
- **Owner rulings:** Q1 override-js-yaml-4 and Q2 moderate are recorded (workflow-state.md comment, Linear). D1/D2
  carry them out as ruled.

### Verdict: REFUTE

The technical plan (D1-D5) is sound and CR1/CR3 are fixed. CR2's fix is factually wrong in 4 rows, against standing
constraint C1. Each fix below is one edit.

### Change Requests

1. **design.md triage table, rows `@jest/expect`, `@jest/globals`, `jest-runner`, `jest-runtime`:** change
   "npm fixAvailable" from `true` to `jest@25.0.0 (major)`, the raw value base `npm audit --json` returns (see the
   table above). Re-derive it with a command rather than copying it from skeptic-design-1.md. "real fix?" stays
   "clears via D1". Also add one line to task 3.4: the regenerated table **replaces** design.md's table too, not
   only the PR body. That way the archived design and the PR cannot disagree if npm's fixAvailable output varies by
   environment.
2. **Add `helio-mcp/.audit-ci.jsonc` (comment lines 2-5) to proposal.md Impact, D5 and a task 2.x item.** Its claim
   that it is "Deliberately stricter than the root and frontend/ configs (`"high": true`)" becomes false. Reword it
   so that only the root config is at `high`. Comment-only edit.

### Non-blocking notes

- `npm ls js-yaml` after task 1.1 will print `overridden`/`invalid` for js-yaml 4 under load-nyc-config's `^3.13.1`
  range. That is expected under ruling Q1, not a failure.
- For task 2.3, grep for `"high": true` and `frontend/` across `*.md`, `*.yml` and `*.jsonc`, not only prose phrasing.
