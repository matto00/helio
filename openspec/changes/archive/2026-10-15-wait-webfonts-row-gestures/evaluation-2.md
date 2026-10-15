## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed head: `b6cc9874dd9baa08de2e77fd9d8837d8148020e8`. Diff base, resolved live: `60086f02bb5b1ee48f2246bc09e3e66349199585`.
- The cycle-2 delta (575c149fd..b6cc9874d) touches one spec, `e2e/hel1605-row-delete-confirm.spec.ts`:
  - It removes the early `waitForWebFonts(a)` and its import.
  - It adds `const REVEAL_DELAY_MS = 500` and a call to `page.clock.runFor(REVEAL_DELAY_MS + 100)` after A's confirm is visible and before B is placed (`:176`).
- It also refreshes `evidence/call-sites.txt`, renames the cycle-1 logs to `cycle1-*`, adds new probe logs, and adds scratch probes (stored as `.txt`).

### Evidence I checked myself

Counts are from each log's summary line. Each log is tied to its code by the switch test's declaration line: `:144` on base, `:145` at cycle 1, and `:146` at cycle 2.

| Log | Result |
| --- | --- |
| after-c2-repeat30.log | 270 passed (`:146` x180) |
| after-c2-I14-repeat130.log | 130 passed (`:146` x260) |
| full-e2e.log | 303 passed (`:146`) |
| probe-runfor-after.log | 10 failed: A's reveal fired AFTER B's placement, `groupBottom = 81`, the same signature as cycle 1 |
| probe-runfor-before.log | 10 passed, `groupBottom = -59` every time |
| probe-race.log | 60 passed. B's placement ends 250-450ms after A's mousedown, which is before the 500ms reveal |
| probe-families.log | 2 passed. The target row's web family `"Schibsted Grotesk"` has a loaded face on /sources and /pipelines, so `rowFamilies` is not empty (my cycle-1 suggestion) |

- The cycle-1 failing runs are still on disk under honest names: `after-repeat30-attempt1-268of270.log`, `after-repeat30-attempt2-269of270.log` and `fix-I14-repeat120-attempt1-119of120.log`. CR2 is satisfied as far as the evidence goes.
- `call-sites.txt` now matches the head. It shows signature `waitForWebFonts(target)` and hel1605 `:179`/`:190`/`:233`/`:244`/`:289`, which I confirmed by grep (CR3).

My own fresh runs at b6cc9874d, with `DEV_PORT=7038`, nice -n 19 and 2 workers:

- `npx tsc --noEmit -p e2e/tsconfig.json`, full `npm run lint` and full `npm run format:check` all exit 0.
- `playwright test e2e/hel1605-row-delete-confirm.spec.ts e2e/hel1574-shell-rail.spec.ts -g "I8|I14|I17|I19|double-click" --repeat-each=15 --workers=2` gave **135 passed**. That is 9 tests x 15, covering hel1605 `:146` (I8, both I14 cases), `:205` (I19) and `:261` (I17), and hel1574 `:351` and `:477`.

### Phase 1: Spec Review — PASS

- **AC1: met.**
  - Every row double-click reaches `settledRowTop` -> `waitForWebFonts` before its gesture point.
  - Both specs pass `--repeat-each=30 --workers=2`: 270/270, plus 130/130 for I14 and my own 135/135.
  - The cycle-1 failure was root-caused with a red/green probe (10/10 vs 10/10) and fixed by ordering the timer, not by retrying.
- **The runFor change does not weaken the HEL-1605 switch scenario. It makes the I14 test reach the state it is named for.**
  - HEL-1605 design rows I8/I14 require a confirm open under A, the page scrolled by at least A's confirm height, and for I14, A's confirm above the viewport. Their assertions are: both presses on B, only B's confirm opens, and B's top delta is under 2px. A's reveal timer is not part of any I8/I14 assertion.
  - Before this change, A's pending 500ms reveal always fired before B's double-click. If wall-clock time had not already fired it, `agePage` would have: Playwright's `clock.fastForward` "fires due timers" (`node_modules/playwright-core/types/types.d.ts:18679`). Firing after B's placement, `scrollIntoView({block:"nearest"})` scrolls A's confirm back to the top edge, which is the `groupBottom = 81` state in probe-runfor-after.log.
  - So on base, the 375px I14 double-click ran with A's confirm back in view. The test checked `groupBottom < 0` only at a transient moment.
  - With `runFor` before the placement, the timer is spent before B is placed. The double-click now runs with A's confirm above the viewport (`-59`), the state design row I14 describes. A real user also takes longer than 500ms to move from A to B, so the reveal firing first is the realistic order.
  - The switch path itself still runs. B's click calls `arm(mounted)` for A, and A's `ref(null)` clears it in the same commit (`rowDeleteFocus.ts:101-103`, `:111-114`).
- **HEL-1605's "must not wait for labels to settle" AC: unaffected.**
  - `runFor(600)` advances the fake clock by 600ms, well short of the 60s tick.
  - The `freshRowLabel(b)` -> `FRESH_LABEL` assertion before the gesture still runs and still passes, so the labels are still fresh at the press.
  - Nothing reads or waits on labels.
- **Scope: within HEL-1606.**
  - The ticket targets flake risk in exactly these row double-click tests, and the proposal allowed hel1605 edits "only if a call site needs it".
  - The edit is one line plus a constant and a comment, in a test the font wait made faster.
  - No product code changed.
- **C1: honored.** No retries, no raised timeouts, no skip. `runFor` orders a fake-clock timer and is not a wait on time.
- **C2: honored.** Counts are non-zero, and the logs are tied to their code through the line numbers above.
- **C3: honored.** It is unchanged since cycle 1, and `rowFamilies` is now shown to be non-empty.

### Phase 2: Code Review — PASS

- `REVEAL_DELAY_MS` is duplicated as a test-local constant. The comment names its source (`rowDeleteFocus.ts`) and gives the reason: e2e does not import app code. This is acceptable, not a magic value.
- The comment at `:170-175` states the probe-confirmed mechanism, and the probe counts it cites match the logs.
- Lint, format and typecheck pass. There is no dead import, because the `waitForWebFonts` import was removed with its only use.
- The cycle-1 findings on the helper still stand: the 10s bound is the helper's own deadline, not a raised timeout, and a stylesheet abort fails loudly under D3.

### Phase 3: UI Review — N/A

No trigger path changed. The change is test harness only.

### Overall: PASS

### Non-blocking Suggestions

- `design.md`/`proposal.md` say nothing about the A-reveal race or the `runFor` ordering in the I8/I14 tests. The comment in the spec explains it. One line under design Risks before archiving would keep the archived change self-describing.
- The committed `evaluation-1.md` is fine to keep. It records the cycle-1 failures this cycle fixed.
