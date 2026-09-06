## Purpose

Defines the contract for `usePipelineDetailPage`'s debounced pipeline-analyze dispatch: it SHALL NOT
compete with an in-flight pipeline run for backend request-handling resources, and the
`hel912-lanes-rejoin.spec.ts` end-to-end guard that exercises this path SHALL remain part of the
default suite.

This capability originally specified a DOM-detach/positioning contract for `OpDropdown`'s open menu.
That mechanism was investigated and **refuted**: direct instrumentation (a `MutationObserver` on
`document.body`, a render counter, and anchor-identity logging, added to `OpDropdown` itself) captured
live failures of `hel912-lanes-rejoin.spec.ts` and found zero menu-node removal events and a clean,
identical render pattern on every dropdown interaction in both passing and failing runs. `OpDropdown.tsx`
is untouched by the change that shipped against this capability. The picker's DOM-stability/positioning
contract, if one is warranted, is NOT restated here. It was originally to be owned by HEL-991, but that
ticket is now closed (its spec was quarantined rather than root-caused), so the click-timeout signature is
tracked under HEL-992 pending an investigation that observes a real mechanism.

## ADDED Requirements

### Requirement: The debounced pipeline analyze does not contend with an in-flight run, up to a bounded maximum

`usePipelineDetailPage`'s 300ms-debounced re-analyze dispatch (fired after a step-list change) SHALL NOT
issue a new `analyzePipeline` request while a pipeline run submitted from the same page is in flight, and
SHALL NOT issue a new request while an `analyzePipeline` request for the same pipeline is already in
flight — **UP TO a bounded maximum deferral window of `MAX_ANALYZE_DEFER_MS` (15000ms)**, after which the
dispatch proceeds regardless of whether the guard has cleared. This is a backend-resource-contention guard,
not a DOM/rendering guarantee, and it is NOT an unconditional suppression: the debounced dispatch competes
with the run's own request for the same backend request-handling resources, measurably delaying the run's
completion, which is why avoiding the contention is worth a deferral — but a guard that is never observed
to clear (see the bounded-deferral requirement below) must not suppress re-analyze forever, so the
avoidance is bounded in time rather than open-ended.

**Accepted tradeoff, stated explicitly:** a pipeline run that legitimately takes longer than 15 seconds,
combined with a concurrent step edit, produces exactly one contending `analyzePipeline` request at the
15-second mark — the contention this requirement otherwise avoids is NOT fully avoided in that case. This
is a deliberate, bounded tradeoff, not an oversight: worst case is one contending request per edit (fired
at the 15s bound rather than immediately, i.e. degrading TOWARD `main`'s always-contends behavior rather
than past it), versus the alternative of a guard that can get permanently stuck (a dropped/never-opened SSE
stream, or a missed terminal event — see the bounded-deferral requirement below) and suppress re-analyze
for the rest of the page's lifetime. The 15s bound itself was chosen against this ticket's own e2e
fixture's measured ~6-10s run duration; a larger, real production pipeline exceeding 15 seconds is not an
exotic or hypothetical case, and such a run experiencing this residual contention is the known, accepted
cost of this requirement rather than a gap in it.

#### Scenario: A step edit while a run is in flight does not dispatch a competing analyze, within the bound

- **WHEN** a step is edited (changing the analyze fingerprint) while a run submitted from the same page has
  not yet reached a terminal SSE status, and fewer than `MAX_ANALYZE_DEFER_MS` have elapsed since that
  edit was deferred
- **THEN** the debounced re-analyze effect does not dispatch `analyzePipeline` while the run remains in
  flight and the bound has not yet been reached — but if the run is STILL in flight once the bound elapses,
  the deferred dispatch proceeds anyway (see the bounded-deferral requirement below); this requirement does
  NOT guarantee no competing dispatch is ever issued for a run in flight, only that one is not issued
  before the bound

#### Scenario: A step edit while an analyze request is already loading does not dispatch a second one

- **WHEN** a step is edited while a prior `analyzePipeline` request for the same pipeline is still loading
- **THEN** the debounced re-analyze effect does not dispatch a second, concurrent `analyzePipeline` request

#### Scenario: A suppressed analyze resumes exactly once when the guard clears

- **WHEN** a step edit's debounced dispatch was suppressed because a run was in flight or an `analyzePipeline`
  request was already loading, and that guard subsequently clears
- **THEN** the debounced re-analyze effect dispatches `analyzePipeline` for that edit's fingerprint exactly
  once — the suppressed edit is deferred, never dropped, and `state.analyzeResult` (written only by
  `analyzePipeline.fulfilled`) does not go on showing pre-edit/stale results indefinitely

#### Scenario: Dispatching stops once nothing has changed — no unbounded re-dispatch

- **WHEN** the guard clears (a run finishes, or an in-flight `analyzePipeline` request settles) and no step
  edit occurred while it was active
- **THEN** the debounced re-analyze effect does NOT dispatch another `analyzePipeline` request for a
  fingerprint that has already been analyzed, even though `analyzeStatus` transitioning (e.g.
  loading→succeeded) is itself one of this effect's dependencies. In particular, a request whose OWN
  resolution takes longer than the 300ms debounce window (so the guard is still active when the effect's
  timer fires while that same request settles) SHALL NOT cause repeated, ever-continuing re-dispatches of
  an already-analyzed fingerprint while the user makes no further edits

### Requirement: A guard that never clears does not suppress the deferred analyze forever

`sseActive` is cleared only by the SSE `onTerminal` handler or a run-submission failure — there is no
consumer anywhere that clears it when the run's SSE stream fails to open, drops mid-run, or simply never
delivers a terminal event (a live, non-replaying subscribe can miss a run that finishes before the
browser's subscription lands). A guard that is stuck in this way SHALL NOT permanently suppress the
deferred analyze: it SHALL still dispatch, exactly once per deferred edit, once `MAX_ANALYZE_DEFER_MS` has
elapsed since the deferral began — regardless of whether `sseActive` (or `analyzeStatus === "loading"`)
has actually cleared. Without this requirement, a future change that removes the bounding watchdog would
silently restore the permanent-staleness defect this ticket's cycle-1/cycle-3 deferral work was meant to
fix, with every other scenario in this capability still green (none of them exercise a guard that never
clears).

#### Scenario: A run whose SSE stream never terminates does not suppress re-analyze forever

- **WHEN** a run is submitted (`sseActive` becomes true) and no SSE terminal event ever arrives to clear
  it — the stream failed to open, dropped mid-run, or its terminal event was missed — and a step is edited
  while `sseActive` is (and remains) true
- **THEN** the debounced re-analyze effect defers the dispatch while `sseActive` is true, but dispatches it
  exactly once, unconditionally, once `MAX_ANALYZE_DEFER_MS` has elapsed since the deferral began — the
  edit's analyze is never suppressed for the rest of the page's lifetime, even though the guard itself
  never clears

### Requirement: The lanes-rejoin end-to-end guard is in service

`e2e/hel912-lanes-rejoin.spec.ts` SHALL be part of the default end-to-end suite. It SHALL NOT be excluded
by any `testIgnore` entry in the Playwright configuration.

#### Scenario: The spec is not excluded

- **WHEN** the default Playwright configuration is loaded
- **THEN** no `testIgnore` entry matches `e2e/hel912-lanes-rejoin.spec.ts`

#### Scenario: The spec passes across repeated runs, at a measured residual well below the pre-fix rate

- **WHEN** the spec is run repeatedly (N=60, `--repeat-each=60 --workers=1`, `retries: 0`) in an isolated
  environment, both before and after the debounced-analyze contention guard above
- **THEN** the `Run status: succeeded` timeout signature's measured failure rate is substantially reduced
  by the guard — measured at ~10% (3/30) pre-fix versus ~1.7-3.3% (1-2/60) post-fix across independent
  runs — rather than eliminated to zero. This requirement does NOT claim every iteration passes for this
  signature alone, and it does NOT claim the spec as a whole is free of other failure causes: **the
  spec's measured COMPOSITE red rate is ~5.7% (4/70), from THREE distinct signatures** — this
  `Run status: succeeded` timeout (owned by HEL-992), an unrelated `:165` layout-pixel assertion (also
  folded into HEL-992's scope), and a `locator.click`/`waitForResponse` timeout (the same signature
  HEL-991 was filed for; **HEL-991 is now closed**, so this occurrence is tracked under HEL-992 pending
  its own investigation, not assumed to share HEL-991's or this ticket's root cause). A reader deciding
  whether to trust a red `hel912` in CI should use the composite number, not the single-signature one.

#### Scenario: The spec's other two known failure signatures are each owned by a tracked ticket

- **WHEN** the `:165` layout-pixel assertion or the `locator.click`/`waitForResponse` timeout occurs in a
  run of this spec
- **THEN** the occurrence is attributable to a specific, currently-open ticket (HEL-992, as of this
  writing) rather than being an unowned, untracked flake — this requirement exists so a future change to
  this spec cannot silently let either signature drift back into having no owner (e.g. if HEL-992 is
  closed for its original target signature without also closing out the other two)
