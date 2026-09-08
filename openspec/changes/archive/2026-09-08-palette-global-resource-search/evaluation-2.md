## Evaluation Report — Cycle 2 (evaluation-2.md)

Delta reviewed: `364386b2` on top of `9a4ddd60`/`42c7dfe3`. Scoped to the delta plus its blast
radius. Every gate and every mutation below was re-run by me; each mutation asserted its own patch
landed before running, and every file was restored (`git diff --quiet` clean, verified after each).

### Content self-authentication

`curl http://localhost:5935/src/features/dashboards/state/dashboardsSlice.ts` returns the module
containing `status !== "loading" && status !== "succeeded"` — a string introduced by `364386b2` and
present nowhere on `origin/main`. So port 5935 is serving THIS branch at THIS commit, not a
pre-delta build or a same-port neighbour. (I deliberately did not use `resourceSearch.ts`'s type
union as the probe: Vite strips types, so that grep returns 0 for an authentic serve — a probe that
would have looked like a failure for the wrong reason.)

### Phase 1: Spec Review — PASS

All three cycle-1 items are addressed in the delta; task 2.1's ticked box is now backed by the test
it always claimed. No new scope beyond the shared-slice fix analysed below, which I judge in scope
(see Phase 2). Planning artifacts and `files-modified.md` updated to match.

### Phase 2: Code Review — PASS

Gates, all from `frontend/` (root `npm test` would have been `passWithNoTests` silence):

| Gate | Result |
|---|---|
| `npm run lint` | pass (`--max-warnings=0`) |
| `npm run format:check` | pass |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npm test` | **290 suites / 2926 tests passed** (was 2922 — +4 from the new guards) |
| `npm run check:tokens` (HEL-1037, root) | `OK — every var(--*) resolves` |
| motion guard (HEL-441) | green within the 290; the delta adds no CSS at all |
| e2e | **23 passed** — `hel503` (5) + `hel519-recent-navigation` (downstream consumer of `ResourceRef`) + `hel516-palette-quick-create`, all against the live servers |

**CR2 — invalid state now genuinely unrepresentable. CONFIRMED.**
`resourceSearch.ts:21-23` is a discriminated union mirroring `ResourceRef`, with `pipelineId:
string` REQUIRED on the output arm; `useResourceSearchActions.ts:57-67`'s `buildRef` is an
exhaustive value-returning `switch` with no coalesce (I grepped: no `?? ""` survives anywhere in
the file). Mutation (making `pipelineId` optional again, patch asserted at line 23) produced BOTH:

```
resourceSearch.test.ts(80,5): error TS2578: Unused '@ts-expect-error' directive.
useResourceSearchActions.ts(60,45): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
```

That second error is the important one, and it answers the "is the `@ts-expect-error` silently
passing for an unrelated reason?" question directly: the directive is suppressing exactly the
missing-`pipelineId` error (TS2578 the instant that error stops existing), and the production code
independently fails on the same mutation — so the guard is not the only thing standing between the
repo and the regression. On other construction sites: `SearchableItem` is constructed in exactly two
places (`useResourceSearchActions.ts:128` and the test's own helpers), and the union makes a
pipeline-less output uncompilable at every site by construction, not by inspection.

**CR1 — pagination guard present and genuinely failable. RE-RUN AND CONFIRMED.**
`outputsSlice.test.ts` now mocks `httpClient.get` with a 200-item first page and a 50-item second
page (`total: 250`) and asserts 250 indexed, `o249` present, exactly 2 GETs, `allStatus:
"succeeded"`, plus a `rejected → "failed"` case. Mutation (replacing `outputService.ts`'s loop
condition with an unconditional `break`, patch asserted by printing the mutated line): **RED —
`Expected length: 250 / Received length: 200`**, i.e. it catches precisely the silent truncation
design.md D3 is about. Restored, clean, green.

**S1 — the rewritten retry guard IS genuinely discriminating. CONFIRMED TWICE, and it deserved the
scepticism.** The rewrite mocks `httpClient` at the bottom layer so the real thunks genuinely run
`idle → loading → failed` and genuinely re-render — which is exactly why the old slice-mock version
was 4/4 green while the bug was present. My re-run of the retry-loop mutation (`statuses` back in
the effect deps, patch asserted): the suite **never terminates** — killed at 150s, and notably even
`--testTimeout=20000` did not fire, because the dispatch storm starves the event loop so Jest's own
timer never runs. So: unmutated the file passes in ~3s; mutated it wedges forever. That IS
discrimination (contrast cycle 1, where the mutation left the same file 4/4 green in 2.7s), but its
failure mode is a hang, not a named assertion — see S1'.

**THE SHARED-SLICE CHANGE (`fetchDashboards`'s `condition`) — I judge it IN SCOPE and safe to ride
along. Here is the evidence, not an opinion.**

*Is the defect real?* Yes, and proven, not asserted. Mutation: reverted the condition to the old
`status === "idle"` (patch asserted, line 70 printed) and ran the palette indexing suite →
`Expected number of calls: 8 / Received number of calls: 7`. The dashboards kind genuinely never
retried from `failed`, so the ticket's own owner-ruled retry-on-open behaviour (design.md D2) was
silently broken for one of its four kinds. The fix is required by this ticket's AC, not a drive-by.

*(a) Can the widened condition cause duplicate or looping dispatches anywhere?* No. The semantic
delta is confined to exactly one state — `failed` (previously blocked, now allowed); `loading` and
`succeeded` are blocked exactly as before, and `idle` was already allowed. I enumerated **every**
`fetchDashboards` dispatch site in the repo (`grep -rn`, excluding tests): there are precisely two.
`src/app/App.tsx:173-175` (`useEffect` keyed `[dispatch]` — mount-only) and
`src/features/commandPalette/useResourceIndexing.ts:77` (keyed `[isOpen, dispatch]` — open-edge
only). `PatchSetReviewPage.tsx:10/230` imports the same-named **service** function, not the thunk —
unaffected. Neither effect can re-fire on a re-render, so no state change (including a transition
into `failed`) can trigger a dispatch on its own. A loop is structurally impossible.

*(b) `App.tsx`'s boot dispatch.* Unchanged in behaviour. First dispatch sets `loading`; a StrictMode
double-invoke's second dispatch is blocked by `loading` under both the old and new condition. Only a
genuine remount after a *failed* boot fetch now refetches — which is the desirable direction, and it
clears the error state rather than pinning it.

*(c) Anything previously ending in `failed` refetching on unrelated re-renders.* Cannot happen, for
the reason in (a): no dispatch site is re-render-driven.

Two further checks I ran because widening a shared guard has bitten this repo before: the new
condition is **byte-identical in shape to `pipelinesSlice.ts:182-185`**, the existing precedent it
claims to mirror; and the F-104 hazard recorded at `pipelinesSlice.ts:480-486` (a `condition`
*narrowing* that broke a caller relying on a post-create refetch) cannot recur here, because this
change is a widening — it can only cause more fetches, never skip one a caller depended on. I also
checked `dashboardsSlice.test.ts:341-343`'s note about a flow that once "relied on a
condition-blocked `fetchDashboards` refetch": that concerns the `succeeded` case (HEL-290 fixed it by
appending directly), which this change does not touch.

Remaining code quality across the delta: comments state what each guard proves AND what it cannot
(the pagination test's "cannot prove the real backend's page-size contract" and the retry test's
"cannot prove a storm with a period longer than the flush window" are both honest and correct); no
dead code; the `@ts-expect-error`s in the outputs test are narrowly scoped to a deliberately partial
test store and commented.

### Phase 3: UI Review — PASS

Re-verified live after the delta (post self-authentication): `Ctrl+K` on `/`, query `alpha` → the
`Search results` section renders with matches, no console errors. The four kinds' navigation,
the output deep-link sheet, the coverage caveat under a slow network, and HEL-519's recents are all
covered by the 23 green e2e tests above, run against the live servers rather than inferred. The
delta contains no CSS and no markup change, so cycle 1's light/dark and hover/focus measurements
(hover === active by construction; light `rgb(239,236,230)` vs transparent at rest; HEL-866 does not
reproduce) still stand.

The two **[judgment]** cohesion observations from cycle 1 remain open **for the skeptic**, unruled by
me: overflow rows are unaligned with the iconed text column, and the first group label can render
clipped against the input when the list is scrolled to the top.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- **S1'** — The retry-loop guard's failure mode is a **hang, not an assertion**. I measured it: under
  the mutation the suite runs past 150s with `--testTimeout=20000` never firing, because the storm
  starves the event loop. In CI that surfaces as a job timeout — a true failure, but slow, expensive
  and confusing to diagnose. Consider making the storm self-limiting so the regression fails *fast
  and by name*: e.g. have the `httpClient.get` mock throw `new Error("dispatch storm: >20 calls")`
  once `mock.calls.length` exceeds a small bound, so the test reports the actual defect instead of
  wedging. Worth a line in the test's own "what this cannot prove" note either way.
- **S2'** — The `fetchDashboards` condition change is guarded only from a distant file
  (`features/commandPalette/useResourceIndexing.test.tsx`). A future maintainer editing
  `dashboardsSlice.ts` has no local signal. Add a short case to
  `src/features/dashboards/state/dashboardsSlice.test.ts`: dispatch with `status: "failed"` and
  assert the thunk is NOT condition-blocked, and with `status: "succeeded"`/`"loading"` that it is.
  That also pins the intent ("retry from failed") next to the code that implements it.
- Carried forward from cycle 1, still open and still non-blocking: the overflow row is a selectable
  no-op that closes the palette and discards the query (**S2**); dashboard results carry no
  disambiguating subtitle, so same-named dashboards render as identical rows (**S3**); the
  failed-kind retry has no real-browser coverage — `page.route` fulfilling a 500 then re-opening the
  palette would close it cheaply (**S4**, and it is honestly disclosed in `files-modified.md`'s
  task-6.4 answer).

### Answering the two-axes question, for the delta

**What does no source text carry?** Whether a guard *discriminates*. Both of this cycle's headline
fixes were, in cycle 1, backed by text that read exactly as it does now — a mutation-run claim in a
comment — and one of them (the retry guard) was nonetheless vacuous. No amount of prose in a test
file distinguishes a guard that fails under its mutation from one that does not; only running the
mutation does, which is why I re-ran all four rather than reading the four comments that describe
them. The dashboards `condition` defect is the same axis from the other side: the old
`status === "idle"` line was correct-looking source text whose wrongness was invisible until a test
existed that could actually observe a second open.

**What path did the gates not exercise?** Three, none blocking: (a) the real backend's pagination
contract — the new test mocks `httpClient` and so proves the client loops, not that
`Page.Default.limit`/`MaxLimit` are what the design says (a genuine e2e with >200 outputs is the
only thing that would); (b) the failed-kind retry in a real browser (S4); and (c) the widened
`fetchDashboards` condition under a *failed boot* in a real browser — every dispatch site is
mount/edge-keyed so I reasoned the loop closed structurally and verified the count by unit test, but
no test anywhere loads the app with `/api/dashboards` returning 500 and confirms the app recovers
rather than storms.
