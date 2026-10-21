## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `7b402cd5f0bc32d6477c9d1e7e8aa93a5b290dba`. The change since cycle 2 (`a5e79b981`) is
`e2e/hel1683-regex-main-thread.spec.ts` (lines 160-171) plus report and handoff files. No `frontend/**` or `backend/**`
file changed. Base resolved live: `4f729eed7`.

### Phase 1: Spec Review — PASS
Issues: none. Cycle 2's Change Request 1 is addressed. The probe now passes on either of the server's two results for the step,
so it no longer depends on how fast the server is. That matches design D5a ("the step then shows the server result for that
step"). The implementation is unchanged since cycle 1.

### Phase 2: Code Review — PASS
Gates run fresh:
- `npm run lint`, `format:check`, `typecheck` and `check:e2e-types` all exit 0.
- Jest and the frontend build were not re-run. No `frontend/**` file changed since `a5e79b981`, where I ran them green in
  cycle 2: root 524 tests, frontend 9340 tests, build OK.

e2e under the e2e lock:
- 2 sequential runs with `--workers=1`: 2/2 passed.
- `--repeat-each=6 --workers=2`: 6/6 passed.
- Every probe's longest main-thread task was 0.0 ms, and every probe sent a draft-preview request.

The orchestrator raised three questions. I checked each against the running app (Chromium, 7115/10022):

1. **Could "Preview is live" already be visible from before the probe edit? No.**
   I recorded a timeline in the browser on a 2-row pipeline with the saved pattern `(x)`, using a MutationObserver plus a
   fetch hook. Times are from the start of recording:

   | Time | Event | Caption | Out cells |
   | --- | --- | --- | --- |
   | 2833 ms | Control `(a+)!` entered | "live" | client values, "a"x28 |
   | 4894 ms | Probe entered | | |
   | 4906 ms | 12 ms after the probe | "updating" | |
   | 5256 ms | Draft-preview request sent | | |
   | 5892 ms | Response 200 | | |
   | 5899 ms | Server result shown | "live" | server nulls ("—") |

   The control's "live" is replaced within about 12 ms of the probe edit. The spec only reaches the `.or()` after
   `waitForTimeout(3000)` and an assertion that the draft-preview request was sent. So the "live" it can match is the server's
   new result, never the control's. If the server is slow, the caption stays "updating", which neither branch matches, and the
   assertion waits up to 15 s.
2. **Does the time-budget locator match the server's real message, and is that branch really exercised? Yes.**
   I forced the probe's own budget branch with an 8-row source (8 x ~0.31 s per cell is over the 2 s budget). The step then
   showed caption "Preview is stale" and the paragraph:
   `stringops operation 'extractRegex' pattern '^(.*.*.*.*.*.*.*.*x)' exceeded the 2 s regex time budget for this step Showing its last good rows.`
   - The spec's locator, written as the equivalent selector
     `internal:text=/pattern '.*' exceeded the 2 s regex time budget for this step/ >> internal:has-text="^(.*.*.*.*.*.*.*.*x)"i >> nth=0`,
     matched exactly that paragraph.
   - Negative control: the same selector filtered on the overrun pattern instead matched no elements. The filter therefore
     selects the probe step's error specifically.
   - In the budget state the caption is "stale", not "live". So `live.isVisible()` is false, the "2 rows" check is skipped,
     and the overrun step's later error cannot satisfy the probe's branch.
3. **Does any other assertion depend on timing?** Nothing new beyond cycle 2's analysis:
   - The overrun branch only gets more certain on slower machines: raw Java takes 2.6-3.0 s per cell with no time box at all.
   - The control's 1.5 s wait can only cause a false pass, not a flake.

### Phase 3: UI Review — PASS
No UI code changed. The e2e runs and the manual Chromium checks above exercised the control, probe (both branches) and
overrun flows. The only console error was the existing `404` for the pipeline's schedule on page load.

Test data from this cycle was deleted by exact id:
- Pipelines a848abff-2b94-4aed-8876-8bad1b3b94d2 and 42e4be34-b313-4e13-8585-7357e6f30815, via API (204 each).
- Sources 443c134c-b378-409e-b126-f7908e68ebe0 and ee1fdb2c-948e-41d9-84b8-f4cc0b9515f5, via API (204 each).
- User bacc2a11-bfcf-44b5-8a23-832c1a2832e4, via `buildUserDeleteSql` with the exact id and email.
- The e2e users were removed by the run's global teardown.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- In the "live" branch, the out cells now tell the server's result apart from the client's: the control leaves "a"x28 and the
  server's probe result is null ("—"). Asserting that no cell reads "a"x28 after the probe, or that both out cells read "—",
  would make the branch check content as well as the caption.
- The comment at spec line 9 still says "~165 ms per cell". My cycle-2 Chromium measurements were about 180 ms per cell when
  freshly compiled and about 60 ms once V8 has warmed the regex up.
