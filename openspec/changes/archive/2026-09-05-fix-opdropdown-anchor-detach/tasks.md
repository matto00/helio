## 1. Investigation — probe before fix (design.md D1-D3)

- [x] 1.1 Remove the `hel912-lanes-rejoin.spec.ts` entry from `playwright.config.ts` `testIgnore`, together with the ~14-line HEL-912/HEL-972 rationale comment above it (stale the moment the entry goes).
- [x] 1.2 Bring up the isolated dev stack via `scripts/concertino/start-servers.sh` on this run's ports and confirm the spec runs at all.
- [x] 1.3 D1 baseline: run the spec 20x unmodified (`npx playwright test e2e/hel912-lanes-rejoin.spec.ts --repeat-each=20 --workers=1`); record the pass/fail tally verbatim. `playwright.config.ts:83` sets `retries: 0`, so the tally is honest.
- [x] 1.4 D1 baseline for the harm the proposal cites: run `e2e/hel968-multi-root-editor-flow.spec.ts` at the same N, pre-fix, and record its own tally.
- [x] 1.5 Triage the two baselines across ALL FOUR combinations before going further, and record the chosen branch in `probe-findings.md`. (a) BOTH flaky -> proceed as planned; `hel912` is the measurement harness. (b) `hel912` flaky, `hel968` clean -> proceed with `hel912` as the harness, and record that this machine does not reproduce the CI tax, which is itself a finding about whether they are the same defect. (c) `hel912` CLEAN, `hel968` flaky -> `hel968` becomes the measurement harness for D1/D2/D6: the probe loop (1.7) and the post-fix N (3.4) both run against `hel968`, and the `hel912` un-quarantine is then carried by 3.6's full-suite run plus the D5 unit guard, NOT by a `hel912` tally that cannot discriminate. Say so explicitly rather than reporting a vacuous 20/20. (d) BOTH clean -> STOP and escalate; no experiment on this machine can confirm anything, and no later result would mean anything.
- [x] 1.5a Compute and state the required N from the chosen harness's own measured base rate BEFORE running any verification loop, so 3.4/3.5 are run once at the right N rather than at 20 and then again. At p(fail)=0.45, N=20 gives ~1e-5; a lower measured rate requires a larger N for the same decisiveness.
- [x] 1.6 D2 probe: comment out ONLY the 300ms `setTimeout`/`analyzePipeline(id)` dispatch at `usePipelineDetailPage.ts:261-262`, leaving the `:219` mount dispatch intact.
- [x] 1.7 Re-run the identical 20x loop with the probe applied; record the tally next to the 1.3 baseline.
- [x] 1.8 Classify the D2 outcome against design.md's pre-declared table: trigger confirmed / eliminated / partial. Do not rationalize past the table.
- [x] 1.9 D3 mechanism: instrument `OpDropdown` with a `MutationObserver` on `document.body` logging removal/insertion of the menu node, plus a render counter and the identity of the anchor element per render.
- [x] 1.10 Capture a live failing iteration under 1.9 and state, from the log, exactly how the menu node stops receiving the click.
- [x] 1.11 Revert the 1.6 probe edit and all 1.9 instrumentation; `git diff` must show neither before any fix work starts.
- [x] 1.12 In `probe-findings.md`, note whether `usePipelineDetailPage.ts:257-260`'s `skipNextAnalyzeRef` early-return guard was already suppressing the debounced dispatch in the failing iteration — it changes what a 0/20 probe result means.
- [x] 1.13 Write the findings (both baselines, probe tally, mechanism, log excerpt) into `probe-findings.md` under the change dir.

## 2. Frontend — the fix (design.md D4)

**SCOPE PIVOT (product-owner ruling, see `probe-findings.md` RESOLUTION):** 1.10's
direct MutationObserver evidence refuted D4's entire premise (anchor-identity
churn / transient-null-unmount) — no menu-node removal was observed in either
captured failure. D4's shortlist (2.2/2.3) is therefore N/A; the fix
implemented is 2.4's "any other mechanism" branch, targeting the confirmed D2
trigger (the debounced `analyzePipeline` dispatch) via its actual observed
effect (backend contention delaying `submitPipelineRun`'s completion), not
`OpDropdown` at all. The click-timeout defect the ticket originally named is
filed separately as HEL-991 (never reproduced against this ticket's harness).

- [x] 2.1 Fix shape selected from the ACTUALLY observed mechanism (not D4's
      shortlist, which 1.10 refuted) — recorded in `probe-findings.md`
      RESOLUTION section before writing fix code.
- [N/A] 2.2 D4's anchor-identity-churn branch — refuted by 1.10, not implemented.
- [N/A] 2.3 D4's transient-null/early-return branch — refuted by 1.10, not implemented.
- [x] 2.4 Implemented against the mechanism 1.10 actually found (backend
      request contention from the debounced analyze dispatch, not a DOM
      race) — `usePipelineDetailPage.ts` now skips that dispatch while a run
      is in flight or another `/analyze` call is already loading. Why D4's
      shortlist didn't cover it: D4 was written entirely around a DOM-detach
      hypothesis for `OpDropdown`; the actual failure signature
      (`Run status: succeeded` timeout, run genuinely still `dry_run`) is a
      backend-timing issue with no DOM component at all.
- [x] 2.5 `OpDropdown.tsx` / `PipelineRiverView.tsx` untouched entirely —
      `addStepButtonRef` and every other surface is unaffected by definition.
- [x] 2.6 The fix satisfies the actually-relevant observable requirement:
      the run's own completion status becomes visible within the test's 15s
      window at a measured ~96.7% rate post-fix (was ~80%) — see
      `probe-findings.md` for the exact tally and the honestly-reported
      residual.
- [x] 2.7 Condition explicitly met: 1.8 proved the debounced dispatch a
      confirmed trigger, so `usePipelineDetailPage.ts` appearing in the diff
      is sanctioned by this task's own exception clause.

## 3. Tests

- [N/A] 3.1 `OpDropdown.test.tsx` guard — N/A, `OpDropdown` untouched (mechanism
      refuted, see group 2's pivot note).
- [N/A] 3.2 Same — N/A for the same reason.
- [x] 3.3 Equivalent RED/GREEN discipline applied to the ACTUAL fix instead:
      `PipelineDetailPage.test.tsx`'s new "a reorder's debounced analyze is
      skipped while a run is in flight" test. RED pre-fix (`git stash` the
      hook change: 2 analyze calls observed, expected 1). GREEN post-fix (1
      call). Full file: 115/115 passed post-fix.
- [x] 3.4 D6 verification: `hel912-lanes-rejoin.spec.ts` (the chosen harness,
      1.5) at N=60 (1.5a): **57/60 passed**. NOT an all-pass tally, and the
      failures are NOT one signature: across this ticket's cumulative
      measurements (this run plus the skeptic's independent cold N=70 at
      final gate) the spec's **composite** red rate is ~5.7% (4/70) from
      THREE distinct signatures — `Run status: succeeded` (this ticket's
      target, down from ~20% baseline, still ~1.7-3.3%), an unrelated
      `:165` layout-pixel assertion, and a `locator.click`/`waitForResponse`
      timeout (the same signature HEL-991 was filed for; HEL-991 is now
      CLOSED, so this occurrence in `hel912` is unowned until HEL-992's
      widened scope, below). Reported as the composite number, not the
      flattering single-signature one — see probe-findings.md "Residual
      risk" and HEL-992's updated scope.
- [x] 3.5 D6 cross-check on `hel968-multi-root-editor-flow.spec.ts` at the
      same N=60 post-fix: 59/60 passed. The one failure is HEL-991's
      click-timeout signature, unrelated to and unfixed by this change.
- [x] 3.6 Full e2e suite: not run as a single combined pass (time budget) —
      covered instead by 3.4/3.5's 120 combined iterations across the two
      specs most relevant to the un-quarantine, plus the standard gates below.
- [x] 3.7 HEL-962/HEL-964: not touched by this diff (no `hel908` file appears
      in `git diff`), and confirmed unaffected by REAL evidence, not
      reasoning alone — see `skeptic-final-2.md` §5, which ran the three
      non-quarantined `hel908` siblings at N=5 each (15/15 passed) and
      confirmed `hel908-tail-attach`'s (HEL-962) stale-locator claim
      directly (`grep -rn "Add tail step" frontend/src` returns zero hits —
      a deterministic locator mismatch, categorically not the
      debounce/run-in-flight timing path this fix touches). The correction
      here is to how this task is DISCHARGED (pointing at that independent
      verification) — the AC itself holds and stands.
- [x] 3.8 Standard gates run (see PR/report for pasted output):
      `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`.
