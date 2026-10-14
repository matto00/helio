## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b5dc6808768258b9408e88772cf8d9ecb57309a9`. Diff base resolved live with `resolve-review-base.sh`:
`9c569fc6074d1d2296ad1a1f5fc91ee6b580a564`. Spawn-cwd guard: `READY`.

### What I verified (with evidence)

- **AC1 (shared helper, inline copies replaced).** `e2e/support/gridProcessedWidth.ts` gates on the exact
  `${containerWidth}px` value, has a phone-stack branch below 768, and its timeout error carries the last observed
  value. In the diff, hel1023 `settledRects` and hel1392-burst `crossTo` both lose their inline
  `--panel-grid-processed-width` reads and call the helper. hel1275 `resizeAndSettle` is migrated as well.
  `grep -rn -- '--panel-grid-processed-width' e2e | grep -v gridProcessedWidth.ts | wc -l` gives `0` (re-run by me).
- **AC2 (audit and grep proof).** `grep -rn setViewportSize e2e | wc -l` gives 78, and audit.md has 78 rows. I
  spot-checked the "leave" classifications against the source:
  - hel1392-remount-staleness `setViewport` (l.62-66): gates on `.react-grid-item` count only.
  - hel1398 l.394/411/427: l.394 comes before the `goto`; l.411 and l.427 are phone-stack measurements.
  - hel588 sweep (l.343-356): asserts the indicator box only.
  
  All of these are correctly left. The box grep returns exactly the 5 lines evidence.md lists (hel1023:251/282,
  hel1028:185-187). Each one is an allowed assertion, not a readiness gate.
- **AC3 / C1 (red before green; honesty).** Two specs changed semantics: hel1392-burst and hel1275.
  - evidence.md says "no red obtained" for both under the 900 ms RO-delay probe. It gives a mechanism for each:
    - hel1392-burst: a fresh mount on phone to desktop seeds `useState(width)`.
    - hel1275: an RGL item box only moves once RGL has the width.
  - The `useState(0)` mutation is described exactly as what it is: "a demonstrated weakness of the old wait, not a
    flake reproduced in the unmutated app".
  - The evaluator independently reproduced the negative result: the origin/main copies passed 5/5 under its own probe.
  - No red is claimed that was not observed.

  Judgement on whether the migrations are justified:
  - hel1392-burst: AC1 requires this migration by name. The old `/^\d+px$/` matches any value, including the
    pre-resize width.
  - hel1275: the AC1 rule (live resize, then a gate on grid geometry) covers it. The new gate fails loudly rather than
    passing vacuously if the expected container is wrong.
  
  Design D3 explicitly sanctions "refactor-with-tightening, no red claimed" when the old wait is provably not racy, and
  that is what happened. A red cannot be manufactured for a wait that is not racy. The honest disclosure satisfies C1.
- **AC4 / C2 / C3 (split).**
  - `DesktopPanelGrid.tsx` is 196 lines.
  - `git diff --stat` on `useLayoutSave.ts` and `dashboardsSlice.ts` is empty, and no `*.test.*` file is in the diff.
  - The only `useLayoutSave(` call is at `DesktopPanelGrid.tsx:109`.
  - I compared the original 436-line file line by line against the five new hooks:
    - Callback bodies and deps are verbatim. HEL-1023 derive-vs-edit and HEL-1457 `kept` items in
      `handleLayoutChange` are identical (`useGridLayoutInteraction.ts:57-80`).
    - The effect declaration order is unchanged. Before: title-ref sync, then HEL-651 auto-close, then commit-flag
      cleanup, then `useLayoutSave`. After: the same sequence via hooks at l.86, 87, 108 and 109.
    - `useGridLayoutInteraction` and `useProcessedWidth` declare no effects.
  - `useLayoutSave`'s outputs reach the interaction hook as plain arguments (C3).
  - I1 and rebase-on-409 live entirely in the unmodified `useLayoutSave.ts`. Its inputs are unchanged.
  - `handleStartEdit` keeps the same setState sequence and a stable identity (it depends on `beginTitleEdit`, which has
    `[]` deps).
  - The only JSX change is `onClose={() => setDetailPanelId(null)}` becoming the stable `closeDetail`. It behaves the
    same.
- **AC5.**
  - archived `skeptic-final-1.md` l.13: "all 8 are at lg geometry, and only 4 fall outside the md bounds". This matches
    the new l.18 wording.
  - `dev-db-residue.txt` (305 rows): the newest `created_at` is `2026-10-08 16:04:07.588553-07`. This matches the new
    window end, and 16:22:40 is kept only as the query bound.
  - l.24 and l.28 (`bad=4/8`) are unchanged.
- **Gates I re-ran (nice -n 19):**
  - `npm run typecheck`: exit 0.
  - `npm run check:e2e-types`: exit 0.
  - `npm run lint`: exit 0.
  - `npx jest --maxWorkers=3 --testPathPatterns='features/panels/(ui/grid|hooks)'`: 36 suites / 251 tests passed.
  - `npm test -- --maxWorkers=3 ...`: the script does not forward the pattern, so the full suite ran: 590 suites /
    7063 tests passed.
- **E2E I re-ran.**
  - Servers came up via `start-servers.sh` 6850/9757, and `assert-phase.sh servers` printed `PASS`. They were stopped
    via `stop-servers.sh` (`STOPPED ports=6850,9757`).
  - I ran hel1023, hel1392-burst, hel1275, hel1028, hel1457 and hel1230 with `DEV_PORT=6850 --workers=2` and no
    probe: **26 passed (2.9m), exit 0**.
  - The teardown printed `deleted 26 recorded throwaway user(s)`. Only @example.test users were used.
- **UI / design judgment.** No visual change: the JSX and the `Responsive` props are identical apart from handler
  property access, and no CSS or token changed. The split's runtime behaviour is covered by the e2e run above (drag,
  resize, undo, stale-tab save, drag-then-create, breakpoint geometry). The evaluator also did a manual live pass of
  title editing and the detail modal. I did not take screenshots, because there is no visual surface to judge.

### Verdict: CONFIRM

### Non-blocking notes

- evidence.md §3.3/5.1 claims `npm test -- --testPathPatterns='features/panels/(ui/grid|hooks)'` gave
  "51 passed / 469 tests". That count does not reproduce. The pattern matches 36 suites / 251 tests (`npx jest`
  directly), and `npm test` ignores the pattern and runs the full suite (590 / 7063). The substantive claim (all
  tests green) holds, but the per-pattern number in that evidence is wrong.
- `containerWidthForViewport` encodes the "under 1056 → minus 40" rule from hel1023's header. hel1392-burst's PHONE
  viewport (1000 → 960 by that rule) is still a phone stack, so the rule is not universally right below 1056. The
  helper is only used with ≥1056 viewports today (1400, 1440, 1100), where it is verified. A future caller below
  1056 should check the rule; a wrong value fails loudly with the observed width, so it cannot pass silently.
- No gate defect: none of the reports I drilled into rests on mtime ordering.
