## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: `575c149fd11fb02095d1ce05a8079d9f811a1feb`. Diff base, resolved live: `60086f02bb5b1ee48f2246bc09e3e66349199585`.
Code changes are e2e only: `e2e/support/webFonts.ts` (new), `e2e/support/rowDeleteGesture.ts` (`settledRowTop`) and
`e2e/hel1605-row-delete-confirm.spec.ts` (an early `waitForWebFonts(a)` in the I8/I14 switch tests).

### Evidence I checked myself

Summary lines are taken from the logs in `evidence/`. Each log is tied to base or fix code by its own line numbers:
the hel1605 switch test is declared at `:144` on base and at `:145` on the fix, because the fix adds one import line.

| Log | Code | Result |
| --- | --- | --- |
| baseline-repeat30.log | base (`:144` x180) | 270 passed |
| base-I14-repeat120.log | base | 120 passed |
| repro-base-red.log | base + 600ms font delay | 4 failed / 2 passed (row top 471.5 -> 453.5 after settledRowTop returned) |
| repro-fix-green.log | fix | 6 passed (`fontsAtReturn=loaded:0`, settled == later) |
| **after-repeat30-attempt1-268of270.log** | fix, **spec unchanged** (failures at base `:176`) | **2 failed** / 268 passed |
| **after-repeat30-attempt2-269of270.log** | fix, **spec in the committed layout** (`:145`, failure at `:181`) | **1 failed** / 269 passed |
| after-repeat30.log | fix (`:145` x180) | 270 passed |
| fix-I14-repeat120-attempt1-119of120.log | fix | 1 failed (`page.goto` 30s timeout in `uiLogin`: infra, not this race) |
| fix-I14-repeat120.log | fix (`:145` x240) | 120 passed |
| full-e2e.log | fix (`:145`) | 303 passed, 58 spec files |

My own fresh runs at 575c149fd, with `DEV_PORT=7038`, nice -n 19 and 2 workers:

- `npx tsc --noEmit -p e2e/tsconfig.json` passed (exit 0). Full `npm run lint` passed (exit 0). Full `npm run format:check` passed (exit 0).
- `playwright test e2e/hel1605-row-delete-confirm.spec.ts -g "I8|I14" --repeat-each=40 --workers=2` gave **120 passed**.
  All 240 progress lines carry the fix line number `:145:9`.
- The frontend/backend gates do not apply. No `frontend/**` or `backend/**` file changed.

### Phase 1: Spec Review — FAIL

- AC1 ("the row double-click tests wait for web fonts before computing a gesture point, and pass `--repeat-each=30` with 2 workers"):
  - The first half is met. Every call site reaches `settledRowTop` -> `waitForWebFonts` before its gesture point: `rowDeleteGesture.ts:10`/`:26`, hel1605 `:100`, `:171`, `:225`, `:281`, and hel1574 `:381`, `:530`.
  - The second half was met only on the **third** after-run. The two earlier after-runs failed (268/270, then 269/270). The executor's claimed "after 270/270" is the third run.
  - The 269/270 run failed with the same signature as the 268/270 run: `expect(above.groupBottom).toBeLessThan(0)`, Received `81`, 375px I14. Its code frame (`:179-184`) and test line (`:145`) match the committed spec exactly. So this failure was most likely produced by the committed spec. That is not certain, because `webFonts.ts` could have differed at that time.
  - Nothing in the evidence shows a code change between that red run and the green re-run. Reporting the green re-run as "the after" is a retry at the measurement level, which goes against the spirit of C1.
- Optional product AC: deferred, and recorded in the proposal Non-goals. Acceptable.
- C1 (no retries, no raised timeouts, no skip): met in the code. See the measurement point above.
- C2 (worktree paths and non-zero counts):
  - Counts are non-zero everywhere.
  - All-green logs print no absolute path. Their base/fix identity is still self-authenticating through the `:144`/`:145` line numbers.
- C3: met in the code.
  - `readFontState` selects the live `link[rel="stylesheet"][href*="fonts.googleapis.com/css2"]`; the `<noscript>` copy is inert.
  - It requires every web family the row's text uses to have a `loaded`/`error` face.
  - It forces layout (`getBoundingClientRect` + `getComputedStyle`) before checking, which closes the window before the font request starts.
- Planning artifact drift: `evidence/call-sites.txt` is committed but stale.
  - It shows `waitForWebFonts(button.page(), button)`, while the final signature is `waitForWebFonts(target)`.
  - Its hel1605 line numbers are pre-edit (`:171`/`:182` vs the final `:176`/`:187`).
- Scope of the extra I8/I14 edit (`hel1605-row-delete-confirm.spec.ts:165-168`):
  - In scope in kind. They are row double-click tests, and the edit reads fonts, never labels, so it does not conflict with HEL-1605's "must not wait for labels to settle" AC.
  - It adds no retry and no raised timeout.
  - But its justification is unproven. See CR1.

### Phase 2: Code Review — FAIL

- **Test reliability (blocking):** see CR1. The settledRowTop-only version introduced a failure in the I14 375px test: 2/30 runs, against 0 in about 90 base runs of that test (30 in baseline-repeat30 plus 60 in base-I14-repeat120).
  - The early `waitForWebFonts(a)` was added to fix it.
  - Its comment says A's reveal "would undo B's placement below if that placement ran later".
  - `frontend/src/shared/chrome/rowDeleteFocus.ts:41-44` arms a `scrollIntoView({block:"nearest"})` of A's confirm `REVEAL_DELAY_MS` (500ms) after A's click. That scroll undoes B's placement when the placement finishes **before** the timer fires, not after. `Received: 81` is A's 81px confirm scrolled to the top edge, consistent with exactly that.
  - Moving the font wait earlier makes B's placement shorter, not longer. So the comment's mechanism does not explain why the edit would close the race, and the 269/270 run shows the same failure after the edit.
  - No probe-confirmed root cause exists for this failure (`systematic-debugging` Iron Law).
- Helper design is otherwise sound:
  - Bounded by its own 10s deadline (`webFonts.ts:12`), polled from Node in real time, so it works under `page.clock`.
  - **(b) The bound is not a raised timeout in disguise.** It sits inside the unchanged 30s test timeout, raises no test or expect timeout, and fails loudly with the observed state instead of passing silently.
  - Faces left `unloaded` are allowed, and errored faces count as settled.
- **(c) A failed stylesheet fails loudly.** probe-d3.log `abort-css` leaves `media:"print"` with `sheet:true` and a status-0 resource entry. A font-file abort also gives status 0, so a failed stylesheet cannot be told apart from the page. D3's "otherwise fail loudly" branch therefore applies, which is acceptable. Consequence: during a Google Fonts outage, each row-gesture test fails after 10s, with a message naming `stylesheetMedia:"print"`.
- `CONTRIBUTING.md` mechanical rules: no inline FQNs, no `any`, file sizes fine. Lint, format and typecheck all pass.
- Non-null assertions in `rowDeleteGesture.ts` are pre-existing.
- No dead code. The scratch probe specs are kept as `.txt` under evidence and are not executable.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The change is test harness only.

### Overall: FAIL

### Change Requests

1. **Root-cause and close the I14 375px `groupBottom = 81` failure, or show it is not on the committed code.**
   - Location: `e2e/hel1605-row-delete-confirm.spec.ts:165-181`.
   - Seen 2/270 with the spec unchanged and 1/270 with the committed spec layout. Not seen in about 90 base runs of that test.
   - Either:
     - (a) Prove that the 269/270 run used different `webFonts.ts`/spec code from 575c149fd. Name the difference.
     - (b) Probe the race in-page: time A's click, A's reveal timer firing, and the end of B's placement. Then make the order deterministic instead of narrowing it. One candidate: this test already has an installed `page.clock`, so after `expect(aGroup).toBeVisible()`, advance the fake clock past `REVEAL_DELAY_MS` (e.g. `page.clock.runFor(...)`) so A's reveal has fired before `placeBottomNearViewportEdge(page, b)`. This is a claim to verify, not a known fix. It must not wait on labels and must not raise a timeout.
   - Then correct the comment at `:165-167` to state the probe-confirmed mechanism.
2. **Report every after-run, not the last green one.**
   - In the handoff, give the after-measurement as all three runs (268, 269 and 270 out of 270), with the failing signatures.
   - After CR1, take a fresh `--repeat-each=30 --workers=2` run of both specs plus a larger I14 sample (≥120) as the after number. Any red run in that series stays in the report.
3. **Refresh or remove the committed `evidence/call-sites.txt`** so it matches the final code: signature `waitForWebFonts(target)` and the final hel1605 line numbers.

### Non-blocking Suggestions

- `waitForWebFonts` passes vacuously when `rowFamilies` is empty, because `every` on an empty array is true. That only happens if the row's first computed family has no registered face (a system font stack). Consider logging or asserting a non-empty `rowFamilies` once in the repro, to show the target row's web families are actually matched.
