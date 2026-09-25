## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/panel-manual-refresh/spec.md` fresh from the worktree (current state,
  round 3).
- Read round 1 and round 2 skeptic reports (`skeptic-design-1.md`,
  `skeptic-design-2.md`) as claims to verify, not facts.
- Read the live, unmodified `frontend/src/features/panels/hooks/usePanelData.ts`
  in full — confirmed `refresh()`'s body (lines 56-60), the fetch effect and its
  `prevFetchKey`/dependency-array dedup guard (lines 62-86), and `isLoading`'s
  definition (lines 123-124) all match design.md's Context claims.
- Read the live `frontend/src/features/panels/ui/PanelCard.tsx` in full —
  confirmed `usePanelData` is currently called only inside `PanelCardBody`
  (line 80), a `React.memo`-wrapped child of `PanelCard`; confirmed `PanelCard`
  already computes `getOutputId(panel)` (line 216) and owns the
  `panel-grid-card__actions` header markup (lines 316-369) that Decision 1 says
  the new button goes into; confirmed `PanelCardBody`'s `if (frozen) return
  null` (line 116) comes after all its hooks run, and its doc comment (lines
  45-48) matches design.md's paraphrase.
- Read `frontend/src/shared/ui/IconButton.tsx`, `frontend/src/shared/ui/Spinner.tsx`,
  and `frontend/src/hooks/useInFlightGuard.ts` — confirmed design.md's claims
  about each (icon-as-`ReactNode`, `aria-hidden` spinner, `guardedRun`'s
  synchronous-inline ref-mutation idiom) match the live code.
- Read `frontend/src/features/panels/hooks/usePanelData.test.ts` (the existing
  test file task 1.2 extends) — confirmed the established convention in this
  file (`refresh() triggers a re-fetch`: await the initial mount fetch to
  resolve, assert call count 1, then call `refresh()` and assert call count 2)
  is exactly the shape needed to make task 1.2's revised test constructible
  and unambiguous in practice, despite task 1.2's prose leaving the interaction
  between the mount-triggered fetch and the explicit `refresh()` calls slightly
  loose (see reasoning below — not a blocking gap).
- Ran `npx openspec validate per-panel-manual-refresh --type change` fresh:
  `Change 'per-panel-manual-refresh' is valid` (exit clean).
- Ran `git status --porcelain=v1`: only `openspec/changes/per-panel-manual-refresh/`
  is untracked/new; no `frontend/`/`backend/` code has been touched yet — this
  round is planning-only, as expected pre-execution.

### Round 2's two required revisions — independently re-verified, both sound

**1. Task 1.2's red-first test (same-tick batching defect).** The revised test
description (tasks.md 1.2, steps 1-4) no longer relies on two synchronous
`refresh()` calls in one `act()`. It now calls `refresh()` once, lets the fetch
effect dispatch with the mock left pending, and only calls `refresh()` a
*second time while that fetch is still unresolved* (a real async gap between
the two activations) — then asserts the dispatch count doesn't grow, then
resolves and asserts a third call *does* dispatch again. I traced this against
the actual `usePanelData.ts` fetch effect and `prevFetchKey.current` dedup
check: without a guard, `refresh()` unconditionally resets
`prevFetchKey.current = null` (line 57) on every call, which defeats the
effect's own dedup check even while a fetch is already in flight — so an
unguarded build genuinely dispatches a second (and with the described third
call, ultimately a higher) time; a build with `inFlightRef` persisting `true`
across the render boundary genuinely dispatches exactly once until the fetch
settles. This is now a genuinely discriminating, reproducible-by-reasoning
red-first test — round 2's specific defect (batching swallowing two
same-tick calls into one effect run regardless of any guard) cannot recur
here because the two `refresh()` calls are no longer same-tick.

One loose end, not blocking: task 1.2 step 1's prose ("render the hook, call
`refresh()` once... its effect runs and dispatches") doesn't explicitly
address that mounting the hook *itself* already triggers an initial fetch
dispatch (`prevFetchKey.current` starts `null`), independent of the first
explicit `refresh()` call — so the literal dispatch-count arithmetic in the
task's prose is a little loose about whether "exactly 1" nets out the mount's
own call or not. I worked through both plausible readings (count including or
excluding the mount dispatch) and in both cases the assertion still fails
pre-fix and passes post-fix — the discriminating power of the test doesn't
depend on resolving this ambiguity, and the existing test file's established
convention (await the mount fetch to resolve before starting the
refresh-specific assertions, as `usePanelData.test.ts`'s current "refresh()
triggers a re-fetch" test already does) gives the executor an unambiguous,
idiomatic way to write it. This is exactly the kind of literal integer/mock-
bookkeeping detail the evaluator/skeptic at the final gate will independently
verify against pasted red-then-green output — not something the design needs
to pin down further.

**2. Decision 1's control placement / `usePanelData` call-site mismatch.**
Design.md's Decision 1 now explicitly states `usePanelData(panel)` is called
exactly once, in `PanelCard` (the common ancestor of the header and
`PanelCardBody`), with its non-`refresh`/`isRefreshing` fields passed down to
`PanelCardBody` as *individual* props (not a spread object). I checked this
against the live component tree and React's actual hook/memo semantics:

- `PanelCard` already owns the `panel-grid-card__actions` header markup, so
  the button can render directly from the lifted hook's `refresh`/
  `isRefreshing` with no cross-component prop-flow problem — this resolves
  round 2's core objection (child-to-parent prop flow doesn't exist).
- The drag-freeze mechanism (`PanelCardBody`'s `if (frozen) return null`) is
  unaffected: it's a same-component early return, unrelated to which
  component calls `usePanelData`, exactly as design.md's Trade-off paragraph
  states.
- Passing `PanelDataResult`'s fields as *individual* props (not one spread
  object) is the right call to preserve `PanelCardBody`'s `React.memo`
  shallow-prop comparison: `refresh` is `useCallback([])`-stable and
  `rawRows`/`headers` are `useMemo`-stable on `paginationEntry` inside
  `usePanelData` regardless of how many times the surrounding `PanelCard`
  function body re-executes (e.g. from title-edit keystrokes triggering
  `PanelCard`'s own local state) — so those props stay referentially stable
  across unrelated `PanelCard` re-renders, and `PanelCardBody` correctly
  continues to skip re-rendering when only unrelated `PanelCard` state
  changes. This is the same reasoning design.md's own text gives, and it
  checks out against how `usePanelData`'s `useCallback`/`useMemo` are actually
  scoped in the live file — moving the *call site* up doesn't change how those
  hooks memoize internally.
- The stated trade-off (`PanelCard` now re-renders on every fetch/poll/refresh
  event, previously isolated inside `PanelCardBody`'s memo boundary) is
  disclosed, not silently absorbed, and correctly reasoned: it's the header
  spinner requirement that makes this unavoidable, and drag performance is
  protected by the `frozen` early-return, not by `React.memo`'s prop-diffing.
- Task 2.8 (new this round) explicitly adds a regression test for exactly this
  — no spurious `PanelCardBody` re-render on an unrelated `PanelCard` state
  change, and the drag-freeze early-return still short-circuits before
  expensive work — closing the loop on round 2's own non-blocking note asking
  for this to be reconfirmed.

Minor, non-blocking observation: tasks.md 2.2's itemized prop list (copied
from `PanelDataResult`'s fields) doesn't literally include `outputId`, even
though the surrounding prose says `PanelCardBody` "now read[s] refresh/
outputId from props." `outputId` isn't part of `PanelDataResult`, so it's a
second, separate prop design.md's D1 text says should be threaded down rather
than recomputed via `getOutputId(panel)` inside `PanelCardBody`. Since
`getOutputId` is a pure, cheap function of `panel` (already a `PanelCardBody`
prop), an executor who instead recomputes it locally instead of accepting it
as a prop produces identical runtime behavior — so this ambiguity, if acted on
either way, is not a functional risk. Worth a one-line tightening at execution
time, not a design-gate blocker.

### Nothing else regressed

- `proposal.md`'s "What Changes" and `ticket.md`'s scope/ACs are unchanged and
  remain consistent with the revised design.md/tasks.md.
- `specs/panel-manual-refresh/spec.md`'s requirements/scenarios are
  behavior-level and unaffected by the D1/task-1.2 revisions; still accurate
  against the live `usePanelData`/`PanelCard` code.
- Decision 2 (synchronous inline `inFlightRef`, never mirrored via a second
  effect) and Decision 3 (`isRefreshing` as a new field, `isLoading`'s
  definition untouched) are unchanged from round 2's already-confirmed text
  and still check out against the live file.
- Decision 4 (no freshness label) is unchanged and was already verified
  factually accurate in round 2 (`dataAsOf` absent from the frontend
  `PanelBase` type).
- No code outside `openspec/changes/per-panel-manual-refresh/` has been
  touched — this remains a planning-only round.
- `openspec validate per-panel-manual-refresh --type change` passes fresh
  (pasted above).

### Verdict: CONFIRM

### Non-blocking notes

1. Tighten tasks.md 2.2's prop-list sentence to explicitly name `outputId` as
   a new `PanelCardBodyProps` field alongside the `PanelDataResult` fields
   (currently only implied by the following sentence about
   `usePanelPolling`/`usePanelRunRefresh` "reading refresh/outputId from
   props"). Not a functional risk either way `getOutputId` is sourced, but
   removes the last bit of ambiguity in an already heavily-revised task.
2. `PanelCardBody`'s doc comment (lines 45-48) describes its `React.memo`
   boundary purely in terms of the `panel` prop; once `isLoading`/
   `isRefreshing`/etc. become additional props that legitimately vary the memo
   comparison, a one-line comment update at execution time would keep it
   accurate (not required by any task item today).
3. Task 1.2's dispatch-count arithmetic (see "one loose end" above) would
   benefit from an explicit note that the executor should isolate the
   refresh-cycle assertion from the mount-triggered initial fetch (e.g. by
   awaiting the mount fetch to resolve first, matching this test file's
   existing `refresh() triggers a re-fetch` convention) — again not blocking,
   since the assertion is discriminating either way.
