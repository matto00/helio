## Skeptic Report — final gate (round 2, skeptic-final-2.md)

I reviewed HEAD `fe164d40a17cb51636800ba9810072c4681a2237` against base `894a72c565e06afc90bde4c4fd0f56cf86b31164`. I resolved the base live with `resolve-review-base.sh` (main/origin), which exited 0. The spawn-cwd guard returned READY.

### What I verified (with evidence)

**Scope of what changed since round 1.**
- `git diff --stat cf1d120d2 HEAD -- frontend DESIGN.md e2e` reports one file changed: `e2e/hel1735-feature-hover.spec.ts` (+11/-9).
- So the frontend stylesheets, the guards and DESIGN.md are byte-identical to the tree that round 1 reviewed and confirmed. The squash and archive commits add only openspec artifacts.
- The non-CSS, non-openspec files changed against base are as planned: DESIGN.md, the new spec, `shell.css.test.ts`, `featureHoverGating.css.test.ts`, `pipelineHoverGating.css.test.ts`, `cssHoverGating.ts` and `tokenAuditSweep.css.test.ts`.

**The cycle-2 fix (`fe164d40a`).**
- T1 now targets `.dashboard-tab--active .dashboard-tab__button` instead of `.dashboard-tab__button` `.first()`.
- The class is real: `DashboardTabBar.tsx:42` adds `dashboard-tab--active` when the tab is active.
- The fix is sound. A tap on the active tab changes no state, so any paint change after the tap can only come from a stuck hover. That is what T1 is supposed to measure.
- The old locator could land on an inactive restored tab, and tapping it activates the tab. The CI diff (100,94,86 to 33,29,25) is the muted-to-active text colour, which fits that state change. The evaluator also confirmed this independently with its own probe.
- The desktop fixture values for T1 are unchanged: only the key was renamed. They match the base rule for the active tab:
  - light: `--app-surface-soft` = rgb(239,236,230);
  - dark: `--app-surface-strong` = rgb(38,35,32).
- The committed red transcript `evidence/e2e-red-run-main-css-cycle2.txt` shows T1 red in both themes, with backgrounds that match those values. T still has 4 asserted red instances (T1, T2, T3, T5), so D6's threshold holds.
- The round-1 nits are fixed: the reveal comment and title now name one render site, and the dead `credentials` binding is gone.

**AC1: every `:hover` rule in a feature stylesheet is gated or allowlisted.**
- I wrote a fresh postcss scanner, independent of the repo parser and of the other agents' scripts: `.concertino/scratch/HEL-1735/skeptic2/scan.cjs`.
- It read 156 files and 266 hover rules. Seven are not inside `@media (hover: hover)`:
  - the DashboardList reveal unit, which is on the allowlist;
  - six `PipelineSpine.css` reveals, which are on the pipeline allowlist.
- No ungated fill remains.

**AC2: the guard covers them.**
- I ran the five hover and CSS guard suites myself (`featureHoverGating`, `pipelineHoverGating`, `sharedHoverGating`, `shell.css`, `tokenAuditSweep`; 3 workers, nice 19): 5 suites and 61 tests passed.
- The mutation transcript is unchanged since round 1, which read it: un-gating one rule fails the guard in 62 of 62 files, and the mixed-list, allowlist-rot and new-file mutations also each fail.

**AC3: desktop hover is unchanged, and the touch e2e passes.**
- I started the servers with `start-servers.sh` on ports 7167 and 10074, using the lane DB `helio_hel1735` (DATABASE_URL and DB_USER exported) and an empty `ANTHROPIC_API_KEY`. `assert-phase servers` returned PASS.
- I then ran the full `e2e/hel1735-feature-hover.spec.ts` with `--repeat-each=3` and 2 workers: **30 passed of 30** in 2.8 min.
- That covers touch P and T and desktop P and T, each in light and dark, plus the reveal probe. The desktop reads go through the hel1790Rest helpers.
- The reveal probe output: the trigger is 3x24 before the row tap and 24x24 after, and tapping the trigger opens the menu in both themes. The Assistant conversation rows show `actions-menu popovers=0`, which confirms there is a single render site.
- Afterwards I stopped the servers with `stop-servers.sh` (STOPPED).

**Other checks.**
- Prettier check passes on the spec and DESIGN.md, and eslint on the spec exits 0.
- C3 holds: no HEL-1789 split spec, no `hel1675-shared-hover`, nothing under `e2e/support/**`, `shared/**` or the nine pipeline files was edited.

**UI design judgment.**
- No stylesheet changed in this cycle. Round 1 took and judged the desktop screenshots against this same CSS, and by construction the only difference from base is the media gate.
- This round's live computed-style reads on desktop equal the fixture recorded on unchanged CSS in both themes. I took no new screenshots, because no visual surface changed since round 1.

**Mtime.** No claim in this report relies on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- `e2e/hel1735-feature-hover.spec.ts` is still about 570 lines against CONTRIBUTING's ~250 soft budget. Mention it in the PR body, or move DESKTOP_HOVER into an `e2e/support` module in a follow-up.
- `root-cause-cycle2.md` describes its 6-load probe in prose without a raw transcript. The evaluator's independent probe corroborates it.
