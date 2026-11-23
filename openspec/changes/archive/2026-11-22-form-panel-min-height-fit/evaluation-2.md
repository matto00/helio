## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `3d77f47c38576cf1f5bfbe7854f58eef573f0555`, base `cba523c030821c709ba227ab8c06a59f9ab913fc` (resolved live).
The spawn guard returned READY. The cycle-2 delta is one commit, 3d77f47c3, touching four files:
- `useCompactCounterSubmit.ts`
- `design.md`
- `specs/form-panel-rendering/spec.md`
- `evaluation-1.md` (byte-identical to the persisted cycle-1 report)

Lane constraints were followed. No servers were started this cycle, and scratch output is in
`.concertino/scratch/HEL-1618/eval2/`.

### Phase 1: Spec Review — FAIL

CR1 from cycle 1 is only partly resolved.
- **Resolved:** the reworded spec now says that a layout from a dashboard import or an applied proposal keeps the
  heights it carries.
- **Not resolved:** the new wording lists **duplicate** among the placements that "SHALL place a `form` panel at 5 rows
  or more", and that is false.

**Each path the spec now names, checked against the code:**

| path named in spec.md:9-10 | code | form height | verdict |
| --- | --- | --- | --- |
| panel create | `PanelLifecycleWrites.scala:37`: `defaultSizesFor` gives `PlacementSizes.forNewPanel` gives `ContentDefault` (`ContentHeight = 5`) for every non-Output kind | 5 | true |
| batch create | `PanelBatchWrites.scala:93`: `defaultSizesFor(p)` per panel, then `CreatePlacement.append` | 5 | **true (the orchestrator's question: confirmed)** |
| duplicate | `PanelLifecycleWrites.scala:54`, then `PanelMutationRepository.scala:73`, then `CreatePlacement.duplicateSizes` (`CreatePlacement.scala:94-103`). This takes the **source's stored item** at each breakpoint (`math.max(1, i.h)`) and uses the kind default only when the source has no item at all | **the source's height, so 4 (or less) for a saved sub-5 form** | **false** |
| client unplaced-panel fallback | `dashboardLayout.ts:29` `defaultItemHeight = 5` (used at :79 and :199) | 5 | true |
| auto-layout | `PanelPacker`: `Form minH = 5` | >= 5 | true |

There is self-authenticating evidence for the duplicate behaviour. The existing, passing
`CreatePlacementSpec.scala:49-51` ("scale the source's lg item ...") asserts that duplicating a 6x4 source yields
`ItemSize(6, 4)` at lg and `ItemSize(3, 4)` at sm, a 4-row duplicate. The sizing code does not look at the panel kind.

A form source below 5 rows is reachable in two ways the owner ruled must exist:
- a saved sub-5 form is never resized on load;
- a lift-when-free resize that is blocked by a panel below keeps the form at 4.

So duplicating either one places a new form at 4 rows, which contradicts the spec sentence.

`measurements.md` §4.4 makes the same wrong claim: its row "create / batch create / duplicate ... 5, none needed"
is wrong for duplicate.

**Scope:** this is the same class of finding as import and proposal apply in cycle 1. It is a backend placement path
outside this frontend ticket, and it is defensible as "a duplicate keeps its source's size". The fix here is wording
only, plus naming it in the follow-up.

The rest of Phase 1 is unchanged from cycle 1 and still passes:
- the ACs, tasks, scope and constraints;
- the evidence chain;
- the four skeptic fold-ins.

**N3:** resolved. `design.md:105` now states the measured 48 px (Comfortable) and 44 px (Compact) for the 3-field form,
with the reason.

### Phase 2: Code Review — PASS

Gates, re-run by me at HEAD:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: root 73 suites / 645 tests, frontend 922 suites / 10628 tests, all passed.
- `npm --prefix frontend run build`: exit 0.

**N2 refactor (`useCompactCounterSubmit.ts:186-199`) changes no behaviour.** The two deleted closures had the identical
body `if (!burstRejectedRef.current) values.setExternalErrors({});`. The new `clearStaleRejectionError` has that exact
body. It is created at the same point (inside the same async settle handler, once per settle), and it closes over the
same `burstRejectedRef` (a ref, read at call time) and the same `values`.

It is still passed as two separate arguments: `onReconciled` and `onQuiescedWithoutReconcile`. `reconciliationTail`
calls each from a different branch and never compares their identities, so sharing one function object cannot change
which branch runs or what it does. Both D2 tests and the HEL-1819 owner tests are green in the full suite.

The merged comment keeps both rationales, and also records why the callbacks stay as separate arguments.

### Phase 3: UI Review — PASS (unchanged; no re-measure needed)

The cycle-2 diff changes no rendering, layout, CSS or grid code. The only frontend change is the behaviour-identical
refactor above. The cycle-1 live measurements and e2e run stand (`evaluation-1.md`). Their screenshots are
`.concertino/runs/HEL-1618/evidence/eval1-1280-{dark,light}.png`.

### Overall: FAIL

### Change Requests

1. **`specs/form-panel-rendering/spec.md:9-11`:** remove "duplicate" from the list of placements that "SHALL place a
   `form` panel at 5 rows or more". Add it to the exceptions sentence. For example: "A layout supplied by a dashboard
   import or an applied proposal keeps the heights it carries, and a duplicate takes its source's stored size, so
   duplicating a form saved below 5 rows yields a form of that height."
   - Make the same correction in `measurements.md` §4.4. Split the "create / batch create / duplicate" row so
     duplicate reads: `CreatePlacement.duplicateSizes`, the source's stored h, REPORTED, not changed.
   - Name duplicate alongside proposal apply (and optionally import) in the follow-up the PR body asks the
     orchestrator to file. The clamp would go in `CreatePlacement.duplicateSizes` for a `form` source that is not a
     compact counter, mirroring `PanelPacker`.

   This is a documentation-only change. No code, test or measurement change is needed.

### Non-blocking Suggestions

- N1 from cycle 1 (the e2e red-run evidence was committed in the implementation commit) still stands as a procedural
  note. Nothing to change now.
