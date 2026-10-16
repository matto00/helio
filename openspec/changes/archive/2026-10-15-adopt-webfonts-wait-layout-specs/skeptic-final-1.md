## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `b5e12edd143fa217ad650852dbadb200df9e3604`. Base, resolved live with `resolve-review-base.sh`: `67c434c6b01f9b91681870488975be5ca370c896`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.

### What I verified (with evidence)

**The diff (`git diff 67c434c6b...HEAD`).** Two code files change: `e2e/support/webFonts.ts` and `e2e/hel1444-footnoted-chart-canvas.spec.ts` (+4 lines). Everything else is openspec evidence.
- `git diff 1ab7a534e HEAD -- e2e frontend backend playwright.config.ts package.json` is empty.
- `git diff 792a90769 HEAD -- . ':!openspec'` is empty.
- So the code has been the same since the conversion commit. The commits after it change evidence only.

**AC1 (probe of hel1510 and hel813 at 768): met, mechanism REFUTED for both.**
- I read `evidence/probes.md` and the per-state `probe-1510-*` and `probe-813-*` logs. The method is held `fonts.gstatic.com` responses, released at named points, which is the HEL-1606 method extended as design D1 and C5 require.
- States exercised: fallback-only, held for the whole test, release mid-measurement, and one family held at a time (Schibsted Grotesk, JetBrains Mono, Fraunces).
- hel1510:
  - The `limit` value varies by about 0.6px in every state, including fallback-only. For example, `limit=871.811` with Schibsted loading and `872.374` with all loaded, and both runs passed.
  - Controls and limit move together, which fits the competing cause the executor names: the modal entrance animation.
  - The fonts never turn the test red.
- hel813 surface 7: box heights are fixed (44/32/28/32) and only widths move by about 1.6px. Every state is green at both 430 and 768.
- **Leaving them unconverted honours the ticket.** AC1 explicitly allows "confirmed or refuted". AC3 converts only "where the font swap can affect the measurement". Adding the wait to a spec the probes show is font-insensitive would be a speculative fix and would hide the real flake cause. Constraint C3 and design D3 forbid exactly that.

**AC2 (recorded sweep): met.**
- I re-ran the exact `sweep-command.sh` grep: 218 lines in 41 files, matching `sweep-hits.txt`.
- Every one of the 41 files is classified in `sweep.md` (I checked each file's key against `sweep.md`; none missing).
- I also ran a wider probe for geometry assertions the grep might miss: `toHaveCSS("width"|"height")`, `getComputedStyle().width`, `.width/.height` comparisons. It found no file outside the 41.

**AC3 (conversion with red and green proof): met. I reproduced it independently.**
- Both runs used the same injector, `FONT_FIRST=1 FONT_FIRST_N=100000`: the stylesheet is withheld until the spec asks about fonts. The preload is the evaluator's `c2-fontfirst.cjs` copy. The base spec is `git show 67c434c6b:e2e/hel1444-...` in my scratch `e2e-base/`.
- **Base:** `sk-1444-base-held.log`, header `cwd=.../hel-1613 head=b5e12edd1... spec=base(67c434c6b) DEV_PORT=7045 BACKEND_PORT=9952`. Result `4 failed`, `exit=1`, with `[HEL-1444 bar bar-two-w2 @1504 light] 58px (main 57)` and `Error: bar-two-w2 @1504 light: bar no taller than main` at 1504 and 1900, light and dark.
- **Converted:** `sk-1444-conv-held.log`, same header, with `FONT_FIRST_ASK_DELAY_MS=400`. Fonts are released on a timer while `waitForWebFonts` polls, so the wait really blocks. Result `4 passed (1.1m)`, `exit=0`, and the bar reads `57px (main 57)` in all 4 runs.
- This matches the executor's `redgreen-hel1444-*.log` and the evaluator's `eval-1444-*.log`.
- The wait is placed after the existing scroll and 200ms settle, before `measure(card)`, and scoped to the measured card, as C4 and D4 require.

**Helper generalisation.**
- `closest("tr") ?? target` is backward-compatible: before, a `null` row meant the wait never settled; row callers (`rowDeleteGesture.ts:26`) resolve to the same `tr` as before.
- The only callers are `rowDeleteGesture.ts` and hel1444 (checked by grep).
- eslint (`--max-warnings=0`), `tsc -p e2e/tsconfig.json` and prettier `--check` on both files all exit 0.

**AC4 (no retries, no raised timeouts): met.** The diff adds no `retries`, `timeout` or `setTimeout` change and no skip or fixme. `FONT_WAIT_MS` stays 10000, as inherited from HEL-1606. `playwright.config.ts` `retries: 0` is untouched.

**AC5 (full suite on the final head): met, with my own runs.**
- Load rule: before the runs the 1-minute load was 8.05 and 4.86, both at or under 10. Before the runs, a `ps -eo pid,args` check found nothing on 7045/9952. Servers were started and asserted with `start-servers.sh` / `assert-phase.sh` (`PASS servers`), and stopped with `stop-servers.sh`.
- **Run 1** (`skeptic-full-suite.log`, header `head=b5e12edd1... DEV_PORT=7045 BACKEND_PORT=9952 dirty=0`): `299 passed`, 4 failed, `exit=1`.
  - All 4 failures fell in one window (tests #238-241): `page.goto` waiting for `"load"` hit the 30s test timeout, plus one consequent `apiRequestContext.post: ... closed`.
  - Specs: `hel516-palette-quick-create` :237/:272 and `hel519-recent-navigation` :73/:92. Neither imports `webFonts.ts`, and neither is touched by this change.
  - Re-run of both files (`skeptic-rerun-516-519.log`): `18 passed`, `exit=0`.
- **Run 2, a full re-run** (`skeptic-full-suite-r2.log`, header `cwd=.../hel-1613 head=b5e12edd143fa217ad650852dbadb200df9e3604 DEV_PORT=7045 BACKEND_PORT=9952 load=4.86 dirty=0`): **`303 passed (18.7m)`, `exit=0`**.
- Run 1 was an unstable measurement, not a defect. That matches the evaluator's `eval-full-suite.log` (head 792a907, `303 passed`, code identical to b5e12edd1).
- About the executor's committed-tree `evidence/full-suite.log` (`303 passed (13.6m)`): it has **no header**, so it does not show which head, paths or ports it ran against. I did not rely on it. AC5 rests on my run 2, plus the evaluator's headed run.

**Gitignored evidence.**
- `*.log` is ignored (`.gitignore:27`, confirmed by `git check-ignore -v`). Every `evidence/*.log` cited by `probes.md` and `sweep.md` is untracked and will disappear at worktree cleanup.
- My own logs are in the scratch dir. `persist-evidence.sh` refused them (`FAIL source is not inside any git working tree`), so their load-bearing lines are quoted inline above.
- The durable record of the evidence is the tracked `.md` files and the scratch `.txt` sources. That is a durability weakness, not a correctness defect, and HEL-1606 shipped the same way.

**Mtime evidence.** No conclusion here rests on mtime ordering. Every run is identified by an in-file `head=` header. No gate defect to record.

**UI review.** N/A: there is no `frontend/**` change.

### Verdict: CONFIRM

### Non-blocking notes
- `evidence/full-suite.log` (executor) has no cwd, head or ports header. It should not be cited as AC5 proof in the PR. Cite the evaluator's or this skeptic's headed runs.
- File follow-ups (the plan promises them; I did not check whether they exist): the hel1510 0.1px flake (the modal entrance animation, measured but not reproduced) and the hel813 768 Connectors flake, which is still unexplained. My run 1 also hit a transient cluster of `page.goto` "load" hangs (4 tests, about 1 minute). It may be the font-pending load-event stall the probes observed, but I have not shown that.
- hel1444's 4 converted tests now depend hard on the Google Fonts stylesheet applying: `waitForWebFonts` throws after 10s if `link.media` never becomes `all`. hel1605 and hel1574 already have the same dependency through HEL-1606, so this is not new risk. It does widen the blast radius if the CDN is unreachable in CI.
- The evaluator's suggestion stands: commit the current mixed-state preload (`FONT_FIRST_ON_TIMEOUT` / `FONT_FIRST_HOLD_FAMILY`). The committed `fontfirst-preload.cjs.txt` is an older version.
