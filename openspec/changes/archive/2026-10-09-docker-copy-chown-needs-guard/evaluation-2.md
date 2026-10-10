## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `6b4de5d5a611b24f3e20e2dd8c24fcd1a2e1c5fa` (fix commit 6b4de5d5a on top of cycle 1). The live-resolved
base is unchanged: `bc2831cf2417af70eb0b48a315def723dcfb5485`.

### Cycle-1 Change Request 1 — RESOLVED
- `scripts/check-ci-complete-needs.mjs:36-47`: a non-comment column-0 line after `jobs:` is now an error. It no
  longer ends the jobs block, which now runs to the end of the file.
- Red-before-green, reproduced independently: I ran the new selftest against the cycle-1 guard from `git show
  8babb8c06:...` in a scratch root. Both new cases FAIL there ("column-0 line inside a quoted scalar after jobs:" and
  "duplicate top-level key after jobs:", each with `got []`). Both pass against HEAD.
- I re-ran the full cycle-1 attack corpus (22 fixtures) against HEAD. Every one fails closed. That includes the
  cycle-1 finding (`quotedCol0AfterGate`) and the duplicate top-level `jobs:` case, which previously passed.
- Spec and design D3 are updated to match. The docker-history lines are now in pr-notes.md (cycle-1 suggestion
  taken).

### Phase 1: Spec Review — FAIL
- AC1-AC3 and AC5: unchanged since cycle 1 and still PASS.
- AC4 and the spec requirement "SHALL fail whenever any job defined in ci.yml ... is absent from `ci-complete`'s
  `needs`": still FAIL, because of a second fail-open in the same class (Phase 2, Issue 1). It was not introduced by
  this fix. It was already present in cycle 1 and I missed it then.

### Phase 2: Code Review — FAIL
Gates I ran fresh in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `check:ci-complete-needs` on the real file: OK.
- `check:ci-complete-needs:selftest`: all passed.
- `check:precommit-ci-parity`: OK.
- `check:openspec`: clean.

Issues:
1. **Fail-open: a duplicate `ci-complete` key inside a multi-line quoted scalar replaces the real `needs` list.**
   - Code: `scripts/check-ci-complete-needs.mjs:63` takes the FIRST `ci-complete` key line
     (`jobLines.find(...)`), and nothing rejects duplicate job keys.
   - Fixture:
     ```
     on: push
     jobs:
       a:
         runs-on: x
         steps:
           - run: "x
       ci-complete:
         needs: [a, b]
         end"
       b:
         runs-on: x
       ci-complete:
         needs: [a]
     ```
   - The guard reports **PASS** with jobs `[a, ci-complete, b, ci-complete]` and needs `[a, b]`.
   - js-yaml and PyYAML both parse this as jobs `[a, b, ci-complete]` with `needs: ["a"]`, so `b` is missing. The
     "ci-complete / needs" lines are only the text of step `a`'s `run` string.
   - This is the same class as cycle 1 (a multi-line quoted scalar whose continuation lines look like structure),
     moved from column 0 to the 2-space job-key indent.
   - Related attacks that already fail closed: a quoted scalar inside the real gate holding a second `needs:` line
     (2 needs lines → error), and a fake `jobs:` inside a `name:` string before the real one (column-0 error).

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: FAIL

### Change Requests
1. `scripts/check-ci-complete-needs.mjs`, after building `jobLines` (around line 60): add an error for any job name
   that appears more than once, for example "duplicate job key \"<name>\" in jobs: block (cannot establish the job
   set)".
   - Why this closes the hole: valid YAML cannot have a duplicate key, and the fake gate needs a second
     `ci-complete` line, so this blocks the needs-substitution path. Fake jobs can only ADD names; a real job key is
     always seen.
   - Add the fixture above as a selftest case, shown red against the current code before the fix.
   - Add one sentence to the spec's "guard fails closed" requirement and to design D3: a duplicate job key is an
     error.

### Non-blocking Suggestions
- none
