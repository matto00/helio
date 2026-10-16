## Evaluation Report — Cycle 4, fix-forward (evaluation-4.md)

Reviewed head: 30d6d7abe39e168f67b393f326947ce391a9ce7a. Base: 7fd2f4f29157c1f159db12e99bda86ef886e4cf2, resolved live with resolve-review-base.sh. The code and spec delta since the last head I reviewed (40f36039e, evaluation-3) is three files:
- `DashboardMetaEditTools.tsx`
- `DashboardMetaRow.test.tsx`
- `specs/dashboard-meta-row/spec.md`

The rest of the change was evaluated in full in evaluation-3, and none of it has changed.

### Evaluation-3 change requests: status

| CR | Status | Evidence |
|---|---|---|
| CR1: focus after Tidy, and the stale flag | **FIXED** | See "CR1 fix" below. |
| CR2: "Narrow content column" scenario | **NOT FIXED**: the restated scenarios are still wrong in edit mode, and they mix two different width measurements. See CR1 below. | `tier-measurements-c4.txt` |

**CR1 fix.**
- **Code:** focus now hangs on a per-tidy counter: `useState` is bumped only when `applyLayoutTidy` returns `true`, and the effect is keyed on `[undoFocusRequest]`. No other layout change can move focus.
- **Live:** I re-ran the cycle-3 real-mouse probe at 1500px on this head:
  - Tidy after an earlier drag puts focus on "Undo layout change".
  - After undoing everything, a fresh drag leaves focus on the panel's "Move … panel" handle. There is no jump.
  - This is the opposite of both cycle-3 failures.
  - Probe output: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.concertino/scratch/HEL-1576/tidy-focus-probe-c4.txt`
- **RTL test (a)** goes red on the old code (`tidy-focus-red.txt`) and passes now.
- **RTL test (b)**, "a layout change after a Tidy does not move focus", is a guard only. It is acceptable but weak:
  - It tidies from an empty history, so on the old code the flag had already been cleared, which is why (b) passed there.
  - It cannot catch the actual stale-flag sequence: earlier change → Tidy → undo everything → new change.
  - The new code removes that failure mechanism, so (b) is not a blocker. Strengthening it is a suggestion below.

### Phase 1: Spec Review — FAIL

`openspec validate dashboard-meta-row-gutters --type change` printed "valid". Every other Phase 1 item is unchanged from evaluation-3 (PASS), including C1–C5. C5 is covered by the e2e decision below.

**Live tier measurements on this head** (1280px window, context list at 400px; same user and dashboard as evaluation-3):

| Window | Mode | Row border box | Row content box | Grid | Row actions | Kebab |
|---|---|---|---|---|---|---|
| 1280 | view | 824 | 784 | yes (776) | Edit layout, Share, appearance and assistant icon-only; Add panel labelled | Refine with AI |
| 1280 | **edit** | 824 | **784** | yes | Undo, Redo, Tidy, Done (icon-only), Add panel, appearance | **Refine with AI, Share, Open assistant** |
| 1300 | edit | 844 | 804 | yes | Undo, Redo, Tidy, Done, Share, Add panel, appearance, assistant | Refine with AI |
| 1260 and below | edit | 804 or less | — | no: the stack renders and edit mode ends | — | — |

- The row has `padding-inline: 20px` per side.
- `useMetaRowTier` uses the ResizeObserver `contentRect`, which is the **content box**. The thresholds 820/640/520 (+150 in edit mode) apply to that, not to the row's rendered width.
- Measurements: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.concertino/scratch/HEL-1576/tier-measurements-c4.txt`. The scripts are persisted next to it.

### Phase 2: Code Review — PASS

**Gates I ran myself in WORKTREE_PATH, all under `nice -n 19`.** The load gate waited one minute, from 11.18 down to 7.99.
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run check:e2e-types`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `HELIO_JEST_MAX_WORKERS=2 npm test`: exit 0. Root: 55 suites / 485 tests. Frontend: 628 suites / **7504** tests (+2, matching the executor's report).
- `DashboardMetaRow.test.tsx`, run on its own under this worktree's path, has 39 tests, all passing. Both new cases pass by name.

**Code.** The counter-plus-effect is minimal, typed and tokens-free, and the comment is accurate. `useEffect`/`useState` replace `useRef`, and no import is left unused.

**E2e decision.**
- **Full suite: not re-run.** The last full run was 312/312 on 40f36039e (evaluation-3). The code delta since then is one focus effect inside the meta row's edit tools, and only one e2e spec drives Undo/Redo.
- **That spec, `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts`, re-run:** 13 tests "Running 13 tests using 2 workers", ending in **"13 passed (44.9s)"**, exit 0. It ran under the lock with DEV_PORT=7008, against `helio_hel1576`, at load 4.53 → 5.00.
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/.concertino/scratch/HEL-1576/e2e4-1028.log`

**Operator note (my error, no data impact).**
- My first hel1028 attempt omitted the `DATABASE_URL` override. Its tests passed, but the global teardown's psql pointed at `helio` from `backend/.env`.
- The teardown's guard raised "0 of 13 recorded users match their exact id and email; nothing deleted", so **nothing was written to `helio`**.
- I then deleted exactly those 13 recorded users from `helio_hel1576` using the repo's `userCleanupCore.cjs`/`db.cjs`, which deleted all 13. I removed the leftover `.e2e-user-registry/` dir and re-ran the spec correctly (above).

### Phase 3: UI Review — PASS

- **Servers:** `start-servers.sh` with `DATABASE_URL=…/helio_hel1576`; `assert-phase servers` printed PASS. Mapping the backend's client ports through `pg_stat_activity` shows all 6 connections are to `helio_hel1576`.
- **Live checks:** done with a separate headless Chromium pinned to http://localhost:7008, using throwaway user `hel1576-eval3-1792105697210@example.test` (scratch DB only). Fonts were awaited before measuring.
- **Results:** the focus probe passes; actions stay on one line with no overflow at every width measured; there is one accent button.
- **Breakpoint sweep:** not re-run, because nothing that renders changed. Evaluation-3's sweep stands.

### Overall: FAIL

### Change Requests

1. **The meta-row width scenarios still do not match the build in edit mode, and they use two different width measurements.** File: `openspec/changes/dashboard-meta-row-gutters/specs/dashboard-meta-row/spec.md:61-67`.
   - **"Narrow content column" (61-63):**
     - It says that with the grid rendering at 1280px and the list at 400px, the row is about 824px and "Edit layout and Share are icon-only".
     - That is true only in **view mode**. In edit mode, at exactly that configuration, Share and the assistant are in the "Dashboard actions" menu (measured above). The WHEN does not name a mode.
   - **"Overflow menu tier" (65-67):**
     - It says "narrower than 640px in view mode, or narrower than 790px in edit mode".
     - Those thresholds apply to the row's **content** width, which is the rendered width minus 2×20px padding.
     - The scenario just before it uses the **rendered** width (824). Read with that same measurement, an 824px row in edit mode is not "narrower than 790px", yet the build puts Share in the menu.
     - Its parenthetical also implies the edit-mode case is unremarkable. In fact it is reachable only between a rendered width of about 816 (where the grid starts) and 830.
   - **Fix:**
     - Add "in view mode" to the Narrow content column WHEN.
     - Either add a sentence that the 640/790/820/520 thresholds are measured on the row's content width, inside its inline padding, or restate them as rendered widths (680/830/860/560).
     - Optionally add the edit-mode case at the same configuration: 1280px, list at 400, edit mode → Share and the assistant in the menu, the edit tools and Done icon-only, and Add panel labelled.
   - This is text only. No code change is needed.

### Non-blocking Suggestions

- **Strengthen RTL test (b)** so it can fail on the old mechanism: dispatch a `pushLayoutSnapshot`, Tidy, undo until Undo is disabled, move focus elsewhere, dispatch another `pushLayoutSnapshot`, then assert focus did not move. That test is red on 40f36039e's code.
- **`useMetaRowTier.ts:35`** seeds the width from `getBoundingClientRect().width` (border box), while the ResizeObserver supplies `contentRect.width` (content box). That is a 40px mismatch until the first observer callback. Use `element.clientWidth` minus padding, or `contentRect`-equivalent, for the seed as well.
- From evaluation-3, still open:
  - The duplicated HEL-1576 comment line at `e2e/hel516-palette-quick-create.spec.ts:347`.
  - Memoising `selectCanTidyLayout`.

---

### Addendum — recheck at 25e68ab3988e920fc9c7354bcda85cc546c2ef37

**Scope.** The delta from 30d6d7abe touches only `specs/dashboard-meta-row/spec.md`, plus the commit of this report, which is byte-identical to the persisted copy. There are 0 files changed under `frontend/` or `e2e/`, so the Phase 2 and Phase 3 results above still stand. I ran no servers or e2e.

**CR1 is fixed.** I checked each restated scenario against `tier-measurements-c4.txt` (1280px window, context list at 400; row 824px rendered, 784px content width, 20px padding each side):

| Scenario | Spec text | Measured | Result |
|---|---|---|---|
| Narrow content column in view mode | Edit layout, Share, the appearance editor and the assistant are icon-only; Add panel is labelled; one line | `inRow` shows Edit layout, Share dashboard, Customize dashboard appearance and Open assistant as `[icon]`, `[Add panel]` labelled, `oneLine: true`, grid rendered | Match |
| Narrow content column in edit mode | Undo, Redo, Tidy layout and Done are icon-only; Share and the assistant are in the "Dashboard actions" menu; Add panel is labelled; one line | Undo, Redo, Tidy and Done are `[icon]`, Add panel labelled, kebab is ["Refine with AI", "Share", "Open assistant"], `oneLine: true` | Match |
| Overflow menu tier | Thresholds of 640 (view) and 790 (edit), measured on the content width inside the inline padding | `useMetaRowTier` reads the ResizeObserver `contentRect` (the content box). A 784px content width in edit mode is below 790 and is in the menu tier. At 1300px (804) edit mode is not. | Match |

`openspec validate dashboard-meta-row-gutters --type change` printed "Change 'dashboard-meta-row-gutters' is valid".

**Revised Overall: PASS.** The non-blocking suggestions above still apply: strengthen RTL test (b), seed `useMetaRowTier` from the content box, remove the duplicated comment at `hel516:347`, and memoise `selectCanTidyLayout`.
