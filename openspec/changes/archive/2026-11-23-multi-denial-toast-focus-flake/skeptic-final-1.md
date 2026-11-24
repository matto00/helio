## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD d6735a39e423548eefa5b03f7927d5078cdf7291 against the live-resolved base 1cdd7df9084fe812729ea4731f1eda502b94fd98 (`resolve-review-base.sh`, exit 0).

### What I verified (with evidence)
- **Diff scope.** `git diff --stat BASE...HEAD`: the only code change is `e2e/hel1172-multi-denial-toast.spec.ts` (+18/-5). The rest is change-dir artifacts. No product, frontend or backend file changed, and no shard-weights edit.
- **AC1, root cause with probe evidence.** `deniedPipelinesToast.ts:28` sorts the rows with `a.pipelineId.localeCompare(b.pipelineId)`. Pipeline ids are server UUIDs, so whether Alpha or Beta renders first is random. Two pieces of evidence support this:
  - `ci-artifacts.txt` quotes the CI error-context snapshots from both attempts of run 45281484916. Both show DOM order Beta then Alpha, Beta's id sorting lower, and focus on `Dismiss notification [active]`. That is exactly where Alpha link -> Alpha run -> Tab lands when Alpha is the last row. This evidence is content-based, not mtime-based.
  - `probe-order.txt` holds 8 local probe records. Every record's DOM order matches the id order. `root-cause.md` and `red-rate.txt` report the failures as exactly the Beta-first runs.

  The test-defect classification (design D3) holds. Real Tab order follows the rendered row order, and nothing in the product drops or traps focus. The spec asserted an Alpha-first order the product never promised.
- **C2, red committed first.** Commit 2689bb449 contains `red-run-warm.txt`, `red-rate.txt`, `probe-run.txt` and `root-cause.md`, and no e2e change. The fix lands in the later commit 2c4d96733. `red-run-warm.txt` shows 4 failed of 12 on the unmodified spec.
- **C1, no waits as the fix.** The diff adds no `waitForTimeout`, timeout, retry or `toPass`. The existing `waitForTimeout(5500)` is pre-existing; it is the persistence check and is unchanged.
- **C3 and AC3, no assertion weakened.**
  - The keyboard sequence is still focus on the first link, then real `Tab` x3, asserting run -> link -> run.
  - The spec now also asserts the DOM order equals the id-sorted order (`toHaveText` on `.toast__link`; the class is only used at `ToastRowList.tsx:34`). This strengthens coverage.
  - The spec's comparator, `alpha.id.localeCompare(beta.id)`, matches the product's comparator. Lowercase hex UUIDs with fixed hyphen positions sort the same in Node and Chromium.
  - The later Enter-on-Beta and Enter-on-Alpha assertions are byte-unchanged and do not depend on row order.
- **AC2, repeated pass, fresh run by me.** I started the lane servers via `start-servers.sh` (lane DB helio_hel1842), and `assert-phase.sh servers` printed PASS. I then ran `npm run e2e -- e2e/hel1172-multi-denial-toast.spec.ts:105 --project=dev --workers=2 --repeat-each=12` with `DEV_PORT=7274`: **12 passed**, exit 0. Output is in `.concertino/scratch/HEL-1842/skeptic-final-green.txt`.
  - Each run is a coin flip on row order, so P(all 12 runs took the same branch) is about 1/2048. Both branches were almost certainly exercised.
  - This adds to the executor's 0 of 24 runs failing (`green-run-warm-24.txt`) after 4 failures in 12 before the fix.
  - The mutation run (`mutation-run.txt`, hardcoded Alpha-first) failed 5 of 12 at the new order assertion.
- **Full spec file, fresh run.** 5 passed, exit 0 (`.concertino/scratch/HEL-1842/skeptic-final-fullspec.txt`). Prettier check on the spec is clean.
- **Servers stopped.** `stop-servers.sh` printed `STOPPED ports=7274,10181`.
- **UI judgment.** Not applicable: no `frontend/**` file changed.

### Verdict: CONFIRM

### Non-blocking notes
- The ticket suggested reproducing "under CI-like conditions (shard company, CPU throttle)". The cold-start and throttle loops were not run, and the D1 deviation note discloses this.
  - This is acceptable. The cause is data ordering, and the CI error-contexts directly show the same Beta-first state.
- Spinoff candidate, as `root-cause.md` already notes: rows sorted by random UUID give users a non-deterministic row order. A name sort would be a product decision.
- The PR body should state the D6 decision, which is to leave the shard weight defaulted.
- No gate defect: no report relied on mtime ordering.
