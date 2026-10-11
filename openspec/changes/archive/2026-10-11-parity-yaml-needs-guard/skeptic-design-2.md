## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD e56d94b107acfc72ac100803c9b26fa471ac3ad9 (change dir untracked; artifacts read from the worktree).

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/ci-parity-yaml-needs/HEL-1462`.
- `openspec validate parity-yaml-needs-guard --strict` -> `Change 'parity-yaml-needs-guard' is valid`.
- **Round-1 CR1 (D1 vs D5 selftest): resolved.** Read `scripts/check-ci-complete-needs.selftest.mjs` in full. Every
  error-path case uses `expectError` = `errors.some(e => e.includes(fragment))`, so an extra D5 anchor error cannot
  break any of them (including the hand-written strings with no `steps`, e.g. "job after ci-complete missing from
  needs"). Every green baseline ("valid file passes", "trailing comment", "block-list needs", "comments between jobs",
  "returns jobs and needs") goes through the `yaml()` helper, so D1's "only the fixture helper changes" is accurate.
  "real ci.yml passes" depends on task 2.3 adding the step; 2.4 covers that.
- **Round-1 CR2 (null steps): resolved in design/tasks.** Probe: js-yaml parses `steps:` with no value as
  `"steps":null`. D2 now says absent/null contributes nothing, other non-list is an error; task 1.1 keeps null valid and
  updates the parity selftest's hard-coded `total !== 5`. BUT the parity spec delta still contradicts it (CR 1b below).
- **Round-1 CR3 (exact token): resolved.** D5 and the ADDED requirement specify exact-token matching with parity's
  extractors; a `:selftest`-only fixture is in D6, task 1.2 and a spec scenario. Probe of the existing `NPM_RUN_RE`:
  `npm run check:ci-complete-needs:selftest` -> `['check:ci-complete-needs:selftest']` (not the guard);
  `npm run check:ci-complete-needs && echo` / `...;` -> `['check:ci-complete-needs']`. Exact matching works as claimed.
- Round-1 non-blocking notes: proposal now says "a step of the always-run `ci-complete` job (no step-level `if:`)";
  parity spec narrowed to "YAML comments and YAML string content outside a step's `run`"; Risks now records the
  `if: false`/`continue-on-error`/combined-edit residual and the shell-comment-in-`run` residual. All addressed.
- D4 against real ci.yml (lines 692-707): `permissions: contents: read` at top level (checkout works);
  `ci-complete` is `if: always()` with a single results step and `timeout-minutes: 2`; a following step with default
  `if: success()` runs only when the results step passed, so the guard runs exactly on the all-green path the m2 hole
  needs. Parity in `frontend` (140-141) runs after root `npm ci` (line 35), so its new js-yaml import (via the reader)
  is installed there.
- Parity selftest `ciYaml()` fixture: ci-complete steps are `- run: true` with no guard step. Parity imports the
  READER (not `checkCiCompleteNeeds`), so D5 does not leak into parity and those green cases stay green. Case E
  (`needs` omits `backend`) is not a reader error, so it still fails only for the uncovered script. Consistent.
- Ticket ACs: AC1 -> D1/D2, tasks 2.1/2.2; AC2 -> D6, tasks 1.1/1.3; AC3 -> D4, tasks 2.3/3.2; AC4 -> tasks 3.1-3.3.
  No scope drift.

### Verdict: REFUTE

### Change Requests
1. **Spec deltas contradict the design in two places (they get archived into canonical specs as written).**
   a. `specs/ci-required-jobs-guard/spec.md`, MODIFIED requirement, scenario "Every job listed": "WHEN every job other
      than `ci-complete` is listed ... THEN the check exits zero". After D5 this is false: every job listed but no
      `ci-complete` step running the guard exits non-zero (the ADDED "Guard step removed" scenario says so). Amend the
      WHEN to "...is listed in `needs` and a `ci-complete` step runs the guard".
   b. `specs/precommit-ci-parity-guard/spec.md`, "Parity fails closed": "...or when a scanned job's `steps` is present
      but not a list". `steps:` with no value is a present key whose value is null (probe above), which this
      sentence makes an error. D2 and task 1.1 say it contributes nothing and stays valid. Reword to "when a scanned
      job's `steps` is neither absent/null nor a list", or add a scenario saying null `steps` is valid.
2. **D5's "small shared export" has no location, and the location matters for the gate chain.** Parity already
   imports the reader from `check-ci-complete-needs.mjs`. If the extractors stay in parity and the needs guard
   imports them, you get an import cycle and the non-hook parity script becomes part of the hook's execution. If they
   go in a new module, that module is newly hook-reachable and the Gate-Chain checklist ("Touched hook-invoked script:
   `scripts/check-ci-complete-needs.mjs`") is incomplete. Name the home. Recommended: export them from
   `check-ci-complete-needs.mjs` (no new file, no cycle, the checklist stays accurate). If you choose a new module,
   add it to the checklist and to task 3.1's isolation run.

### Non-blocking notes
- With D5 inside `checkCiCompleteNeeds`, structural early returns (no `needs`, scalar `needs`, and so on) happen
  before the anchor runs, so those fixtures report one error, not two. That is fine; just don't write a selftest that
  expects both.
- Task order: once 2.1 lands, `npm run check:ci-complete-needs` on the real tree fails until 2.3 adds the step.
  Do 2.1 and 2.3 in one commit, or the hook blocks the intermediate commit.
- `NPM_RUN_RE` also matches `npm --prefix frontend run check:ci-complete-needs`, which would satisfy the anchor and
  then fail at runtime because the script doesn't exist in frontend. It fails loudly either way, so no change is
  needed.
