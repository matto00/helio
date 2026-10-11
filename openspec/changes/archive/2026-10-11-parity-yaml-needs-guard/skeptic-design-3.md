## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD e56d94b107acfc72ac100803c9b26fa471ac3ad9 (change dir untracked; artifacts read from the worktree).

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/ci-parity-yaml-needs/HEL-1462`.
- `npx openspec validate parity-yaml-needs-guard --strict` -> `Change 'parity-yaml-needs-guard' is valid`.
- **Round-2 CR 1a: resolved.** `specs/ci-required-jobs-guard/spec.md` "Every job listed" now reads "WHEN every job other
  than `ci-complete` is listed in `ci-complete`'s `needs` and a `ci-complete` step runs the guard -> exits zero",
  consistent with D5 and the ADDED "Guard step removed" scenario.
- **Round-2 CR 1b: resolved.** Parity spec "fails closed" now says "a scanned job's `steps` is neither absent/null nor a
  list (an empty `steps:` parses as null and contributes no commands)". Matches D2 and task 1.1 ("null `steps:` stays
  valid").
- **Round-2 CR 2: resolved.** D5 now names the home: the token extractors move into `check-ci-complete-needs.mjs` and
  are exported; parity imports the extractors and the reader from there; no new module, no reverse import. So the
  Gate-Chain checklist's single touched hook-invoked script (`scripts/check-ci-complete-needs.mjs`) and task 3.1's
  isolation run are accurate.
- Deletion safety for task 2.2: grep for `parseCiCompleteNeeds|extractJobBlocks|extractNpmScriptInvocations` across
  repo `.mjs/.js/.json` (excluding node_modules/scratch) hits only `scripts/check-precommit-ci-parity.mjs` itself; the
  parity selftest imports only `checkPrecommitCiParity` (line 10). Removing the regex exports breaks no caller.
  `extractNpmScriptInvocations` is also used by `parseHookScripts` (line 70), so moving it means parity's hook-side
  parsing imports it too; this is within D5's "parity imports them" and leaves hook-side semantics unchanged.
- The parity selftest's hard-coded `total !== 5` (lines 179-180) is real; task 1.1 updates it.
- Fresh whole-design pass: AC1 -> D1/D2, tasks 2.1/2.2; AC2 -> D6, tasks 1.1/1.3 (m1 decoy fixture run against the
  pre-change script); AC3 -> D4/D5, tasks 2.3/3.2 (m2 red via the exact `ci-complete` command); AC4 -> tasks 3.1-3.3.
  No placeholders/TBDs; proposal, design, tasks and spec deltas agree; no scope drift (no `.husky/pre-commit`
  change, no new dependency). D4's reasoning (only the required job itself cannot be dropped from `needs`) holds;
  the step-ordering (results step first, guard after with default `if: success()`) runs the guard on the all-green
  path that defect 2 needs.

### Verdict: CONFIRM

### Non-blocking notes
- Task 2.3a commits 2.1-2.3 together. 2.2 also changes behaviour that the 1.1 fixtures test, so in practice the
  executor should land 2.1-2.4 in one commit (the hook runs the needs-guard selftest only in CI, but keeping one green
  commit avoids a red intermediate state).
- Round-2 notes still apply: structural errors short-circuit the anchor (one error per structural fixture), and
  `npm --prefix frontend run check:ci-complete-needs` would satisfy the anchor but fail loudly at runtime.
