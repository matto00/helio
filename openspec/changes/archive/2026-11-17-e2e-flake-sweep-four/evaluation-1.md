## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: bdda7c36a00712e8b1bf61380b8cf78f7ed11877 (commits 6f398a2a6, bdda7c36a). Diff base resolved live with
resolve-review-base.sh: fd370e5e5abbfa3451133c8a2db97edc22970be8. Changed files: `e2e/hel1668-schema-panel-copy.spec.ts`,
`e2e/support/isolateLivePage.ts`, `frontend/src/features/dashboards/tabs/hydrateTabs.ts`, its `.test.ts`.

### Phase 1: Spec Review — FAIL

The code is right. The deliverable record of what was found is not. Checklist:

- AC1 (root cause from probe/trace; no retries/sleeps/longer timeouts): PASS for hel1578 (trace: hydration overwrote
  the card-click selection), hel813 (trace: the one unanswered Google Fonts css2 request held the `load` event) and
  schema-panel-copy (per-frame probe: `.spine-row--selected .first()` resolved to the pre-selected row 0; 0.997836 at
  +202 ms matches CI's 0.997824). The diff adds no `waitForTimeout`, no retries and no raised timeout. The only
  `setTimeout(150_000)` hits in the touched spec are older than this change.
- AC2 (forced red, then 40/40 at 2 workers): checked against evidence and re-run by me.
  - hel1578: d1-e2e-red.txt fails at the heading assertion with a gated `/api/dashboard-changes` (a gate, not a sleep).
    Green under the same gate 10/10.
  - hel813: d2-red.txt times out at `isolateLivePage.ts:30 goto("/login")` with only the first fonts request stalled.
    Green 10/10.
  - schema-panel: the original body fails 10/10 under 10x CPU throttle. It fails with the CI light signature
    (`select` `rgba(0, 0, 0, 0)`). The fixed body passes 10/10 under the same throttle (spine-force-*-throttle10.txt).
  - The executor's hel1578-40x.txt and hel813-40x.txt keep only the tail of the output, so they don't show the worker
    count. I re-ran all of them myself (Phase 2).
- Jest red-first claim: the committed test was edited after the recorded red. d1-jest-red.txt shows a
  `toEqual(["a", "c", "b"])` that is now `["a", "b", "c"]`. So I checked it independently in a detached throwaway
  worktree at HEAD with `hydrateTabs.ts` reverted to the base. Result: 2 failed / 19 passed, with Expected "a"
  Received "b" and Expected "c" Received "b". The committed tests really fail on the unfixed product code. The
  worktree was removed afterwards.
- AC3: hel1578 is a real product race. It is fixed in `hydrateTabs.ts` with a red-first unit test. In scope and small.
- AC4: phone-sheet:184 is honestly not fixed. There is no product or spec change for it. `phone-sheet-probe.md` lists
  the hypotheses and probes tried (focus/blur listeners, mount observer, CPU throttle 6/12/25/30x, preview gate,
  preview delays of 150–450 ms; all passed) and names it a candidate. **But that record exists only in
  `.concertino/scratch/HEL-1754/evidence/`. That folder is gitignored lane scratch and is swept after merge.** Nothing
  in the change dir that gets archived records the outcome (see CR1).
- Planning artifacts reflect the final behavior: FAIL (CR1, CR2).
  - design.md D3 still reads "probe required; leading hypothesis: focus moved after the tap". The probe refuted that.
  - D4's leading hypothesis was a re-render or hover loss after the tap. That is not the cause found; the real cause is
    the pre-selected row matching the locator.
- Spec delta wording: `specs/.../spec.md` says hydration "SHALL NOT replace a dashboard the user **selected or**
  navigated to". The implementation says the opposite on purpose: `hydrateTabs.ts` treats only a location change as a
  navigation, so "a bare selection write can never hijack hydration". The requirement should say what the code
  guarantees (CR2).
- Task accuracy: tasks.md 3.4 is marked done for "each of the four tests". The evidence has no 40x transcript for
  phone-sheet. My own run below covers it (40/40 at 390x844), but the task line and the evidence do not match (CR3).
- Scope: no creep. Popover/ActionsMenu untouched. CONSTRAINTS C1/C2/C3/C4/C12: honored in the diff.

### Phase 2: Code Review — PASS

Gates, all run fresh in WORKTREE_PATH (no CLEAN_WORKTREE):

| Gate | Result |
| -- | -- |
| `npm run lint` | exit 0 |
| `npm run format:check` | all files pass |
| `tsc --noEmit` (frontend) | clean |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (`HELIO_JEST_MAX_WORKERS=3`) | root 66/66 suites, 579 tests; frontend 787/787 suites, 9642 tests |
| hel1578-home-changed-dot:111 | 40 passed |
| hel813:93 at 430px [mono] | 40 passed |
| hel1668-schema-panel-copy:172 | 40 passed |
| hel1668-phone-sheet:184 at 390x844 | 40 passed |

Each Playwright row ran with `--repeat-each=40 --workers=2 --retries=0` on DEV_PORT=7186 / BACKEND_PORT=10093, under
`nice -n 19`. Each transcript prints "Running 40 tests using 2 workers" and shows no flaky or failed tests. The harness
deleted all 40 throwaway users after each run.

Code:

- `hydrateTabs.ts`: the re-plan reuses the pure `planHydration` instead of adding a branch. It keeps the adopted
  `lastViewedAt` stamps. A no-navigation run follows exactly the old path.
  - The only caller (`dashboardTabsListeners.ts:52`) dispatches with no `deepLinkId`, so the fix applies in
    production.
  - `currentDeepLink` honours an explicit `options.deepLinkId`, so that path stays fixed.
  - Comments meet the CONTRIBUTING.md ticket-reference rule: the decision is stated inline.
- `isolateLivePage.ts`: `domcontentloaded` on both navigations. The next `fill` waits for its field, so readiness is
  still asserted.
- Schema-panel spec: it now waits on the tapped row (`.spine-row` nth(1)), on its selected class, and on menu opacity
  reaching 1. These are polling expectations at default timeouts. The opacity check can still fail if the product
  stops revealing the menu, because `toHaveCSS` would time out.
- No dead code, no `any`, no over-engineering.

### Phase 3: UI Review — PASS

Triggered because `frontend/**` changed. The only UI-affecting change is which dashboard is selected when hydration
ends; there is no CSS, layout or markup change, so the breakpoint checks don't apply.

- Happy path (open a Home card while hydration is still running) is covered end to end in a real browser by the
  hel1578 40/40 run above. The no-navigation path is covered by the unit test and the unchanged dashboard-tabs suite
  (234 tests in `features/dashboards/tabs`, run as part of the full jest suite).
- No new console or page errors appeared in the runs.

### Overall: FAIL

### Change Requests

1. Make the AC4 and findings record part of the change itself, not only gitignored scratch. In
   `openspec/changes/e2e-flake-sweep-four/design.md`, add an "Outcome" note to each decision:
   - D3: not reproduced. List the probes tried (as in `phone-sheet-probe.md`). Say that hypotheses (a) and (c) are
     refuted and (b) is supported by the trace but could not be forced. State that it stays a named candidate, and name
     the unproven hardening (wait for the sheet animations and for "Loading preview" to clear).
   - D4: replace the re-render/hover-loss hypothesis with the cause actually found: `.spine-row--selected .first()`
     resolved to the pre-selected row 0. Include the probe frame evidence and the 10x-throttle red/green.
   - D2: one line confirming `waitForURL` was also switched, plus the residual-risk sentence that is already there.
2. In `openspec/changes/e2e-flake-sweep-four/specs/.../spec.md`, change "a dashboard the user selected or navigated to
   after hydration started" to match the implementation. For example: "a dashboard the user navigated to (the location
   changed to `/dashboards/:id`) after hydration started; a selection change without a location change does not
   count". This keeps the spec from promising behaviour the code deliberately refuses.
3. Make the tasks and evidence agree. Either save a phone-sheet:184 `--repeat-each=40 --workers=2` transcript under
   `evidence/` (full output, including the "Running N tests using 2 workers" line), or reword tasks.md 3.4 to say
   phone-sheet was probed rather than run 40x. Also re-save `hel1578-40x.txt` and `hel813-40x.txt` with their header
   lines (or note in summary.md that they are tails), and re-capture `d1-jest-red.txt` against the committed test text.
   That last one is optional: I re-verified the red independently.

### Non-blocking Suggestions

- The last new jest test ("the re-planned target is not restored by hydration") passes on both the base and the fixed
  code. Nothing in the fix could make it fail; at most it is a guard. Either label it as a guard or drop it.
- If the orchestrator's PR body becomes the main place readers look for AC4, copy the phone-sheet candidate paragraph
  into it as well.
