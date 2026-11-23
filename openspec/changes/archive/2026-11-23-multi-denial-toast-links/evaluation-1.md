## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `e159e4668924963562703559c4ad16630562f923` against live-resolved base `1b3c309e01080bbca65e246036694dc24b19328d` (commits 01dab9e5a planning + red run, e159e4668 implementation).

### Phase 1: Spec Review — PASS
- AC1 (each listed pipeline links to its page; per-pipeline "Run to update" where `canRun`; no toast storm): met. `deniedPipelinesToast.ts` emits one row per pipeline with `linkTo: /pipelines/<encoded id>`, and a row action only when `p.canRun`. Rapid identical writes coalesce through the existing variant+message dedup. e2e "rapid identical writes leave one toast" passed in my run.
- AC2 (persistent while it holds actions, keyboard reachable, computed ARIA asserted): met. N>=2 is `duration: 0` and eviction-exempt. The e2e asserts `getByRole` link/button names, `toHaveAccessibleDescription`, Tab order and focus after consume. I confirmed the same behaviour live (below).
- Owner Q1 (link per row, inline run only where `canRun`, toast closes when no run action remains) and Q2 (every pipeline listed, scroll inside the toast) are honoured, and so are CONSTRAINTS C1–C4. The diff touches no pipeline page component and no backend. The e2e uses `steps-above-bound`, not AI.
- Every task is marked done and matches the code. The spec delta (`specs/run-to-update-affordance/spec.md`) describes the implemented behaviour.
- Scope: the D8 non-modal focus hand-off in `Toast.tsx` now applies to every toast's dismiss/action, not only multi-denial. design.md D8 states and accepts this, so it is not scope creep.
- C12 red evidence: `evidence/red-run.txt` was committed in 01dab9e5a before the implementation. The commit message states that the pre-commit tsc gate refused the red test files, so they went in with the implementation. That matches C12's stated fallback ("keep the red run as .txt evidence and say so"). The red run is compile-only: every suite fails on TS2305/TS2339 for the missing API. So the behavioural red comes from `evidence/mutations.txt` (a–f). Each mutation fails the expected tests. I accept this as meeting C12 (see the suggestion on mutation e2 below).

### Phase 2: Code Review — FAIL
Gates, run fresh by me in WORKTREE_PATH after `npm ci`:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test` (3 workers): exit 0. Root 73 suites / 645 tests passed; frontend 923 suites / 10663 tests passed.
- `npm --prefix frontend run build`: exit 0
- e2e on the lane DB with the backend started with an empty `ANTHROPIC_API_KEY`: `e2e/hel1172-multi-denial-toast.spec.ts` 3/3 passed, and the regression spec `e2e/hel1096-run-to-update-affordance.spec.ts` 2/2 passed.

Issues:
1. **DESIGN.md §3 "The 44px touch floor" [mechanical]: violated by the new controls.** The rule is DESIGN.md:302-340: "Every interactive control reachable by touch must clear a 44x44px target", met with a sized `::after` hit expander behind `@media (max-width: 768px), (pointer: coarse)`.
   - The new row link `.toast__link` (`frontend/src/shared/ui/toast.css:157`, rendered at `frontend/src/shared/ui/Toast.tsx:228`) has no expander.
   - The per-row button reuses `.toast__action` (`Toast.tsx:239`), which has none either.
   - Measured live at 390px: every row link and every row "Run to update" button is 17px tall (one wrapped link is 50px). Only "Dismiss notification" reaches 44x44.
   - A 2+ denial toast puts 2N such targets in a vertical stack with `--space-1`/`--space-2` gaps.
   - The single-pipeline `.toast__action` already lacked an expander before this change. This change multiplies the defect into a dense stack, so the new controls must comply.
2. **CONTRIBUTING.md:24 file-size budget.** `frontend/src/shared/ui/Toast.tsx` grows from 298 to 416 lines. CONTRIBUTING says that when an edited file crosses ~400 lines, you propose a split "rather than adding to it". Both new concerns can be extracted without behaviour change:
   - the row list (`Toast.tsx:217-256`)
   - the D8 focus machinery (`handOffFocusFromRemovedToast`, `Toast.tsx:61-94`, plus the two layout effects at 157-177)

DRY, typing, security, error handling and dead code: no issues found.
- The `useStore<{ toasts: { items: ToastData[] } }>()` inline type is acceptable; it avoids a `RootState` import from `shared/ui`.
- Tests are meaningful: FormPanelView 1.3c would catch a wrong toastId/key, and the store test imports the real ignore list.

### Phase 3: UI Review — PASS (except the touch-floor finding, which is filed under Phase 2)
Servers came up through `start-servers.sh` on 6604/9511 against `helio_hel1172` (`assert-phase` PASS). I checked in the shared MCP browser on port 6604 only, with no dialog open. I seeded 4 runnable denied pipelines, one with a long wrapping name.
- **Happy path.** One warning toast with 4 rows:
  - Computed tree: `list "Pipelines not updated"`, with `link "<name>"` → `/pipelines/<id>` and `button "Run to update: <name>"` per row.
  - The toast persists.
  - Keyboard Enter on a row's run removes only that row's action, and focus lands on that row's link.
  - Mouse clicks on the remaining actions closed the toast.
  - Keyboard path with the last action: focus returned to the form's Submit button (the pre-entry element).
  - Focus never reached `body`. In one run the pre-entry textbox had been unmounted by a 390px layout switch, and focus fell back to `main#app-main-content`, as the spec allows.
- **Scroll (Q2).** The list is `max-height: 256px` with `overflow-y: auto`; 350px of content scrolls inside the toast and nothing is truncated.
- **Focus ring.** It is not clipped at the list edge in light or dark.
- **Breakpoints.** 1440 / 1100 / 768 / 390: no horizontal overflow of the document or the list. The toast stays inside the viewport and sits above the bottom nav at 390.
- **Console.** No errors during the tested flow. Errors seen earlier in the session were my own seeding hitting the 429 rate limit and are unrelated.
- **Tokens.** New CSS uses only `--space-*` / `--weight-*` tokens and inherits colour. Row actions reuse `.toast__action`, the shared treatment.

Evidence (persisted):
- /home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/eval1/shots/dark-1440-focus-link.png
- /home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/eval1/shots/light-1440-focus-button-after-consume.png
- /home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/eval1/shots/light-390.png
- /home/matt/Development/helio/.concertino/runs/HEL-1172/evidence/.concertino/scratch/HEL-1172/eval1/shots/dark-390.png

In the light shots the form panel card stays dark because I switched the theme by setting `data-theme` on the root element, which does not re-apply panel appearance. The toast itself renders with light tokens.

### Overall: FAIL

### Change Requests
1. **Touch floor for the row controls** (`frontend/src/shared/ui/toast.css`, `frontend/src/shared/ui/Toast.tsx:228,239`).
   - Under `@media (max-width: 768px), (pointer: coarse)`, give `.toast__link` and the row "Run to update" button a 44px hit target, following DESIGN.md §3 and `shared/ui/tapTarget.css`:
     - `position: relative`
     - an explicitly sized `::after`: for a labelled control, the full-width strip `left: 0; right: 0; height: 44px; top: 50%; transform: translateY(-50%)`
   - Respect "Expander tiling": a row's run button and the next row's link must not have overlapping hit regions. Widen the touch-gated row/item spacing so it reaches the tiling point and no further, or use another layout that tiles. Never use `min-height: 44px` on the button.
   - Add a unit guard with `expectTapExpander()` (`shared/ui/tapTargetTestUtils.ts`) for both selectors.
   - Add a 390px e2e assertion that bisects each row control's real hit extent with `elementFromPoint`, using the epsilon DESIGN.md specifies. Apply it to the first test in `e2e/hel1172-multi-denial-toast.spec.ts`, or a new test in it.
   - Covering the single-pipeline `.toast__action` with the same rule is in-file and cheap. Either do it here or record it as a follow-up.
2. **Split `Toast.tsx` back under budget** (CONTRIBUTING.md:24). Behaviour-preserving, with the existing tests unchanged and still green:
   - Move the row list rendering (`Toast.tsx:217-256`, with its `linkRefs`/`focusLinkAfterRef` effect) into a sibling component, e.g. `frontend/src/shared/ui/ToastRowList.tsx`.
   - Move `handOffFocusFromRemovedToast` into a small module, e.g. `frontend/src/shared/ui/toastFocusHandOff.ts`.

### Non-blocking Suggestions
- `evidence/mutations.txt` mutation "e2" quotes `handOffFocusFromRemovedToast(element, preEntry.current, ...)`, but the committed code passes `preEntry` (the ref). The mutation was recorded against an earlier revision. Re-record it against the final text so the evidence matches the shipped code.
- Rows are ordered by pipeline id (UUID), which looks random to a user. Ordering the rows by name would read better; the aggregate `message` and coalescing key can keep their id order. This is a design-level call, so it is left to the skeptic.
- A residue user and pipelines that my live UI check seeded remain in the lane-private DB `helio_hel1172` (`hel1172-eval*@example.com`). They have no effect on the shared DB.
