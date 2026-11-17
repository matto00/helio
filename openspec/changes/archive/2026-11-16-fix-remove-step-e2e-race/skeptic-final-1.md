## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `324566a0597098c0171322dbc9e9fdab0a9b7ce7`. Base resolved live with `resolve-review-base.sh` (main/origin):
`ab6cc9416c9451eded398b5787a7d0de707d8d1f`. The diff under review is two e2e specs (`e2e/hel1685-draft-polish.spec.ts`
+6/-1 and `e2e/hel1631-draft-mode.spec.ts` +4/-1) plus openspec artifacts. No product code changed.

### What I verified (with evidence)

1. **Root cause, checked against the CI trace myself.** I parsed `trace3/1-trace.trace` and `1-trace.network` with
   `python3 -I`, using scripts kept in my scratchpad, not in the download dir.
   - Click `call@9228` is on `button[name=/^Step 3:/]`. Its `after` snapshot URL is already
     `?step=ce6da272…` (the compute step).
   - Click `call@9230` is on `button[name="Remove step"]`, unscoped. Its `input@call@9230` snapshot still renders the
     focused section `Step 1 Filter rows` with the URL on `?step=ce6da272…`. The `after@call@9230` snapshot shows
     `Step 1 Sort rows`.
   - Network: the first `draft/save` returns 422, then a save returns 200. After that, `POST preview?outputId=b581d5f4…`
     returns 200.
   - Conclusion: the selection lags the URL, so the unscoped click removed the Filter step and the wrong Output. The
     watched Output was then legitimately previewed. This is a test race, not a product defect.
   - Mechanism: the frontend uses React Router 7 (`react-router-dom ^7.18.3`). Its `setSearchParams` re-render is a
     transition, and `selectedStepId` is derived synchronously from the URL (`hooks/useStepSelection.ts`). So the
     replaceState lands before React commits the new focused card. That is consistent with the trace.

2. **The red the gate asked for: one forced race applied to both versions, red on the old spec and green on the fixed
   one.** The executor's M1 and the evaluator's M2 mutations replace the click sequence with a synchronous
   `page.evaluate`. Both show the race exists, but neither can run the fixed spec's wait, so neither proves the wait
   closes the race. I built a mutation that leaves each version's own click code untouched and only widens the render lag:
   - **The mutation.** One line inserted immediately before `getByRole("button", { name: /^Step 3:/ }).click()`. It
     delays every `MessagePort.prototype.postMessage` delivery (React's scheduler channel) for 1500 ms. Discrete
     (sync-lane) clicks are unaffected, but the transition render of the new selection is held back. This is the CI lag,
     made deterministic.
   - **How the specs were built.** Mechanically, by a script, from `git show ab6cc9416:e2e/hel1685-draft-polish.spec.ts`
     (mA) and `git show HEAD:…` (mB). The only other edits are absolute import paths and `test.only` on item 7. I diffed
     both against their sources to confirm that.
   - **mA (base spec + forced lag), `--repeat-each=3 --workers=1`:** 3 failed. All three fail at
     `requests naming the removed Output` with one `POST …/preview?outputId=<watched metric>`, which is the exact CI
     signature. In the mA trace:
     - The 422 cascade names one step (`980bdaaf…`) and one Output (`82569c0a…`).
     - `input@call@82` (the Remove-step click) renders `Step 1 Filter rows`.
     - This is the same mechanism as CI.
   - **mB (HEAD spec + the identical forced lag), `--repeat-each=5 --workers=1`:** 5 passed (54.5s).
   - **Conclusion.** The scoped wait on `region "Step 3 Compute…"` closes the race. The red-to-green comes from the fix,
     not from a lucky run count.
   - Specs: `.concertino/scratch/HEL-1711/skeptic/mA-base-forced.spec.ts`, `mB-fixed-forced.spec.ts`, `sk.config.ts`.
     These are lane scratch files and are not committed. The inserted line is quoted under Non-blocking notes so the
     claim survives the sweep.

3. **Fixed specs, full run, fresh.** Against servers I started with the canonical `start-servers.sh` (7143/10050,
   `assert-phase.sh servers` → `PASS servers`):
   - `npx playwright test e2e/hel1685-draft-polish.spec.ts e2e/hel1631-draft-mode.spec.ts --workers=2` → `15 passed (57.3s)`,
     exit 0.
   - I stopped the servers afterwards with `stop-servers.sh` → `STOPPED ports=7143,10050`.

4. **Gates and constraints.**
   - `npx eslint` on both specs: exit 0.
   - `npx prettier --check` on both specs and the change-dir md: "All matched files use Prettier code style!"
   - Grepping the added e2e lines for `waitForTimeout|timeout` finds nothing (grep exit 1). No timeout was widened and
     no retry was added. That satisfies the "not by widening the timeout" AC.

5. **Acceptance criteria.**
   - **AC1: root cause identified and reproduced locally, not assumed.** Met.
     - The root cause is probe-confirmed from the CI trace (item 1).
     - No natural local red was obtained, and `evidence.md` says so honestly: 20/20, and 30/30 under CPU load.
     - Locally it is reproduced by forced-race mutations: the executor's M1, the evaluator's M2, and my mA, which gives
       the exact CI failure message 3/3.
     - Accepting a forced local red under design.md Decision 1 is a reasonable reading of "e.g. `--repeat-each`".
   - **AC2: the test's wait is made deterministic, not by widening the timeout.** Met.
     - The wait is a web-first locator wait on the focused section, and the click is scoped to it.
     - mA→mB proves it closes the race.
     - The added dialog assertion (`toContainText("Avg minutes")`) makes a future wrong-step removal fail with a clear
       message. Per the executor's M1, it catches the race at the dialog.

6. **Report claims vs ground truth.**
   - `evidence.md` is accurate where I could check it: the CI trace facts (ids, 422, the 200 preview, the focused
     section at the click) and the fixed-run counts, which I re-ran as 15/15.
   - `evaluation-2.md`'s trace reading matches mine.
   - No mtime-ordering evidence is relied on anywhere. Everything above rests on snapshot content, ids and pasted
     output.

### UI / design judgment

N/A. This is a test-only change, with no `frontend/**` changes.

### Verdict: CONFIRM

### Non-blocking notes
- The forced-race line I used, for the record:
  `await page.evaluate(() => { const orig = MessagePort.prototype.postMessage; const until = performance.now() + 1500; MessagePort.prototype.postMessage = function (this: MessagePort, ...a: unknown[]) { const left = until - performance.now(); if (left > 0) { setTimeout(() => (orig as (...x: unknown[]) => void).apply(this, a), left); return; } (orig as (...x: unknown[]) => void).apply(this, a); } as typeof orig; });`
  It is inserted before the `Step 3:` click. It is the stronger red than M1/M2, because it applies unchanged to both the
  old and the new spec. `evidence.md` could cite it if the record is revised, but that is not required.
- `hel1631` uses `/^Step 3 /` rather than naming the step label. That is fine for its seed. It is slightly weaker than
  hel1685's `/^Step 3 Compute/` if that spec's step order ever changes.
- `evaluation-2.md` is untracked in the worktree (`git status`: `?? …/evaluation-2.md`). The orchestrator should make
  sure it is committed or persisted with the other artifacts.
