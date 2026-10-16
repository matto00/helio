## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed HEAD:** `b5e12edd143fa217ad650852dbadb200df9e3604`.
- **Review base:** `67c434c6b01f9b91681870488975be5ca370c896`.
- **What changed since cycle 1:** commit b5e12edd1 touches only evidence and planning files (`sweep-command.sh`, `sweep-hits.txt`, `sweep-hits-v1-dom-only.txt`, `sweep.md`, `evaluation-1.md`).
  - `git diff 792a90769..HEAD -- e2e frontend backend playwright.config.ts package.json` is empty.
  - `git diff 1ab7a534e..HEAD -- e2e/` is empty.
- **Scratch logs:** this cycle's runs are in `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1613/evaluator/c2-*.log`. Their key lines are quoted inline below.

### Phase 1: Spec Review — PASS

**CR1 (AC2, hel1512 missing from the sweep): resolved.**

- **The new sweep reproduces exactly.** I re-ran the v2 grep with `git grep` on 792a90769: 218 lines in 41 files, identical to `sweep-hits.txt` (`diff`: no output).
  - It adds `getBoundingRect|measureText|getTextRect|getBBox|getComputedTextLength|createRange`.
  - hel1512 is now classified ASSERTS-GEOMETRY.
  - hel1311 is also classified. Its `poly.getBoundingRect()` reads the visualMap colour bar, which is a shape, not text, so it is font-insensitive.
- **The executor's 8 hel1512 logs agree with sweep.md.** Each passes all 4 tests (`4 passed`, `exit=0`), and each starts with a `### cwd=...hel-1613 head=792a907... DEV_PORT=7045 BACKEND_PORT=9952 start=... env=...` header.
  - The `env=` field is not truncated. It records the mode, for example `FONT_FIRST_ON_TIMEOUT=1500 FONT_FIRST_N=100000 FONT_FIRST=1 FONT_FIRST_HOLD_FAMILY=JetBrains Mono`.
  - The 8 logs ran between 10:49:27 and about 10:55.
  - hist10 minGap at 1504px is 16.75 in A, C, D, E and all three F runs, and 14.849 in B (fallback-only). At 375px it is 13.035 in every state.
- **My own reproduction** used the executor's mixed-state preload (`c2-fontfirst.cjs`, copied from its scratch dir). The servers ran on 7045/9952, with 2 workers and `nice -n 19`.
  - **E (`c2-hel1512-E.log`):** the stylesheet is withheld until the spec's `waitForTimeout(1500)` at `:299`. ECharts therefore lays the charts out in the fallback face, and the labels are measured after the web faces apply. Result: 4 releases logged, hist10 `16.75 16.75 13.035 13.035`, `4 passed`, `exit=0`.
  - **E with only JetBrains Mono held (`c2-hel1512-E-hold-JetBrains_Mono.log`):** JetBrains Mono is the axis-label face. Result: same values, `4 passed`, `exit=0`.
  - **Fallback-only and late swap:** these are my cycle-1 runs on the same e2e code. They gave 14.849 and 16.75, both 4 passed.
- **Leaving hel1512 unchanged is consistent with C3/D3.**
  - No state turns it red.
  - The tightest margin to its 14px floor is 0.85px, under fallback-only, and sweep.md records it.
  - The reverse mixed state (laid out in the web face, measured in the fallback) is not reachable: a loaded face does not unload.

**CR2 (C2, logs without path or ports): resolved for the new logs.** Every new hel1512 log carries the header. Cycle 1 already accepted that the older logs would not be regenerated, because my own runs covered them.

Other checks:
- **AC1 and AC3:** unchanged from cycle 1, which passed them. hel1444 has a same-mode red/green pair, and hel1510/hel813 were refuted.
- **AC4:** no retries or raised timeouts. The code is unchanged.
- **AC5, full suite on the final head:** covered by my own cycle-1 run on 792a90769 (`eval-full-suite.log`): `303 passed (15.8m)`, `exit=0`, header `cwd=...hel-1613 head=792a907... DEV_PORT=7045 BACKEND_PORT=9952`. The e2e, frontend and backend code is byte-identical between 792a90769 and b5e12edd1, as shown by the empty diff above.
- **Constraints:** C1-C5 are honored.

### Phase 2: Code Review — PASS

There is no code change since cycle 1, so the cycle-1 gate results still apply: lint, format:check and `tsc -p e2e/tsconfig.json` all exit 0. The only changes are to evidence files, and the sweep command in them is accurate.

Load rule: before starting the servers, `/proc/loadavg` showed 18.48 (1-minute). I waited until 11:05:19, when it read 9.76, then ran.

### Phase 3: UI Review — N/A

No UI-trigger files changed.

### Overall: PASS

### Non-blocking Suggestions

- **Commit the new forced-delay preload.** The preload behind states E and F (`FONT_FIRST_ON_TIMEOUT`, `FONT_FIRST_HOLD_FAMILY`) exists only in the executor's session scratch dir (`scratchpad/hel1613/executor/hel1613-fontfirst.cjs`). The committed `evidence/scratch/fontfirst-preload.cjs.txt` is the older version, without those modes. Commit the current one as `.txt`, as was done for the other scratch files, so the mixed states stay reproducible.
- **Make the cited logs durable.** `*.log` is gitignored (`.gitignore:27`), so every `evidence/*.log` that sweep.md and probes.md cite is untracked. They will disappear with the worktree at cleanup. HEL-1606 shipped the same way, so this is precedent, not a regression. Still, consider `git add -f` for the load-bearing logs, or persisting them with `persist-evidence.sh`: the hel1444 red/green, the hel1512 A-F runs and full-suite.
