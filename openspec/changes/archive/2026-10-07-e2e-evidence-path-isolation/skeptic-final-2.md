## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 080f3eeb19cf09ba2a447bc6a6e9b002a9ea9afa. Base resolved live by `resolve-review-base.sh`: dd6463764aadaa3bab4ca03e8c00a3b727dff1bf (origin/main). I traced against the restated ticket and the restated AC1–AC4 in ticket.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/e2e-evidence-path-isolation/HEL-1363`.
- **Diff scope** (`git diff --stat BASE...HEAD`): the merge of origin/main brought in nothing outside scope. The changed files are 10 e2e specs, `e2e/support/evidencePath.ts`, the two guard scripts and their selftests, `package.json`, `.husky/pre-commit`, `ci.yml`, `.gitignore`, and the change artifacts. I read the full code diff.
- **AC1, first half: no e2e source references `openspec/`.** I grepped `openspec` across `e2e/`. The only hits are comments (`evidencePath.ts:6`, `hel813...:59`, `stateContrast.mjs:8`) and `e2e/README.md`, which is not a spec.
- **AC1, second half: no screenshot goes to a cwd-relative path.**
  - Grepping `.concertino` across `e2e/` returns zero hits.
  - Every `.screenshot(` call site takes `path: evidencePath(...)`. Multi-line calls were confirmed from the diff.
  - Grepping `writeFile|mkdirSync|recordVideo|tracing|saveAs|.pdf(` finds only hel520 and hel813. Both write CSS mutation proofs and restore them, so neither is an evidence write.
  - `playwright.config.ts` has `testDir: "./e2e"`, so no spec lives outside the scanned tree.
- **AC1, helper is cwd-independent.**
  - I transpiled `evidencePath.ts` with the frontend's TypeScript and compiled it as a Module at its real path. Run from cwd `/`, it returned `<WORKTREE>/e2e-evidence/HEL-1363/skeptic-probe-a.png` and `.../HEL-1350/skeptic-probe-b.png`.
  - It throws for `("HEL-1","../x.png")`, `("../openspec","a.png")` and `("HEL-1","..")`.
  - `git check-ignore -v` shows `e2e-evidence/HEL-1/a.png` matched by `.gitignore:103:/e2e-evidence/`.
- **AC4: nothing is created under `openspec/changes/`.** After the probe, `git status --porcelain` showed only the evaluator's own uncommitted `evaluation-3.md`. `ls openspec/changes` showed just `archive` and this change. I then removed the empty dirs the probe had created by exact path, using `rmdir` on `e2e-evidence/HEL-1350`, `e2e-evidence/HEL-1363` and `e2e-evidence`.
- **AC2: the guard is wired, green on HEAD, and red on base.**
  - `npm run check:e2e-evidence-paths` exited 0 ("clean (61 e2e files scanned)").
  - `:selftest` exited 0 with 16/16.
  - Wired in `.husky/pre-commit:21-22` and `ci.yml:122-123`.
  - I ran the HEAD guard against a fresh `git archive dd6463764 e2e` export. It exited 1, with the four `openspec/` hits (hel1275:26, hel1277:22, hel1350:16, hel1351:23) plus the cwd-relative and `resolve(SHOTS…)` screenshot hits.
- **AC2: the selftest can actually fail (my own mutation, scratch copy).** I replaced rule (b)'s `!value.startsWith("evidencePath(")` with `false`. The selftest went to 13 passed, 3 failed: cwd-relative string, template literal, and variable indirection.
- **AC3: `check:openspec` skips gitignored-only directories.**
  - The logic at `check-openspec-hygiene.mjs:806-816,250-258` uses `git ls-files --cached --others --exclude-standard`, run in `targetRoot` with the sanitized git env. It fails closed when git is missing or errors.
  - `npm run check:openspec` exited 0, and `:selftest` exited 0 with 21/21.
  - My mutation (exemption made unconditional) took the selftest to 19 passed, 2 failed: the committable-file case and the no-git case. So the "checked exactly as before" half is genuinely guarded.
  - `git check-ignore` confirms `*.png` (`.gitignore:48`) covers the incident's `openspec/changes/x/screenshots/a.png` shape.
- **Spec deltas.**
  - The MODIFIED `Preservation of the other hygiene rules` requirement keeps all four base scenarios and adds the two new ones.
  - `openspec validate e2e-evidence-path-isolation --strict` reports the change is valid.
- **Prior-round finding (spread bypass) is closed.** The guard rejects `...` in options, and the selftest has a red case for it.

### UI review

Skipped. No `frontend/**` files changed, and no view was affected. I did not start servers or use a browser, per the driver rules.

### Verdict: CONFIRM

### Non-blocking notes

- My adversarial probes found evasion shapes the guard does not catch:
  - `path: evidencePath(...) + "x"`
  - `page?.screenshot?.({path:"a.png"})`
  - `page["screenshot"](...)`
  - `"open" + "spec"`
  - `` `${root}/openspec` `` with no trailing slash
  - `{"path": "a.png"}` (Prettier would unquote this key)

  None of these is a natural authoring shape, and AC2 targets reintroduction of the incident shapes, which are caught. A follow-up could tighten this if it ever matters.
- `evaluation-3.md` is still untracked in the worktree. The orchestrator needs to commit it with the delivery artifacts.
