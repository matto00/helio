## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `2e12cfc0fd33b2deee2f11a43cc8a81ba6fc1b4c`. The base is `79288722ac0e0c73bb0a6dc2984588aead783767`, resolved live with
`resolve-review-base.sh`. The branch has 2 commits: ce18230ca (red tests and before-heights) and 2e12cfc0f (CSS fix,
jest guard, evidence). The working tree was clean.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (blank space gone at 390/768/1100, light and dark, test fails first):
  - The e2e geometry assertion loops owner/editor x light/dark x 390/768/1100.
  - Commit ordering confirms `red-run.txt` was committed in ce18230ca, before the CSS change in 2e12cfc0f.
  - I measured it myself in the live app (see Phase 3).
- AC2 (message still shows and is announced): the new test checks that both messages land on the same element
  handle, with the role kept, visible, and `position: static` in flow below the content. I also checked it in the
  live app.
- AC3 (other kinds keep their height): I re-measured this myself (Phase 2). Every non-counter card changed by 0.0 px
  at every width.
- Ticket constraints honoured. Both regions stay mounted; there is no conditional mount, no `display:none` and no
  `visibility:hidden`. Markup is unchanged: `FormPanelView.tsx` is not in the diff.
- tasks.md is all ticked and matches the diff. Scope is limited to `CounterControl.css`, a guard test and the
  extended hel1791 spec. There is no API or schema impact.
- Workflow-state constraints C1–C15 are honoured in the diff. Evidence lives in the change dir; scratch output is
  outside the worktree.

### Phase 2: Code Review — PASS
Issues: none.

Gates, all re-run fresh by me in WORKTREE_PATH (outputs in `/home/matt/Development/helio/.concertino/scratch/HEL-1804/eval-*.txt`):

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (3 workers) | root 71/71 suites, 621 tests; frontend 903/903 suites, 10483 tests; all pass |
| `npm --prefix frontend run build` | exit 0 |
| `CounterControl.css.test.ts` alone | 3/3 pass |
| Playwright, 2 workers, lane DB, DEV_PORT=7236 | 24/24 pass |

- The Playwright batch covered `hel1791-compact-counter-stack-height` (6) plus the regression specs `hel1088`,
  `hel1087`, `hel1095`, `hel1169` and `hel1090` (18).
- Per-kind heights from my own run (`HEL1791_LABEL=eval`), compared with the committed `heights-before.json.txt`:
  - Output, Text, Markdown, Image, divider and Multi-field form: +0.0 px at 390, 768 and 1100.
  - Counter card: -32.0 px at all three widths.
  - This reproduces the executor's `heights-diff.txt`.
- I did not re-run the mutations: that would modify code, which this role does not do. The committed
  `mutation-M1.txt` / `mutation-M2.txt` transcripts are consistent with the selector logic:
  - M1 (`:empty` → `:not(*)`) gives back the 48 px band.
  - M2 makes the status `position: absolute`, so the `in flow` assertion fails.
- Code quality:
  - The CSS rule is narrowly scoped to direct children of `.form-panel-view__compact-counter`.
  - Comments state the why and the rejected alternatives inline, with the HEL-N prefix (CONTRIBUTING "Ticket
    references").
  - No magic values: the test reads padding with `getComputedStyle`.
  - The guard is labelled a guard and uses no unsafe escape hatches.
  - No dead code.
  - DESIGN.md: no token, spacing or type values are added, so no [mechanical] rule is touched.

### Phase 3: UI Review — PASS
Issues: none.

Servers were reused after I checked them:
- Backend PID 1898546 and frontend PID 1902959 both have their `/proc/<pid>/cwd` inside this worktree's
  `backend/` and `frontend/`.
- `/health` returns 200.
- Vite serves `CounterControl.css` containing the HEL-1804 rule.

Shared MCP browser: no open dialog, and every check ran on port 7236. I used a throwaway owner on lane DB
`helio_hel1804` with a text panel and a compact counter panel.

Live-app results:

- **Stack layout at 390, 768 and 1100 px (sidebar present), light and dark:**
  - The space below the counter row is 16 px, equal to `padding-bottom` 16px.
  - Both regions are `position: absolute` while empty, `display: block`, `visibility: visible`, 0x0.
  - No horizontal overflow.
- **Accessibility tree:** the card exposes the `alert` and `status` nodes while they are empty.
- **Happy path:** the `+` step shows "The row was added." in the status region. It is `position: static`, its top is
  16 px below the counter row, it sits inside the layout, and the card grows from 179.2 px to 210.2 px.
- **Unhappy path (rejected step → alert in flow):** covered by the new e2e test, which passed in my run.
- **Desktop grid at 1440:**
  - The counter row is 82 px from the layout top and 59 px from the bottom (the intended 16 px re-centring from
    design D2).
  - The empty alert is a 0x0 box inside the layout.
  - No overflow.
- **Console:** no errors or warnings from my port-7236 page. The two buffered errors in the shared browser came from
  port 7241, another lane.

The claims above rest on numeric `getBoundingClientRect` / `getComputedStyle` readings, not on screenshots or mtime
ordering.

Test residue: I deleted the throwaway dashboard (0858efd1-eda4-4ded-9b40-fd6dac8e5c75) and source
(2d5f4573-9436-4836-b06c-c81bfbe339b8) through the API. The lane-DB user 3c4471f2-2545-4739-a3e6-d5a5e3546f8d
(hel1804-eval-1795313909848@example.test) remains, for exact-id cleanup with the lane's other e2e users.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `e2e/hel1791-compact-counter-stack-height.spec.ts`, alert step:
  - `expectRegionInFlow(".form-panel-view__alert", "alert", /\S/)` accepts any text.
  - Matching the mocked `HEL1804 rejected step` text, or the client's mapped message for a 400, would prove the
    alert came from this step rather than any earlier text.
- The red run only records the 390 px failure for each test, because the width loop stops at the first failed
  assertion. 768 and 1100 are covered by the green run and the heights diff, not by their own red result. This is
  acceptable, but worth knowing.
