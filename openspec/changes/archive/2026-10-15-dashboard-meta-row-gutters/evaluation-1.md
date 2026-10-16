## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: f69aea31b39c381ffac707b8ae37648a4f4d09a9. Base: 60086f02bb5b1ee48f2246bc09e3e66349199585 (resolved live with resolve-review-base.sh).
Scope: only the unblocked work, tasks 1.1, 1.2, 1.3 and 3.1. Tasks 2.x, 3.2-3.4, 4.x and 5.1 are blocked on escalation HEL-1576-1792053980784-c95b08 (design.md D0) and were not judged for absence.

### Phase 1: Spec Review — FAIL

The implementation follows the design-gate-confirmed plan (skeptic-design-3.md CONFIRM). The skeptic's open note about skipping empty `outputId` is implemented and tested.

| Check | Result |
|---|---|
| AC3 (gutter is a token value and matches DESIGN.md) | PASS. `GRID_GUTTER_PX = 12` with a test that parses `theme.css` `--space-3`. DESIGN.md §9 bullet added. Measured live: 12px horizontal and vertical. |
| ACs 1, 2, 4 | Blocked by design and out of scope for this review. |
| No AC reinterpreted | PASS |
| Tasks marked done match the implementation | **FAIL.** See CR1. Task 1.2 is marked `[x]` but one hard-coded grid-margin `18` it names is still there. |
| Scope creep | PASS |
| Regressions | PASS (full jest is green, see Phase 2) |
| API contracts / schemas | N/A (frontend only) |
| Planning artifacts reflect implemented behaviour | **FAIL.** See CR2 (design.md D7 describes a CSS custom property that was not built). |
| CONSTRAINTS C1-C5 honoured | PASS. C1: no layout writes. C3: no App.tsx, App.css or sections.ts edits. C2/C4: my own runs respected the caps. C5 applies only before Delivery. |

Issues:
- **CR1:** `openspec/specs/panel-content-sizing/spec.md:15` (Requirement "Panel card container sizing baseline", scenario "Panel card at default grid size") still says `rowHeight=52, margin=18 ... approximately 314px`. The delta `specs/panel-content-sizing/spec.md` modifies only "Grid layout sizing baseline". Archiving would therefore leave a stale margin of 18 in the main spec. Task 1.2 named this spec explicitly. The number 314 was already wrong (5·52+4·18 = 332), so the fix also corrects it.
- **CR2:** design.md D7 says "The grid container also exposes it as CSS (`--panel-grid-gutter: var(--space-3)`) for any CSS consumer (skeleton)". The diff contains no such property; `grep -rn panel-grid-gutter frontend/src` finds nothing. The skeleton does not need it, because `DesktopPanelGridSkeleton.tsx:53` reads `panelGridConfig.margin` directly.

### Phase 2: Code Review — PASS

I ran every gate myself in WORKTREE_PATH with `nice -n 19` and jest capped at 3 workers:
- `npm run lint`: exit 0 (eslint `--max-warnings=0`)
- `npm run format:check`: exit 0 ("All matched files use Prettier code style!")
- `npm run typecheck`: exit 0
- `npm test`: exit 0. Root: 51 suites / 469 tests passed. Frontend: 613 suites / 7288 tests passed. `jest --listTests` from `frontend/` lists 613 paths, all under `/home/matt/Development/helio/.claude/worktrees/feature/dashboard-meta-row-gutters/HEL-1576/`.
- Targeted run (`useDashboardMeta|dashboardMeta|panelGridConfig|processedWidth|PanelGridSkeleton`): 7 suites / 47 tests passed. `--listTests` confirms every path is in this worktree.
- `npm --prefix frontend run build`: exit 0

Red-first evidence (`.concertino/runs/HEL-1576/evidence/`):
- `gutter-red.txt`: the drift test fails with Expected 13 / Received 12 when the constant is mutated.
- `useDashboardMeta-red.txt`: 9 mutations. 8 are killed by named tests: empty-outputId skip, per-id sequence, unsubscribe on unmount, terminal reload, failed read keeps old value, mount read skipped, source cap, oldest-run-wins. The executor honestly recorded one survivor, "no mounted guard" (21/21 pass). See the suggestions below; this does not block.

Checklist:
- CONTRIBUTING code quality: PASS. Imports are at the top and there are no inline qualifiers. File sizes are 148 lines for the hook and 99 for the derivation, under the ~250 budget.
- DESIGN mechanical rules: PASS. The gutter comes from `--space-3` and a test pins the JS mirror.
- DRY: PASS. Uses the shared `fetchOutputMeta`/`getOutputMetaCached` (which dedupe in-flight requests), `getPipelineById` and `subscribeToPipelineTerminal`.
- Readable and modular: PASS. A pure derivation sits in `state/dashboardMeta.ts` and I/O stays in the hook.
- Type safety: PASS. No `any`. There are two `eslint-disable-next-line react-hooks/exhaustive-deps` lines (`useDashboardMeta.ts:69` and `:144`). Each carries a reason, and each keys an effect on a joined-id string so it is stable.
- Error handling: PASS. A failed Output or pipeline read omits that contribution, per D2. A failed re-read drops the earlier value, covered by test e2.
- Tests meaningful: PASS. They cover (a)-(g), feeding-set add/remove, the held-Output path and the pure derivation cases, including singular count, never-run, failed-latest and "+N".
- No dead code or over-engineering: PASS. The hook is intentionally unmounted until task 3.2, as the plan states.
- Behaviour preserving: the gutter is a deliberate visual change, and saved layouts (grid units) are untouched.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` on 7008/9915, and `assert-phase.sh servers` printed PASS. I checked that the page URL was on port 7008 before every action and awaited `document.fonts.ready` before every measurement. I used the dev account and the "HEL-1576 scratch content-fit" dashboard.

- **1280, dark and light:** the desktop RGL grid renders 8 panels. Measured from the DOM, adjacent panels are 12px apart both horizontally and vertically (x 328→786 | 798, y 72→316 | 328). Every 4-row panel is 244px tall (4·52 + 3·12), and there is no document horizontal overflow. Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots/eval1-dark-1280.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots/eval1-light-1280.png`
- **1100, 820, 768 and 375, both themes:** with the context list at its default width, the content column is narrow enough that the existing mobile stack renders instead of RGL. This change does not touch that; the stack gap is `--space-3` = 12px, and there is no horizontal overflow at any width. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.eval-shots/eval1-light-820.png`. The desktop gutter therefore shows only where RGL renders (1280 here).
- **Console:** no errors from the dashboard flow after login. Errors seen and attributed elsewhere:
  - 401/403 lines came from my own unauthenticated API probes before login.
  - Two ECharts "Can't get DOM width" warnings fired during the viewport resize into the stack layout.
  - Three 502s on `/api/pipelines/:id/run-events` (the SSE fanout through the Vite proxy) appeared while the tab sat idle. Backend `/health` returned 200 at the same moment. This diff does not touch that code path, and the new hook is not mounted.
- **Content fit (D10a), including the form panel the executor reported:** I confirmed this live at 1280. In the form panel, `.panel-content--form` has `scrollHeight` 210 against `clientHeight` 141 and is a scroll container (`overflow-y: auto`). The executor's `before-form.png` shows the same scroll container already clipping at 18px. So the overflow already existed before this change; the gutter change takes 18px off the visible area (262→244). It adds no new scrollbar or new kind of clipping, and the submit button is still reachable by scrolling. D10a allows "fixed ... or reported", and the executor reported it. The fix belongs in the form panel's own min-height or CSS, not in `rowHeight`. It does not block this ticket; a follow-up is recommended below. The other panel kinds are clean: chart, metric, text, markdown, image and divider have no overflow, and the table's DataGrid scroller is its normal intended scroll.

Remaining checks (meta row, edit mode, undo/redo, accessible names for new controls) cover blocked scope; nothing in that UI exists yet to check.

### Overall: FAIL

The fixes are small artifact corrections. The code, tests, gates and live gutter are all sound.

### Change Requests
1. **Stale grid margin in the main spec (task 1.2 incomplete).** In `openspec/changes/dashboard-meta-row-gutters/specs/panel-content-sizing/spec.md`, add a `## MODIFIED Requirements` block for "Panel card container sizing baseline". Copy the full requirement from `openspec/specs/panel-content-sizing/spec.md:9-25`. Change the scenario at line 15 to "rendered at the default 5-row height (rowHeight=52, margin=12), giving 308px total height". Re-derive the "roughly 270px" figure in the THEN line from 308 instead of 314. Then run `grep -rn "margin=18\|\[18, 18\]\|× 18" openspec/specs/panel-content-sizing openspec/changes/dashboard-meta-row-gutters/specs` and confirm only the base spec's soon-superseded lines match.
2. **design.md D7 describes code that does not exist.** Either delete the sentence "The grid container also exposes it as CSS (`--panel-grid-gutter: var(--space-3)`) for any CSS consumer (skeleton)." (recommended: there is no CSS consumer, and `DesktopPanelGridSkeleton.tsx:53` reads `panelGridConfig.margin`), or implement the property and give it a consumer. Do not leave an unused custom property.

### Non-blocking Suggestions
- `frontend/src/features/panels/ui/grid/MobilePanelStack.css:8-9`: the comment now reads "rhythm replaces the desktop grid's margin:[12,12]", which no longer makes sense because both are 12. Reword it to say the stack and the desktop grid share the `--space-3` gutter.
- `useDashboardMeta.test.tsx` test (d): the "drops a late response" half cannot fail. React 18 ignores setState after unmount, and the executor's own mutation run shows that removing the `mounted` guard leaves 21/21 green. Either rename the assertion to what it proves (unsubscribe), or drop the `mounted` ref, since `feeding`/`requestSeq` plus React's own behaviour already cover it.
- Form panel at minimum height: open a follow-up ticket. The form already overflowed its 4-row cell before this change (content 210px in a 141px viewport at 12px gutters). Consider either a minimum height for form panels that matches their field count, or a compact form layout. Mention this in the PR body together with the before/after screenshots in `evidence/screenshots/content-fit/`.
