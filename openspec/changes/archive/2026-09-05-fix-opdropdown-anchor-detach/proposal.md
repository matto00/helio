## Why

`OpDropdown`'s open menu intermittently detaches from the DOM while the user is reaching for an item, so the
click lands on nothing — measured at ~45% on base `a45e9881` (9 of 20 isolated iterations). This is a shipping
user-facing defect: a menu that ignores a click shortly after adding a step. It is also, as of the 2026-09-05
field data, the single largest tax on delivery throughput — three consecutive PRs (#555, #562, #563) went red on
`e2e/hel968-multi-root-editor-flow.spec.ts` with diffs that could not plausibly have caused it, and all three
went green on a bare re-run. That trains reviewers to discount a red e2e, which is the more expensive damage.

## What Changes

- Run the isolation experiment the ticket names as the first task and nobody has done: temporarily disable
  `usePipelineDetailPage`'s 300ms debounced `analyzePipeline(id)` dispatch **alone**, re-run the repeat loop, and
  measure the flake rate against the established baseline. This converts the leading correlate into a confirmed
  cause or eliminates it.
- From that probe-confirmed root cause, fix the mechanism that lets a burst of ancestor re-renders tear down or
  re-place the open menu's DOM node mid-interaction. The `anchorRef={{ current: ... }}` object-literal identity
  churn (`PipelineRiverView.tsx:312`, `BranchAffordance.tsx:46`) driving `OpDropdown`'s `useLayoutEffect(...,
  [anchorRef])` is the standing hypothesis, not a licensed fix.
- **Un-quarantine `e2e/hel912-lanes-rejoin.spec.ts`** by removing its `testIgnore` entry from
  `playwright.config.ts`, returning the guard to service. This is a hard acceptance criterion.
- Add unit coverage that fails on the pre-fix behavior, so the guarantee is not carried by an e2e alone.

## Capabilities

### New Capabilities

- `pipeline-op-picker-stability`: the op-type picker's open menu SHALL remain mounted, positioned, and
  clickable across ancestor re-renders that occur while it is open — including the render burst produced by the
  debounced pipeline analyze that follows any step-list change.

### Modified Capabilities

(none — no existing spec describes `OpDropdown`'s behavior; `grep` over `openspec/specs/` returns zero hits.)

## Impact

- `frontend/src/features/pipelines/ui/OpDropdown.tsx` — positioning effect and its dependency.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx`, `.../BranchAffordance.tsx` — anchor prop identity.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — only if the probe implicates the dispatch.
- `playwright.config.ts` — one `testIgnore` entry removed.

## Non-goals

- **HEL-964** (`hel908-full-flow`) and **HEL-962** (`hel908-tail-attach`) are explicitly out of scope. HEL-962 is
  a stale-locator problem from HEL-943's "Add tail step" -> "Branch" rename — a different cause. Both are
  re-checked and *reported on* after the fix; neither is un-quarantined or fixed here without escalating first.
- Re-litigating the A/B result, the not-a-remount finding, or the render-churn discriminator. All are settled.
- Any production database or deploy action — this run has neither.
