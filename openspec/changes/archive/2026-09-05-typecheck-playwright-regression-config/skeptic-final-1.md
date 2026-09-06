## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Judged against the **re-scoped** acceptance criteria in `ticket.md`. Commit `4cd6b6df`.
No backend server, no Scala spec, no database connection of any kind was opened (HEL-974
constraint honoured). No UI change in the diff, so no browser run.

### What I verified (with evidence)

**1. The one-line diff is the whole code change; root `tsconfig.json` untouched.**
`git diff --name-status main...HEAD` lists exactly one non-openspec file, `M e2e/tsconfig.json`.
`git diff main...HEAD -- tsconfig.json | wc -l` → `0`.
`git diff main...HEAD -- .husky/ package.json scripts/ .github/ | wc -l` → `0` (so no
`.github/workflows/ci.yml` collision with HEL-996, and no new gate/script).
The body of the change:
`"include": ["**/*.ts", "../playwright.config.ts"]` → `[..., "../playwright.regression.config.ts"]`.

**2. Coverage change reproduced in BOTH directions, by me, from TypeScript's own resolver.**
- *Before* (main's config, restored via `git show main:e2e/tsconfig.json` into a throwaway
  `e2e/tsconfig.skeptic-before.json`, deleted immediately after):
  `npx tsc -p … --showConfig | grep -c 'regression\.config'` → **0**.
- *After* (shipped config): same command → **2** (one occurrence in `include`, one in `files`).
- Parsed the JSON rather than trusting the grep count:
  `'../playwright.regression.config.ts' in files` → **True**; resolved `files` count **19**
  (design-gate baseline measured 18 → exactly +1 file, no collateral scope widening).

**3. The new coverage is real, not nominal — the red arm actually fires.**
A green `check:e2e-types` proves nothing on its own (it was green while the file was uncovered),
so I mutated the newly-covered file: appended `const __skepticProbe: number = "not a number";`
to `playwright.regression.config.ts` and re-ran the gate →
`playwright.regression.config.ts(37,7): error TS2322: Type 'string' is not assignable to type 'number'.`,
exit **2**. Restored with `git checkout --`; `diff` against a pre-probe backup reports IDENTICAL and
`git status --porcelain` shows only the untracked `evaluation-1.md`. This is the discriminating
measurement the design (D2) asked for and it holds.
Unmutated gate: `npm run check:e2e-types` exits **0**.

**4. The gate genuinely runs.** `.husky/pre-commit` line 7 is `npm run check:e2e-types`;
`package.json:28` defines it as `tsc --noEmit -p e2e/tsconfig.json`. Enforced on every commit.

**5. No artifact restates the refuted premise as real; no ruled-out work snuck in.**
Grep for the false mechanism across the change dir returns one hit outside the design-gate skeptic
reports: `ticket.md:8`, inside the sentence "As filed, HEL-997 **claimed** … but the mechanism those
facts were supposed to imply **is false**." That is the explicitly-labelled refutation the third AC
requires, not an assertion. `proposal.md` — Why and `design.md` — Context likewise carry the
687-files/0-under-`.claude` measurement labelled as a refutation. The commit message states only the
0→2 measurement and makes no worktree-scoping claim. No guard script, no selftest, no new gate, no
`exclude` addition, no root `tsc` invocation, and no follow-up ticket artifact exists in the diff.

**6. Archive readiness.** `npx openspec validate typecheck-playwright-regression-config --strict` →
`Change 'typecheck-playwright-regression-config' is valid`. `skip_specs: true` is correct here — a
build-tooling include entry has no capability delta, and inventing one to satisfy validation would be
worse. `files-modified.md` accurately enumerates the single modified file.

**AC trace:** AC1 → diff above. AC2 → §2 + §3 (`--showConfig` before/after *and* mutation proof).
AC3 → §1 + §5. AC4 → §5 (commit message; PR body should carry the same framing).

### Verdict: CONFIRM

### Non-blocking notes

- `ticket.md`'s third AC still says the refuted story "is retained in the archived proposal and design
  only as an explicitly-labelled refutation" while an earlier draft's wording tension was flagged in
  `skeptic-design-2.md`. The shipped artifacts match the retained-as-refutation reading, which is the
  more useful outcome. Nothing to change.
- The PR body (not yet written at review time) must keep the same labelled-refutation framing as the
  commit message; the diff itself contains no offending text.
- Reminder for archive: HEL-997's closing comment still owes the 687-file `--showConfig` measurement
  per the owner's out-of-scope ruling. That is an orchestrator/closing step, not a code change.
