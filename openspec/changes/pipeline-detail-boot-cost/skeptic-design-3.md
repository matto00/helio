## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 70b063a47046910b4526f7de0add5901cc39fbb0. The change dir is untracked, so there are no code edits yet. Spawn-cwd guard: READY. Artifacts read: ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-editor-page/spec.md, skeptic-design-1.md and skeptic-design-2.md.

### What I verified (with evidence)

**Round 2 CR1(a), the StrictMode duplicate GET on revisit, is closed.**
- The cleanup reset is gone. D3 says "There is NO cleanup-time reset".
- The boot fetch is now chained off the mount effect's own `fetchPipelineById` promise.
  - That effect is guarded by `lastFetchedIdRef` (`usePipelineDetailPage.ts:301-310`). The ref survives StrictMode's simulated unmount and remount, so effect run #2 dispatches nothing.
  - One pipeline promise means one chained history dispatch.
- The `condition` (same pipelineId and same openId in flight) is a second guard.
- The new scenario "A StrictMode revisit still issues one run-history GET" and task 3.2's StrictMode test cover it.

**Round 2 CR1(c), the boot gate reading stale store state, is closed.**
- D3 gates on this open's `fetchPipelineById` fulfilment.
- The payload is a `PipelineSummary` (`pipelinesSlice.ts:189-195`), which carries `lastRunTruncated` (`types/pipelineStep.ts:665`).
- The gate no longer reads `currentPipelineStatus`.
- The retry path is named. It currently lives in `PipelineDetailPage.tsx:140-141` (`onRetry` dispatches `fetchPipelineById` directly), so the implementer must route it through the hook. That is implementable.

**Round 2 CR1(b), a late response marking a revisit fresh, is closed only when the page remounts.**
- A remount creates a new mount token, so a late response carries a different openId and is never fresh.
- **It is not closed for an in-place id change. See CR1.**

**Round 1 items stay resolved.**
- CR2: a `force` refresh plus latest-request-wins, task 3.3.
- CR3: C1 and D5 reproduce `root-cause-evidence.md:65,73`.
- CR4: the title has no count when not fresh, and "No runs recorded yet" shows only when the list is fresh and empty.

**Post-run force path with openId: sound.**
- A forced dispatch with the current openId becomes the latest request. The earlier response is then dropped by the requestId check.

**Ground truth behind CR1:**
- `AppRoutes.tsx:115` declares `<Route path="/pipelines/:id" element={<PipelineDetailPage />} />` with no `key`. So going from `/pipelines/A` to `/pipelines/B` re-renders the same component instance: same refs, same mount token.
- In-place navigation between pipelines is an ordinary path. Sources:
  - The AppShell sidebar (`shared/chrome/SidebarBody.tsx:135`, `toHref={(item) => \`/pipelines/${item.id}\`}`).
  - The picker (`shared/chrome/usePickerSelection.ts:140`).
  - `resourceNavigation.ts:45,49`.
- `runHistory` is keyed by pipeline (`pipelinesSlice.ts:84`). D2 makes the status, requestId and openId fields per pipeline too, so A's fields survive a visit to B untouched.

**Tests that will break, beyond the ones task 3.2 lists:**
- `PipelineDetailPage.test.tsx:2183-2208` seeds `runHistory` and asserts the persisted banner synchronously. This is the HEL-873 persisted-banner test. Under D3 it renders no banner, because the records are not fresh for the open.
- `PipelineDetailPage.test.tsx:3061-3080` waits for the on-mount `fetchRunHistory` call, then expects `toHaveBeenCalledTimes(2)`. With no boot fetch, its first `waitFor` never passes.

**Lint (non-blocking, see notes):** `eslint-plugin-react-hooks` 7.0.1's recommended set is applied (`eslint.config.cjs:94`). It includes `react-hooks/refs` and `react-hooks/purity`, under a zero-warnings policy.

**Other checks:**
- No TODO/TBD placeholders.
- No contract or schema impact.
- AC coverage is complete.
- Scope matches the ticket and avoids HEL-1350's files.

### Verdict: REFUTE

### Change Requests

1. **openId `<mount token>:<id>` collides when the user goes A, then B, then A in place, so an earlier visit's history counts as fresh.**
   - **The path:** open pipeline A and open its modal. A's history becomes `succeeded` with openId `T:A`. Click pipeline B in the sidebar (same instance, openId `T:B`). Click A again. The openId is `T:A` again.
   - **The effects:**
     - A's stored list is "fresh for this open", so the modal shows it without a GET. This violates the spec requirement ("a list loaded on an earlier visit SHALL NOT be shown without being refetched") and the scenario "Run history is refetched on a later page open".
     - A first-A-visit response landing after the user returns also carries `T:A`, so it marks the return fresh. That violates "A response from an earlier visit does not count for a later one". This is round 2's (b) again, by the in-place route instead of a remount.
     - The `condition` would also dedupe the return visit's modal fetch against a request still in flight from the first A visit.
   - **Required revision:** make the token unique per page open, not per (mount, id).
     - For example, a counter or fresh token regenerated on every `id` change. That means `${mountToken}:${seq}`, where `seq` increments when `id` changes, held in StrictMode-stable state.
     - State it in D3, and add the in-place A to B to A path to the spec's revisit and late-response scenarios.
   - **Add an RTL test:** render at `/pipelines/A`, open the modal and resolve. Navigate in-router to B, then back to A, and open the modal again. Assert a second A GET. It must be red against the `<mount token>:<id>` version.
   - **Also extend task 3.2's migration list** with `PipelineDetailPage.test.tsx:2183` (the persisted-banner test) and `:3061-3080` (the mount-plus-run call count).
     - Migrate the banner test by driving the chained boot fetch: mock `getPipelineById` with `lastRunTruncated: true` and `fetchRunHistory` with the truncated run, then await. Never seed a succeeded status, since that would bypass the very path this change adds.
     - Re-derive the call-count test's expected count from the new boot rule.

### Non-blocking notes
- **The token mechanics must pass lint.** `react-hooks/refs` flags reading `ref.current` during render, and the freshness check needs openId in render. `react-hooks/purity` flags `Math.random`/`crypto.randomUUID` in render. A `useState(() => token)` lazy initializer also survives StrictMode and is lint-clean. Do not add `eslint-disable` lines to satisfy the ref wording in D3.
- **The boot chain must not get a cleanup cancel flag.** If the chained `.then` is cancelled by an "active" flag set in the mount effect's cleanup, StrictMode's simulated cleanup cancels it. Run #2 is ref-guarded and dispatches nothing, so there would be zero history GETs on a truncated open. Task 3.2's StrictMode test should catch this; it is worth one line in D3.
- **Refreshes should not hide a list that is already fresh.** With freshness = `succeeded` AND the latest request's openId, a forced post-run refresh while the modal is open flips it to the loading state, hiding a list it already showed. Today the list stays and updates. Consider keeping the last list from this open visible during a refresh, i.e. stale-while-revalidate within the same open. Otherwise, name this as an accepted visible change under the "No behaviour regressions" AC.
