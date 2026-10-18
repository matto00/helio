## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `00dfd8df200b03d79f8c088ce9436f152bd5dfdd` (the delta since cycle 2 is `a866b1bdd..00dfd8df2`). The base was
resolved live as `29cb0a60f41e72b0a6b26c15a28360c504fffdb8`.

Evidence (persisted):
- Measurements: `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/eval3/evaluator-cycle3-measurements.json`
- Screenshot of the post-Run state at 375×812: `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/eval3/after-run.json.after-run-succeeded.png`
- The probe scripts are in `.concertino/scratch/HEL-1582/eval3/`.

All live checks ran in my own headless Chromium (isMobile, hasTouch, DSF 2) against this worktree's servers. I confirmed
the server processes' cwd before trusting them. Page loads were paced to stay under the 120 req/60 s per-user `/api`
limit; my first unpaced probe hit "Rate limit exceeded" (HEL-1620).

### Gates (fresh)

| Gate | Result |
|---|---|
| lint, format:check, typecheck, frontend build | exit 0 |
| jest (2 workers) | root 524/524; frontend 704 suites / 8869 tests |
| check:tokens, e2e-types, openspec, spec-structure, e2e-user-cleanup, e2e-evidence-paths, repo-integrity | all exit 0 |
| Playwright under the lock, 2 workers: the whole `hel1582-mobile-pipeline` file, `hel1628-source-sample-label` and `state-surface-contrast-guard` | **39 passed** (3.0 min) |

### Cycle-2 change request: back link versus schedule-chip expander — RESOLVED

I measured every header control's real hit extent with `elementFromPoint` bisection at 0.25px steps. The table covers
the never-run state at all three widths and is summarised in the rows below it.

| State | 375 | 390 | 768 |
|---|---|---|---|
| never-run | 0 controls < 43.75 | 0 | 0 |

Every other state also had **0 controls under 43.75 px at every width**, and painted inputs were at least 43.25 px:
- succeeded;
- long source name plus a long pipeline name;
- persisted failed;
- paused schedule (on both a never-run and a run pipeline);
- queued: the label read "Queued…", taken while the run POST was held open;
- in-session after a Run: a real failing run gave "Failed: Run blocked: 1 error-severity assertion(s) failed — unique(status)…", and a real succeeding run gave "Snapshot replaced: 14 rows";
- rename (dirty) and the discard confirmation.

Two states were not driven directly:
- **"running"** is the same label slot as "Queued…".
- **The failed state** is covered by both a real failure and a persisted one.

The status line's `margin-top` and the 44px rename field are correct, and the new e2e header sweep runs with no prior
run plus in rename mode.

### Phase 1: Spec Review — FAIL

AC2, AC3 and AC4 hold. **AC1 is not robust.**

The spec (`pipeline-detail-mobile-layout`, "Steps tab…") says: "At 375×812 a pipeline with one source, three steps and
one Output SHALL show the source card, all three step rows and the Output card fully, above the floating action bar,
without scrolling."

Measured Output-card margin to the bar top at 375×812, at scrollTop 0:

| State | Header | Output bottom vs bar top (696) |
|---|---|---|
| never-run | 92 | 666, margin **+30** |
| succeeded on page open (the e2e seed state; long names change nothing) | 114.8 | 688.8, margin **+7.2** |
| queued | 108 | margin **+14** |
| in-session failed (a real failed run, long error) | 108 | margin **+14** |
| **in-session succeeded, right after tapping Run pipeline** | 124 | **698, margin −2** |
| rename / discard confirm (a transient editing state) | 162.8 | margin −40.8 |

After the page's own primary action succeeds, the status line wraps to three lines:
- "Snapshot replaced: 14 rows";
- "14 rows written · 1 minute ago" (a stale persisted relative time shown next to the fresh in-session result);
- the schedule chip.

That pushes the Output card 2px under the floating bar. The pills cover the card's bottom border (see the screenshot).
The executor's own fit criterion (`assertFits`: `bottom ≤ barTop + 0.5`) would be red in this state. The e2e never
measures it, because AC1 is asserted only on page open.

The 7.2px steady-state margin therefore has less headroom than the status line's ordinary third line (about 22px). I do
not consider it robust.

### Phase 2: Code Review — PASS

The cycle-3 delta is a small, correct CSS change under the touch gate (tokens only, with a guard test), a rename field
painted at the text-field floor, the `run` seed flag, never-run fit and header sweeps, and the corrected BottomSheet
comment. Nothing regressed: all gates and the 39 e2e tests pass.

### Phase 3: UI Review — FAIL

The touch floor is clean in every header state and width (see above). The fit is broken by 2px at 375×812 after an
in-session successful run. The 390 and 768 widths fit in every state I measured.

### Overall: FAIL

### Change Requests

1. **AC1 / spec "Output card fully, above the floating action bar" fails by 2px at 375×812 right after a successful
   in-session Run.** The header grows to 124px because the status line (`MobilePipelineHeader.tsx`, the
   `.mobile-header__status` row) shows the in-session label "Snapshot replaced: N rows" **and** the persisted
   `SpineLastRunMeta` "N rows written · <relative time>" together, which wraps the chip to a third line.
   - **Fix.** Keep the status line at two lines in every run state at 375. One option is to hide the persisted
     `SpineLastRunMeta` while an in-session status (`sseStatus ?? runStatus`) is shown: it is redundant and stale there.
     Another is to keep the in-session label and the meta on one ellipsized line. Do not shave the AC1 margin elsewhere.
   - **Test.** Add AC1 assertions to `e2e/hel1582-mobile-pipeline.spec.ts` for the in-session states, at minimum after
     tapping Run pipeline and the run succeeding, plus "Queued…". Use the same `assertFits`, which must go red on the
     current code.

### Non-blocking Suggestions

- The rename/discard-confirm state pushes the Output card 40.8px under the bar at scrollTop 0. It is a transient
  editing state the user scrolls past, so I am not counting it against AC1. It is worth noting in the PR.
- A pipeline with an analyze warning shows the `SpineStatusStrip` banner (about 46px), which also pushes the Output card
  below the bar at 375. A banner is legitimately extra content, but this is another sign the fit margin has no headroom.
- The earlier notes still stand: the Dry run hover changes only 1.025:1 from its rest fill in light, and
  `PipelineMobile.css` is about 520 lines.

### Critical Path

This is the final cycle (3 of 3). The one remaining blocker:
1. **The status line must not wrap to a third line after an in-session Run at 375×812**, which today puts the Output card
   2px under the floating action bar. It needs a small header change (drop or merge the stale persisted meta while an
   in-session status shows) plus an e2e AC1 assertion in that state.

Everything else is verified and green:
- the five cycle-1 change requests and the cycle-2 back-link fix;
- the touch floor in every header state at 375, 390 and 768;
- no exit flash, measured live;
- all gates, and 39 e2e tests.

**Recommendation for the human:** the defect is real and measured, but it is 2px, the Output card stays readable, and
it occurs only in the transient post-Run state. Either:
- (a) send one more targeted executor pass for the change request above (low risk, about 1 hour); or
- (b) accept the change as is, and file the fix as a follow-up tied to HEL-1631, which will add a draft-status row to
  the same bar and so reduce this margin further.

I lean to (a): HEL-1631 makes the bar taller, so the fit margin only shrinks from here.
