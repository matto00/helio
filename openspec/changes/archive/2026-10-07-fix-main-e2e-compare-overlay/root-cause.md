# HEL-1373 root-cause and classification record

## hel1350 (tasks 1.1-1.3, AC1)
- (a) Unmodified main spec (`HEAD~1` spec + `HEAD~1` Select) run locally, light+dark, trace on: **passes** (2 passed; log `hel1350-unmodified-main-spec.log`, trace under `e2e-evidence/HEL-1373/red-unmodified-main/`). The CI hang is placement-dependent: it needs the Compare trigger low in the viewport, which locally only happens if scroll alignment lands there.
- (b) CI trace (`art1350/tr/1-trace.trace`, run 37703155327): the Compare-trigger click logged `element is not stable` then `retrying click action` (Playwright re-aligns the element, bottom of the sheet scroll area), then "7 days" option click: `element is outside of the viewport`, retried ~273 times to the 150s timeout. The spec now forces that placement (scrollIntoView block:end, poll until stable) so the case is deterministic.
- Root cause: `.ui-select__panel` is `position: fixed` opening below the trigger with no viewport awareness, so a trigger near the bottom edge puts options past the 900px viewport where neither scrolling nor the listbox's own scroll can reach them.
- Red on main, with the new spec: both legs fail at `listbox bottom inside the viewport` (981 > 900); trace+screenshots persisted in `e2e-evidence/HEL-1373/red-new-spec-main-select/`. Log: `hel1350-red-main-2.log`. Green on the fix: 2 passed, screenshots `e2e-evidence/HEL-1373/compare-listbox-open-{light,dark}.png`.
- (c) Bisection (HEL-1331 `HistoryPayloadsField` / HEL-1285 +"Previous" / HEL-1366) was NOT performed. Reason: the fix and the proof do not depend on which commit tipped CI's layout over the edge; any extra sheet height or option reaches the same defect, and the red/green is on the product behaviour (listbox inside viewport). HEL-1366 (SSE ordering) is not implicated: all setup calls in the CI trace succeeded and the failure is a pure layout retry loop. HEL-1331/1285 added height/an option to the same sheet and are plausible tippers (unproven).

## hel1351 (tasks 2.1-2.2, AC2, C1)
Date dependence reproduced 2026-10-08T03:1xZ with the OLD whole-card `/\b(15|7)\b/` assertion (HEAD~1 spec), browser zone via `TZ`:
- `TZ=America/Los_Angeles` (renders 10/7): PASS. Full `tallCard.textContent()`: `HEL-1351 Talleastsum(amount)15vs 7d11InspectNothing selectedClick a chart element to inspect its underlying rows.CloseHEL-1351 TalloutputoutputUpdated 10/7/2026`; match `["7","7"]` = the day-of-month in `Updated 10/7/2026` (`15vs`/`7d` have no word boundary, so the tooltip value never matched).
- `TZ=UTC` (renders 10/8): FAIL. Same text but `Updated 10/8/2026`; match `null`.
- Logs: `hel1351-old-America_Los_Angeles.log`, `hel1351-old-UTC.log` (scratchpad/logs). The label is the server-assigned `lastUpdated` formatted in the browser zone, so CI (UTC) flipped at 00:00Z. The old assertion never proved the 15.
- New assertion green under both zones (evaluator: PDT and `TZ=UTC` runs).

C1 mutation record: wrong-value mutation (expect 10) red; value-7 mutation red WITH the card containing `Updated 10/7/2026` (evaluator-cited `error-context.md` of `zz-mut-dateleak`, lines 97/114/145): the old date-leak path was present and the assertion stayed red. The `^east` anchor is a second defence, so the run does not isolate the scoping alone.

## Decision 2 grep
`grep -nE '\\b\(?[0-9]' e2e/*.ts` -> no hits. Remaining whole-card `textContent()` sites assert label text, not digits: hel1275:223, hel1277:312/317, hel1350:214/227. No follow-up needed.

## PanelCard.test.tsx 3-vs-2 (task 3.1, AC4)
Classified as HEL-1215's known flake / timing sensitivity, not related to this change: PanelCard does not use the `ui/Select` component or the chart tooltip option; the test's own comment (lines ~62-75) says an indeterminate microtask tick can cause a data-driven extra `PanelCardBody` re-render. Bounded repeats: the file alone 5x (35/35 each) plus 4 full-suite runs (463 suites, 4891 tests) all passed; the observation did not recur.

## Test-data residue (CR5)
20 users (14 from the executor's logs, 6 evaluator-listed) were identified by exact id from run logs, verified to be `hel135x-*@example.test` free-tier rows, and deleted by exact id (including their `pipeline_run_rate_window` rows). Count remaining: 0. Specs' lack of user cleanup predates this change (follow-up candidate).
