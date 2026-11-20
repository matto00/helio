## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `fe164d40a17cb51636800ba9810072c4681a2237` against base `894a72c565e06afc90bde4c4fd0f56cf86b31164`. The base was resolved live.

Since cycle 1 (`cf1d120d2`) the branch was squashed (`8e60a4451`) and archived (`1d58a308d`). The squash differs from the cycle-1 head only in openspec artifacts (`evaluation-1.md`, `files-modified.md`, `skeptic-final-1.md`), per `git diff --stat cf1d120d2 8e60a4451`. The archive moved the change dir and synced `openspec/specs/feature-stylesheet-hover-gating/spec.md`.

The only code change in this cycle is `e2e/hel1735-feature-hover.spec.ts` (commit `fe164d40a`).

### Phase 1: Spec Review — PASS
Issues: none.

Each cycle-2 change request (from `ci-failure-1.md`):

1. **Root cause: confirmed independently.** I wrote a scratch probe (`.concertino/scratch/HEL-1735/eval/pw/tab.check.ts`) and ran it against HEAD on the 1024x768 touch context. It seeds dashboards `zz-a` and `zz-b` and opens `/dashboards/<zz-b>`.
   - In one run, all 4 loads rendered `["zz-a","zz-b*"]`: the inactive tab came first. In other runs only `["zz-b*"]` rendered.
   - So the old `.dashboard-tab__button` `.first()` locator could pick an inactive tab, and a tap on it activates it. That is a state repaint, not a stuck hover.
   - The CI diff shows exactly this: rgb(100,94,86) is the muted inactive colour and rgb(33,29,25) the active one.
   - The fix targets `.dashboard-tab--active .dashboard-tab__button`, whose state a tap does not change.
2. **The new T1 instance is red on unchanged CSS: confirmed independently.**
   - I injected the base (894a72c56) `DashboardTabBar.css` hover rules, lines 49-71, ungated into the touch context. After a tap the active tab is RED on 4 of 4 loads per theme:
     - light: background goes from rgba(0,0,0,0) to rgb(239,236,230)
     - dark: background goes from rgba(0,0,0,0) to rgb(38,35,32)
   - Without the injection it is green on 8 of 8 loads.
   - These values match the executor's `evidence/e2e-red-run-main-css-cycle2.txt` exactly. There, T has 4 asserted red instances (T1, T2, T3, T5), which still meets D6's threshold.
   - Caveat: the injected style sits at the end of the cascade rather than in its source position. The cycle-1 structural proof (the gate is the only difference) is what makes this a fair stand-in for unchanged CSS.
3. **The desktop fixture still holds.** The T1 fixture values are byte-identical to the cycle-1 fixture recorded on unchanged CSS in `e7d50ef45`; the commit only renames the key.
   - They equal the base rule's values for the active tab: light `--app-surface-soft` = rgb(239,236,230), dark `--app-surface-strong` = rgb(38,35,32), the same values the injection produced.
   - The desktop tests on HEAD assert this fixture and pass in my run below. So "desktop hover unchanged" still holds.
4. **Stability.** My own run of the full spec with `--repeat-each=6` and 2 workers passed 60 of 60 in 4.4 min. "T1 active dashboard tab" was green 12 of 12 times, and the reveal opened its menu 12 of 12. The executor's run was 100 of 100 at `--repeat-each=10`.
5. **Nits: fixed.** The reveal comment and test title now name one render site, and the dead `credentials` binding is gone.

The constraints still hold: no stylesheet, `shared/`, pipeline-file, `hel1675`, `hel1790Rest` or HEL-1789-spec change in this cycle.

### Phase 2: Code Review — PASS
Issues: none.

Gates were run fresh in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- Root jest: 70 suites and 617 tests pass.
- `npm run check:openspec`: clean, after the archive.
- Frontend jest for the hover-gating, `shell.css` and `tokenAuditSweep` suites: 5 suites and 61 tests pass.

The frontend source tree is byte-identical to cycle 1. The full frontend jest suite (10320 tests) and the build passed there, so I did not re-run them.

### Phase 3: UI Review — PASS
Issues: none.

- Servers were started with `start-servers.sh` on ports 7167 and 10074, with the lane DB `helio_hel1735` and `ANTHROPIC_API_KEY` empty. `assert-phase` returned PASS, and the servers were stopped with `stop-servers.sh`.
- The touch P and T tests, the desktop tests in both themes and the reveal probe all passed across the repeat run.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `e2e/hel1735-feature-hover.spec.ts` is still about 570 lines against CONTRIBUTING's ~250 soft budget. Moving the DESKTOP_HOVER fixture into an `e2e/support` module, or noting it in the PR body, would address it.
- `root-cause-cycle2.md` states its probe in prose with no transcript, and `e2e-hel1675-1790-cycle2.txt` and `e2e-repeat10-cycle2.txt` hold only their summary line. Committing the raw probe output would let a later reader re-check the claims without re-running.
