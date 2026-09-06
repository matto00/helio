# HEL-972: OpDropdown menu detaches intermittently on the step/branch pickers — ~45% on main; pre-existing, confirmed by A/B

## Description

`OpDropdown`'s open menu intermittently detaches from the DOM while the user is reaching for an item, so the click lands on nothing. For a real user this is a menu that ignores a click shortly after adding a step — up to ~45% of the time in rapid interaction. The user clicks "Branch" / "+ lane" / "insert step here", the picker opens, they click an item, and nothing happens. This ships on `main` today; it has been invisible only because nothing exercised the affordance hard enough to catch it.

Beyond the user-facing defect, this flake now taxes essentially every PR in the repo. Three consecutive PRs (#555, #562, #563) failed `e2e/hel968-multi-root-editor-flow.spec.ts:41` with an identical `locator.click: Test timeout of 30000ms exceeded` signature, none of which could plausibly have caused it (one a Scala test file, one a comment-only frontend diff, one backend domain logic). All three went green on a bare `gh run rerun --failed` with no code change. This erodes the meaning of a red e2e and forces a human judgement call on every failure. The ticket was raised to Urgent on that basis.

### What is ALREADY SETTLED — do not re-derive or re-litigate

- **The race predates HEL-912.** A/B experiment: 9 of 20 iterations failed (45%) on base `a45e9881`, a HIGHER rate than the ~20-25% seen on the HEL-912 branch. Method: separate worktree at `a45e9881`, own Postgres, dedicated backend/frontend, single worker. HEL-912 merely wrote the first spec driving the affordance hard enough, and soon enough after a step-list change, to expose it.
- **It is NOT an unmount/remount.** `OpDropdown` was instrumented with mount-id + render-count logging across 8 further iterations and a live failure was captured: the failing instance stayed mounted throughout, same mount id start to finish. StrictMode double-invoke appears in passing *and* failing runs alike — dev-only noise, not the cause.
- **The discriminator is render churn.** The failing instance re-rendered **6 times** while open, versus **2** on every passing iteration. Something dispatches several state updates to an ancestor in a tight burst, in the window after the picker-opening click and before the menuitem click lands.
- **Fresh-vs-populated database is not the discriminator.** It fails at a similar rate either way; "the test depends on ambient dev-DB state" is ruled out.

### The leading correlate — NOT yet a confirmed cause

`usePipelineDetailPage`'s 300ms-debounced `analyzePipeline(id)` dispatch fires after any step-list change, which a just-created Filter step is. It remains the leading candidate but has never been isolated.

Related static lead (a lead, not the conclusion): a freshly-allocated object literal is passed as `anchorRef` on every parent render, so `OpDropdown`'s `useLayoutEffect` keyed on `[anchorRef]` re-runs on *every* re-render of the parent, not only when the anchor actually changes.

Live-tree locations as of base `62b428db` (line numbers have drifted from the ticket's own citations; two literal sites exist today, not three):
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx:312` — `anchorRef={{ current: insertAnchorEl }}`
- `frontend/src/features/pipelines/ui/BranchAffordance.tsx:46` — `anchorRef={{ current: anchorEl }}`
- `frontend/src/features/pipelines/ui/OpDropdown.tsx:42-49` — `useLayoutEffect(..., [anchorRef])`
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:261-262` — the 300ms debounced `analyzePipeline(id)` dispatch (plus an immediate mount dispatch at :219)

The tail/branch surface at `PipelineRiverView.tsx:361` and `:497` already passes a real ref (`addStepButtonRef`), so it is NOT one of the literal-object sites.

## Acceptance criteria

- [ ] **Isolate the debounce FIRST, before designing any fix.** Temporarily disable `usePipelineDetailPage`'s 300ms `analyzePipeline(id)` dispatch *alone* and re-run the repeat loop. This is the one experiment nobody has done, and it is what turns the leading correlate into a confirmed cause or eliminates it. Record the measured flake rate with the dispatch disabled against the measured baseline rate.
- [ ] **Probe-confirmed mechanism for the render burst — not a plausible story.** `systematic-debugging` applies: no fix without a probe-confirmed root cause. A correlation, a static code reading, or "this pattern is known to be bad" is not a root cause.
- [ ] **Fix verified by repeated runs — 20+ iterations, not a single green.** A ~45% defect passes often enough that one green run proves nothing and must be treated as no evidence at all. State the iteration count and the pass/fail tally explicitly.
- [ ] **`e2e/hel912-lanes-rejoin.spec.ts` is UN-QUARANTINED** — its `testIgnore` entry removed from `playwright.config.ts` — and passes repeatedly. This is a hard acceptance criterion, not a nice-to-have: that spec is this fix's verification, and the ticket is NOT done while the guard is still out of service.
- [ ] Re-check HEL-962 (`hel908-tail-attach.spec.ts`) afterwards and report whether it is affected — different root cause (a stale `"Add tail step"` locator left by HEL-943's rename to "Branch"), same affordance, worth confirming. **Report only — do NOT un-quarantine it or fix it in this change without escalating first.**

## Scope boundaries

- HEL-964 (`hel908-full-flow`) and HEL-962 (`hel908-tail-attach`) look like the same or an adjacent family. They are explicitly OUT of scope for this change. If the fix appears to resolve either, say so in the report and escalate — do not fold them in.
- No production database access and no deploy access is available to this run.

## Verification environment

This run has the Playwright session exclusively — nothing else is running and nothing else will be started until it completes. Long repeated loops can be run without contending for the browser or the dev database. Use that: the verification bar here is statistical, and there is budget for it.
