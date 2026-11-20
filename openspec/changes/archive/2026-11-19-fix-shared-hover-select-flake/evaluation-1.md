## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c680a596101de9cadfffb1e6e5ff907d24528101` against the live base `beb94adfe49759ebc8e180500130a032fdfac3b4`
(commits 2aa530bce red guard, c680a5961 fix).

### Phase 1: Spec Review — FAIL

Passing items:
- AC "no weaker assertion": met. `e2e/hel1675-shared-hover.spec.ts:376-381` keeps `not.toEqual(rest)` for all six
  instances (including the `probeOnly` instance 2), and `:384` keeps `toEqual(DESKTOP_HOVER[theme])`. The only change
  inside the loop is `settleToRest` before the rest read and `settleToHover` in place of the old document-wide
  `waitForFunction`. No retry, `fixme`, skip, or test-timeout change.
- Red-before-fix ordering (C12): met. 2aa530bce adds the guard with the old read pattern (`noAnimations` then read);
  `red-guard-before-fix.log` shows 9/10 failing, light received `rgba(33, 29, 25, 0.2)`, which is CI's exact signature.
  The guard is labelled "forced-condition guard (NOT a reproduction ... natural rate locally is 0/40)" in the file
  header and in the commit message, as Risks bullet 1 requires.
- Product branch correctly not taken: the CI rest read is the hover paint and the hover read was correct, so the
  defect is in the test's rest read. No product CSS change, no HEL-1735 scope.
- Instance-3-only (discriminator b): addressed with evidence. `ci-trace-extraction.md` puts the click at (195, 363),
  outside the trigger at rest (y 247..291), with the sheet sliding the trigger up through y=363. The probe's natural
  40-rep log (`probe-natural-hog90-40reps.log`) shows the trigger turning `:hover` during the sweep with no mouse move
  (hoverFrames > 0 in several reps), and one rep reading a mid-transition `0.125`. So the mechanism also shows up in
  natural runs, not only in the forced one.
- `settleToRest` cannot hide a product hover defect. It reads rest only once the control is not `:hover`, not under the
  tracked pointer, and nothing is animating. If hover stayed stuck, or the pointer really rested on the control, it
  rejects loudly after 10 s rather than reading. If a CSS bug painted the hover values at rest, the rest read would
  capture them and the unchanged `not.toEqual` would fail. If hover never painted, `settleToHover` would still
  require `:hover` plus pointer-inside, and `toEqual(DESKTOP_HOVER)` would fail.
- The 10 s waits are not a disguised timeout increase. They are bounded polls on asserted conditions. The previous
  hover wait (`page.waitForFunction`, no explicit timeout) was bounded only by the 240 s test timeout, so the new cap
  is tighter, and the rest read previously had no settle at all.

Issues:
1. **Completeness bar discriminator (a) is not met, and the claim offered for it is contradicted by the CI logs.**
   design.md Decision 1 says a cause that explains the failing read but not discriminators (a)/(b)/(c) is not
   probe-confirmed. The forced mechanism is theme-independent: `red-guard-before-fix.log` reds dark 4/5 and light 5/5,
   and both mutation logs red dark as often as light. So it does not explain light 3/3 failing while dark 3/3 passes.
   The explanation relayed for (a), that `hel1783` "overlapped only the light test", is false on the logs:
   - Failing runs: `hel1783` started during the DARK desktop test in all three. main@beb94adfe
     (`.concertino/scratch/HEL-1777/main-e2e2.log`): hel1783 owner registered at 03:40:34.57, during dark
     (03:40:28.8-03:40:47.7). It ran until 03:41:47, so it also overlapped light (03:40:47.7-03:40:56.8). PR attempt 1
     (`e2e2-fail.log`): 03:16:06.36, during dark (03:16:02.2-03:16:21.0). Attempt 2 (`e2e2-rerun.log`): 03:37:25.05,
     during dark (03:37:20.5-03:37:38.7).
   - Passing run (`.concertino/scratch/HEL-1790/pass-main-94a8.log`): hel1783 registered at 02:39:39.75, inside the
     LIGHT test (02:39:26.2-02:39:54.9), and the light test passed.

   So hel1783 overlap is present for both themes in failing runs and for light in the passing run. It does not
   discriminate (a) or (c). No durable artifact in the change dir or `.concertino/runs/HEL-1790/evidence/` states the
   named root cause against (a)/(b)/(c). Task 1.4 is marked done without that write-up.
2. **Discriminator (c) is not shown.** The failing legs were faster (about 12 m vs 17.5 m; dark 18-19 s vs 32.6 s).
   The guard models the window as widened by a main-thread stall (a "loaded runner's late refresh"), which is in
   tension with the faster runner being the one that fails. No artifact reconciles this.
3. **Task 3.1 is marked `[x]` but not done as written.** It requires `--repeat-each` >= 3 over the full leg-2 selection.
   The evidence is one full pass in two batches: `stability-leg2-batchA.log` 73/73 and `stability-leg2-batchB.log`
   49/49, which is 122 tests with the two desktop hover tests appearing once. The supplementary 3.2 runs (x4 + x6 =
   10 repeats, 20/20 desktop hover tests, 98/98 overall) are complete.
4. Task 4.1 (CI) is open and deferred to Delivery by design. Not counted against this cycle.

### Phase 2: Code Review — PASS

Fresh gates, run by me on the changed files. The diff matches neither `frontend/**` nor `backend/**`, so these are
the applicable equivalents:
- `npx eslint --max-warnings=0` on the 3 e2e files: exit 0
- `npx prettier --check` on the e2e files and the change dir: clean
- `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0
- `node scripts/check-openspec-hygiene.mjs`: clean
- Playwright on lane servers (`helio_hel1790`, ports 7222/10129, `ANTHROPIC_API_KEY` empty, 2 workers, nice 19):
  `hel1675-shared-hover.spec.ts` plus `hel1790-hover-probe.spec.ts`, `--repeat-each=3`: **18/18 passed**. Log
  persisted at `/home/matt/Development/helio/.concertino/runs/HEL-1790/evidence/.concertino/scratch/HEL-1790/eval1-run.log`.

Code observations (none blocking):
- `e2e/support/hel1790Rest.ts`: small, typed (the `as unknown as` window cast is confined to the init script and the
  evaluate). The failure message includes the observed state. No dead code.
- `settle`'s `running` check is document-wide, the same as the predicate it replaces, so it introduces no new
  sensitivity. A page-level infinite animation would now fail after 10 s instead of 240 s, which is a louder failure,
  not a weaker one.

### Phase 3: UI Review — N/A

No trigger matched: there are no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The
diff is e2e and change-dir only.

### Overall: FAIL

Category: spec-divergence. The fix is sound, minimal and assertion-preserving, and every gate I re-ran is green. The
failure is that design.md's own completeness bar for a "named root cause" (discriminator a, and c) is unmet, the
supporting hel1783 claim is factually wrong, and task 3.1 is ticked without meeting its count.

### Change Requests
1. Write `.concertino/runs/HEL-1790/evidence/root-cause.md` (persist it) naming the cause and addressing each of
   Decision 1's (a), (b) and (c) with cited evidence:
   - (b): reuse `ci-trace-extraction.md` and the natural hoverFrames data.
   - (a): drop or correct the "hel1783 overlapped only the light test" claim, using the timestamps in Issue 1 above.
     Either produce probe evidence for a light/dark discriminator, or state explicitly that the forced mechanism reds
     both themes, that (a) is not explained by a probed discriminator, and what the 3/3-vs-0/3 split is attributed to.
     In the second case the orchestrator must decide whether that meets Decision 1 or needs an escalation; the
     executor must not self-certify it. One unverified lead, a hypothesis only: the hel1783 phase that coincides with
     instance 3. In failing runs light's instance 3 lands about 22 s into hel1783; in the passing run it lands about
     7 s in. That depends on runner speed and could cover (a) and (c) together. Check it against the trace timestamps
     before relying on it.
   - (c): reconcile "faster runner fails" with the stall model in the guard header (`e2e/hel1790-hover-probe.spec.ts:8-15`).
2. Task 3.1: either run two more full leg-2 passes (`node scripts/e2e-shard.mjs plan 7` selection, 2 workers, lane ports
   exported) to reach >= 3 and report the counts, or untick 3.1 and record the actual count (1 pass, 122/122) with the
   reason. Do not leave `[x]` on an unmet count.

### Non-blocking Suggestions
- The post-fix guard partly checks itself: after `settleToRest` it re-asserts not-`:hover` and no animation, so
  `early === settled` follows almost by construction. It guards the helper, not the HEL-1675 spec's call to it, so
  deleting `settleToRest` from `hel1675-shared-hover.spec.ts:372` would not redden it. That is acceptable for a labelled
  forced guard. A one-line note in the guard header saying it guards the helper would stop a reader over-trusting it.
- `proposal.md`, `design.md`, `ticket.md` and the `skeptic-design-*.md` files are untracked in the worktree. Make sure
  they are committed or archived at Delivery so the change dir matches the record.
