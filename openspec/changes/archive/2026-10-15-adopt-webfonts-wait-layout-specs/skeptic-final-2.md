## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `861da5ce1748b30cb497707a5ac6e23e801d5c62` (unchanged from first read to after the full-suite run; `git status --porcelain --untracked-files=no` empty).
Base, resolved live with `resolve-review-base.sh "$W" main origin`: `7fd2f4f29157c1f159db12e99bda86ef886e4cf2` (= `origin/main` = merge-base; `HEAD..origin/main` empty).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.

### What I verified (with evidence)

**The diff (`git diff 7fd2f4f29...HEAD`).** The only code changes are `e2e/support/webFonts.ts` (scope `closest("tr") ?? target`, rename `rowFamilies` to `scopeFamilies`, comment/error-text updates, `row !== null` dropped from `settled`) and `e2e/hel1444-footnoted-chart-canvas.spec.ts` (+4: import and `await waitForWebFonts(card)` before `measure(card)` at :407). Everything else is under the archived change dir. `playwright.config.ts` diff is empty. `git diff 39aeff591 861da5ce1` = `evaluation-3.md` only.

**AC1 (probe of the hel1510 / hel813 768 Connectors mechanism): met, REFUTED for both.** Read `evidence/probes.md` and spot-read the logs, e.g. `probe-813-all-release-before-dialog-nowait-r1.log`: at 430 and 768 the gate releases the held fonts before the dialog bisect, boxes read `131.91x44`, `78.38x32 / 147.36x32`, `28x28`, `128x32`, 2 passed. Heights are fixed CSS, only widths move; hel1510's `limit` varies ~0.6px in every state including fallback-only, so it is not font-driven. Not converting refuted specs is what the ticket's AC1 ("confirmed or refuted") and AC3 ("where the font swap can affect the measurement") allow.

**AC2 (recorded sweep): met on the merged head.** I re-ran `evidence/sweep-command.sh` on HEAD: output byte-identical to `sweep-hits-v3-merged.txt` (`diff` empty; 248 lines, 43 files). Every one of the 43 files is named in `sweep.md` (scripted key check, 0 missing), including the merge's new `hel1579-pipeline-spine-layout.spec.ts` (ASSERTS-GEOMETRY, font-insensitive in baseline/fallback/late/first-measurement/per-family holds, `v3-hel1579-*`, `v4-hel1579-*`) and `support/accentAudit.ts` (POSITION-ONLY).

**AC3 (red under forced delay, then green): met.** Read `v4-redgreen-hel1444-base-RED.log` (base spec sha `92273fbc...` in a scratch mirror, header ports 7045/9952): 16 x `58px (main 57)`, `Error: bar-two-w2 @1504 light: bar no taller than main` etc., 4 failed. `v4-redgreen-hel1444-converted-GREEN.log` (cwd = this worktree, head 39aeff591): 16 x `57px (main 57)`, 4 release lines (fonts released while the wait polls, so the wait is non-vacuous), `4 passed (1.3m)`, `exit=0`. The two code files are byte-identical between 39aeff591 and 861da5ce1, so the pair holds for the final head. The prior skeptic independently reproduced the same pair on identical code. Wait placement: after scroll and the 200ms settle, scoped to the measured card, not inside any `expect.poll`/retry (C4).

**AC4 (no retries, no raised timeouts): met.** The diff adds no `retries`, timeout, `skip` or `fixme`; `FONT_WAIT_MS` stays `10_000`; `retries: 0` untouched. Only callers of `waitForWebFonts`: `rowDeleteGesture.ts:26` (row path, unchanged behaviour) and hel1444:407.

**AC5 (FULL e2e suite on the final head): met, with my own run on 861da5ce1.**
- Coverage of the evaluator's `v4-full-suite.log`: I read it (header `head=39aeff591... DEV_PORT=7045 BACKEND_PORT=9952`, `312 passed (14.6m)`, `exit=0`, 0 `✘`); its sha256 `c6f1e85d...` matches the durable copy under `.concertino/runs/HEL-1613/evidence/...`. Since 861da5ce1 adds only a markdown file, that run is equivalent in substance. I re-ran anyway so the AC rests on a run of the exact final head.
- My run: `/home/matt/Development/helio/.concertino/scratch/HEL-1613/skeptic2/full-suite.log` (sha256 `54a53249ebe8f2fd413727a452a6e3e58f60ae1429f6edad78a898181676b35e`). Header: `cwd=/home/matt/Development/helio/.claude/worktrees/task/adopt-webfonts-wait-layout-specs/hel-1613 head=861da5ce1748b30cb497707a5ac6e23e801d5c62 dirty=0 DEV_PORT=7045 BACKEND_PORT=9952 loadavg_start=3.48`; `### lock acquired 18:31:11 loadavg=3.52`; command `flock -w 3600 .../e2e.lock ... nice -n 19 npx playwright test --workers=2`.
- Result: `Running 312 tests using 2 workers`, **`312 passed (15.1m)`, `exit=0`**, 0 `✘` lines, `loadavg_end=3.61`. hel1444 bar lines: 16 x `57px (main 57)`.
- 312 equals `npx playwright test --list` on HEAD (`Total: 312 tests in 59 files`), so this was the full suite, not a subset.
- Servers: `start-servers.sh` + `assert-phase.sh` (`PASS servers`), stopped with `stop-servers.sh` (`STOPPED ports=7045,9952`). Shared `helio` DB; backend started on it.

**Gates on the changed files:** `eslint --max-warnings=0` on both files exit 0; `prettier --check` exit 0. The evaluator's `tsc -p e2e/tsconfig.json` (exit 0) was not re-run; the code is byte-identical to what two prior gates typechecked.

**UI review:** N/A. No `frontend/**` change.

**Mtime evidence:** no conclusion here rests on mtime ordering. Every cited run is identified by an in-file `head=` header plus checksums. No gate defect to record.

**Evidence persistence:** my full-suite log is outside the git tree (scratch dir), so it is cited by absolute path and sha256 with the load-bearing lines quoted above.

### Verdict: CONFIRM

### Non-blocking notes
- Follow-ups the plan promises (I did not check whether they are filed): the hel1510 0.1px flake (modal entrance animation, measured, not reproduced), the still-unexplained hel813 768 Connectors flake, and the hel1579 accent-audit rate-limit flake (123 `/api` requests per minute, 22 x 429 in both font states; `evaluation-3.md`).
- `hel1579-pipeline-spine-layout.spec.ts:261` waits on `document.fonts.ready`, which `webFonts.ts` documents as vacuous. It is green in every forced state, so this is not a defect here, but `waitForWebFonts(header)` is the honest wait. Put it in the same follow-up.
- hel1444 now depends on the Google Fonts stylesheet applying (10s throw otherwise). In fallback the base assertion fails anyway (58 > 57.5), so this adds no new failure mode. It is the same CDN dependency hel1605/hel1574 already carry.
- `workflow-state.md` `LAST_EVAL_REPORT` still points at the pre-archive path (cosmetic, per evaluation-3).
