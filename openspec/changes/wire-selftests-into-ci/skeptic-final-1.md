## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit 9fc85f11 on task/wire-selftests-into-ci/hel-996. No UI/frontend/backend surface in the
diff (ci.yml + one Node self-test script + change artifacts), so per the ticket's hard constraint
no dev server, no sbt, no DB connection, and no browser review was performed — correctly, there
is nothing visual to judge.

### What I verified (with evidence)

**Ground truth.** `git diff main...HEAD --stat`: 11 files, only `.github/workflows/ci.yml` and
`scripts/check-no-credential-in-agent-surface.selftest.mjs` are product files. `.husky/pre-commit`,
`package.json`, `tsconfig.json` untouched (confirmed absent from the diff) — the HEL-997 constraint holds.

**Baseline.** `node scripts/check-no-credential-in-agent-surface.selftest.mjs` → `OK`, exit 0, with
both new cases printing `ok` for all five assertions.

**Are the two new probe cases genuinely failable? My own mutations, not the executor's claim:**

1. *Mutation A* — `if (process.env.CI) {` → `if (false) {` at the terminal skip branch.
   Result: `FAIL (2 failure(s))`, exit 1 — `forced skip with CI set exits non-zero` (`status=0`)
   and `output carries the fatal-skip-in-CI token` both went red. The CI-fatal branch is bound.
2. *Mutation B* — same line → `if (true) {`. Result: `FAIL (1 failure(s))`, exit 1 —
   `forced skip with CI cleared exits zero` went red (`status=1`). The non-fatal local-root
   direction is independently bound, so the pair is a real differential, not a one-sided assertion.
3. *Mutation C* (anti-tautology) — renamed the synthetic skip id `hel996-forced-skip-probe` →
   `renamed-probe`. Result: `FAIL (2 failure(s))` — both "output names the synthetic skipped case"
   assertions went red while the exit codes stayed correct. So the cases would not be satisfied by
   a child that failed for an unrelated reason; the naming assertions carry weight.
   Each mutation was reverted from a pristine copy; `git status --porcelain` afterwards shows the
   worktree clean except the evaluator's untracked `evaluation-1.md`.

**Can the `HEL996_FORCE_SKIP_SELFTEST` hook make a genuinely skipped case report success?** No.
The hook has exactly one effect (`selftest.mjs:157-162`): it calls the existing `skip()` helper,
which only pushes onto `skippedCases` (`:146-149`). There is no code path that clears, filters or
decrements `skippedCases`, and the terminal branch is keyed on `skippedCases.length > 0`
(`:1137`), not on `isRoot` — so the hook is strictly monotone. Empirically:
`HEL996_FORCE_SKIP_SELFTEST=1 CI=1 node …` → exit 1 with
`FATAL SKIP IN CI (1 case(s) skipped: hel996-forced-skip-probe)`. Worst-case misuse (the hook
leaking into a CI environment) is fail-closed: it reddens the build, it cannot green it.

**`if (process.env.CI)` vs design.md Decision 3.** Decision 3 says "treat any non-empty `CI` value
as CI"; `process.env.CI` is exactly that predicate (`""` falsy, any non-empty string incl.
`"false"` truthy). The one asymmetry — `CI=false` being treated as CI — is in the safe direction
(stricter), which Decision 3 explicitly reasons about. Faithful implementation.

**Recursion guard soundness.** The probe block is gated on `if (!process.env.HEL996_FORCE_SKIP_SELFTEST)`
(`:1069`) and every spawned child is constructed with that variable set (`:1077`, `:1097`), so the
tree is exactly depth 1 / two children. Verified empirically, not just read:
`HEL996_FORCE_SKIP_SELFTEST=1 node …` emits **zero** lines matching `forced skip with CI`
(`grep -c` → `0`). No unbounded spawn is possible. The probe block is also placed at the very end
of the `try`, after all other cleanup, so the child's `finally` cannot delete a live parent plant
(skeptic-design-1 note 1 honoured).

**AC tracing.**
- AC1 (gate + self-test in CI) — already on base at `ci.yml:54-55`, out of scope per the ticket. Confirmed present.
- AC2 (root-detected skip is a hard CI failure; policy + CI-detection documented) — `selftest.mjs:1149-1157`
  plus design.md Decisions 1–3. Met.
- AC2b (the new branch is itself probe-covered, not asserted) — met, and independently mutation-proven above.
- AC3 (`check:openspec:selftest` in CI) — `ci.yml:56-64` with a house-style comment matching the
  HEL-913/HEL-846 precedent. YAML parses; the frontend job's last four `run` steps are
  `check:no-credential-leak`, `…:selftest`, `check:openspec:selftest`, `npm test`.
  `npm run check:openspec:selftest` locally: `17 passed, 0 failed`, exit 0.
- AC (push-a-mutation-makes-CI-red) — delivery-time; tasks.md 3.1/3.2 are correctly left unchecked
  and are the only unchecked tasks. Not held against the diff, per the gate brief.
- AC5 (survey conclusion recorded) — in proposal.md, design.md Context, and the ci.yml comment itself.

**Spec deltas.** Both delta files match the shipped behaviour, including the two-sided
root-in-CI-fails / root-locally-warns scenarios. `npm run check:openspec` → `openspec/ is clean`.

**Other gates re-run by me (not taken from the evaluator's report):** `npm run format:check` → clean;
`npm run check:no-credential-leak` → `OK (6032 files scanned, 0 violations)`.

### Verdict: CONFIRM

### Non-blocking notes
- Setting `HEL996_FORCE_SKIP_SELFTEST=1` in a *local* shell silently suppresses the two probe cases
  while exiting 0 with `OK WITH SKIPS`. That is a coverage loss only outside CI, it is loudly named
  in the output, and in CI it is fatal — acceptable, but worth remembering if the hook name ever
  ends up in a `.env`.
- The fatal message goes to stderr while `OK WITH SKIPS` goes to stdout. That is the right split;
  no change wanted, just noting the probe's stdout/stderr assertions depend on it.
