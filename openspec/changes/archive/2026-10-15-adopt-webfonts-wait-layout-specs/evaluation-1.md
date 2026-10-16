## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `792a907695ff67ad0a3c070af282a7679797543b`. Review base (resolve-review-base.sh): `67c434c6b01f9b91681870488975be5ca370c896`.
Code diff: `e2e/support/webFonts.ts` (scope `closest("tr") ?? target`, doc comment, timeout message) and
`e2e/hel1444-footnoted-chart-canvas.spec.ts` (+`waitForWebFonts(card)` before `measure(card)`/`yAxisProbe(card)`).
Everything else is under `openspec/changes/adopt-webfonts-wait-layout-specs/`.

Evaluator scratch logs (outside the repo, cited inline with their key lines):
`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1613/evaluator/eval-*.log`.

### Phase 1: Spec Review — FAIL

| Check | Result |
| --- | --- |
| AC1 probe hel1510 / hel813 surface 7 | PASS. 50 probe logs: 49 green, 1 failure (`probe-813-all-release-after-cta-nowait.log`, the `route.fetch ... closed` gate artefact, re-run 3x green). hel1510 `limit` varies 871.8-872.4 in every state, fallback-only included; hel813 heights are fixed. Both REFUTED and left unchanged, as C3 requires. |
| AC2 sweep complete | **FAIL. See CR1.** The recorded grep reproduces exactly: I re-ran it with `git grep` on base 67c434c6b, 210 lines, identical to `sweep-hits.txt`, 40 files. It includes every term the design-gate skeptic named (`toBeInViewport`, `scrollHeight`, `clientHeight`, `offsetHeight`, `offsetTop`, `elementFromPoint`, `scrollTop`, `getClientRects`). It still misses a spec that asserts pixel geometry: `e2e/hel1512-category-axis-labels.spec.ts`. That spec measures ECharts label boxes with `el.getBoundingRect()` (`:73`), which the grep's `getBoundingClientRect` does not match, and canvas `ctx.measureText` (`:82`). It asserts `overlaps` empty (`:317`) and `minGap + 0.05 >= 14` (`:328-331`). It is not in `sweep.md` and was not in any forced-state run (`scratch/sweepfiles.txt.txt`). |
| AC3 converted spec red then green | PASS for hel1444. I reproduced it in the same mode myself (below). |
| AC4 no retries or raised timeouts | PASS. The diff adds no `retries`, `setTimeout`/`timeout:` change, `skip` or `fixme`. `FONT_WAIT_MS` is unchanged. |
| AC5 full suite on final head | PASS. My own run: 303 passed (below). |
| Tasks all done and matching | PASS. |
| Scope creep | PASS. None. |
| Constraints C1-C5 | C1, C3, C4, C5 PASS. C4: the wait is per card, scoped to the card, before measuring, and not inside a retry. **C2 partial, see CR2.** |

### Phase 2: Code Review — PASS

Gates, run fresh in the worktree. The changed files are `e2e/**`, so no `frontend/**` or `backend/**` gate is triggered. I ran the root gates that cover e2e:

- `npm run lint` (`eslint . --max-warnings=0`): exit 0
- `npm run format:check`: "All matched files use Prettier code style!", exit 0
- `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0

Full e2e suite, my run (`eval-full-suite.log`):

- Header: `cwd=/home/matt/Development/helio/.claude/worktrees/task/adopt-webfonts-wait-layout-specs/hel-1613 head=792a907695ff67ad0a3c070af282a7679797543b DEV_PORT=7045 BACKEND_PORT=9952 start=10:31:14`
- Result: `Running 303 tests using 2 workers` / `303 passed (15.8m)` / `exit=0 end=10:47:03`
- Run with `nice -n 19` and `--workers=2`, using servers started by `start-servers.sh` and stopped by `stop-servers.sh`.

Code findings:

- **Helper generalisation.** It is backward compatible for every real caller. Row callers pass a button inside a `<tr>`, so `closest("tr")` is unchanged. The only other caller is `rowDeleteGesture.ts:26`. One behaviour does change, by design (D4): a target outside any `<tr>` now settles on its own subtree, where before it always timed out. No leftover `rowFamilies` or "target row" references remain.
- **hel1444 conversion.** The wait sits after the existing 200ms settle and before both `measure(card)` and `yAxisProbe(card)`. The comment states the 57 vs 58px reason. No dead code. Typing is unchanged.
- **Fallback-only behaviour.** The question was whether failing on fallback-only fonts is acceptable. **It is.**
  - HEL-1606 design D3 (archive `design.md:43-48`, `:79`) makes "stylesheet-never-applied fails loudly" the helper's contract.
  - The pre-conversion test already fails in that state, on all 4 variants: 58px against a 57.5 limit (`redgreen-hel1444-base-RED.log`).
  - So the conversion adds no new failure surface. A Google Fonts outage was already red here. It now fails with a diagnostic naming the cause instead of a misleading geometry miss.
  - My reproduction (`eval-1444-conv-cssblock.log`): `waitForWebFonts: web fonts did not settle within 10000ms for the measured scope: {"settled":false,"stylesheetMedia":"print",...}` at `hel-1613/e2e/hel1444-footnoted-chart-canvas.spec.ts:407:11`, 1 failed.

Independent same-mode red/green for hel1444 (`@1504px light`). Both runs used the same injection: `FONT_FIRST=1 FONT_FIRST_N=100000 FONT_FIRST_ASK_DELAY_MS=1500`, with fonts withheld until the spec asks for them, then released concurrently.

- Base spec (`git show 67c434c6b:` copy, run from the worktree, `eval-1444-base-held.log`): bars `58px (main 57)` x4, failing at `hel1444-base.spec.ts:465:16`, `1 failed`. **RED.**
- Converted spec (`eval-1444-conv-held.log`): `[fontfirst] releasing web fonts after measurement #100000`, bars `57px (main 57)` x4, `1 passed`. **GREEN.**

This also closes the gap in the executor's evidence. Its red run (fallback-only) and green runs (fontfirst N=1, and N=100000 with concurrent release) used different modes. Its own `redgreen-hel1444-base-N14.log` shows base GREEN under fontfirst N=14. The pair above is in the same mode.

Overlap window (08:11-08:42, the other lane's suite). I checked this with self-authenticating evidence: the epoch-ms stamps the tests themselves embed in their throwaway-user names, not file mtimes.

| Logs | Window |
| --- | --- |
| All `probe-*.log` | 07:58:03-08:07:12 |
| `forced-sweep-fontfirst-n1.log` | 08:49:11-08:59:48 |
| `redgreen-*.log` | 09:06:38-09:10:59 |
| `row-callers-hel1605-hel1574.log` | 09:11:30-09:12:23 |
| `full-suite.log` | 09:19:24-09:32:50 |
| `forced-sweep-late-1500.log` | 09:39:08-09:59:12 |
| `forced-sweep-css-block.log` | 10:06:01-10:18:03 |

None falls inside 08:11-08:42. The file mtimes agree, but I relied on the embedded stamps, not the mtimes.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: FAIL

### Change Requests

1. **AC2: the sweep misses `e2e/hel1512-category-axis-labels.spec.ts`, and its measurement is font-sensitive.**
   - **Why it was missed.** The spec asserts canvas-label pixel geometry: overlap boxes at `:100-109` and `:317`, and an absolute `minGap >= 14` floor at `:322-331`. It reads them through ECharts `getBoundingRect` and canvas `measureText`, and neither term is in the recorded grep.
   - **My measurements on HEAD** (unchanged spec, servers 7045/9952, workers 2, nice 19). With the stylesheet blocked (`eval-hel1512-css-block.log`): `hist10 minGap 14.849` at 1504 (floor 14), 4 passed. With the late swap at 1500ms (`eval-hel1512-late_1500_1500.log`): `hist10 minGap 16.75`, 4 passed.
   - **What that shows.** The asserted value moves by 1.9px with the face and sits 0.85px above its floor in fallback. Also, `full-suite.log:830+` shows `dark-1504 hist20 minGap 15.75` in one run against 22.75 in another.
   - **Required changes:**
     - Add `getBoundingRect|measureText` (canvas/ECharts text geometry) to the sweep command in `evidence/sweep-command.sh` and `sweep.md`, and re-record `sweep-hits.txt`.
     - Classify hel1512 and any other new hits.
     - Run hel1512 on base through the D1/C5 states: fallback-only; late swap; a mixed state where the fonts are released after the chart canvases are visible but before `axisLabels`, so ECharts lays out in one face and the test measures in the other; and per family (JetBrains Mono at least).
     - If any state is red, convert it with red/green proof per C3/D5. Note that ECharts does not re-lay out on font load, so the wait likely has to precede the chart render, not just the measurement.
     - If every state stays green, record it in `sweep.md` as "font-insensitive under delay (values ...)", using the measured values above.

2. **C2: most cited logs do not show this worktree's path or ports.**
   - `probe-*.log`, `full-suite.log`, `forced-sweep-fontfirst-n1.log`, `redgreen-hel1444-converted-GREEN*.log` and `row-callers-hel1605-hel1574.log` contain no `hel-1613` path, and only `full-suite.log` mentions 7045 or 9952. Attribution currently rests on the committed `scratch/run.sh.txt` and `sweeprun.sh.txt`.
   - Every log written for CR1, and any re-run you cite, must start with a header line: cwd, `git rev-parse HEAD`, DEV_PORT and BACKEND_PORT (for example `echo "### cwd=$PWD head=$(git rev-parse HEAD) DEV_PORT=7045 BACKEND_PORT=9952" > log`).
   - The existing logs do not need regenerating: my own runs above independently cover the full suite and the hel1444 red/green, with this worktree's path and ports.

### Non-blocking Suggestions

- `sweep.md` could cite a same-mode red/green pair for hel1444 (held fonts, base red / converted green), like the one above. It would replace the fallback-only red alongside the fontfirst green.
- `hel1510`: the competing cause the probes measured (the modal entrance animation moving content-right by about 0.5px in the first ~100ms) is worth a follow-up ticket, as `probes.md` already says.
