## Evaluation Report — Cycle 4 (evaluation-4.md): CR1 re-check only

Head reviewed: `5319977e4157e213720218678595da401bb490bf` (parent `55ff0e85d`, reviewed in evaluation-3.md).

Authorisation: I verified it in `events.jsonl` rather than relying on the orchestrator's message.
- Escalation `HEL-1583-1792204257038-108014` has `escalation.answered`, answer `extend-one-cycle`, `answer_source: human`.
- There is also an earlier `escalation.answer_discarded` event, 9 ms after the raise. The human answer came after it.
- The scope is limited to the mono fix.

### Phase 1: Spec Review — PASS
- **CR1 resolved.** `.dashboard-refresh-line` is now `font-family: var(--font-mono)` (`DashboardMetaRow.css`). The
  wrong "Sans (HANDOFF: no mono)" comment is corrected. This matches the spec delta (mono caption), D11, the ticket,
  HANDOFF.md:28 and DESIGN.md:382.
- The DESIGN.md §12 "Refreshed line" bullet now says `--font-mono` like the desktop meta row.
- **Scope check.** `git diff --stat 55ff0e85d..5319977e4` touches only the files below. Nothing outside the mono fix
  changed.

  | File | Change |
  |---|---|
  | `DashboardMetaRow.css` | one declaration and its comment |
  | `DashboardRefreshLine.test.tsx` | a new CSS pin |
  | `e2e/hel1583-glass-nav.spec.ts` | a computed-font assertion |
  | `DESIGN.md` | the §12 bullet |
  | change-dir `evaluation-3.md` | byte-identical to my persisted report |
  | 3 evidence txt files | red/green/mutation output |

### Phase 2: Code Review — PASS
- Gates, fresh runs at 5319977e4:
  - `npm run lint`: 0
  - `npm run format:check`: 0
  - `npm --prefix frontend run typecheck`: 0
  - related unit tests (`DashboardRefreshLine|DashboardMetaRow|dashboardMeta`, 2 workers, nice 19): 6 suites,
    80/80 pass
- **CSS pin.** It strips comments, extracts the `.dashboard-refresh-line` rule, and requires
  `font-family: var(--font-mono)` with no `--font-sans`. A revert to sans fails it. The executor's mutation evidence
  agrees: `refreshed-font-pin-mutation.txt` reads "1 failed, 7 passed".
- **e2e assertion.** It compares the line's computed `font-family` to a probe element's computed
  `var(--font-mono)` stack. This is not vacuous. `refreshed-font-red.txt` shows it failing on 55ff0e85d in both
  themes ("Schibsted Grotesk…" against "JetBrains Mono…"), and `refreshed-font-green.txt` shows it passing (2/2).

### Phase 3: UI Review — PASS
- Servers: `start-servers.sh` READY on 7015/9922 and `assert-phase.sh servers` PASS. I stopped them afterwards with
  `stop-servers.sh` (`STOPPED ports=7015,9922`).
- Refreshed-line e2e (`-g "refreshed line"`, DEV_PORT=7015, 2 workers): **2/2 passed**, and its 2 throwaway users
  were deleted.
- Live check on the running app at 375:
  - Light and dark: the line reads "refreshed N seconds ago", computed family `"JetBrains Mono"`, 12px.
  - `document.fonts.check('12px "JetBrains Mono"')` is true.
  - Desktop meta row at 1280 (dark): `.dashboard-meta-row__refresh` is `"JetBrains Mono"`, 12px, with the same text.
    The phone line is absent there, as intended.
- No console errors on the dashboard view.
- Screenshots (durable):
  - `/home/matt/Development/helio/.concertino/runs/HEL-1583/evidence/.concertino/scratch/HEL-1583/eval4/refreshed-375-light.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1583/evidence/.concertino/scratch/HEL-1583/eval4/refreshed-375-dark.png`

### Overall: PASS

### Non-blocking Suggestions
- None in scope. The cycle-3 suggestions (the `?? ""` path fallback, the duplicated prefix match in
  `DataSectionTabs`, the `as NavDestination` cast, and where the pill CSS lives) still stand. Under the owner's
  scope ruling they are for escalation or follow-up, not in-loop work.

Cleanup: my throwaway user (`hel1583eval4-1792204872855@example.com`) was deleted through the e2e harness delete
SQL. A count of `hel1583eval%` users returns 0.
