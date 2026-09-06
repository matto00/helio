# HEL-972 probe findings (tasks 1.1–1.13, in progress — ESCALATED before task 2)

## 1.1 — testIgnore removed

`e2e/hel912-lanes-rejoin.spec.ts`'s `testIgnore` entry (and its ~14-line rationale
comment) removed from `playwright.config.ts`. This edit is retained regardless of
how the escalation below resolves — the spec needs to be in the default run set to
measure anything.

## Pre-D1 fixture fix (schema drift, unrelated to the ticket's hypothesis)

Before any baseline could be measured, `e2e/hel912-lanes-rejoin.spec.ts` failed
**20/20** iterations at pipeline-creation setup (`POST /api/pipelines` → 400
`key not found: roots`). This is unrelated to the OpDropdown investigation: HEL-913
(merged after HEL-912 was written) replaced the scalar `sourceDataSourceId` field
with a required `roots[]` array, with **no accepted alias** (see
`schemas/pipelines/create-pipeline-request.schema.json`, `PipelineProtocol.scala`).
The spec was still using the old scalar shape. Fixed by changing the request body
to `roots: [{ sourceId: source.id }]` (matching `hel968-multi-root-editor-flow.spec.ts`'s
own usage of the current shape). This fix is retained — the spec cannot run at all
without it — but it is a fixture-currency fix, not related to the OpDropdown bug.

## D1 — baseline re-measurement on this branch (task 1.3/1.4)

**hel912-lanes-rejoin.spec.ts**, 20x, `--repeat-each=20 --workers=1`, unmodified
(post schema-drift fix): **4 failed / 16 passed (20% failure rate)**.

**hel968-multi-root-editor-flow.spec.ts**, 20x (60 total sub-tests: 1 main + 2
viewport variants × 20): **0 failed / 60 passed (0% failure rate)**.

### Triage (task 1.5)

This is closest to combo (b) — hel912 flaky, hel968 clean — so per the pre-declared
table: **hel912 is the measurement harness**, and it's recorded that this machine
does not reproduce the CI tax cited in the proposal (three PRs failing on
`hel968-multi-root-editor-flow.spec.ts:41` with a `locator.click` timeout). Zero
evidence of that specific symptom was seen anywhere in this run (0/60 on hel968,
and no click-timeout failures on hel912 either — see below).

**However, this combo does not cleanly match (b) as written**, and that mismatch is
the substance of the escalation below: the ticket's proposal states hel912 "reliably
detects" the OpDropdown menu-detach defect. The 4 failures actually captured (both
in this baseline and in the later D3 mechanism run) show **a different, specific
failure signature** — see "Mechanism probe" below.

### Required N (task 1.5a)

At the harness's own measured rate p(fail) = 0.20 (4/20), the probability of N
consecutive clean passes by luck alone at N=20 is 0.8^20 ≈ 1.15%, not decisive
enough. Solving 0.8^N ≤ 1e-5 gives N ≈ 52. **Required N = 60** (rounds up for
margin, and matches the N already used for the hel968 cross-check, giving
0.8^60 ≈ 1.3e-6). This N is recorded now, before any verification loop, per 1.5a.

## D2 — debounce isolation probe (tasks 1.6–1.8)

Temporarily commented out **only** the 300ms `setTimeout`/`analyzePipeline(id)`
dispatch at `usePipelineDetailPage.ts:261-262` (mount dispatch at `:219` left
intact). Re-ran the identical 20x hel912 loop:

**Result: 0 failed / 20 passed (0%)**, vs. the 4/20 (20%) baseline.

**Classification (task 1.8): TRIGGER CONFIRMED.** The debounced `analyzePipeline`
dispatch is a real, reproducible trigger for hel912's flakiness on this branch —
this is not a coincidence at N=20 (going from 20% to 0/20 is consistent with the
dispatch being necessary for the failure, though N=20 alone is not decisive in
isolation; the effect direction matches the correlate named in the ticket).

Probe edit reverted immediately after (task 1.11 partial — see below); `git diff`
on `usePipelineDetailPage.ts` is clean.

## D3 — mechanism observation (tasks 1.9–1.10) — THE FINDING THAT TRIGGERS ESCALATION

Instrumented `OpDropdown.tsx` with:
- A render counter, logged every render along with `anchorRef` identity and
  whether `anchorRef.current` was present.
- A log at the `useLayoutEffect`'s two branches (`anchor.current` null → early
  return, vs. a successful `setPos(...)`).
- A `MutationObserver` on `document.body` logging insertion/removal of the
  `.pipeline-detail-page__op-dropdown` menu node.

Also added a temporary `page.on("console", ...)` listener in the spec to surface
these logs in the Playwright run output.

Ran the debounce-restored (i.e. normal/unmodified) hel912 spec 25x
(`--repeat-each=25 --workers=1`) to capture a live failure under instrumentation.

**Result: 2 failed / 23 passed (repeat #6 and #20).**

**In BOTH captured failing iterations, the OpDropdown instrumentation shows exactly
the same clean pattern as every passing iteration**: each of the test's 4 dropdown
opens (Filter, Lane 1 branch, Lane 2 branch, Union rejoin branch) produced exactly
4 renders, one `useLayoutEffect` firing with a real `setPos(...)` (never a null
`anchor.current`), and exactly one "menu node ADDED" — **zero "menu node REMOVED"
events in either failing run.** This is the *direct, observed* opposite of the
ticket's settled discriminator (6 re-renders + a detached node vs. 2 renders when
passing) — on this branch, in this harness, every dropdown interaction (passing OR
failing test) shows the same 4-render, add-only pattern with no detachment.

**The actual failure, in both cases, is unrelated to any OpDropdown interaction.**
Both failures are at the same assertion — the LAST line of the test, well after
every dropdown interaction has already completed successfully:

```
Error: expect(locator).toBeVisible() failed
Locator:  getByLabel(/Run status: succeeded/i)
Timeout:  15000ms
> 244 | await expect(page.getByLabel(/Run status: succeeded/i)).toBeVisible({ timeout: 15000 });
```

The captured `error-context.md` page snapshot for one of the two failures shows the
run status still reading `"Run status: dry_run"` — i.e. the dry run was
**genuinely still in flight**, not stuck behind a missing DOM node. No click
failed; no locator failed to resolve; the run simply hadn't reached `succeeded`
within the 15s window.

### What this means

1. The D2 result (debounce dispatch is a confirmed *trigger* for hel912's
   flakiness) still stands as an observation.
2. But the *mechanism* the ticket names — `anchorRef` object-literal identity
   churn driving `OpDropdown`'s `useLayoutEffect` to re-measure and detach the
   portalled menu mid-click — is **directly contradicted** by the D3 observation.
   There is no render burst, no detachment, no anchor-identity anomaly in either
   captured failure.
3. The actual, observed effect of the debounced analyze dispatch here looks like
   **backend/run-completion contention**: firing an extra `/api/pipelines/:id/analyze`
   request shortly before or during a dry run appears to delay the dry run's own
   completion past a 15s window, on some fraction of runs. This is a plausible,
   real defect, but it is a different mechanism (server-side request contention or
   a run/analyze interaction on the backend) than a frontend DOM-detach race in
   `OpDropdown`.
4. Neither harness (hel912 4/20, or hel968 0/60) produced the specific symptom
   PRs #555/#562/#563 hit in CI (`locator.click: Test timeout of 30000ms exceeded`
   on `hel968-multi-root-editor-flow.spec.ts:41`) or any click-target-detach symptom
   at all, in ~45 combined iterations across both specs plus 25 more under direct
   OpDropdown instrumentation.

This is a genuine contradiction between the ticket's locked "settled" narrative
(discriminator = 6 vs. 2 re-renders; mechanism = anchor object-literal churn) and
what systematic-debugging's probe-before-fix protocol, followed exactly as
specified, actually produced on this branch/environment. Per design.md's D3 ("a
story that merely fits the numbers is not sufficient") and the ticket's own
insistence that 2.2 not be implemented "by default because it matches the
ticket's suggestion," I'm stopping here rather than guessing which of the
following is true:
- The environment/base commit used for the ticket's original mount-id/render-count
  instrumentation differs meaningfully from `62b428db` in a way that changed the
  bug's presentation (e.g. a fix landed in one of the ~20 commits since `a45e9881`
  that already mitigated the DOM-detach symptom, leaving only a residual, unrelated
  backend-timing flake).
- hel912-lanes-rejoin's specific interaction pattern (waits for each network
  response before the next click) never gave the original race a window to
  manifest, and a different, more rapid-click harness would still show it — in
  which case hel912 is the wrong harness for this specific defect despite being
  the only flaky one on this branch.
- The bug described in the ticket no longer exists on `main` and hel912's
  remaining flakiness is a distinct, real, but different-severity defect that
  deserves its own ticket rather than being folded into this one under the
  "anchor churn" fix shape.

None of D4's shortlisted fixes (anchor-element identity, call-site memoization,
ref-held position) address a backend/run-timing contention issue — implementing
one anyway would satisfy the letter of task 2.2 while leaving the actually-observed
failure mode (and the un-quarantine acceptance criterion, which requires the spec
to pass repeatedly) unaddressed.

## Task 1.11 — probe edits reverted

- `usePipelineDetailPage.ts`: reverted, clean (`git diff` empty).
- `OpDropdown.tsx`: reverted, clean (`git diff` empty).
- `e2e/hel912-lanes-rejoin.spec.ts`: the temporary `page.on("console", ...)`
  listener has been reverted; the `roots` schema-drift fix (pre-D1, unrelated to
  the probe) is retained.

## Task 1.12 — skipNextAnalyzeRef

Not yet evaluated in detail against the captured failures — the D3 finding (that
the mechanism is not DOM-detach at all) makes this moot until the escalation
below is resolved and it's clear which investigation thread to continue.

## RESOLUTION (post-escalation, product-owner ruling)

The product owner split the scope: fix the mechanism actually observed and
measured here; file the click-timeout signature (which this investigation
never reproduced on `hel912`) as a separate ticket instead of guessing at it.

### Task 2 — the fix

**Mechanism, finally pinned down precisely:** `submitPipelineRun.fulfilled`
(pipelinesSlice.ts) unconditionally sets `state.runStatus = "succeeded"`
regardless of `dryRun` — this is why the happy path passes at all (Redux's
`runStatus` fills in for the SSE terminal event, which for a dry run is
literally `"dry_run"`, never `"succeeded"` — see `PipelineRunService.scala`'s
`onDryRunSuccess`, `publish(pidStr, RunStatusEvent("dry_run", ...))`). The
test's `getByLabel(/Run status: succeeded/i)` assertion is actually racing the
HTTP-round-trip fallback against the real SSE event, not checking a stable
label. When the debounced `analyzePipeline(id)` dispatch (or an earlier one
still "loading") is competing with the run submission for backend resources,
that HTTP round trip (and/or the SSE event) is delayed past the 15s window.

**Fix implemented** in `usePipelineDetailPage.ts`: the debounced re-analyze
effect now skips dispatching `analyzePipeline` when either (a) a run is
currently in flight (`sseActive`, read via a ref to avoid a stale closure in
the `setTimeout` callback), or (b) an `/analyze` request for this pipeline is
already `"loading"` (Redux `analyzeStatus`). This directly targets the
confirmed D2 trigger without touching `OpDropdown` at all.

**NOT fixed / explicitly left alone:** `submitPipelineRun.fulfilled`'s
"succeeded"-for-every-run-including-dry-runs mislabeling. This is a real,
separate small defect (a dry run's status badge can transiently and
incorrectly read "succeeded" before the true `dry_run`/`Preview: N rows` state
arrives) that happens to be why the flaky assertion can pass at all. Fixing it
properly requires also fixing the test's own assertion (which would otherwise
always fail for a dry run), and is out of scope for a flake fix — flagged here
as a candidate follow-up, not fixed silently.

### Task 3 — verification

- **Unit test** (`PipelineDetailPage.test.tsx`): "a reorder's debounced
  analyze is skipped while a run is in flight" — reorders a step while a held-
  open `submitPipelineRun` promise keeps `sseActive` true, advances past the
  300ms debounce window, and asserts no additional `analyzePipeline` dispatch
  occurred. **Demonstrated RED pre-fix** (`git stash` the hook change, re-run:
  2 calls observed, expected 1) **and GREEN post-fix** (1 call). Full
  `PipelineDetailPage.test.tsx` suite: 115/115 passed post-fix.
- **e2e verification, `hel912-lanes-rejoin.spec.ts`** (the harness this
  ticket's mechanism was measured against):
  - N=20 (first pass, sseActive-only guard, before adding the
    analyzeStatus-loading guard): 1/20 failed (5%) — partial improvement from
    4/20 (20%) baseline, not sufficient.
  - N=20 (both guards in place): **20/20 passed.**
  - N=60 (the required N per 1.5a's decisiveness computation): **57/60
    passed, 3 failed.** Of the 3: **2 are the target signature** (`Run
    status: succeeded` timeout) — measured residual rate ~3.3%, down from the
    20% baseline (~6x improvement) but not fully eliminated. **1 is an
    unrelated, pre-existing pixel-timing layout assertion**
    (`expect(desktopTops[0]).toBe(desktopTops[1])`, 347 vs 351 — a side-by-side
    layout check off by 4px), not this ticket's signature at all.
- **e2e cross-check, `hel968-multi-root-editor-flow.spec.ts`** (post-fix,
  N=20 then N=40, 60 total): 59/60 passed. The one failure is the click-
  timeout signature this ticket's mechanism does NOT explain or fix — see
  HEL-991 below.
- **HEL-962 / HEL-964** (report-only, per scope boundaries): not touched, not
  re-run under this fix specifically. No reason to expect either is affected
  — HEL-962 is a stale-locator problem (unrelated), HEL-964 is a
  `hel908-full-flow.spec.ts` flake with a documented non-reproducible
  history, neither exercises `usePipelineDetailPage`'s debounce/run-in-flight
  interaction in the way this fix touches.

### Residual risk, stated plainly

The fix does not bring `hel912-lanes-rejoin.spec.ts` to a measured 0% failure
rate — it reduced the target-signature failure rate roughly 3-6x (10-20% ->
1.7-3.3%, measured independently twice at N=60/N=30). This is reported
honestly rather than rounded up to "fixed." Filed as **HEL-992** (team Helio
Platform, Normal priority) rather than left as prose here: the remaining
contention likely comes from another concurrent request this specific guard
doesn't cover (e.g. `previewOutput` refreshes fired by
`refreshVisibleOutputPreviews` around the same window a run's completion is
awaited), not from the same `analyzePipeline` dispatch this fix already
suppresses — but that is HEL-992's leading candidate, not yet a
probe-confirmed cause.

### HEL-991 filed

The `locator.click: Test timeout of 30000ms exceeded` signature that hit PRs
#555/#562/#563 on `hel968-multi-root-editor-flow.spec.ts:41` is a genuinely
different defect. `hel912-lanes-rejoin.spec.ts` never reproduced it across
~140 combined iterations in this investigation (its MutationObserver
instrumentation showed clean 4-render, no-removal dropdown behavior in every
captured failure). A fresh N=60 post-fix run of `hel968` itself DID reproduce
it once (1/60): `locator.click` timed out waiting for
`getByRole('menuitem', { name: /Union/i })` after clicking "Branch this
step" — the op-dropdown menu was not present in the page snapshot 30s later.
Filed as **HEL-991** (team Helio Platform, High priority) with the three PR
numbers, why each diff was structurally incapable of causing it, the
MutationObserver refutation evidence, the fresh live repro, and an explicit
note that no rapid-click harness has been built yet and the mechanism is
unknown — do not assume anchor-identity churn without direct observation
against the actual failing interaction.

### HEL-972 (Linear) updated

Title and description updated with a retraction banner at the top: the
DOM-detach/anchor-churn mechanism is refuted by direct instrumentation, what
was actually fixed (debounce/backend-contention), and a pointer to HEL-991
for the click-timeout signature, with an explicit note not to inherit the
~45%/20-25% A/B figures as describing the click-timeout defect.

## Cycle 2 (evaluation-1.md change requests)

Evaluation-1.md's Overall verdict was FAIL for two specific, cheap-to-fix defects
(spec delta describing a refuted mechanism; a suppression that never resumed).
The fix itself and its measured numbers were independently re-verified and
confirmed sound (see evaluation-1.md's own E1-E4).

**CR1 (spec delta):** `specs/pipeline-op-picker-stability/spec.md` rewritten
wholesale. Deleted both DOM-detach/positioning requirements and their five
scenarios (unverified, refuted by direct instrumentation, OpDropdown
untouched). Kept and rewrote the lanes-rejoin guard requirement's second
scenario against the honest, measured bar (~10-20% pre-fix -> ~1.7-3.3%
post-fix, not "every iteration passes"). Rewrote `## Purpose` to describe the
debounced-analyze/run-contention contract that actually shipped, and added a
new ADDED requirement describing that contract's two scenarios directly
(step edit during an in-flight run; step edit during an in-flight analyze).

**CR2 (the real code defect — suppressed analyze was dropped, not deferred):**
Fixed in `usePipelineDetailPage.ts`. The debounce effect's dependency array
now includes `sseActive` and `analyzeStatus`, so the effect re-runs when
either guard clears. A new `pendingAnalyzeRef` marks a deferred dispatch, and
a new `lastAnalyzedFingerprintRef` prevents the effect from dispatching
merely because `analyzeStatus` toggled loading->succeeded as a side effect of
its OWN previous dispatch (adding `analyzeStatus` to the deps otherwise
creates exactly that feedback loop — discovered via a genuinely RED run of
the new mirror test before this second ref was added; see below). Net
behavior: an edit suppressed while the guard is active now dispatches once,
automatically, as soon as the guard clears — it is never silently dropped.

New unit test ("a suppressed analyze (blocked by an in-flight `/analyze`) is
dispatched exactly once after the prior one settles") added, using the
`analyzeStatus === "loading"` guard specifically (not `sseActive`, which only
clears via a real SSE `onTerminal` event this jsdom harness has no transport
for — confirmed while writing HEL-972's original test). Demonstrated RED
against the pre-CR2 "bare `return`" code (2nd edit's analyze never dispatched,
test times out waiting for `callsBeforeEdits + 2`) and GREEN post-fix. Full
`PipelineDetailPage.test.tsx` suite: 116/116 passed post-fix (was 115 before
this cycle's new test).

One pre-existing test regressed when `analyzeStatus`/`sseActive` were added to
the deps array — "an insert changes stepsFingerprint and the existing
debounced analyze re-dispatches" — because its `syncStepsFromServer` resync
mock (`getPipelineStepsMock`) was never updated to reflect the newly-created
step, so the resync reverted local `steps` back to a fingerprint already
recorded as analyzed, and the new (correct) "don't dispatch for an
already-analyzed fingerprint" logic suppressed it. Fixed by wiring that
test's second `getPipelineStepsMock` call to return the post-insert 3-step
list, matching what a real backend resync would actually return — a
fixture-realism fix, not a behavior change to the fix itself.

Re-ran the required N=60 e2e loop after CR2 (the deferral must not
reintroduce the contention it exists to avoid): `e2e/hel912-lanes-rejoin.spec.ts`,
`--repeat-each=60 --workers=1` — **58/60 passed, 2 failed**, both the target
`Run status: succeeded` signature (~3.3%), consistent with (not worse than)
the pre-CR2 fix's own measured range (1.7-3.3% across the two independent
N=60 runs already on record). The deferral does not reintroduce the
contention.

**CR3 (false justification comment):** Corrected as part of the CR2 edit.
The claim "the run's own response ... already carries fresher schema/row
data" is removed. The comment now states the real, checkable reason:
`state.analyzeResult` is written only by `analyzePipeline.fulfilled`
(pipelinesSlice.ts), so a suppressed edit must still eventually dispatch or
the analyze panel is left stale. The D2/D3 evidence citation is kept.

**CR4 (residual follow-up ticket):** Filed as **HEL-992** (team Helio
Platform, Normal), with the `previewOutput`/`refreshVisibleOutputPreviews`
leading-candidate starting point from this document, and acceptance criteria
requiring a probe-confirmed cause before any further fix — not a repeat of
"leave it as prose."

## Cycle 3 (evaluation-2.md change requests)

Cycle 2's fix (698961e1) had one real regression: `pendingAnalyzeRef` was set
**unconditionally** whenever the guard was active, including on an effect
re-entry caused by the SAME fingerprint's own dispatch flipping
`analyzeStatus` to `"loading"` (not a new edit). That spuriously re-armed the
pending flag and defeated the fingerprint bail-out, causing an unbounded
redispatch loop whenever `/analyze` resolves slower than the 300ms debounce
window — invisible under the fast/instant mocks every cycle-2 test used.
Evaluator's probe (mock every analyze at 600ms, one edit, then 5s idle)
measured b992e937 = 1 dispatch, 698961e1 = 6-and-climbing at ~1/830ms.

**Fix:** only set `pendingAnalyzeRef.current = true` when
`lastAnalyzedFingerprintRef.current !== stepsFingerprint` — i.e. only when
this is genuinely a new, not-yet-analyzed edit being deferred, never when the
guard-active branch is re-entered by the dispatch's own state transition.

**Regression test added** ("a single edit's analyze settles once and does
not redispatch indefinitely while idle"): mocks every `analyzePipeline` call
to resolve after 600ms, makes ONE edit, then waits 5.5s idle, and asserts
exactly one additional dispatch (not an unbounded, still-climbing count).
Demonstrated RED against the cycle-2 code (received 7, unbounded and still
growing) and GREEN against the cycle-3 fix. While writing this test, an
initial run showed extra dispatches unrelated to the loop bug — the test had
forgotten to mock `reorderPipelineStepsMock`, which meant `handleReorderSteps`
silently reverted the optimistic reorder after the unmocked call, producing a
second GENUINE fingerprint change (a real, expected extra dispatch, not a
regression). Fixed by mocking it, matching every sibling test's setup. Full
`PipelineDetailPage.test.tsx` suite: **117/117 passed** post-fix.

**Spec gap closed** (evaluator's CR4/CR5): the ADDED requirement "The
debounced pipeline analyze does not contend with an in-flight run" only
constrained what must NOT happen, which cycle-1's silent-drop behavior would
have satisfied verbatim. Added two scenarios: "A suppressed analyze resumes
exactly once when the guard clears" (the resume/no-drop guarantee) and
"Dispatching stops once nothing has changed — no unbounded re-dispatch" (the
termination guarantee this cycle's own regression violated).

**Re-ran the required N=60 e2e loop after the fix:**
`e2e/hel912-lanes-rejoin.spec.ts`, `--repeat-each=60 --workers=1` —
**57/60 passed, 3 failed**. Of the 3: 2 are the target `Run status: succeeded`
signature (repeat25, repeat58 — same signature as every prior cycle's
measurement, ~3.3%), and 1 is the same unrelated pre-existing layout/pixel
assertion seen in earlier cycles (`expect(desktopTops[0]).toBe(desktopTops[1])`,
351 vs 350, repeat20 — a side-by-side layout check off by 1px, not this
ticket's signature).

**On the evaluator's HEL-991 lead:** the click-timeout signature
(`locator.click: Test timeout ... waiting for getByRole('menuitem', ...)`)
did **NOT** recur in this N=60 run. It appeared exactly once, previously, in
a run against the cycle-2 (buggy, request-looping) commit — consistent with
the evaluator's hypothesis that an unbounded `/analyze` retry loop could
starve an unrelated concurrent request enough to produce that exact symptom.
With the loop now fixed, zero occurrences in 60 further iterations. This is
suggestive, not conclusive (N=1 vs N=0 is not itself decisive), but it is
a real, worth-recording data point: **HEL-991 may be far cheaper to
reproduce/fix than currently scoped, since one of its only two known live
occurrences coincided with a request-loop defect that has since been fixed
by an unrelated ticket.** This finding is being posted to HEL-991 directly
so it isn't lost in an archived change.

## Final gate, round 1 (skeptic-final-1.md change requests)

A cold skeptic (inheriting none of the evaluator's conclusions) independently re-verified
the loop fix at four entry points (analyze rejecting, rapid alternating edits, run-in-flight
with no terminal event, unmount mid-deferral), mutation-checked the regression guard
(RED 2/7 on the reverted hook, GREEN after), and probed the contention hypothesis under
artificial CPU load (8 hogs, load avg 13.2 -> 0/20 target-signature occurrences) —
**that hypothesis is closed; not revisited here.** The skeptic REFUTED on two grounds:

**CR1 — a real regression: the `sseActive` guard could get permanently stuck.**
`sseActive` is cleared only by the SSE `onTerminal` handler or a submit-failure catch —
never when the stream fails to open, drops mid-run, or its terminal event is simply missed
(`PipelineRunStreamRoutes.scala`'s live, non-replaying `subscribe` can miss a run that
finishes before the browser's subscription lands). Any of those leaves `sseActive` (and so
this guard) stuck true forever, silently suppressing every future edit's analyze for the
rest of the page's lifetime — the exact permanent-staleness outcome deferral (vs. cycle 1's
drop) exists to prevent.

**Fix:** bounded the deferral in TIME rather than plumbing `connectionError` through this
hook's several run-lifecycle call sites (a wider, riskier change this ticket doesn't
otherwise touch). Added `MAX_ANALYZE_DEFER_MS` (15000ms, chosen to comfortably exceed a
normal run's measured ~6-10s duration while still bounding a genuinely stuck guard to a
fixed window, and to match the same 15s window `hel912-lanes-rejoin.spec.ts` itself uses
for its own run-status assertion). A watchdog timer, started on the FIRST defer for a given
fingerprint (not restarted on every re-entry while still blocked — mirrors the
`lastAnalyzedFingerprintRef` discipline from cycle 3), forces the dispatch unconditionally
if the guard still hasn't cleared when it fires. The watchdog is deliberately NOT tied to
the debounce effect's own dependency-triggered lifecycle (a stuck guard by definition
produces no further `sseActive`/`analyzeStatus` changes to re-run that effect at all) —
it is cleared on unmount and whenever a dispatch actually fires (normally or via the
watchdog itself), via a shared `clearDeferWatchdog` helper.

**New test** ("a step edit deferred by a run whose SSE stream never terminates eventually
dispatches anyway"): submits a Dry run that resolves normally (not a submit FAILURE, which
already clears `sseActive` via the existing catch) but never followed by any SSE event —
this test never touches the SSE layer at all, which is the point. Uses fake timers to
advance past `MAX_ANALYZE_DEFER_MS` without a real 15s wait. Demonstrated RED against the
pre-CR1 code (stuck at the baseline count forever) and GREEN post-fix. Full
`PipelineDetailPage.test.tsx` suite: **118/118 passed** post-fix.

**Re-ran the required N=60 e2e loop:** `e2e/hel912-lanes-rejoin.spec.ts`,
`--repeat-each=60 --workers=1` — **58/60 passed, 2 failed**, both the target
`Run status: succeeded` signature (~3.3%). No new or different failure signature was
introduced by the bounded-deferral change.

**CR2 — honest composite-rate accounting; every signature now owned.** The skeptic's own
cold N=70 (three separate runs, including one under artificial CPU load) measured a
**composite red rate of ~5.7% (4/70) from THREE distinct signatures**, not ~1.7% against the
target signature alone: `Run status: succeeded` (HEL-992), an unrelated `:165` layout-pixel
assertion (previously unowned), and a `locator.click`/`waitForResponse` timeout — the same
signature HEL-991 was filed for, but **HEL-991 is now closed (Done)**, leaving this
occurrence (observed directly in `hel912`, not just `hel968`) with no owner.

Addressed: **HEL-992 widened** from "isolate the target-signature residual" to an umbrella
covering all three signatures explicitly, with HEL-991's closed status noted and the
click-timeout occurrence in `hel912` folded into HEL-992's scope pending its own
investigation (not assumed to share either other signature's root cause). Updated
`specs/pipeline-op-picker-stability/spec.md`'s scenario to state the composite rate and its
three components, plus a new scenario asserting each of the three signatures stays
attributable to a tracked ticket. Updated `tasks.md`'s 3.4 entry to report the composite
number rather than the single-signature one.

**Non-blocking (extract `useDebouncedAnalyze`):** declined for this cycle. CR1's fix already
touches this exact logic and I'd rather ship a verified, mutation-tested fix on the final-gate
budget than also restructure it into a new hook in the same pass — extraction is a genuine
improvement (six pieces of mutable state plus a self-triggering dependency is real complexity)
but is a separable, lower-risk follow-up once this logic has stopped changing underneath it.
Noted for a future ticket rather than done silently or skipped without comment.

## Final gate, round 2 (skeptic-final-2.md change request — documentation only)

A fresh cold skeptic ran seven adversarial probes against the round-1 watchdog (stuck guard
with 120s idle, stuck guard with 600ms slow analyze, six rapid edits, unmount mid-watchdog,
20s real-timer idle, a run held genuinely in flight, and re-arm after firing) and found **no
fourth code defect**: bounded, leak-free, self-cancelling, still functional on later edits,
worst case one `/analyze` per 15s against one per edit at 300ms on `main`. The CR1 regression
test was re-confirmed mutation-RED. **The bounded-deferral design itself is sound and is not
being revisited.** No code or test changes were made this round, per explicit instruction.

**The defect this round:** the spec asserted an UNCONDITIONAL guarantee ("SHALL NOT issue a new
`analyzePipeline` request while a run ... is in flight", "does not dispatch ... for as long as
the run remains in flight") that round 1's own watchdog deliberately breaks at 15 seconds — the
same cycle-1 failure shape (spec asserting behavior the code doesn't have), arriving from the
opposite direction this time. `grep -ni "watchdog|MAX_ANALYZE_DEFER|15000|bounded"` across
`spec.md`/`tasks.md`/`design.md` returned zero hits before this round — the entire bounding
mechanism existed only in code comments.

**Fixed:** the requirement and its first scenario in
`specs/pipeline-op-picker-stability/spec.md` now explicitly qualify the guarantee as bounded —
"UP TO a bounded maximum deferral window of `MAX_ANALYZE_DEFER_MS` (15000ms), after which the
dispatch proceeds regardless." The accepted tradeoff is stated in the open, not buried: a run
legitimately exceeding 15s combined with a concurrent edit produces exactly one contending
`analyzePipeline` request at the 15s mark; this is deliberate (worst case one contending
request per edit, degrading TOWARD `main`'s always-contends behavior rather than past it,
versus the alternative of a permanently-stuck guard) rather than an oversight. Also corrected:
the code comment's "~6-10s" justification for the 15s bound is this ticket's own small e2e
fixture's measurement — a larger, real production pipeline exceeding 15 seconds is not exotic,
and the spec now says so rather than implying the case is hypothetical.

Added a new requirement + scenario ("A guard that never clears does not suppress the deferred
analyze forever" / "A run whose SSE stream never terminates does not suppress re-analyze
forever") describing the bounded-deferral mechanism's own guarantee directly — mirroring the
resume/termination scenarios cycle 3 added for the same reason: without this, a future change
that removes the watchdog would silently restore the permanent-staleness defect with every
other scenario in this capability still green, since none of the others exercise a guard that
never clears at all.

**Also corrected** (coordinator's third item): `tasks.md`'s 3.7 entry previously read as if
HEL-962/HEL-964 were left entirely unverified ("not touched, not re-run"). The AC itself holds
— but the correct discharge is to point at `skeptic-final-2.md` §5's actual evidence (15/15
across the three non-quarantined `hel908` siblings at N=5 each, plus a direct `grep` confirming
`hel908-tail-attach`'s stale-locator claim), not to claim nothing was run when independent
verification in fact ran and confirmed it. The AC was not deleted, only the claim about how it
was met.

## Status: DONE (final-gate round 2 change request addressed — documentation only, no code/test/e2e changes this round).
