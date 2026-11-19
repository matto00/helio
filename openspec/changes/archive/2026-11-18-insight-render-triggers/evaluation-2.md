## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `0240a79ffade1573258e2e9c566311dac61d2cb8`. Base `56b4ae1ff`, resolved live. Cycle-2 delta: `d8e43ec95..0240a79ff`.

### Gates I ran myself
| Gate | Result |
|---|---|
| `sbt -J-Xmx3g testFull` (nice 19) | **pass**. ScalaTest line: `Tests: succeeded 9981, failed 0, canceled 5`. The 5 cancels are the existing report-only measurement specs. |
| jest suites: insight panel, outputEditor, ask | pass: 42 suites / 560 tests |
| `npm run lint`, `npm run format:check`, frontend `typecheck`, `npm --prefix frontend run build` | pass |
| e2e: hel1743-insight-refresh, hel1744-insight-panel, hel1746-ask-ui | **pass 20/20**. Playwright ran with 2 workers. Servers came from `start-servers.sh` on the lane DB `helio_hel1743` with `ANTHROPIC_API_KEY` empty; the backend logged `insight renders disabled`, so no model call was possible. Servers were stopped with `stop-servers.sh`. |

The frontend delta this cycle is only a reordering of fields in `useOutputKindState.ts`. The full `npm test` passed in cycle 1 (9963 tests), and the typecheck and build pass again here.

I made no live model calls and read no `.env` file. Mutations ran in throwaway detached worktrees, which have been removed. The executor's worktree is clean.

Evidence (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/eval2-mutations.out`
- `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/eval2-hook-faithful.out`
- `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/eval2-e2e.txt`

### Cycle-1 change requests
1. **CR1 (hel1746) — resolved.** At `e2e/hel1746-ask-ui.spec.ts:398-414`, the spec now expects:
   - the keyless failed state on the card;
   - `lastAttempt` equal to `{status: failed, trigger: pin}`;
   - exactly one history item, with trigger `pin`.

   The ask-ui spec delta was amended to match ("not-yet-rendered until the pin render's first attempt is recorded"). All 4 variants pass.
2. **CR2 (ER1 overlapping) — resolved.** The new test gates run 2's snapshot commit with an overriding `NodeSnapshotRepository`, so this order holds:
   - run 2's write phase begins first;
   - render 1 starts afterwards and reads run 1's data (it asserts `not include "222"`);
   - run 2 then commits, and its own render is throttled.

   The tick pass then renders run 2's data. My overlap-grace mutation (`run.isAfter(att)`) now turns exactly this test red.
3. **CR3 (fixture race) — resolved.** `futures.add` now happens before `calls.incrementAndGet`, and `settle` also waits for `futures.size >= n`. `testFull` is green.
4. **CR4 (hook guard) — resolved.** The test uses a 60 s timeout and a pending promise. It requires the run, its future and the `succeeded` event to complete while `model.sends == 1` and no row exists yet.
   - **Correction to my cycle-1 finding:** the mutation I used in cycle 1 replaced only the trailing `published`. That left the `published.foreach` hook in place, so it was a double trigger, not a move into the writes chain. The executor's diagnosis of this is right.
   - I re-ran the faithful mutation: remove the `foreach` block and return `published.flatMap(v => insightTrigger.afterRunSucceeded(...).map(_ => v))`. The new hook test and the ER1 overlap test both go red (`Tests: succeeded 33, failed 2`).
   - The timeout behaviour (a failed row, and no late write) moved into its own test, which passes.
5. **CR5 (inputs tests) — resolved.**
   - The disabled-step test compares a sort→limit chain with the limit enabled (`Leaders`) against the same chain with the limit disabled (`Summary`). My `.filter(_.enabled)` removal turns it red.
   - The other-node test reads a metric-with-compare Output that sits on a different node. It asserts that the compare is read and that the preset stays `Summary`.
6. **CR6 (stale mutation entries) — resolved.** In `mutations.md`, the old hook and R3b entries are marked SUPERSEDED, the old hook re-run is marked UNREPRODUCIBLE, and new entries target code that exists. My R3b mutation on `forViewer` is red.

The non-blocking items were addressed too: `JDouble` is now imported, the live-check id is filled in, and the field order in `useOutputKindState` is fixed.

### Phase 1: Spec Review — PASS
- Every acceptance criterion, ER1, ER2 and every D13 fold-in now has passing evidence. The named checks from evaluation-1 still hold, and the two that failed are now verified:
  - **ER1 overlapping:** verified by the mutation above.
  - **ER1 success then a failed run:** verified in cycle 1.
  - **ER2:** verified in cycle 1.
- The ask-ui spec delta matches the implemented pin behaviour.
- Constraints C1–C18 are honoured.

### Phase 2: Code Review — PASS
- Production code changed only by the `JDouble` import. The other changes are tests, the fixture and the e2e spec, and they are meaningful: each fails under its defect.
- No dead code was introduced.

### Phase 3: UI Review — PASS
The three e2e specs pass on every theme and viewport. The cycle-1 manual pass still holds, because no UI code changed beyond the field reordering: the Refresh button works by keyboard, renders at 1440/1100/768/375, and the model selector lists Server default plus Haiku, Sonnet and Opus 5.5.

### C12 (red first) — honest judgement
- **Stage 1 and the cycle-2 owner answers** have genuine red-first runs on record.
- **Stages 2–4 and the cycle-3 replacements were not red-first.** Their tests were written alongside, or after, production code that was already correct. `red-runs.md` now says so plainly.
- **What stands in for red-first** is mutation evidence, and I reproduced it myself this cycle on the guards in question:
  - hook placement (the faithful mutation);
  - ER1 overlap grace;
  - the disabled-step filter;
  - R3b.

  All four go red. Together with cycle 1's reproductions (digest, ER2, ER1 failed-run, D14 cap, failed-row usage), every named guard now has a reproducible, failable test.
- **Judgement:** as a record of order, C12 is only partly met. As evidence that the guards are real, it is sufficient. I do not hold the missing order against the verdict, because each guard is shown red under its own defect by an independent run, and the executor documents the order honestly instead of claiming otherwise.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- The hel1746 test title still says "real pin placed not-yet-rendered" (`e2e/hel1746-ask-ui.spec.ts:251`), but the test now asserts the failed state after the pin render. Consider renaming it.
- `InsightRenderService.scala` (364 lines) and `InsightRenderServiceSpec.scala` (about 600 lines) are over the soft size budgets. A split would help the next reader.
- The panel shows two refresh controls with different meanings: the chrome "Refresh <title>" (re-read) and the new "Refresh" (re-render). This is left to the skeptic for wording.
