## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit `207c33f7` on top of `12e4474d`/`aafb34ed`/`2bd7c268`/`b16a3382` (base `7b872db9`).
§4/§5 remain de-scoped and are not evaluated as gaps.

Both cycle-2 change requests are substantively fixed and the CR-A retraction is handled well.
The guard is **not** vacuous — I tested that directly and it has teeth. One blocking issue
remains, and it is in the place cycle 2 already flagged as fragile: **Case A is flaky, ~40% on
my measurements**, and I root-caused it.

### Phase 1: Spec Review — PASS

- **The CR-A retraction is complete and honest.** `files-modified.md` carries the full
  retraction with the corrected border figures (4.9596 dark / 3.4815 light) and explicitly
  withdraws the HEL-1046/1050 attribution. The in-code comment where `KNOWN_RESIDUAL_RATIOS`
  used to live now explains what the defect was rather than leaving a silent deletion.
- **Confirmed independently, as asked:** neither `design.md`, `proposal.md`, `tasks.md` nor the
  spec delta names the 10 sites or either ratio. `grep -rn "1\.0828|1\.1443|HEL-1046|HEL-1050|residual"`
  across all four returns only pre-existing, generic scope-boundary statements — design.md:128
  ("the token's own derivation stays out of scope (HEL-1046/1050)"), design.md:254, tasks.md:26,
  plus HEL-1050 references about the *source* guard. Every one of those remains true and correct
  independently of the retraction: they are statements about what this ticket does not own, not
  claims that a residual was found. No correction is needed there. The executor's read is right.
- No AC is claimed that is not met. The spec delta's "whichever mechanism conveyed focus" is now
  actually implemented, which was the outstanding Phase-1 consequence from cycle 2.

### Phase 2: Code Review — FAIL

Gates, re-run fresh by me:

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run check:e2e-types` | PASS |
| `npm test` | PASS — 3143 tests; helio-mcp 248 |
| `e2e/focus-presence-guard.spec.ts` | PASS — 196 elements, 8 views, 98070ms, **0 residuals, 0 failures** |
| `e2e/hel520-focus-presence-guard.regression.spec.ts` | **FLAKY — 3 of 5 runs passed; see below** |
| `git status --short` after every run | clean |

---

#### Does the guard still have teeth? Tested directly — yes.

This was the right question to ask, so I tested each of the four sub-questions rather than
reasoning about them.

**1. Case A still goes red for the stated reason.** When it runs correctly the mutated arm
reports `no-indicator`, from the early return at `focusPresenceProbe.ts:206` that fires *before*
any candidate is collected. The any-channel rule cannot rescue it, because the rule only ever
sees channels that changed and in this case none did. Structurally sound. (Its determinism is
the blocking issue below — the logic is right.)

**2. Case B still goes red, and the clip check is genuinely per-channel.** Run against the
reverted `PipelineDetailHeader.css`, exactly as you suggested:

```
[Case B][baseline] verdict=pass     ratio=5.1089714871982395
[Case B][mutated]  verdict=clipped  detail=outline: clipped on X by ancestor box [302.0,553.3]
[Case B][reverted] verdict=pass     ratio=5.1089714871982395
```

Note the `outline:` prefix in the detail — `isClipped` is called per candidate with that
candidate's own `bandExpand`, and a clipped candidate is `continue`d rather than credited
(`focusPresenceProbe.ts:376-380`). So the very defect this ticket originally fixed is still
caught under the any-channel rule. This was the most important thing to check and it is clean.

One structural note, not a defect: if an element's outline is clipped but its *border* also
changes and clears the floor, the element now passes. That is correct behaviour — an unclipped
border swap is something the user actually sees — but it is a genuine widening versus the
precedence rule, and worth knowing. It does not apply to the `PipelineDetailHeader` button,
whose only changed channel is the outline.

**3. Can the any-channel rule credit a channel that isn't functioning as an indicator?**
Partly, in principle — and I measured that it does not happen anywhere in this app.

The principle: a candidate is only collected when its `*Changed` flag is true, so an unchanged
channel can never be credited. But the ratio measured is the channel's **absolute** contrast
against the backdrop, not the **magnitude of its change** from rest. So an element whose
background shifts imperceptibly (1/255) under focus would have its whole, possibly
high-contrast, background credited. Four channels means four chances at that.

The measurement: I swept `/` and `/settings` with the shipped `FOCUSABLE_SELECTOR` and the same
real-`.focus()` + CDP-forced `:focus-visible` path, recording which channels change per element.
Across 50 visible focusable elements:

```
outline: 47   box-shadow: 11   border: 3   background: 2   no channel changed: 0
elements rescued ONLY by a border or background candidate: 0
```

Every element that changes border or background *also* changes outline or box-shadow, so no
element in the measured population depends on a weak-magnitude candidate to pass. The hole is
real but currently has **zero exposure**, and it is inherited (the old precedence rule's final
`else` branch graded `backgroundColor` the same way) rather than introduced by this fix.
That makes it a documented limitation, not a blocking finding — see the non-blocking suggestions.

**4. The CR-B floor is non-vacuous.** `assertRouteFullyCovered` now throws unconditionally when
`totalStamped === 0`, before the `coveredIds.size >= totalStamped` early return that used to
swallow it (`focus-presence-guard.spec.ts:110-116`). The message names the view. A route that
renders nothing now fails on its own terms. Correct fix, correctly placed.

---

#### [BLOCKING] The Case A regression arm is flaky — 2 failures in 5 runs, root-caused

I ran the harness five times. Case A failed twice:

```
run 1  [mutated] verdict=fail          ratio=1.440754096742417      -> FAILED (expected no-indicator)
run 2  [mutated] verdict=no-indicator                               -> passed
run 3  [mutated] verdict=no-indicator                               -> passed
run 4  [mutated] verdict=fail          ratio=1.440754096742417      -> FAILED
run 5  [mutated] verdict=no-indicator                               -> passed
```

Case B passed every time. The baseline and reverted arms were stable throughout at
`pass ratio=4.9596025224053735` — which independently confirms cycle 2's CR-A diagnosis, since
that is exactly the border-channel ratio I measured by hand last cycle.

Root cause, and it is the same hazard the cycle-2 `measureLive` fix was written to close, just
under-margined:

- `measureLive` blurs and then waits **200ms** before reading `base`
  (`hel520-focus-presence-guard.regression.spec.ts:101`).
- `--app-transition` is `0.16s` = 160ms (`frontend/src/theme/theme.css:64`), and `inputs.css`
  transitions `border-color` and `box-shadow` on it.
- 200ms is **1.25x** the transition. Every other settle in this ticket's code uses **400ms**,
  including the very next wait in the same function (line 105), whose comment argues for 400 as
  ">2x headroom" against this exact 160ms transition. The steady-state guard uses 400ms for the
  same reason.

So when the blur-side transition has not finished, the mutated call's `base.raw.borderColor` is a
mid-transition value rather than the true resting one. The injected style pins the forced
border-color to the *resting* value read in step 1, so forced ≠ base, `borderChanged` is true, a
border candidate is collected, and the arm reports `fail ratio=1.4407` (a partially-transitioned
border) instead of `no-indicator`. The constant 1.4407 across both failures is consistent with a
deterministic intermediate frame, not with noise.

Why this is blocking despite the live guard being fine:

- Task 7.4 and design.md D6a require the arm go red **for the stated reason**. An arm that
  reports the wrong verdict 40% of the time is not a proof of the `no-indicator` branch; it is a
  proof that runs sometimes. The next person to run this harness has a 2-in-5 chance of
  concluding the guard is broken.
- The cycle-2 handoff presented the `measureLive` fix as "the correct, general fix for
  `measureLive` itself, not a Case-A-specific workaround", validated by a single passing run.
  Repetition is what distinguishes a fix from a coin flip, and it was not done.

What is **not** wrong, and should not be over-corrected: the live sweep's teeth are unaffected.
Even in the failing runs the mutated element still receives a *failing* verdict (`fail` at 1.44,
below the 3.0 floor), so a genuinely suppressed indicator is still caught in production use. This
is a defect in the determinism of the evidence, not in the guard's detection.

Required: raise the pre-`base` settle at line 101 from 200ms to 400ms, matching line 105 and the
steady-state guard, and update its comment to state the derivation (160ms transition, 2.5x
headroom) rather than the bare number. Then **run the harness at least five times** and record
that it is 5/5, not 1/1 — that repetition is the actual deliverable here, per the same standard
the rest of this ticket has been held to.

---

#### CR-A's implementation — correct

`measureOneElement` (`e2e/support/focusPresenceProbe.ts:245-429`) now collects a `Candidate` per
changed channel, applies `isClipped` per candidate with that candidate's own `bandExpand`
(ancestor boxes read once and cached), measures each independently, passes if any clears
`FOCUS_NONTEXT_CONTRAST_THRESHOLD`, and reports the best ratio. It is genuinely the any-channel
rule and not a precedence reorder. Error handling improved as a side effect: an unparseable
box-shadow no longer aborts the whole element, it drops that one candidate and records the
reason, with `unresolved-backdrop` reserved for the case where nothing measurable survived.
Clipping is reported in preference to unresolved when no candidate produced a ratio, which is
the more actionable finding — a good call. The allowance block is deleted outright and
`failures` is now an unfiltered `f.verdict !== "pass"`, so nothing is suppressed.

### Phase 3: UI Review — PASS

Triggers matched. Servers had again exited between cycles; restarted via
`scripts/concertino/start-servers.sh` (5952/8859) and cwd re-verified with
`readlink /proc/<pid>/cwd` (4 matching processes) before any measurement was trusted. No bare
`npx playwright`/`npm`/`vite` invocation — absolute binary path, explicit `DEV_PORT`/
`BACKEND_PORT`, `-c` naming this worktree's config.

Rendered evidence: the main sweep (196 elements, 8 views, 0 failures), five regression-harness
runs, and my own 50-element channel-change measurement. No `frontend/src` runtime or style code
changed this cycle, so there is no new UI surface; cycle 1's CSS offset fix remains verified by
Case B on every run. No console errors surfaced. `git status --short` clean after every run —
no leftover source mutations from the harness.

Subjective visual judgement remains the skeptic's.

### Overall: FAIL

One blocking item, narrow and mechanical: a 200ms constant that should be 400ms, plus the
repeated run that should have caught it. Everything else this cycle is correct, and the two
cycle-2 CRs are properly closed.

### Change Requests

1. **Fix the Case A flake and prove the fix by repetition.** In
   `e2e/hel520-focus-presence-guard.regression.spec.ts:101`, raise the pre-`base` blur settle
   from `waitForTimeout(200)` to `waitForTimeout(400)`, matching line 105 and the steady-state
   guard, and rewrite the comment to give the derivation (`--app-transition` is 160ms,
   `theme.css:64`; 400ms is >2x headroom) instead of an unexplained constant.
   Then run the harness **at least five consecutive times** and record in `files-modified.md`
   that all five passed — a single green run is what let this through last cycle.
   Observed failure signature to confirm you have eliminated, not merely reduced:
   `[Case A][mutated] verdict=fail detail=ratio=1.440754096742417` where `no-indicator` is
   expected, at a rate of 2 in 5.
   If 400ms does not make it deterministic, do not escalate the timeout further without a probe:
   read `base.raw.borderColor` in the failing run and confirm whether it is a mid-transition
   value, which would either confirm the diagnosis or refute it cleanly.

### Non-blocking Suggestions

- **Name the weak-magnitude limitation in `measureOneElement`'s comment.** Each candidate is
  graded on its channel's absolute contrast against the backdrop, not on the magnitude of its
  change from rest, so an imperceptible shift in a high-contrast channel would be credited.
  Measured exposure today is zero (0 of 50 elements across `/` and `/settings` depend on a
  border- or background-only candidate; outline changes on 47 of 50), and the limitation is
  inherited from the precedence rule rather than introduced here — so this is documentation,
  not a fix. A future ticket could require a minimum delta between rest and focused colour.
- Worth recording in the same comment that a clipped outline can now be rescued by an unclipped
  border/box-shadow candidate that clears the floor. That is intended behaviour, but it is a real
  difference from the precedence rule and a reader will want it stated rather than inferred.
- The two stale "occlusion sampling" comments in `e2e/focus-presence-guard.spec.ts` (~lines 258
  and 263, carried over from cycle 2's non-blocking list) are still there. The 400ms
  transition-wait rationale is worth keeping; the occlusion framing describes code that no longer
  exists.
- `assertRouteFullyCovered`'s `coveredIds.add` placement and the stamp-filter visibility
  predicate mismatch (both from cycle 2's non-blocking list) remain unaddressed. Neither has
  fired; both are still worth a line each.
- This worktree still has no root `node_modules` and resolves through the parent repo's; the dev
  servers have now died between all three of my cycles. Both are environment notes for the
  orchestrator, not defects in this change.
