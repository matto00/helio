## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a6500058c2ebc6e1adffced8153d871e913c11fe` against the live base `beb94adfe49759ebc8e180500130a032fdfac3b4`
(`resolve-review-base.sh`, exit 0). Commits: 2aa530bce (red guard), c680a5961 (fix), 6d9e95540, a6500058c (instrumentation).

Verdict: ESCALATION
Question: Should the owner waive design Decision 1's (a)/(c) completeness bar, which the write-up admits it does not meet, and accept the root cause as it stands?
Options: waive and merge (recommended), require CI-side discriminator evidence before merge, other (free-form)
Context: Below. The fix, the non-weakening check, the stability counts and the red/mutation proof all verify cleanly.
The one open item is a bar the plan set for itself. design.md Decision 1 says, in its own words, "A cause that explains
the failing read but not these discriminators is not probe-confirmed". root-cause.md states plainly that (a) light-fails/
dark-passes and (c) passing-vs-failing runs are NOT explained by a probed discriminator. A skeptic cannot waive a bar the
plan made binding, so the owner has to rule on it. On the evidence, my recommendation is to waive it.

### What I verified (with evidence)

**Root cause of the failing read: established, by elimination plus real-run corroboration**
- Only one rule can produce the operand. CI's rest operand is border `rgba(33, 29, 25, 0.2)`
  (`.concertino/scratch/HEL-1777/main-e2e2.log:1993`), which is light `--app-border-strong`. In `frontend/src/shared/ui/inputs.css`
  only the `(hover: hover)` `:hover` rule (lines 30-35) sets that. Focus-visible and aria-invalid use other colours.
  So at the rest read the trigger matched `:hover`.
- I parsed the failing CI trace myself (`trace-main-beb94adfe-44667845106.zip`, `1-trace.trace`):
  - Instance 3's click on `.spine-row__select` is at (195, 363). `control.hover()` is at (195, 269), the trigger centre.
    With a 44 px control that puts the trigger at y≈247-291, so the stationary pointer is about 72 px below the trigger
    at rest. `:hover` at the rest read therefore needs a stale hover, which the upward slide sweeping the trigger through
    y=363 can produce. This matches `ci-trace-extraction.md`.
  - Instances 1 and 2 use the same click point, but their controls sit at (312, 51) and (256, 144), never at x=195.
    That explains (b).
  - New corroboration the write-up does not cite: the post-hover `noAnimations` wait is 161.8 ms and 162.5 ms for
    instances 1 and 2, a full 0.16 s transition, but only 96.1 ms for instance 3 (call@36808). The trigger was not in a
    clean rest state when the pointer arrived. This fits a hover state that was being cleared or reversed. It does not
    prove the timing.
- The forced guard reproduces CI's exact signature (light received `rgba(33, 29, 25, 0.2)` against an expected 0.11) in
  `red-guard-before-fix.log` (9 failed / 1 passed). It is labelled as forced, not as a reproduction.
  - The first half of the mechanism was observed naturally, with no mouse move: hover frames mid-slide in 5 of 40 reps,
    under a 90 ms hog (`probe-natural-hog90-40reps.log`).
  - The natural failing read is 0/40 locally. That is disclosed.
- Red-first order checked: at 2aa530bce the guard reads right after `noAnimations` (red). c680a5961 adds `settleToRest`.

**(a)/(c) are not explained, and my new data points narrow (c)**
- Two later main runs carry the UNFIXED test, and in both `e2e (2)` passed:
  - main@68255cf79, run 44683347610, job 136111720839: `121 passed (11.5m)`, desktop dark 18.5 s, light 15.6 s.
  - main@a867001d7, run 44687930342, job 136126606821: `126 passed (12.8m)`, dark 22.0 s, light 22.6 s.
- The 68255cf79 leg ran in the "fast/failing" profile (about 12 min, dark about 18 s) and still did not fire.
- Conclusion: runner speed is not a deterministic discriminator. The data fits a per-run probabilistic race, which fired
  in 3 of about 5 fast-profile runs and 0 of the slow ones.
- That makes the (c) bar, as written ("e.g. via runner speed"), probably unsatisfiable as a deterministic explanation.
- (a) remains a real asymmetry: about 3 light fires, 0 dark, over about 8 runs. Dark always runs first.

**Fix is correct and cannot mask a product defect (`e2e/support/hel1790Rest.ts`, spec lines 367-381)**
- `settleToRest` resolves only once all of these hold: `!:hover`, the tracked pointer's `elementFromPoint` is not
  inside the control, and no document animation is running. Otherwise it rejects after 10 s, naming the observed state.
  - If the pointer were genuinely over the control at rest (a geometry change), the test fails loudly.
  - If `:hover` stuck permanently (a real sticky-hover defect), the test fails loudly.
  - The only thing it tolerates is a transient stale `:hover` that the browser clears on its own. That is browser
    hover-refresh behaviour under a stationary pointer, not product CSS.
- So the unexplained (a)/(c) cannot make the fix wrong. The fix is correct for every cause in which the trigger is
  `:hover` at the rest read, and the CI operand proves the failure is in that class.
- `settleToHover` additionally asserts that the control is `:hover` and under the pointer before the hover read. That
  strengthens the test.
- Assertions are unchanged. I checked by diff (`git diff beb94adfe...HEAD -- e2e/`): `not.toEqual(rest)` still runs for
  all six instances and `toEqual(DESKTOP_HOVER[theme])` is untouched. There are no retries, no skip/fixme and no timeout
  change. The touch describe is untouched.

**Mutation / stability / CI**
- Mutation logs:
  - `mutation-settleToRest-noAnimationsOnly.log`: 7 failed / 3 passed.
  - `mutation-settleToRest-noop.log`: 3 failed / 3 passed.
  - `green-guard-after-fix.log`: 10 passed.
- Stability:
  - Leg-2: 3 full passes, every batch green (73+49, 73+47, 73+47).
  - Supplementary: 44 + 54 passed.
- My own fresh run, on lane servers (`helio_hel1790`, 7222/10129, `ANTHROPIC_API_KEY` empty, `assert-phase servers`
  PASS, nice 19, 2 workers):
  - Command: `hel1675-shared-hover` + `hel1790-hover-probe`, `--repeat-each=2`.
  - Result: **12 passed (1.4m)**, exit 0.
  - All Select-trigger lines show `waited=0ms first.hovered=false`.
  - Servers were stopped with `stop-servers.sh`.
- PR #1191, run 44685378992 at 6d9e95540: conclusion `success`. Its log shows instance-3 first samples not hovered, so
  this run did not exercise the mechanism. That is disclosed.
- CI for HEAD a6500058c (run 44689678648) was still in progress at review time.
- AC4 ("CI on main is green") is post-merge only.

### Recommendation to the owner (what further evidence would suffice, and at what cost)
1. **Recommended: waive the (a)/(c) bar and merge.**
   - The fix does not depend on (a) or (c).
   - The fix fails loudly for any persistent variant.
   - The permanent first-sample instrumentation will log `first.hovered=true` with theme and instance on any future CI
     run where the old read would have fired. That builds the (a)/(c) evidence passively, at zero cost.
   - Optionally file a follow-up to read those lines after N main runs.
2. **If the owner wants (a)/(c) before merge,** the only obtainable source is real runners. Local natural rate is 0/40.
   - Push a temporary CI-only diagnostics commit that restores the old unsettled rest read, keeping the instrumentation.
     Run `e2e (2)` about 8-10 times, half of them with `THEMES` order swapped (light first) to separate theme from order.
   - Cost: about 15 min per leg, roughly 2-3 hours of wall time, with a real chance of few or no fires. Only about 3 of
     the last 5 fast-profile runs fired, and 0 of the last 2.
   - Even then, (c) will likely resolve to "probabilistic", not a deterministic discriminator.

### Non-blocking notes
- Commit or archive the untracked planning and evaluation artifacts in the change dir at Delivery.
- The 96 ms vs 162 ms post-hover wait (trace call@36808 vs @36742/@36778) is worth adding to `root-cause.md` as
  real-run support for "not at rest".
- `TICKET_TYPE: feature` on a bug ticket (workflow-state.md) is cosmetic.
