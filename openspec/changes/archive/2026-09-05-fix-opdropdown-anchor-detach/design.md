## Context

See proposal.md — Why. What shapes this design is that the root cause is **not yet known**, and the ticket makes
the order of work an acceptance criterion: probe first, fix second. `systematic-debugging` binds here.

Live-tree facts confirmed against base `62b428db` (the ticket's own line numbers have drifted — see
`.concertino/runs/HEL-972/evidence/premise-validation.md`):

- `OpDropdown.tsx:42-49` — `useLayoutEffect` reads `anchorRef.current`, calls `setPos({...})` with a **freshly
  allocated object**, and is keyed on `[anchorRef]`.
- `OpDropdown.tsx:63` — `if (pos === null) return null;`. The menu is portalled to `document.body`, so whether
  the `<ul>` node survives a given render is decided entirely inside this component.
- Two callers pass a new object literal every render: `PipelineRiverView.tsx:312`
  (`anchorRef={{ current: insertAnchorEl }}`) and `BranchAffordance.tsx:46`. A third surface
  (`PipelineRiverView.tsx:361,497`) already passes a real `addStepButtonRef` and is **not** affected.
- `usePipelineDetailPage.ts:261-262` — the 300ms debounced `analyzePipeline(id)` dispatch; `:219` an immediate
  one on mount.

Prior instrumentation established the failing instance stays mounted (same mount id) and re-renders 6x while
open vs 2x when passing. So the component is not remounting — but Playwright still reports the *element* as
detached, which means the surviving suspect is the menu's **DOM node** being removed and re-inserted underneath
a stable component instance. This design does not assume that; it makes it the thing the probe must decide.

## Goals / Non-Goals

**Goals:**
- Produce a probe-confirmed causal chain, with measured numbers, before any fix is written.
- Establish a repeat-loop harness that makes a ~45% defect measurable, and reuse it unchanged for verification.
- Return `e2e/hel912-lanes-rejoin.spec.ts` to the default suite.

**Non-Goals:**
- Choosing the fix now. The fix shape is deliberately deferred to the probe's outcome (see D3).
- Any change to the debounce's product behavior. Disabling it is a **temporary probe**, reverted before the fix
  lands; if the debounce turns out to be the trigger, the fix belongs in the picker, not in removing analyze.
- HEL-962 / HEL-964 — report-only, per proposal Non-goals.

## Decisions

**D1 — Re-measure the baseline on this branch before touching anything.** The ticket's 45% was measured on
`a45e9881`; this branch forks from `62b428db`, ~20 commits later, several of them in the river editor
(HEL-968 #553, HEL-970 #552, HEL-914 #546). Inheriting the old number would be exactly the stale-premise
mistake. Run the un-quarantined `hel912-lanes-rejoin.spec.ts` 20x against the unmodified branch and record the
tally. *Alternative rejected:* trusting the ticket's rate — cheap, but it makes every later comparison
unanchored, and a changed baseline would silently invalidate the whole experiment.

**D2 — Isolate the debounce as a single-variable probe.** With the baseline in hand, comment out **only** the
`setTimeout(... analyzePipeline(id) ..., 300)` dispatch at `usePipelineDetailPage.ts:261-262`, leaving the mount
dispatch at `:219` and everything else intact, and re-run the same 20x loop. Interpretation is fixed in advance,
so the result cannot be rationalized after the fact:
- Rate collapses to 0/20 → the debounced dispatch is the **trigger**. The picker's fragility is still the
  defect; the dispatch is what fires it. Proceed to D3 to find the mechanism it fires.
- Rate is materially unchanged → the dispatch is **eliminated**, the ticket's leading correlate is dead, and the
  render burst has another source that must be found before any fix. Instrument to find it.
- Rate drops but not to zero → more than one trigger. Record it and keep looking; do not stop at a partial.

**D3 — The mechanism must be observed, not inferred.** Whatever D2 returns, the fix requires a direct
observation of *how* the menu's DOM node stops receiving the click. The specific question to answer with a
probe: does `anchorRef.current` transiently read `null` (or a different element) on one of the burst's
re-renders, driving `setPos(null)`-equivalent behavior or an early `return` path that unmounts the portal
subtree? A `MutationObserver` on `document.body` recording removal of the menu node, correlated with render
counts, answers this directly. A story that merely fits the numbers is not sufficient — the ticket says so.

**D4 — Fix shape is chosen after D3, from a pre-declared shortlist.** Recorded now so the choice is principled
rather than post-hoc: (a) pass the anchor *element* rather than a synthesized ref object and key the effect on
element identity; (b) memoize the wrapper at each call site; (c) hold the measured position in a ref plus a
stable state shape so re-measuring cannot change render output when the geometry is unchanged. Preference order
is (a) then (c): (a) removes the identity churn at its source in both call sites and makes the effect's
dependency honest. This ordering is a tie-break for the case where D3 implicates anchor identity — it is NOT a
pre-selection: if D3 implicates something else, the fix follows D3 and the shortlist is recorded as incomplete.
(b) is a mitigation at the call site that leaves the component's dependency still lying about what it depends
on, so it is a fallback only. The fix must satisfy the mechanism found in D3, not merely remove a smell.

**D5 — The guard must be demonstrated RED at unit level.** An e2e that is green 55% of the time pre-fix cannot
by itself prove a fix. Add a test in `OpDropdown.test.tsx` that re-renders the parent with an unchanged anchor
and asserts the menu node's identity is preserved and no re-measure occurs. It MUST be shown failing against
the pre-fix component and passing after — a green-only test proves nothing here.

**D6 — Verification is the same harness as D1, not a new one.** 20 consecutive passes of the un-quarantined spec
post-fix. Under the measured base rate this is decisive: at p(fail)=0.45, the chance of 20 clean runs by luck is
0.55^20 ~ 1e-5. This decisiveness math must be
computed from **the measurement harness's own** measured rate (tasks 1.5/1.5a), not inherited: if `hel968`
becomes the harness, state the computation for `hel968`'s rate. A lower measured rate requires a larger N, and
N must be fixed before the verification loop is run, not after. A single green run is explicitly not evidence.

## Risks / Trade-offs

- **The re-measured baseline is near zero** (the flake is environment-sensitive and this machine does not show
  it) → then no experiment on this machine can confirm anything, and D2's result would be meaningless. Detect it
  at D1, before spending any budget on a fix; escalate rather than proceeding to design a fix blind.
- **Fixing a real smell that is not this bug.** The anchor-identity churn is genuinely wrong regardless, which
  makes it tempting to fix and declare victory. D3 exists to block that, and the spec's requirements are deliberately written against
  observed behavior only (node preserved, click delivered, position stable) — no requirement names an internal
  mechanism, so a probe outcome that clears the anchor path does not leave a stranded spec commitment.
- **20 iterations of a full e2e is slow.** Accepted: this run holds the Playwright session exclusively and
  nothing else is queued, which is precisely the budget this ticket needs. Prefer Playwright's own `--repeat-each`
  over a shell loop so browser and server startup are not paid 20 times over.
- **The probe edit leaks into the commit.** The D2 debounce edit is temporary. It must be reverted before the
  fix commit, and its absence verified in the final diff.

## Open Questions

None that can be deferred. The one genuine unknown — the mechanism — is resolved by D2/D3 inside this change,
not deferred past it.
