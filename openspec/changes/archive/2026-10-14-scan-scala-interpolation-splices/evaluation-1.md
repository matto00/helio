## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `4ce5800260288edffa267ffbcfd2cfb80d8e9d42`, against base `609e62b6d917243355a179fa8a26318c04898c27`. The base was resolved live with
`resolve-review-base.sh` and exited 0. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=task/scala-guard-interpolation-splices/HEL-1386`.

### Phase 1: Spec Review — PASS
Issues: none.

- **AC1 (splices are scanned, plain text is ignored, nested braces work).** `codeOnly` in `scripts/check-scala-quality.mjs` handles this. It does a depth-counted
  `scanCode(true)` and recurses into `scanLiteral` for nested literals. Plain literals, plus the text, `$$`, `$"` and `$ident` portions of interpolated
  literals, are blanked.
- **AC2 (selftest cases).** All three are present:
  - red `${}` cases for the s/f/raw/custom interpolators, nested braces, a nested string, a brace inside a nested string, a nested interpolated literal, a single-line `"""`, and a splice after `$ident`;
  - a green plain-literal `"${java.util.UUID...}"` case;
  - green cases for `$java.util.UUID` and `$$java.time.Instant`.
- **AC3 (red first).** I reproduced this myself. I ran the new selftest against the base guard (`git show 609e62b6d:scripts/check-scala-quality.mjs`) in a
  scratch copy. Result: `check-scala-quality selftest: 12 failed, 49 passed`, exit=1. The failures included the core cases `flags a s-interpolator splice — got []`,
  f/raw/custom, nested-brace, nested-string, brace-in-nested-string, triple-quote, splice-after-$ident, and the column case. This matches the executor's persisted
  transcript line for line.
  - On the executor's disclosure: two cases already passed on the old guard, `nested interpolated literal splice` and the `C2` unclosed-triple case. That is correct, and it is not a defect.
    - In both, the old regex mis-paired quotes, which left the FQN exposed. The cases passed for the wrong reason.
    - The AC requires the new case to fail on the current guard, and nine splice red cases plus the column case do fail.
    - Both of the old-guard-green cases are still failable against the new code: my independent mutation (below) turns both red.
    - C2's companion green case, `an unclosed triple-quote with only text`, is red on the old guard. So C2's pair as a whole is red-first.
- **AC4 (existing violations).** No content-keyed baseline exists, and none was needed: no site is newly flagged. `grep -rnE '\$\{[^}]*(java\.|javax\.|scala\.)' backend --include=*.scala`
  returns zero hits. The base guard and the new guard both exit 0 over this tree, so the wider scan finds nothing to fix and no `.scala` files changed (`git diff --name-only`
  .scala count = 0).
- **ShareTokenGenerationSpec.scala is untouched.** `git log 609e62b6d..HEAD -- <file>` is empty. It is also unflagged: `scanScalaText` over the file gives `hard: []`.
  Lines 45 and 56 are the plain-literal `scala.util.Random` mentions. Line 51's interpolated `${new File(".")...}` splice is scanned and stays clean.
- **Tasks 1.1–3.5.** All are checked, and each matches what was implemented.
- **Spec delta.** `MODIFIED Requirement: Inline-FQN guard exemptions` exists under that exact name in `openspec/specs/scala-inline-fqn-guard/spec.md:29`. The ADDED requirement matches the behavior.
  I verified the scenario "exits non-zero" with a real CLI spawn on a splice fixture: `backend/src/main/scala/x/A.scala:2:27: inline FQN 'java.util.…'` with exit=1, and column 27 is correct.
- **No scope creep.** The diff touches only the guard, its selftest and the change artifacts.
- **Constraints C1–C3 are honored.**
  - C1: `$"` is blanked next to `$$` (`next === "$" || next === '"'`), and the green selftest case `an escaped $" quote then text (C1)` covers it. It was red on the old guard.
  - C2: a red case covers a splice on an unclosed `"""` opening line, and a green case covers text-only unclosed `"""`.
  - C3: the guard header documents the `'}'` / `'"'` char literal inside splice code as a known limit.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (none of the configured globs `frontend/**` / `backend/**` match the changed files, so I ran the relevant gates directly):
- `npm run check:scala-quality` passed from `/home/matt/Development/helio/.claude/worktrees/task/scala-guard-interpolation-splices/HEL-1386`:
  `check-scala-quality selftest: 61 passed`, then `Scala code-quality check: clean (250 soft warning(s))`, exit=0. The counts are non-zero, and the warnings list this worktree's backend files.
- `npx prettier --check` on both scripts and all change markdown passed.
- `npx eslint --max-warnings=0` on both scripts exited 0.
- Independent mutation, done in a scratch copy and not the executor's mutation: I replaced `scanCode(true);` with `while (i < n && line[i] !== "}") blank(1);`, which blanks splice code as text.
  The selftest then went `11 failed, 50 passed`, exit=1. The failures included the nested-interpolated and C2 cases.
- Ad-hoc probes. Length is preserved in every case.
  - `x+"java.time.Instant"` gives 0 hits, so a non-identifier before `"` is treated as plain.
  - `s"${ if (a) { b } else { c } } java.time.Instant"` gives 0, so nested braces close correctly and the trailing text is blanked.
  - `f"${x}%2.2f java.util.UUID"` gives 0.
  - `val x = s"${java.util.UUID}" // java.time.Instant` gives 1.
- Code quality:
  - The scanner is small, has no dependencies, and never throws; five unterminated inputs are pinned by the selftest.
  - The column now comes from `match.index`, which is valid because comment stripping space-fills instead of deleting.
  - I found no dead code and no TODOs.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file is changed. The spec delta sits under `openspec/changes/`.

### Overall: PASS

### Non-blocking Suggestions
- `scripts/check-scala-quality.mjs` is now 252 lines, up from 180, just over the ~250 soft budget in CONTRIBUTING.md:24. If it grows again, consider moving `codeOnly`
  into its own module, for example `scripts/scala-code-only.mjs`.
- The selftest's CLI spawn still uses a non-splice fixture. A one-line splice fixture in that spawn would pin the CLI path for splices, which I verified manually above.
