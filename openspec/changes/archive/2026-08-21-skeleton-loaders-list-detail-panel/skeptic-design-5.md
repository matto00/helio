## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Re-derived from ground truth as if this were round 1, then checked the prior four rounds' change
requests against the tree myself. Every line/behaviour claim below is one I read in the worktree at
`3d93e82a`, not one I inherited from another agent's report.

### What I verified (with evidence)

**Gates the planner reported.** Re-ran both: `openspec validate skeleton-loaders-list-detail-panel
--strict` → `Change 'skeleton-loaders-list-detail-panel' is valid`; `node
scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`. Both genuinely pass.

**CR1(a) — internally consistent, and the rejection of option (b) is sound, not a rationalisation.**
I re-derived `PanelList`'s four branches by reading `PanelList.tsx:208-278`: `StatusMessage` at `:209`
returns `null` for `idle` (`StatusMessage.tsx:38-39`); `:224` requires `selectedDashboardId === null`;
`:246` requires `status === "succeeded"`; `:258` requires `items.length > 0`. At `idle` + dashboard
selected + `items === []` **nothing renders in the content area** — exactly as `design.md` D11:169-177,
`specs/loading-state-pattern/spec.md:203-212`, its `:228-231` scenario, and task 6.5c-ii now all say.
Consistent across all four artifacts, and none of them claims an empty state renders.
Option (b) is correctly rejected: `App.tsx:122-129` dispatches `fetchPanels` from an effect (after
paint) and `panelsSlice.ts:42-49` starts at `status: "idle"`, so widening `:246` to `idle` would paint
"No panels yet" on the frame *before* the skeleton on every cold boot with a dashboard selected. That
is strictly the flash the ticket forbids. I also confirmed the terminal-idle state is real and
*persistent*, not one frame: `deletePanel` (`panelThunks.ts:127-139`) dispatches
`markDashboardPanelsStale` and — unlike `createPanel`/`duplicatePanel` (`:107-108`, `:149-150`) —
never refetches; `panelsSlice.ts:85-89` sets `status = "idle"` and clears `loadedDashboardId`, and
`:130-132` empties `items`.

**D13's discriminator — correct, complete *in the hook*, and it swallows nothing.**
- Always followed by a dispatch: `usePanelData.ts:88-92` early-returns only when `currentFetchKey` is
  null; `:95-99`'s dedupe guard is deliberately bypassed when `paginationEntry == null` (HEL-242); the
  effect's deps include `paginationEntry` (`:140-148`), so a deleted entry re-arms it.
  `fetchPanelPage` has **no `condition` option** (`panelThunks.ts:423-427`), so `pending` cannot be
  suppressed.
- Cannot swallow an error or a no-data state: `fetchPanelPage.pending` *creates* the entry
  (`panelsSlice.ts:196-205`) and `rejected` preserves it (`:218-226`), so after any completed fetch
  `paginationEntry != null` and the widened clause is false — the error branch
  (`PanelContent.tsx:87`) and `noData` (`usePanelData.ts:241-242`) stay reachable.
- No permanent-skeleton hazard on a panel with no fetch target: `usePanelData.ts:224-236` early-returns
  `isLoading: false` when `currentFetchKey === null`, and the widened clause requires it non-null.
  `resetPanelPagination` (`panelsSlice.ts:78-81`) has zero dispatchers, so it adds no third path.
- D8 interaction is coherent: `markDataTypeRowsStale` (`:94-101`) deletes the entry → widened clause
  true → effect re-runs → dispatch → skeleton takeover, which is exactly what D8 and its spec scenario
  lock. Polling is unaffected: `refresh()` (`usePanelData.ts:83-87`) does **not** delete the entry, so
  a poll refetch keeps `paginationEntry != null` and `rows.length > 0` → content stays, spinner
  semantics unchanged. No polling regression.
- D13's stated symptom is real: `MetricRenderer.tsx:38-50` paints `--` and "No data" from null data.

**D10/D12 grounding.** `DesktopPanelGrid.tsx:115` and `MobilePanelStack.tsx:46` both render
`resolveDashboardLayout(panels, layout)`; `defaultDashboardLayout` is four empty arrays
(`dashboardLayout.ts:19-24`); `useLayoutSave.ts:51-52` seeds the persisted baseline with the
*resolved* layout and `:74-78` early-returns on equality, so a generated layout is never written back.
`panelGridConfig` = `rowHeight: 52`, `margin: [18,18]`, `breakpoints.sm: 768`, `itemHeights.default: 5`.
`PanelGrid.tsx:48-56` branches to `MobilePanelStack` below 768px. `panel.ts:319-321` carries
`dashboardId`. `fetchPanels.pending` (`panelsSlice.ts:102-106`) does not clear `items`, so D12's
switch case is real. `PanelList.tsx:154-207`'s header and zoom widget are gated on
`selectedDashboardId`, not on `items`, so the toolbar does not shift when the skeleton swaps.

**Other cited anchors, all accurate.** `theme.css:70-71` (`--app-transition: 0.16s ease`,
`--transition-slow: 0.28s cubic-bezier(...)` — both shorthands, so D1/task 1.5's "the curve is not
extractable" is right); `theme.css:240-248` sets `animation-duration`/`-iteration-count`/
`transition-duration` `!important` but **not** `animation-name`, so D2's "use the `animation`
shorthand / `animation-name: none`" is the one mitigation that actually wins; `EmptyState.css:13-17`
`min-height: 320px`; `DataGrid.css:34-39` preview `max-height: 320px`; `.dashboard-list__items` gap
`2px` (`DashboardList.css:166-189`), `.dashboard-list__button` `height: var(--control-md)` (`:424-431`),
`--stacked` `height:auto; min-height:--control-md` (`:507-513`); `SidebarBody.tsx:78-101` dispatches
only the active section and skips chat on the free tier, with exactly five `<SidebarItemList>` render
sites (119/148/183/221/299 — verified as the *only* ones in the app) plus `DashboardList` at `:377`,
subtitle producer at `:217`; `StatusMessage`'s three render sites are `PanelList:209`,
`SidebarItemList:287/289`, `DashboardList:265`; `SuspenseFallback.tsx:4-17` (no props, HEL-512
invariant) nested by `ChartRenderer.tsx:41-55` inside `.chart-panel__canvas`; `SourcesPage.tsx:53/77`,
`PipelinesPage.tsx:35/66`, `TypeRegistryPage.tsx:12/24/48`, `DashboardList.tsx:265/269/289`,
`PipelineDetailPage.tsx:626`, `SourceDetailPanel.tsx:44/276-284`. `grep -riE "skeleton|shimmer"` over
`frontend/src` returns nothing, so "no competing implementation" holds. `panelsSlice.ts:88` is indeed
the only `state.status = "idle"` assignment in the frontend, and the four widened surfaces' thunks
either have no `condition` or one that passes at `idle` (`dashboardsSlice.ts:62`,
`pipelinesSlice.ts:177-180`), so their `idle` is genuinely once-only.

**Task 6.9's premise is correct.** `/usr/lib/node_modules/@fission-ai/openspec/dist/core/
specs-apply.js:238` rebuilds the preamble from the base spec and `:281` stamps a `TBD` Purpose for
newly created specs — a delta's `## Purpose` is never applied.

**Where ground truth contradicts the plan** — two findings, both new this round, both traced below.

### Verdict: REFUTE

**Blocking (2).** CR1 and CR2 each describe a case where the plan as written produces behaviour its
own normative `SHALL` forbids, on a surface the ticket enumerates, with no task or test that would
catch it. Both fixes are artifact edits plus (CR1) a two-line source deletion the executor was going
to touch anyway; neither re-architects anything.

**Non-blocking:** everything under "Non-blocking notes" — including the 229-line `design.md`, which I
would keep as is. Its length does not harm the executor; every long decision is load-bearing.

**Confirmed on my own reading, for the record:** D6, D8, D10's rationale, D11 (including the CR1(a)
resolution and the rejection of option (b)), D12, and D13's discriminator. Rounds 1–4's change
requests are genuinely resolved, not paper-resolved.

### Change Requests

**1. BLOCKER — task 3.2a's widening never reaches a table panel in the grid; `PanelCard.tsx:103`
intercepts it, so the new requirement's own `SHALL` is unmet for the most common bound panel kind.
(`tasks.md` 3.2a, `design.md` D13:188-192, `specs/loading-state-pattern/spec.md:233-243` + a missing
test task)**

Task 3.2a locates the fix in `usePanelData.ts` and says "`PanelDetailModal.tsx:78` inherits it". It
does — `PanelDetailModal.tsx:361` passes the hook's `isLoading` straight through. But the grid does
not:

```
PanelCard.tsx:89-94   const tableIsLoading =
                        panel.type === "table" && paginationEntry != null &&
                        paginationEntry.isLoadingMore && paginationEntry.rows.length === 0;
PanelCard.tsx:103     isLoading={panel.type === "table" ? tableIsLoading : isLoading}
```

`tableIsLoading` re-derives the flag locally and **requires `paginationEntry != null`** — precisely the
condition D13 widens away. Widen the hook and a table panel in the grid still falls through to
`TableRenderer`, which with null rows renders an `aria-hidden` 2×3 ghost table
(`TableRenderer.tsx:183-208`). The delivered sequence for a bound table panel becomes: grid skeleton →
ghost table → body skeleton → data. That is two different loading treatments inside one card in one
load (the consistency premise D6 exists to protect, relay point 7), and the *same* table panel would
load differently in the grid than in its own detail modal.

The spec requirement states "This SHALL apply wherever the hook drives a panel body, including the
panel detail modal" (`spec.md:242-243`), so the plan would ship a delta whose `SHALL` its own task set
does not implement. Round 4 saw this exact hazard — `skeptic-design-4.md:159` notes "`tableIsLoading`
at `:89-93` *also* requires `paginationEntry != null`, so tables have the identical frame" — and the
fix omitted it. Nothing in the current task list would catch it: the D13 requirement has **no locking
test task at all** (6.5b/c/c-i/c-ii/d/e lock D8/D11/D12/D6; nothing locks D13), and 6.4's
`PanelContent` test cannot exercise it because `PanelContent` receives `isLoading` as a prop.

Required:
  a. Name `PanelCard.tsx:89-94, :103` in task 3.2a (and in D13). The cheapest correct fix is to
     **delete `tableIsLoading` and pass the hook's `isLoading` for every kind**: the two expressions
     are literally identical post-dispatch (compare `usePanelData.ts:240` — `paginationEntry
     ?.isLoadingMore === true && rows.length === 0`, where `rows = paginationEntry?.rows ?? []`), so
     the deletion is behaviour-preserving for the load-more/refresh paths and makes the widening apply
     uniformly. If you prefer to keep the local derivation, say explicitly that it must gain the same
     `currentFetchKey !== null && paginationEntry == null` clause.
  b. Add a test task (e.g. 6.5f) locking the requirement's three scenarios for **at least a metric and
     a table panel**, driven through `PanelCardBody`/the hook rather than `PanelContent`'s prop.

**2. BLOCKER — the grid skeleton's empty-layout fallback geometry contradicts the code's actual
default placement *and* the delta's own exact-horizontal-geometry `SHALL`; the phone-stack
requirement still contains the round-2 "zero cards" defect in its spec text.
(`tasks.md` 2.6a/2.6/2.8, `design.md` D10:126-136, `specs/loading-state-pattern/spec.md:140-153` and
`:170-176`)**

  a. **"full `cols` width" is the wrong number, on the majority path.** Task 2.6a says to render
     "**3** default-sized cards (`itemHeights.default` = 5 rows tall, **full `cols` width for the
     breakpoint**)". The resolved grid's default width is not `cols`; it is
     `defaultItemWidth(colCount)` (`dashboardLayout.ts:51-53`): **4** at lg (12 cols) and md (10), **3**
     at sm (6), **2** at xs — and positions come from `findNextAvailablePosition`
     (`dashboardLayout.ts:26-48`), packing left-to-right at `h = 5`. So at lg the plan's placeholder is
     three times too wide: three stacked full-width bars would swap to three quarter-width cards in a
     single row. By D10's own evidence (45 of 71 dev dashboards with panels store zero layout entries;
     `useLayoutSave.ts:51-52,74-78` explains why) this is the **common** case on the ticket's flagship
     surface and its headline AC.

     This also contradicts the delta itself: `spec.md:31-36` excuses only a *count* delta — "the
     per-row or per-card geometry SHALL match exactly — row height, gap, padding, border radius and
     **horizontal geometry**" — while D10:130-131's looser "accepting a stated count/**position**
     delta" would let the mismatch pass unchallenged at the evaluation and final gates. One of the two
     has to move, and the spec is the one that is right.

     Required: state the fallback as the code's own default placement (`defaultItemWidth(cols)` ×
     `itemHeights.default`, packed by the same rule), not "full cols width". The clean formulation —
     and I'd state it as the rule in D10 and 2.6/2.6a — is to build the placeholders by running the
     *same* resolution the grid runs: `resolveDashboardLayout(stubs, savedLayout)[activeBreakpoint]`
     over N synthetic panel ids. With that single rule the fallback case becomes a **pixel-exact match
     for the first N cards** and the only accepted delta is the count, which is what the spec already
     licenses.

  b. **The projection case is unaddressed, and at phone width it is the norm.** 2.6/2.6a present a
     binary — "layout[bp] covers the panel set" vs "empty/shorter". Ground truth has a third case:
     when `layout[bp]` is empty but another breakpoint is not, `resolveDashboardLayout` fills the
     active breakpoint by **projecting** the richest saved breakpoint (`pickProjectionSource` /
     `projectLayout`, `dashboardLayout.ts:150-186`), so the real grid renders one card per projected
     entry while the plan's skeleton renders 3 defaults. On the phone stack (`xs`) that is the dominant
     shape: users drag on desktop, so `xs` is empty while `lg` is not. Deriving through
     `resolveDashboardLayout` (a) handles this for free.

     Note also that "or covers fewer panels than the dashboard has" (`spec.md:148`) is not decidable by
     the component — the panel count is unknown at skeleton time, that being the premise. Re-word to
     the decidable condition ("the saved layout for the active breakpoint has no entries") so the
     requirement is testable.

  c. **The phone-stack requirement contradicts itself.** `spec.md:170-176` says the stack skeleton
     renders "one placeholder per saved layout entry" and carries **no** fallback clause — with an
     empty saved `xs` layout that is zero placeholders, contradicting its own scenario at `:178-180`
     ("stack-shaped placeholders are rendered, **not an empty region**") and the never-render-zero rule
     the grid requirement got. `tasks.md` 2.8 already says the right thing ("same count source and
     empty-layout fallback as 2.6/2.6a"); the archived spec text must say it too, since that is the
     durable contract.

### Non-blocking notes

1. **Keep `design.md` at 229 lines.** It does not harm the executor; the long decisions (D10/D11/D13)
   are the ones three prior reviewers demanded. One cheap readability fix: **D13 is printed between
   D11 and D12** (`design.md:179-192` vs `:194`) — reorder or renumber.
2. **Light-theme shimmer headroom, judged against the wrong reference.** D10's risk bullet compares the
   ramp to the page background (`#f4f2ed`), but the panel-card, modal and detail skeletons sit on
   `--app-surface` (`#fdfcfa` light, `theme.css:145-147`). At the highlight end the bar becomes
   `--app-surface-raised` `#ffffff` — essentially invisible against a `#fdfcfa` card, so the sweep will
   read as "the bar dissolves" rather than a travelling highlight, and light mode risks looking flat
   next to dark (`#161514` on `#1a1816` with a `#232019` highlight is well-judged). Not a plan defect —
   the plan does mandate reviewing both themes — but the visual gates should judge contrast against the
   *containing* surface, and the executor should be free to pick a different token pair (still tokens,
   DESIGN.md §3) if light reads cheap.
3. **`PanelList.tsx:156-159` renders "N panels" from `items.length` while the skeleton is up** — "0
   panels" on a cold boot, and the *previous* dashboard's count mid-switch. That is the same class of
   premature data claim D13 objects to for metric panels. Cheap polish: suppress or placeholder the
   count while the skeleton renders.
4. **Task 3.4 is loosely worded about `SourceDetailPanel`'s Reload.** `isLoading`
   (`SourceDetailPanel.tsx:44,137,166`) is also true on a *reload* with `previewRows` already
   populated; a literal `isLoading ? <skeleton> : ...` would replace the resolved `DataGrid`, which the
   initial-load-only requirement forbids and which would take the Reload path off the button-label
   spinner D7 assigns it. One clause ("only when `previewRows === null` and `previewUnsupported ===
   null`") removes the ambiguity.
5. **Test blast radius is larger than 6.3/6.4 imply.** Eight existing files assert loading copy this
   change removes: `PanelContent.test.tsx`, `ChartRenderer.test.tsx`, `MarkdownRenderer.test.tsx`,
   `PanelCreationModal.test.tsx`, `StatusMessage.test.tsx`, `SidebarItemList.test.tsx`,
   `DashboardList.test.tsx`, `SuspenseFallback.test.tsx`. 6.8 will surface them; naming them saves a
   cycle.
6. **While doing task 6.9, write real `## Purpose` text for the two NEW specs too.** `specs-apply.js:281`
   stamps `TBD - created by archiving change …`; several specs already in `openspec/specs/` carry that
   literal text, so the pattern is established but not good.
7. **`TypeRegistryPage`'s resolved content is `TypeRegistryBrowser`, not a list** — the 320px-floor
   block skeleton in 4.1/4.2 is defensible there and on `SourcesPage`, but confirm at the visual gate
   that it reads as the same treatment *family* as the row-shaped sidebar/list skeletons (relay point
   7: two visibly different treatments = the ticket failing its own premise).
8. `specs/shared-status-message/spec.md:53-56`'s "PanelList loading state" scenario says "holds no
   panels", while D12's actual gate is "holds no panels **for the selected dashboard**". Harmless, but
   align it if you are in the file.
