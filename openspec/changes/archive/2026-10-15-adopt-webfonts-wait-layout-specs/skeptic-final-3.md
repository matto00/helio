## Skeptic Report — final gate (round 3, skeptic-final-3.md)

- **Reviewed HEAD:** `f0f2e5fb6bbe63729dbcfb98cdb71a07e556e524`. It was the same at first read and at the end of my full-suite run (`head_end=` in the log). `git status --porcelain --untracked-files=no` was empty.
- **Base:** resolved live with `resolve-review-base.sh "$W" main origin` as `38de7610a4a54d23ce748f914cd558cb46ccab95`. `git ls-remote origin main` returns the same SHA, so `origin/main` has not moved since the re-gate merge.
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.

### What I verified (with evidence)

**The diff (`git diff 38de7610a...HEAD`).** The only code changes are in two files:
- `e2e/support/webFonts.ts`:
  - The scope is now `closest("tr") ?? target`.
  - `rowFamilies` is renamed to `scopeFamilies`.
  - `row !== null` is dropped from `settled`.
  - Comment and error-text updates.
- `e2e/hel1444-footnoted-chart-canvas.spec.ts`, +4 lines: the import, plus `await waitForWebFonts(card)` at :407, after scroll and the 200ms settle and before `measure(card)`. It is not inside any poll or retry. The card is a `.react-grid-item`, so it has no `tr` ancestor and the scope is the card itself.

Everything else is under the archived change dir. The only callers of `waitForWebFonts` are `rowDeleteGesture.ts:26` (row path, behaviour unchanged) and `hel1444:407`.

**The HEL-1576 drift re-gate (the focus of this round).**
- `git diff --name-only 7e6967545 f0f2e5fb6`: 11 files, 0 outside `openspec/changes/archive/2026-10-15-adopt-webfonts-wait-layout-specs/`. Nothing in `e2e/` or `playwright.config.ts` reads that directory; grep for `openspec` there finds comments only.
- `git diff 861da5ce1 7e6967545 --name-only -- e2e` lists exactly the 9 drifted specs evaluation-4 names: hel1023, 1028, 1189, 1230, 1260, 1457, 516, 909, 910.
- The two code files are unchanged by the merge: the 38de7610a...7e6967545 e2e diffstat shows only them.
- **Sweep on HEAD:** I re-ran `evidence/sweep-command.sh`. The output is byte-identical to `sweep-hits-v4-merged.txt` (`diff` empty, 248 lines). The v4 classification therefore covers the final head.
- The evaluator states three things about the drifted specs. I checked each against the diff list and the sweep, and they hold:
  - hel1189, hel516 and hel910 contain no sweep term.
  - hel909 is quarantined.
  - hel1023's `GRID_MARGIN` change is grep-invisible, and it was included in the forced-state runs.
- **hel1444 red/green re-run on the merged head, which matters because the gutter changed the card width.** I read both logs.
  - `v6-redgreen-hel1444-base-RED.log`: base spec sha `92273fbc…`, head 7e696754, ports 7045/9952. Fonts are withheld for the whole test. Result: `58px (main 57)` in all 16 measurements, `4 failed`, `exit=1`, 0 release lines.
  - `v6-redgreen-hel1444-converted-GREEN.log`: run from this worktree. Result: `57px (main 57)` ×16, `4 passed`, `exit=0`, 4 release lines.
  - **The GREEN run is not vacuous.** I read `fontfirst-preload.cjs.txt`: with `FONT_FIRST_N=100000`, the only release path is the spec calling `waitForWebFonts` (detected by `stylesheetMedia` in the evaluated function), followed by a 400ms delay. The fonts therefore land only because the new wait asked for them and blocked on them.

**AC1 (probe of the hel1510 / hel813 768 Connectors mechanism): met, REFUTED for both.** See `evidence/probes.md`:
- Each family was held and released at every step.
- Heights are fixed CSS; only widths move.
- hel1510's `limit` jitter is present in the fallback-only state too.
- The ticket allows "confirmed or refuted", and AC3 converts only specs "where the font swap can affect the measurement".

**AC2 (recorded sweep): met.**
- The command, full hit lists v1–v4 and per-file classification are in `evidence/sweep.md`.
- I reproduced the v4 hit list on HEAD.

**AC3 (red under forced delay, then green): met.** This is the hel1444 pair above, re-done on the post-HEL-1576 code. The code is byte-identical on f0f2e5fb6.

**AC4 (no retries, no raised timeouts): met.**
- The diff adds no `retries`, timeout, `skip` or `fixme`.
- `FONT_WAIT_MS` is still `10_000`.
- `playwright.config.ts` is unchanged by this branch.

**AC5 (FULL e2e suite on the final head): met. I ran it myself on f0f2e5fb6.**
- The evaluator's `v6-full-suite.log`: header `head=7e696754…`, ports 7045/9952, `312 passed (15.0m)`, `exit=0`, 0 `✘`. Its sha256 `8ad3e36c…` matches the durable copy under `.concertino/runs/HEL-1613/evidence/`. By tree equivalence it already covers f0f2e5fb6, since every changed path is archive markdown. I re-ran it anyway so the AC rests on a run of the exact head.
- **My run:**
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1613/skeptic3/full-suite.log`, sha256 `3bf66accd6676b5f580c45c952233df62139a21e9effd571ddf604d0894fca8f`.
  - Header: `cwd=…/hel-1613 head=f0f2e5fb6bbe… dirty=0 DEV_PORT=7045 BACKEND_PORT=9952 loadavg_start=4.47`.
  - `lock_acquired=22:31:51 loadavg=3.19`, using `flock -w 3600 …/e2e.lock`, `nice -n 19 npx playwright test --workers=2`.
  - Result: `Running 312 tests using 2 workers`, **`312 passed (16.0m)`, `exit=0`**, 0 `✘`.
  - hel1444 bar lines: 16 × `57px (main 57)`.
  - 312 equals `npx playwright test --list` (`Total: 312 tests in 59 files`).
- **Servers:**
  - Started with `start-servers.sh`; `assert-phase.sh servers` printed `PASS servers`.
  - The listeners were confirmed by cwd: java on 9952 at `…/hel-1613/backend` and node on 7045 at `…/hel-1613/frontend`.
  - Stopped with `stop-servers.sh` (`STOPPED ports=7045,9952`).

**Gates on the changed files, run fresh:**
- `eslint --max-warnings=0`: exit 0.
- `prettier --check`: exit 0.
- `tsc -p e2e/tsconfig.json --noEmit`: exit 0.

**UI review:** N/A. The branch's own diff has no `frontend/**` change; HEL-1576's frontend changes come from main.

**Mtime evidence:** none of my conclusions rests on mtime ordering. Runs are identified by in-file `head=` headers and sha256. evaluation-4 does not disclose unsound evidence mtimes, so I have no gate defect to record.

**Evidence persistence:** my full-suite log is outside the git tree. I cite it by absolute path and sha256 above, with the load-bearing lines quoted.

### Verdict: CONFIRM

### Non-blocking notes
- **Nearest-to-red value after the merge:** hel1512 hist20 at 1504 in fallback-only, 14.40 against a floor of 14 (evaluation-4). It is fallback-only, which production users hit only if the CDN fails, and green in every swap state. It is worth watching.
- **Injector caveat:** `fontfirst-preload.cjs`'s blocking release can starve an `expect.poll` (the hel1350 analysis). Future sweeps should pair it with the `FONT_FIRST_NOWAIT` variant, as evaluation-4 recommends.
- **Follow-ups the plan promises:** the hel1510 0.1px flake (modal entrance animation), the hel813 768 flake, the hel1579 accent-audit rate limit, and hel1579:261's `document.fonts.ready`. I did not verify that they are filed.
- **Test residue:** 4 throwaway hel1444 users from the mirror RED run were left in the shared DB (disclosed in evaluation-4).
