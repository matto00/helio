## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 62df9ff487cf7dbf08b3e51ccbc8804ccf77a73a. The change directory is untracked, so the artifacts were read from disk: ticket.md, proposal.md, design.md, tasks.md, specs/dashboard-grantee-access/spec.md, skeptic-design-1.md and skeptic-design-2.md.

### Round-2 change requests: are they actually addressed?

- **CR1 (signal for hiding the insight Refresh): addressed.**
  - D7 now names the signal: the per-panel Output `kind` from `useOutputMeta(outputId)`. I checked `hooks/useOutputMeta.ts` and `state/outputMetaCache.ts:121-139`. In panel scope that hook resolves through `fetchPublicOutputMeta(dashboardId, panelId)` and is cached per Output, and `PanelCardBody` already makes the same read, so this adds no request.
  - When the kind is unknown, the button is hidden (fail closed).
  - The "or not fed" option was removed from D1. `insightChromeStore` is stated as owner-only.
  - The footer question is answered: there is no "Updated" line in panel scope, and no new copy.
  - Task 3.5 has the red jest case, the unknown-kind case and the non-insight control case.
- **CR2 (client sort/filter and disclosure): mostly addressed.**
  - (a) `useTableRows` gets a `clientOps` input, which replaces the `onSortChange != null` suppression at `useTableRows.ts:195` for the terms it names.
  - (b) The `clientScope` prop, its copy and its "only when `loaded < total`" rule are specified.
  - (c) The zero-match copy for a truncated panel-scope table is specified.
  - (d) Owner rendering is unchanged.
  - The jest and e2e text assertions are in task 3.2.
  - One interaction with the existing disclosure branch is left open. See F2.
- **Round-2 non-blocking notes:** reflected. `usePanelSortFilter` gains `dashboardId` (task 3.2), and the D9 stranger is fixed as B against an ungranted second dashboard with no pipeline grant.

### Fresh review: what I verified against the live tree

- **The public viewer is not affected by the move to per-panel scope.** `PublicDashboardViewerPage.tsx` renders `PanelContent` with an explicit `historySource`, so it never reads `usePanelReadScope`. `useOutputHistory` and `InsightPanelBody` already prefer an explicit source over the role gate (`history/useOutputHistory.ts:38-50`, `insight/InsightPanelBody.tsx:43-46`). D2's rule "the public page keeps passing its token" holds as long as the explicit prop keeps winning.
- **The four `fetchPanelPage` dispatch sites are still exactly the four in D4.** They are `usePanelData.ts:326` and `:360`, `usePanelSortFilter.ts:143` and `PanelCardBody.tsx:200`.
- **The selected dashboard always comes from the store.** The panels on screen are fetched for `selectedDashboardId`, and `dashboardsSlice.ts:479-482` only keeps a `selectedDashboardId` that exists in `items`. So in the running app, failing closed on an unknown dashboard does not move an owner's real dashboard onto the per-panel path.
- **`PublicOutputControlScope` (C11) and the per-panel routes are unchanged since rounds 1-2** (same HEAD). My round-1 route and RLS verification still applies.

### Defects found in the plan

**F1. D1's fail-closed rule reverses a deliberate HEL-1773 default, and the design does not say what happens to the tests built on that default.**
- Today two things make every panel surface without the provider behave as owner:
  - `dashboardAccessContext.tsx:6-11`: the context defaults to `"owner"` "so every surface that never mounts the provider (... and the many component tests) behaves exactly as before".
  - `dashboardAccess.ts:64-79`: `isKnownNonOwnedDashboard` deliberately fails open for a dashboard the store does not hold, including "a panels-only store".
- D1 replaces both with `panelReadScopeFor(state, panel.dashboardId, ...)`. For an absent dashboard, `dashboardAccessRole(undefined)` returns `"viewer"`, which makes it panel scope.
- I counted the impact. 28 jest files mock or assert `getOutputRows` and seed no dashboard at all. Examples:
  - `usePanelData.test.ts`, `usePanelSortFilter.test.ts`, `panelThunks.generationStamp.test.ts`, `panelThunks.fetchPanelPage.crossFilter.test.ts`
  - `PanelCard.crossFilterServer.test.tsx`, `PanelCard.loadMoreCarriesSortFilter.test.tsx`, `PanelCard.filterEmptyState.test.tsx`
  - `PanelDetailModal*.test.tsx`, `MobilePanelStack.*.test.tsx`
- Every one of them exercises the owner Output-route path. Under D1 every one of them flips to the per-panel path (rows, split, history, capabilities, distinct values).
- The design never mentions this, so an implementer can resolve it in at least three incompatible ways:
  - seed an owned dashboard in each file;
  - have `renderWithStore` auto-seed an owned dashboard for every panel's `dashboardId`, which would also mask the fail-closed rule in every test;
  - quietly keep a fail-open or "no provider means owner" exception, which brings back the very F3 inconsistency that round 1 fixed.
- The second and third options defeat D1, and the first is a 28-file fixture edit that will look like "fixtures changed to make tests pass" at the final gate unless it is planned.

**F2. In panel scope, the existing filter disclosure would print the server total as the result count.**
- In `TableRenderer.tsx:126-137` and `:230-241`, whenever `filtering` is true (any quick search or column filter), the existing `LoadedScopeDisclosure` renders with `rowsTruncated={totalRowCount === undefined && rowsTruncated}` and `matchCount={totalRowCount ?? ...}`. That produces "{totalRowCount} results.".
- In panel scope, R4 keeps quick search and non-control column filters out of the request. So `totalRowCount` is the server total without those terms, not the number of rows that match.
- Example: a quick search that narrows 40 loaded rows (total 40) to 3 would still say "40 results.". That is a confidently wrong number, the HEL-451/HEL-1027 failure mode, and it contradicts the spec delta's quick-search scenario.
- When `loaded < total`, D4(b)'s new `clientScope` note would render next to the existing note unless their order is defined. D4 specifies the new note but says nothing about suppressing or re-deriving the existing one in panel scope.

### Verdict: REFUTE

Both fixes are small edits to design.md and tasks.md. Neither one reopens an owner ruling (R1-R4, S1 and S2 all stand).

### Change Requests

1. **D1: state how surfaces without a stored dashboard are handled, and keep the rule fail-closed (fixes F1).**
   - Say explicitly that `panelReadScopeFor` has no "absent dashboard means owner" exception in production code.
   - Say that existing owner-path tests are migrated by seeding the panel's dashboard as owned (`accessRole: "owner"`, or an `ownerId` equal to the signed-in user), file by file.
   - Say that `renderWithStore` does NOT auto-seed ownership, so the fail-closed rule stays observable in tests.
   - Name the affected test files (or the grep that finds them) as planned fixture changes in task 2.1, so the final gate can tell them apart from fixtures edited after the fact to make tests pass.
   - State that the context default `"owner"` either stops influencing read routing or is removed together with `useCanUseOutputRoutes`.
   - If a different approach is chosen, state it and the reason.
2. **D4(b): define the existing disclosure's behaviour in panel scope (fixes F2).**
   - In panel scope, when any client term is active, the existing `filtering` branch must not show `totalRowCount` as the match count. Specify one of:
     - (a) the `clientScope` note supersedes it, so only one note renders;
     - (b) a count derived from the client-filtered loaded rows.
   - When every row is loaded and a client filter is active, specify what is shown: "{filteredRows.length} results.", or nothing. Never the server total.
   - Specify the precedence so at most one disclosure line renders.
   - Add a jest case to task 3.2: panel scope, every row loaded (total 40), quick search matching 3 shows no "40 results.". Add the truncated variant too (one note, not two).

### Non-blocking notes

- **D7 kind flicker.** Failing closed hides Refresh on every panel-scope card until its meta resolves. That is acceptable, but the e2e should wait for meta before asserting that a non-insight card has Refresh.
- **`panelScopes` is a single map keyed by Output.** It is overwritten by whichever dashboard's `fetchPanels` ran last. A dual-grant user who also binds the same Output on a dashboard they own would read meta through the Output route on the shared dashboard after a switch, and C11's "zero `/api/outputs`" e2e invariant would go red even though the read is authorised. D1 already accepts this. The D10 dual-grant pass should keep the Outputs disjoint, as the switch step does.
- **D9 insight route.** Use an insight-kind panel for the 200 cases. The route returns 404 for a non-insight Output, so a mis-chosen fixture would look like a stranger 404.
