## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `1ba2fbf76e5500b550181430c7f85e28f0f275f8`. The live review base from `resolve-review-base.sh` is `33dcf8fd22fe21f4823697aec101033e7f637c30`. I traced the work against the restated ticket and AC1–AC4 in ticket.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/e2e-evidence-path-isolation/HEL-1363`.
- **Diff read in full:** `git diff 33dcf8fd2...HEAD` covers:
  - 10 e2e specs
  - the new `e2e/support/evidencePath.ts`
  - the new guard and its selftest
  - the hygiene script and its selftest
  - wiring in `package.json`, `.husky/pre-commit` and `ci.yml`
  - `.gitignore` (`/e2e-evidence/`)
- **AC1 (no openspec/ reference, no cwd-relative screenshot path):**
  - All four `SHOTS = resolve(__dirname, "../openspec/...")` constants are removed: hel1275, hel1277, hel1350, hel1351.
  - All `.concertino/runs/...` cwd-relative paths are removed: hel588, hel1085, hel1087, hel1088, hel1095, hel1169.
  - The grep `writeFileSync|createWriteStream|\.concertino|openspec|outputDir|recordVideo|\.screenshot\(` over `e2e/` and `playwright.config.*` finds no remaining non-helper screenshot path and no non-comment openspec reference. The only openspec hits are in comments and in `e2e/README.md`, which is not source.
  - The helper resolves from `__dirname`, not cwd, to `<root>/e2e-evidence/<TICKET>/<file>`. It validates ticket and file names.
  - `git check-ignore` confirms `e2e-evidence/` is ignored. Its root is outside `openspec/`.
- **AC2 (guard red/green, pre-commit + CI):**
  - Wired at `.husky/pre-commit` and `ci.yml` next to `check:test-temp-dir-hygiene`.
  - Fresh runs in WORKTREE_PATH:
    - `check:e2e-evidence-paths`: exit 0, 60 files.
    - The selftest: 15/15, exit 0.
  - My own red runs, in a scratch clone (not the worktree):
    - Restoring base `e2e/hel1350-chart-compare-picker.spec.ts` gives exit 1 with 3 violations at lines 16, 160 and 208.
    - A path built as `join(d,"a.png")` fails with exit 1.
- **AC3 (`check:openspec` decision):**
  - The implementation is `holdsOnlyGitignoredFiles`, using `git ls-files --cached --others --exclude-standard`. It fails closed when git is absent or fails.
  - Probed against real `.gitignore` rules in the scratch clone:
    - `openspec/changes/zz-ghost/screenshots/a.png` alone gives exit 0 and the stderr notice "openspec/changes/zz-ghost holds only gitignored files … skipped".
    - Adding `proposal.md` gives exit 1 with `change "zz-ghost" has no tasks`.
  - `check-openspec-hygiene.selftest.mjs`: 21/21.
  - `check:openspec` on the worktree: clean.
- **AC4 (helper probe):**
  - In the scratch clone, from cwd `/`, `evidencePath('HEL-1350', …)` resolved to `<clone>/e2e-evidence/HEL-1350/…` for both former hel1350 filenames.
  - `git status --porcelain` stayed empty, apart from my own node_modules symlink.
  - Nothing new appeared under `openspec/changes/`.
  - `'../x.png'` throws.
- **Other gates, run fresh:**
  - `check:e2e-types`: exit 0.
  - `prettier --check` on every changed ts/mjs/json/yml file: clean.
- **Debugging law:** the root cause is recorded and probe-confirmed in the ticket.md premise section. The committed hel1350:16 path resolves inside whichever worktree runs it. The guard is the regression check, and it goes red on the original shape (above).
- **UI:** none. No `frontend/**` change, so I skipped Step 4. I did not use a browser.

### Verdict: CONFIRM

### Non-blocking notes

1. **The branch conflicts with current origin/main and must be rebased before merge.** origin/main is now `dd6463764` (HEL-1330, which added a shared `registerAndLogin` helper).
   - `git merge-tree --write-tree HEAD dd6463764` reports content conflicts in `e2e/hel1085-…`, `e2e/hel1087-…` and `e2e/hel1088-…`.
   - All three are adjacent import-line edits: this branch adds the `evidencePath` import, and main drops `type Page`.
   - I ran the guard against the merged tree, extracted to scratch, and it is clean (61 files). So HEL-1330 adds no new violations.
   - The rebased commit will not be the SHA I reviewed. Re-run `check:e2e-evidence-paths` and `check:e2e-types` after resolving.
2. **Rule (b) can be bypassed with an object spread.** `await page.screenshot({ ...shot })`, where `shot = { path: "x.png" }`, passes the guard (exit 0, scratch fixture). This contradicts the header's "fails closed" claim for indirection through a variable. Nothing in the tree uses the pattern. A cheap hardening would reject `...` inside the options literal.
3. Rule (a)/(b) only scan `.ts/.mts/.js/.mjs` under `e2e/`. `playwright.config.ts` sits outside that and is unscanned. Today it only mentions openspec in a comment.
