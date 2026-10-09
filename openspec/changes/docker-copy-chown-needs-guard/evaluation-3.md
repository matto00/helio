## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `2ba8bbbfb28bf7631697174f276c8fa782b36247` (fix commit 2ba8bbbfb). The live-resolved base is unchanged:
`bc2831cf2417af70eb0b48a315def723dcfb5485`. This is the final cycle: `EXECUTION_CYCLES: 3`.

### Cycle-2 Change Request 1 — RESOLVED
- `scripts/check-ci-complete-needs.mjs` now rejects duplicate job keys.
- Red-before-green, reproduced independently: I ran the HEAD selftest against the 6b4de5d5a guard in a scratch root.
  Both new cases FAIL there ("duplicate ci-complete key from a quoted scalar" and "duplicate ordinary job key", each
  `got []`). Both pass against HEAD.
- I re-ran my whole earlier attack corpus (cycles 1 and 2, 27 fixtures) against HEAD. None passes wrongly.

### Phase 1: Spec Review — FAIL
- AC1-AC3 and AC5: PASS, unchanged since cycle 1.
- AC4 and spec requirement "SHALL fail whenever any job defined in ci.yml ... is absent from `needs`": FAIL. There
  is a third fail-open in the same multi-line-scalar class (Phase 2, Issue 1).

### Phase 2: Code Review — FAIL
Gates I ran fresh in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `check:ci-complete-needs` on the real file: OK.
- `check:ci-complete-needs:selftest`: all passed.
- `check:precommit-ci-parity`: OK.
- `check:openspec`: clean.

Issues:
1. **Fail-open: a fake job key inside the gate's own quoted scalar cuts off the guard's view of `ci-complete`.**
   - Fixture (double quotes; the single-quoted variant behaves the same):
     ```
     on: push
     jobs:
       a:
         runs-on: x
       b:
         runs-on: x
       ci-complete:
         name: "x
         needs: [a, b, zz]
       zz:
         y"
         needs: [a]
     ```
   - The guard reports **PASS** with jobs `[a, b, ci-complete, zz]` and needs `[a, b, zz]`.
   - js-yaml and PyYAML both parse this as jobs `[a, b, ci-complete]` with `needs: ["a"]` and
     `name: "x needs: [a, b, zz] zz: y"`. Job `b` is missing.
   - Mechanism:
     - The fake `  zz:` is a valid, non-duplicate 2-space key, so the guard thinks the `ci-complete` block ends there.
     - The single `needs:` line it finds in that block is the fake one.
     - The real `needs: [a]` is credited to the fake job `zz`, whose own `needs` is never read.
   - None of the three fixes so far (the column-0 error, the 2-needs-lines error, duplicate keys) touches this
     shape.

**Judgment the orchestrator asked for: the line-based approach cannot be made sound against this class without, in
effect, a YAML lexer.**
- A multi-line double- or single-quoted scalar (and likewise a multi-line flow `[...]` / `{...}`) can contain lines
  that are byte-identical to job keys, `needs:` lines, or anything else the guard reads.
- js-yaml and libyaml (PyYAML) both accept the continuation lines at any indent, including column 0.
- Every fix so far has closed one arrangement of those fake lines: cycle 1 column 0, cycle 2 duplicate keys, and now
  this one, a non-duplicate fake key in the gate block. More arrangements remain, because the guard does not know
  which lines are inside a scalar.
- Making it sound line-by-line means tracking quote state, flow-collection depth, and block-scalar (`|`/`>`) regions.
  The block-scalar regions are needed because their literal content can hold unbalanced quotes such as `don't`.
  That is a YAML lexer in all but name.

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: FAIL

### Change Requests
1. Replace the line scanner in `scripts/check-ci-complete-needs.mjs` with a real YAML parse. Recommended:
   - Use `js-yaml` 4.x (`load`). It is already in the lockfile as a transitive dependency; I checked 4.3.1, as it
     resolved from this checkout.
   - Declare it as a root `devDependency`. Do not rely on hoisting: this worktree has no root `node_modules` and
     only resolves it through the ancestor main checkout.
   - `js-yaml` 4 rejects duplicate keys by default, and every fake-line attack in this corpus becomes plain string
     content.
   - Keep the fail-closed contract on the parsed tree. Each of these is an error, never a pass:
     - `jobs` is not a plain object, or has zero keys;
     - `ci-complete` is missing;
     - `needs` is missing, or is not an array (or is GitHub's allowed single-string form; decide and test either way);
     - an entry is not a string matching `^[A-Za-z0-9_-]+$`;
     - `needs` names an undefined job;
     - a job other than `ci-complete` is missing from `needs`;
     - the YAML itself fails to parse.
   - Keep the existing selftest fixtures; most still apply as reason-text cases. Add the three multi-line-scalar
     attacks from evaluations 1-3 as pass-closed cases.
   - Update proposal (non-goals), design D3 and the spec's "guard fails closed" requirement, which currently specify
     the line-based shape rules.
   - This reverses the planner's self-set non-goal "adding a full YAML parser dependency". It was a planner choice,
     not an owner ruling, but the orchestrator should confirm it is within its authority.

### Critical Path (final cycle, Overall FAIL)
- **Everything else is done and verified:** the Dockerfile change, the equivalence evidence, the hook and CI wiring,
  parity, the item-3 data, and the post-release check text.
- **The single remaining issue is that the guard is not sound against multi-line quoted scalars.**
- **Recommendation for the human / driver, in order of preference:**
  1. Approve one more cycle (or a short follow-up commit) that swaps the scanner for `js-yaml`, as Change Request 1
     describes. It is a small diff: the parse plus about 10 checks on the parsed tree. It ends the whack-a-mole
     pattern that has now taken three cycles.
  2. Alternatively, accept the line-based guard as is.
     - Every attack that still passes needs a deliberately contrived multi-line quoted string, and none of them is
       likely in practice.
     - The guard does catch the realistic failure the ticket targets: a new job appended and simply not added to
       `needs`. The CLI red and the selftest prove that.
     - If you take this route, state the residual gap in the PR body and the spec ("lines inside multi-line quoted or
       flow scalars are not distinguished from structure").
     - Then file a follow-up ticket to move the guard to a parser, together with the matching
       `parseCiCompleteNeeds` weakness already noted for `check-precommit-ci-parity.mjs`.

### Non-blocking Suggestions
- none
