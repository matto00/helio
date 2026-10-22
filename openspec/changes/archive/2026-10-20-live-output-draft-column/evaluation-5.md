## Evaluation Report — Cycle 5 (evaluation-5.md)

Reviewed commit: `0d225e632641dba03a6c0f676f047f98e5569ded`. This review covers only what changed since `4eab42cde`.

### Phase 1: Spec Review — PASS

- **Merge `5a3fe8075`** (origin/main `edfd329c8`) is clean. `git show --remerge-diff 5a3fe8075` is empty, so no manual conflict resolution rode in.
- **Docs commit `9a21136d5`** (made with `-n`) touches exactly two files, `evaluation-4.md` and `skeptic-final-3.md`. Nothing else rode along.
- **Constraints.** C1: frontend only. C2: hel1631 is unchanged. C3: unchanged, see below. C7: assessed under (c) and Phase 3.

### Phase 2: Code Review — PASS

Gates, run fresh by me:

| Gate | Result |
|---|---|
| lint, format:check, typecheck | all exit 0 |
| build | exit 0 |
| Targeted jest (`HELIO_JEST_MAX_WORKERS=2`): liveOutput, useIdleCoalesced, ChartPanel*, ChartRenderer, ChartOutputPanel, PipelineDetailPage, PipelineSpine, chart entrance | 43 suites, 538 tests, all passed |
| e2e hel1631 + hel1632, unthrottled, `--trace retain-on-failure`, under the flock | 27/27 passed. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/c5-e2e.log` |

**(a) The guards fail when the fix is reverted.** I mutated a throwaway detached worktree (since removed):

| Mutation | Result |
|---|---|
| M1: `memo` removed from `LiveOutputColumnView` | `LiveOutputColumn.test` "does not re-render its view for an edit…" fails (1/13) |
| M2: `noAnimation` not passed in `LiveOutputRender` | parity test "draws the live chart without animation" fails (1/7) |
| M3: `ChartPanel` ignores `noAnimation` | `ChartPanel.noAnimation` "turns animation off…" fails (1/2) |
| M4: `onToggle` made unstable in `PipelineSpineLayout` (`() => toggleOutput()`) | no test fails (337 passed) |

M4 means the stable-callback part of the fix is unguarded. That gap is non-blocking: the memo guard covers the view, and the phone placement passes no `onToggle`.

**(b) Dashboard charts are unchanged.**
- The override is opt-in: `noAnimation = false` by default in `ChartPanel.tsx`, and with it false the `useMemo` returns `motionOption` untouched.
- Only `LiveOutputRender.tsx:60` passes `noAnimation`.
- `ChartPanel.noAnimation.test` asserts that a chart without the prop keeps its animation.
- All six parity cases still pass, and `noAnimation` is not among the compared props.

**(c) Throttled numbers: rate 4 spot-checked, rate 6 not run.** Throttle added only in the scratch copy.

| Test | Rate | Edit 1 | Edits 2-10 | Mean of edits 2-10 |
|---|---|---|---|---|
| hel1631 :177 | 4 | 92.5 ms | 54.2-62.5 ms | 57.0 ms |
| hel1632 :259 | 4 | 88.2 ms | 54.4-67.9 ms | 59.8 ms |

- hel1632 is about 5% above hel1631, within the claimed 3-9%.
- Both fail the 50 ms budget at rate 4, untouched hel1631 included. That is consistent with cycle 4's claim that rate 4 is beyond this machine for either test, so rate 4 is not a usable pass/fail gate here.

**(d) The unthrottled gap is unattributed, and the evidence points away from per-edit CPU cost.**
- My unthrottled run under load about 4:
  - hel1631: 11.2-25.0 ms;
  - hel1632 step count: 14.4-26.4 ms.
- The gap is small here and was large in the executor's quieter runs.
- A gap that shrinks to about 5% when the CPU is slowed 4x cannot be proportional per-edit work. It looks like a fixed offset of about one frame (15-19 ms ≈ 16.7 ms), from the count commit landing a frame later.
- The two specs also measure differently:
  - hel1632's helper observes all mutations under `document.body` and waits for the live tile too.
  - hel1631 observes only the count cell.
- HEL-1688 found about 4 ms on main with Outputs, so something on this branch, or in this spec's measurement, adds the offset.
- Candidates: the narrower centre column making the filter editor stack (a bigger layout per commit), or the measurement difference above. I did not isolate it.
- **Effect on CI:** CI behaves like the throttled regime, where the gap is about 5%. So for CI it matters only as a few ms of lost headroom. Worth a follow-up probe; not blocking.

**Review notes, non-blocking:**
- The 1500 ms cap concern from cycle 4 (the idle callback is cancelled by every new value) still applies. It is more noticeable now with `QUIET_MS` at 250.
- `useIdleCoalesced.test.ts:37` was correctly re-scaled to `QUIET_MS / 5`.

### Phase 3: UI Review — PASS, with a listed trade-off for the owner

Measured input → live-Output tile:
- 268.8-279.0 ms unthrottled;
- 321-350 ms at rate 4.

That matches the claimed 250-400 ms.

**Is it acceptable against DESIGN.md §10/§11? A listed trade-off, not a defect.**

§10 (motion):
- Turning chart animation off on a surface that redraws on every edit is consistent with §10's intent. Motion must not get in the way of input, and chart data morphs are not one of the token-timed entrance or highlight effects §10 requires.
- Dashboard charts keep their animation, guarded by a test.
- The cost: a user on Motion "Full" sees no chart morph in the live column.

§11 (the "live" marker, a [judgment] rule):
- For about 250-280 ms after the last edit, and for the whole of a continuous typing burst, the column shows the previous draft's frame still marked "live".
- That is a bounded lag rather than a misuse of the marker.
- The cheap fix from cycle 4 still applies: drive the marker from the uncoalesced inputs and show "updating" while a change is pending.

Overall:
- The acceptance criteria's speed budget covers the step count and preview, which still meet it locally at 2.5x (cycle 4). The Output render has no budget, and design D6 pre-approved coalescing.
- A quarter-second settle on a side-panel chart is an acceptable product trade-off.
- It is owner-visible. List it in the PR's "Reversible UI calls" as: about 250-400 ms settle, no chart animation in the live column, and "live" shown on the previous frame during the settle, with the marker change as the follow-up.

I stopped the servers with `stop-servers.sh`. I created no test data outside the e2e teardown.

### Overall: PASS

### Non-blocking Suggestions
- Add a guard for the stable `onToggle` (M4 survived), or drop the comment that relies on it.
- Drive the "live" marker from the uncoalesced source, so the pending-change state reads "updating" (§11).
- Honour `MAX_WAIT_MS` by skipping the idle wait once the cap has passed (from cycle 4).
- Follow-up probe for the unthrottled one-frame offset: compare hel1632's measurement helper against hel1631's, and the 1280 three-column layout against the disclosure layout.
