## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `cf1d120d289e0cfc7d6d06d7db1b4b8162f05548` against base `894a72c565e06afc90bde4c4fd0f56cf86b31164`. I resolved the base live with `resolve-review-base.sh` and it exited 0. The branch has three commits: the guard red, the e2e red, then the gating. The spawn-cwd guard returned READY.

### What I verified (with evidence)

**AC1: every `:hover` rule in a feature stylesheet is gated or allowlisted.**
- I wrote my own scanner instead of reusing the repo parser or the executor's or evaluator's scripts. It uses postcss and lives at `.concertino/scratch/HEL-1735/skeptic/all.cjs`.
- It walked every `.css` under `frontend/src`: 156 files and 266 hover rules. Seven are ungated:
  - the DashboardList reveal (`.dashboard-list__item-row:hover .popover.actions-menu`, mixed with `:focus-within` and `:has(...)`);
  - six reveals in `PipelineSpine.css`, which are already on the pipeline guard's allowlist.
- So there is no ungated feature fill anywhere in the tree.
- The only `:hover` in TS/TSX outside test files is a comment (`PipelineListTable.tsx`). `index.html` and `app.html` contain no hover rules.

**AC2: the guard covers them.**
- `frontend/src/featureHoverGating.css.test.ts` walks `frontend/src/**/*.css` and excludes `shared/` and `PIPELINE_GUARDED_FILES`.
- It asserts:
  - no ungated selector outside the allowlist;
  - no gated rule mixes hover and non-hover selectors;
  - the allowlist has not rotted;
  - file and rule floors (110 and 176);
  - every pipeline-guarded file still exists.
- I ran all eight hover and CSS guard suites myself (`npm --prefix frontend test`, 3 workers, nice 19): 8 suites and 92 tests passed. The suites were `featureHoverGating`, `pipelineHoverGating`, `sharedHoverGating`, `shell.css`, `tokenAuditSweep`, `DashboardTabBar.css`, `focusRingTokenGuard` and `AccentPicker.css`.
- I read the committed mutation transcript `evidence/guard-mutations.txt`. Un-gating one rule failed the guard in 62 of 62 files, each time naming the file and selector. The mixed-list, allowlist-rot and new-file mutations also each fail.
- The red commit `16619916b` contains no stylesheet edits, and its transcript fails on 200 ungated selectors. C1 holds.
- `PIPELINE_GUARDED_FILES` is extracted once. The pipeline guard re-relativizes each entry, so its allowlist is byte-identical.

**AC3: desktop hover is unchanged.**
- **Structural check.** My own postcss check (`.concertino/scratch/HEL-1735/skeptic/eq.cjs`) is independent of the executor's `structural-equivalence.mjs`. For each of the 62 changed stylesheets it compares the base and HEAD versions as ordered lists of (at-rule chain without the hover gate, declaration block, selector set), merging adjacent identical blocks. Result: 62 files, 1447 groups, 0 differing.
- **What the gates contain.** No gated rule has a non-hover selector, and no gate is nested in another.
- **Properties inside the gates.** They are only paint: background, border-color, color, text-decoration, box-shadow, filter and outline. No display, visibility, opacity, size or pointer-events, so no reveal was gated as if it were a fill.
- **Live check.** I started the servers with `start-servers.sh` on 7167/10074, using the lane DB `helio_hel1735` and an empty `ANTHROPIC_API_KEY`; `assert-phase servers` returned PASS. I then ran `e2e/hel1735-feature-hover.spec.ts`. Its desktop tests (fixture recorded on the unchanged CSS, reads through the HEL-1790 settle helpers) passed for P and T in both themes, on every run.
- **Test edits.** I checked the shifted baseline lines in `tokenAuditSweep.css.test.ts` against base: the literals are identical (`gap: 2px;`, `padding: 4px 4px;`, `padding: 2px;`). The `shell.css.test.ts` change reads a rule's own selector instead of the media prelude; its expected values are unchanged.

**Touch, and the reveal (C2, C4).**
- **First full run: 9 passed, 1 failed** (`touch T … (T, dark)`). The output was truncated and its error was lost, so I do not know the cause.
- **Reproduction attempts.** I re-ran touch T three times (6/6 passed), then the full file twice (20/20 passed). That is 26 passes in a row, so I treat the first failure as an unreproduced one-off, not a verdict.
- **Per-instance results.** In every run all instances read green in P and T, light and dark.
- **Red on unchanged CSS.** I did not re-run this myself. The executor's red transcript is consistent with the commit content: `e7d50ef45` touches only the spec and evidence files.
- **Reveal: one render site, confirmed in source.**
  - `SidebarItemList.tsx:440` renders `ActionsMenu` only when `onDelete !== undefined`.
  - `AssistantContextList.tsx:82` passes no `onDelete`.
  - `DashboardList.tsx:378` is the only other `.dashboard-list__item-row` with an actions menu.
- **Reveal: live probe** (T, both themes). A row tap widens the trigger from 3x24 to 24x24, and tapping the trigger opens the menu. The touch path is intact, so nothing needed escalating under C4.

**C3, unedited files.** `git diff --name-status` shows no change to any HEL-1789 split spec, to `hel1675-shared-hover`, to `e2e/support/**`, to `frontend/src/shared/**` or to the nine pipeline files.

**Design judgment (DESIGN.md §5).**
- On desktop the change is visually invisible by construction: every declaration block is byte-equal, and the only difference is the media gate.
- I took two desktop screenshots at 1280x800 with a mouse hover:
  - the Data Sources rail item in **dark** (the file is misnamed `...-light.png`), which shows its fill: `/home/matt/Development/helio/.concertino/runs/HEL-1735/evidence/.concertino/scratch/HEL-1735/skeptic/desktop-rail-hover-light.png`;
  - a context-list dashboard row in light, which shows its fill and the revealed ⋮ trigger: `/home/matt/Development/helio/.concertino/runs/HEL-1735/evidence/.concertino/scratch/HEL-1735/skeptic/desktop-list-hover-light.png`.
- Both look as they did before: the same token fills, and both themes match.
- The DESIGN.md §5 paragraph names all three guards and drops the "not yet covered" sentence. Prettier check passes on DESIGN.md and the new spec.

**Mechanical gates.** I relied on the evaluator's fresh runs: lint, typecheck, format and full jest (874 suites, 10320 tests) all exited 0. The executor's `jest-full.txt` agrees. No backend change.

### Verdict: CONFIRM

### Non-blocking notes
- `e2e/hel1735-feature-hover.spec.ts`:
  - The reveal describe header and the test title (around lines 487-490 and 523) still say "two render sites" / "both render sites", but the established fact is one site. Reword them.
  - `const credentials = ...; void credentials;` is a dead binding.
  - At 570 lines the spec is over CONTRIBUTING's ~250 soft budget. Moving the DESKTOP_HOVER fixture into an `e2e/support` module would fix that, or the split can be noted in the PR.
- One unexplained failure of touch T dark in my first full run of the file. It did not recur in 26 later runs. If CI flakes on it, look at the T2 or T5 instances first.
- I left one throwaway user (`hel1735-skeptic-*@example.test`) and its two dashboards in the lane-private DB `helio_hel1735`, not the shared dev DB.
- No evidence in this report depends on mtime ordering.
