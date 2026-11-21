## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/hover-probe-wait-hang/HEL-1813`.
- Read ticket.md, proposal.md, design.md, tasks.md, workflow-state.md. No TODO/TBD placeholders. The proposal, design and tasks agree with each other. All three ticket ACs are covered: root cause → 1.2–1.4, 20 passes plus a bounded worst case → 3.2/3.3, mutation red → 3.1. The change is test-only and no contract delta is needed.
- Spec on base (`afc2a6872`) `e2e/hel1790-hover-probe.spec.ts:37-46`: the rAF-polled `waitForFunction` has no timeout and `test.setTimeout(240_000)` (line 31). This confirms the unbounded wait. Lines 19-21 (`noAnimations`) are also unbounded, apart from the test timeout. `settle` in `e2e/support/hel1790Rest.ts:60-75` is already bounded at 10 s.
- CI trace (`.concertino/scratch/HEL-1813/ci-main/tr/1-trace.trace`), parsed myself:
  - The click on `.spine-row__select` ends at 612014.8 at point (195, 363).
  - `waitForFunction` (call@15810) starts at 612026.8 and has no `after` event.
  - Root is `data-theme="dark"` with no `data-motion`, so the full `bottom-sheet-in` slide applies, not the subtle fade.
  - Screencast frames arrive about every 20-45 ms during the slide.
  - Frame `...446453.jpeg` (t=612103) shows the sheet mid-slide. Frame `...446680.jpeg` (t=612330) shows it at rest: the `duration_s` trigger sits at about y≈248 CSS px, above the 360..366 pointer row.
  - So the trace is consistent with "the sheet slid past the window and then rested above it". The cause is not yet proven, which is what the design's probe step is for.
- Motion tokens (`frontend/src/theme/theme.css:163,170,176`): the slide runs 280 ms with an ease-out of `cubic-bezier(0.3, 0.9, 0.4, 1)` over about 828 px. Under jank, a single frame can easily cover more than the window. The hypothesis is plausible.
- Consumers of `e2e/support/hel1790Rest.ts` (grep over `e2e/`): `hel1790-hover-probe.spec.ts`, `hel1675-shared-hover.spec.ts` **and `hel1735-feature-hover.spec.ts`** (line 7 imports `settleToHover`/`settleToRest`; line 472 calls them).
- HEL-1790 baseline red rates (`openspec/changes/archive/2026-11-19-fix-shared-hover-select-flake/skeptic-final-1.md:66-68`): the noAnimations-only mutation was 7 red / 3 green, and the no-op mutation 3 red / 3 green. Neither was red every time.

### Verdict: REFUTE

### Change Requests
1. **Missing regression consumer.** design.md Decision 5, proposal.md Impact and tasks.md 3.4 name only `hel1675-shared-hover.spec.ts` as the other consumer of `e2e/support/hel1790Rest.ts`. But `e2e/hel1735-feature-hover.spec.ts:7` also imports `settleToHover`/`settleToRest` from it. Required changes:
   - Add hel1735 to the Impact list and to Decision 5.
   - Change task 3.4 to: "if `hel1790Rest.ts` changed, both `hel1675-shared-hover.spec.ts` and `hel1735-feature-hover.spec.ts` pass in full".
   - Add hel1735's behaviour to the Non-goals.
2. **The preferred fix can bring back the race it removes (Decision 3).** "Find the sheet's `bottom-sheet-in` animation, pause it, seek…" does not say *when or how* the animation is captured. If it is looked up from the test after `click()` returns, through `page.evaluate` → `document.getAnimations()`, it is a race against a 280 ms slide. That lookup is the same Node↔page round trip that jank stretches. A CSS animation that has finished with `backwards` fill is no longer returned by `getAnimations()`, so under the CI conditions in question the lookup can find nothing. That is a fast failure instead of a hang, but it is still a flake. Required changes:
   - Decision 3 must say the capture is race-free. For example: an in-page listener installed *before* the click (such as a capturing `animationstart` handler on `document`, filtered to `animationName === "bottom-sheet-in"`) that pauses the animation synchronously. Alternatively, an explicit argument why the chosen approach cannot miss the animation.
   - If the animation is not found or has already finished, the spec must fail fast with a message naming that state (Decision 4).
   - Task 2.1 must carry that acceptance signal.
3. **No bar for "still turns it red" (Decision 5 / task 3.1).** The design asks to "report the measured red rate" but sets no pass threshold. A deterministic fix could quietly *lower* the guard's red rate, and this check would still pass as long as one run went red. Since Decision 5 itself predicts that a deterministic forced condition makes the mutation "red in both themes", the threshold should be:
   - each mutation red in every run, in each theme, over a stated N (≥ 5 per theme);
   - if that is not achieved, the rate must be at least the HEL-1790 baseline (7/10 and 3/6, cited above), with the shortfall explained.
   - The threshold must be written into task 3.1.

### Non-blocking notes
- design.md Context calls the condition "a window only a few pixels wide". That is inaccurate. `r.top <= 360 && r.bottom >= 366` holds while the trigger's top is in [366 − height, 360], a band about (trigger height − 6) px wide, roughly 30+ px. The probe's "largest per-frame travel" should be compared against that band width, not against 6 px. Restate the claim, or let the probe measure it.
- Red-first (Decision 2 / 1.5): say where the probe code lives. It should either sit outside `testDir: ./e2e`'s default match, or be a temporary variant that the fix commit removes. Otherwise a committed red/hanging probe spec runs in CI on any push of the red commit.
- Line 19's `noAnimations` wait and line 64's `expect.poll` are also in scope for Decision 4's "every wait bounded". The design covers this ("every `waitForFunction`/poll"); this note only confirms it is intended.
- Theme discriminator: `THEMES = ["dark", "light"]` (`e2e/support/hel1582Phone.ts:17`), so dark is the first test in the file and likely the first on its worker. Cold first-load jank is a strong candidate for "why dark", and the probe should check it explicitly. Decision 1 already allows "per-theme order/load".
- workflow-state.md has `TICKET_TYPE: feature` for what is a flake/bug ticket. This is cosmetic.
- Scope: the sweep's stall trigger (spec:51, `top <= 250`) depends on the rest top being ≤ 250. I estimate about 248 from the trace frame, which is a thin margin. If the fix changes the geometry or seek point, the probe should confirm the stall actually fires.
