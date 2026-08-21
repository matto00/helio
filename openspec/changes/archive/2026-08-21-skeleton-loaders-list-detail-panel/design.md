## Context

`DESIGN.md` §7 permits the accent border-spinner **or** a skeleton, but the app has no skeleton primitive
(`grep -riE "skeleton|shimmer"` over `frontend/src` finds none), so every surface improvised — read from
the tree at `3d93e82a`:

- Bare text lines: `SourcesPage.tsx:53` (`<p>Loading sources…</p>` at `--text-xs` — the inherited HEL-539
  defect), `TypeRegistryPage.tsx:24`, and `PanelList`/`DashboardList`/`SidebarItemList` via
  `StatusMessage.tsx:18`'s `<p>`.
- Full-surface spinner takeovers: `PipelineDetailPage.tsx:626` (early return), `PanelContent.tsx:80`,
  `PipelinesPage.tsx:35`. `SourceDetailPanel.tsx:281` keeps its "Click Preview…" hint mid-flight.

`PanelGrid.tsx` is presentational with no loading branch — `PanelList` gates it on `items.length > 0`,
so the grid area is simply **empty** while panels load. `SourceDetailPanel` receives a resolved `source`
prop; its only in-flight state is the local preview fetch. Two upstream facts constrain everything:
`usePanelData.ts:240` already computes `isLoading = isLoadingMore && rows.length === 0`, so
`PanelContent`'s `isLoading` is *already* initial-only; but the list slices flip redux `status` to
`"loading"` on **every** fetch, and no slice clears `items` on `pending`, so
`status === "loading" && items.length === 0` is an initial-load predicate available everywhere with zero
new Redux state.

## Goals / Non-Goals

**Goals:** one shared `Skeleton` primitive; shape-matched, no-layout-shift placeholders on initial load
across the enumerated surfaces; a genuine `prefers-reduced-motion` opt-out; token-only styling; one
consistent treatment everywhere; the skeleton-vs-spinner division documented in code.

**Non-Goals:** error states (HEL-539) / empty-state CTAs (HEL-548) / toasts (HEL-535); `TextRenderer`'s
unbound-panel placeholder lines (geometry locked by `panel-content-sizing` spec:44, and they mean "not
bound to a type", not "data is in flight" — converting them would overload one visual with two meanings); `PageSuspenseFallback`; backend changes; fixing HEL-539's `isRetrying`
dead code; the four empty `aria-busy` divs at `dashboards/ui/ProposalReviewPage.tsx:204`,
`pipelines/ui/PipelineProposalReviewPage.tsx:85`, `patchSets/ui/PatchSetReviewPage.tsx:171`,
`proposals/ui/CombinedProposalReviewPage.tsx:83` — each carries a class name with zero matching rules in
any stylesheet, so each renders nothing at all. A real §7 violation, but on non-enumerated surfaces, and
two are commented as unreachable type-narrowing guards; follow-up candidates.

## Decisions

**D1 — Add a shimmer-duration token; do not reuse the motion tokens as-is.** `--app-transition`
(`0.16s ease`) and `--transition-slow` (`0.28s cubic-bezier(…)`) are transition *shorthands* tuned for
hover and one-shot entrances; a 0.28s infinite sweep strobes. `theme.css` gains
`--app-skeleton-shimmer: 1.6s` in the Motion block. *Rejected:* a literal `1.6s` — precisely the drift
HEL-652/680/677 exist to clean up; adding a token is the sanctioned mechanism (DESIGN.md §3, whose Motion
bullet and §6 primitives list are both extended to match).

**D2 — The reduced-motion opt-out must be explicit; the global rule is a trap.** `theme.css:240-248`
collapses `animation-duration`/`-iteration-count` but does not disable a shimmer, and its `!important`
outranks a normal declaration. `Skeleton.css` carries its own `@media (prefers-reduced-motion: reduce)`
block setting the `animation` shorthand to `none` plus a flat `background`. Full mechanism and the reason
a duration-based mitigation silently fails are specified in `specs/shared-skeleton/spec.md`. jsdom
evaluates no media queries, so this is locked by a static `Skeleton.css.test.ts`, per the
`EmptyState.css.test.ts` / `IconButton.css.test.ts` precedent.

**D3 — Shape-match by reusing the real layout, not by re-guessing it.** Each surface renders its
placeholder *inside the same wrapper element and CSS classes* as its resolved content, so padding, gap
and geometry come from one stylesheet rather than a parallel one. Sidebar skeleton rows render as `<li>`s
inside the real `<ul className="dashboard-list__items">` (2px gap) at `.dashboard-list__button`'s exact
`--control-md` (32px) height and `--app-radius-sm`. Per-surface placeholder components live beside the
surface they mimic and are built **exclusively** from the shared primitive — no shimmer CSS exists
outside `Skeleton.css`. Main-content skeletons target `EmptyState --main`'s `min-height: 320px` floor
(`EmptyState.css:16`), the number the inherited 331px→15px collapse measures against. Where a resolved
height is genuinely not predictable, the plan states a bound rather than implying an exact match:
`SourceDetailPanel`'s preview resolves into `.ui-data-grid--preview`, capped at `max-height: 320px`
(`DataGrid.css:34-39`) but shorter for a small result set, so its skeleton uses a documented height with
a stated delta — the same concession D10 makes for the grid and the phone stack.

**Addendum (skeptic-final-1.md CR3) — `PipelineDetailSkeleton`'s header and footer bands carry the same
kind of accepted delta, previously undocumented.** The page container itself is stable (`[240,48,1200,852]`
before and after resolve — verified live), but two of its three bands are not exact matches, both because
their real content's LENGTH is not knowable pre-fetch, the same fact D10 licenses a bounded delta for:
- **Footer** (`y851 h49` skeleton → `y780.2 h119.8` resolved, +70.8px, moving the band up by the same
  amount): `PipelineDetailFooter.tsx:111-130` renders a `.pipeline-detail-page__meta-bar` band ONLY when
  `lastRunAt != null` — genuinely unknowable before the pipeline/run data resolves, so the skeleton (which
  omits it) cannot predict whether that band exists. Independently, `.pipeline-detail-page__footer-left`
  (`flex-wrap: wrap`) holds the output name plus one schema chip per output field — an unbounded,
  data-dependent count with no resolver-style mechanism (unlike D10's grid, there is no
  `resolveDashboardLayout`-equivalent to run over synthetic stand-ins here), so it can wrap to more lines
  than the skeleton's fixed two.
- **Header** (`h31` skeleton → `h36` resolved, +5px), and consequently **river** (`y79 h772` →
  `y84 h696.2`, absorbing the header's growth so the container stays fixed): the same source-of-truth
  problem at smaller scale.

**Rejected: hand-building a meta-bar-shaped placeholder and a guessed schema-chip count.** This is
precisely the class of fix the ticket's own review already rejected once for the grid (D10's Context section
notes hand-placing "full `cols` width" would have been wrong on the majority path) — inventing a specific
shape for content whose presence/length is unknowable pre-fetch produces a placeholder that is confidently
wrong as often as it's right, which is worse than a documented, bounded delta. Recorded here, the way this
decision documents `SourceDetailPanel`'s bound above, rather than left as a silent gap between the
artifacts' implied parity and the code's actual behavior.

**D4 — Skeletons render on initial load only.** With items present a refetch keeps rendering them rather
than flashing back to placeholders (refined by D11/D12 for the idle frame and dashboard switches).
`PipelineDetailPage` already uses the data-presence form (`currentPipeline === null`) and keeps it. This
also brings `DashboardList` and `SidebarItemList` into agreement — today `DashboardList.tsx:289` renders
its `<ul>` unconditionally during load while `SidebarItemList.tsx:293` does not, so the sidebar shows two
different treatments by route.

**D5 — `StatusMessage` loses its loading branch and narrows its prop type.** All three consumers stop
routing loading through it, so keeping the branch leaves new dead code. `status` becomes
`"idle" | "succeeded" | "failed"`, making `status="loading"` a **compile error** rather than a silently
blank list. *Rejected:* leaving it as a safe default — trading a loud type error for a silent §7
violation at a future call site.

**D6 — `PanelSuspenseFallback` becomes the panel skeleton, which is therefore kind-agnostic.**
`SuspenseFallback.tsx:4-9` documents an explicit HEL-512 invariant that the chunk-load fallback is
*visually indistinguishable* from `PanelContent`'s data-load, and `ChartRenderer` renders it **inside the
same panel card** whose data-load becomes a skeleton — leaving it puts two loading treatments in one
frame. But `PanelSuspenseFallback` takes **no props** (`SuspenseFallback.tsx:10-17`) and cannot learn the
panel kind, and it sits nested inside `.panel-content--chart > .chart-panel__canvas`
(`ChartRenderer.tsx:41-55`) while `PanelContent`'s loading branch replaces the whole body with
`.panel-content--state`. So the panel-body skeleton is **one kind-agnostic component that fills its
container**, used by both — not "shaped to the renderer type", which would be unmatchable across those
two boxes and would break the very invariant D6 exists to keep. Nothing is lost: the card's box, which is
what layout shift is measured on, is fixed by the grid cell either way (D10), and the body is `flex: 1`
in both. The `frontend-code-splitting` delta locks the invariant rather than the widget.
`PageSuspenseFallback` is a whole-route wait with no panel frame around it and is left alone.

**D7 — The division, documented in code.** Skeleton = initial structural load. Spinner = short in-place
work over existing structure: `TableRenderer`'s "Load more" (`:154`), `SourceDetailPanel`'s
Preview/Reload label, `MessageComposer`'s "Sending…", `RefinementChatDrawer`'s progress row, and
`PageSuspenseFallback`. A comment stating this sits on `Skeleton.tsx`. No existing spinner is removed
except the first-load takeovers listed in Context plus `PanelSuspenseFallback`.

**D8 — A pipeline-run refresh keeps presenting as a first load, and that is acceptable.**
`markDataTypeRowsStale` (`panelsSlice.ts:94-101`) deletes the pagination entry, so the next fetch has
`rows.length === 0` and reads as initial. Today that renders a full `Spinner xl` takeover; after this
change, a full skeleton takeover — same structural class, better looking, no regression to polling UX.
Because this is a deliberate exception to D4, `loading-state-pattern` names it explicitly and locks it
with its own scenario rather than asserting a rule the code breaks. *Rejected for now:* preserving `rows`
behind a stale flag so it reads as a refresh — a real change to refresh semantics, beyond this fence, and
the better home for adding a grid-card refresh spinner (there is none today: `isLoadingMore &&
rows.length > 0` renders nothing). Recorded as a follow-up.

**D9 — Sidebar row shape is a call-site prop.** `/registry` rows are `--stacked`
(`DashboardList.css:508-513`) and `SidebarBody.tsx:217` is the only `subtitle:` producer; every other
section is a flat 32px row. With zero items `SidebarItemList` cannot infer this, so the call site passes
it. That height is content-derived and unmatched by any token, so `/registry` is measured first.

**D10 — The grid skeleton approximates `resolveDashboardLayout`, and never renders zero cards.** Both
grids render `resolveDashboardLayout(panels, layout)` (`DesktopPanelGrid.tsx:115`,
`MobilePanelStack.tsx:46`), not the saved `layout` — that function fills a fallback position for every
panel missing from the saved array and projects entries across breakpoints. And saved layouts are usually
empty: `useLayoutSave.ts:51-52,76-78` seeds its persisted baseline with the *client-resolved* layout and
early-returns when they match, so a generated layout is never written back until a real drag. In the dev
DB, 45 of the 71 dashboards that have panels store zero layout entries, and `defaultDashboardLayout` is
four empty arrays — so "one card per saved-layout entry" would render **nothing** on the majority of
dashboards, failing the ticket's hard line on the one surface it was written for.

The panel count is genuinely underivable before `fetchPanels` resolves, but the *geometry* need not be
approximated at all: build the placeholders by running the grid's own resolver over N synthetic panel
stubs — `resolveDashboardLayout(stubs, savedLayout)[activeBreakpoint]`. One rule covers all three cases,
including the breakpoint-**projection** case (`pickProjectionSource`/`projectLayout`,
`dashboardLayout.ts:150-186`) that a saved-array reading misses entirely and that dominates at `xs`,
since users drag on desktop and leave the phone breakpoint empty. Where the saved layout has no entries
for the active breakpoint — a decidable condition, unlike "covers the panel set" — N is **3**, and the
resolver applies `defaultItemWidth(colCount)` (4/4/3/2, `:51-53`) and `findNextAvailablePosition` for
free. Geometry is therefore **pixel-exact for the covered prefix in the two decidable cases** — a saved
layout that fully covers the panel set, and one with no entries for the active breakpoint — because those
are the only two cases in which the resolver's placement for every panel is determined by the saved
layout alone, independent of the panel count the skeleton cannot yet know. Hand-placing "full `cols`
width" would have been 3× too wide at lg, on the majority path. The skeleton renders **inside**
`.panel-list__zoom-container` (`PanelList.tsx:258-270`), sharing its `transform: scale()` and sizing, so
a saved zoom ≠ 1 does not displace the swap.

**Correction (evaluation-1.md CR4) — the third, *partial*-coverage case does not get an exact match, and
an earlier version of this decision overclaimed that it did.** When a saved layout covers only some of the
panel set (the common case for an actively-used dashboard whose panel count has grown since the last
drag — `skeptic-output overview`'s dev-DB profile at 4 saved `lg` entries / 6 real panels measured a
140px per-card height delta beyond the covered prefix; `Skeptic Isolation Test` is the *fully-empty*
case above, not this one), `findNextAvailablePosition` displaces the saved-position
panels beyond that coverage into free space to make room for the panels the skeleton's synthetic stubs
cannot represent (the real panel count, and therefore which real panels get displaced and by how much, is
exactly the fact D10's premise says is unknowable pre-fetch). The covered prefix still matches exactly;
the displaced remainder's position and size delta is an accepted, documented consequence of
resolver-derived placement — not a defect, and not the *count* delta the spec licenses elsewhere, but a
third, narrower one specific to this case. `specs/loading-state-pattern/spec.md`'s grid requirement and
scenario list now say this explicitly, the way D3 already states a bound rather than an exact match for
`SourceDetailPanel`'s preview height.
Below `breakpoints.sm` (768px) `PanelGrid.tsx:50-64` mounts
`MobilePanelStack` — a flex column at `--space-3` gap/padding whose per-card height comes from
`mobilePanelHeights.ts` and depends on `panel.kind`, unknowable pre-fetch. There the skeleton matches the
stack's width and spacing at a single documented neutral height, accepting a per-card **height** delta.
*Rejected:* deferring phone skeletons — that keeps rendering nothing, which the ticket forbids outright.

**D11 — The initial-load gate includes the pre-dispatch `idle` frame — except on `PanelList`, whose
`idle` is re-entrant and terminal.** These surfaces mount at `status === "idle"` and dispatch from a
mount effect, which React runs *after* paint — so a `"loading"`-only gate paints the **empty** branch
first and the skeleton one commit later. `SourcesPage.tsx:77` renders the full ~331px "Connect a data
source" hero at idle, on the very page whose inverse collapse this ticket inherited. The gate therefore
becomes `(status === "idle" || status === "loading") && items.length === 0` on the surfaces whose `idle`
is genuinely pre-dispatch: `SourcesPage`, `PipelinesPage`, `TypeRegistryPage` (each dispatches from its
own mount effect) and `DashboardList` (`App.tsx:120` dispatches `fetchDashboards()` unconditionally).
This is safe there because `panelsSlice.ts:88` is the **only** site in the entire frontend that assigns
`status = "idle"` — for every other slice `idle` is reachable exactly once, before the first dispatch.

**Two exceptions, both load-bearing:**

*`SidebarItemList`.* `SidebarBody.tsx:78-101` dispatches only the *active* section's fetch and skips the
chat section entirely on the free tier, so an idle-inclusive gate would park a permanent skeleton there.
It receives the initial-load flag from its call site — the same call site that already supplies its row
shape (D9) — and `SidebarBody` sets it only for sections it actually dispatches for.

*`PanelList` keeps a `"loading"`-only gate and accepts its one pre-dispatch frame.* It does **not**
self-dispatch (`App.tsx:123-129` does, and that effect early-returns when `selectedDashboardId === null`
and is keyed on `[dispatch, selectedDashboardId]` alone — not on `status` or `loadedDashboardId`). Two
states therefore sit at `idle` **forever**, with no fetch pending and none coming: (a) **zero
dashboards**, where `selectedDashboardId` is `null` so the effect never dispatches — widening here would
render skeletons over `PanelList.tsx:225-237`'s "No dashboards yet" + **"New dashboard" CTA**, the F-003
bootstrap path and the surface HEL-554's first-run experience is built on; and (b) **deleting a
dashboard's last panel**, where `markDashboardPanelsStale` (`panelsSlice.ts:85-89`) sets `status =
"idle"` *and* clears `loadedDashboardId`, `deletePanel.fulfilled` empties `items`, and nothing refetches
until the next dashboard switch. Note (b) also rules out `loadedDashboardId` as a "fetch is coming"
discriminator — it is `null` in both the pre-dispatch frame and this terminal state, so no Redux state
distinguishes them.

Be precise about what the accepted frame actually contains: at `idle` with a dashboard selected and no
items, **`PanelList` renders nothing at all** — `:209` yields `null` for idle, `:224` needs
`selectedDashboardId === null`, `:246` needs `status === "succeeded"`, `:258` needs `items.length > 0`.
So what is accepted is one frame of the **pre-existing blank grid area**, not of a legitimate empty
state. That is still strictly cheaper than a permanently lying loading state, so the decision stands —
but the artifacts must not claim an empty state renders there. The missing `EmptyState` on that terminal
branch is a genuine §7 empty-state gap that predates this change and belongs to **HEL-548**; closing it
here would mean rendering "No panels yet" for one frame *before* the skeleton on every cold boot, which
is the very flash this ticket forbids — a worse trade, and outside the fence. Recorded, not fixed.

**D12 — A dashboard switch renders the skeleton, not the previous dashboard's panels.**
`fetchPanels.pending` (`panelsSlice.ts:102-106`) does not clear `items`, so on a switch a plain
`items.length === 0` gate is false and the *old* dashboard's panels keep rendering under the *new*
dashboard's layout until the fetch resolves — and since a cold boot is the only other path, the headline
skeleton would almost never appear. Each `Panel` carries `dashboardId` (`panel.ts:321`), so `PanelList`'s
emptiness test is "no items **for the selected dashboard**" — state-free. Composed with D11's exception,
its full gate is `selectedDashboardId !== null && status === "loading" && (items.length === 0 ||
items[0].dashboardId !== selectedDashboardId)`. A switch dispatches immediately, so `fetchPanels.pending`
has already set `status = "loading"` while `items` still holds the previous dashboard's panels — the
skeleton fires, and the in-session switch becomes its primary path without any reliance on `idle`. This
is not a contradiction of D4: D4 keeps content across a refetch of the *same* list; a different
dashboard's list is not that list.

**D13 — The panel body's own pre-dispatch frame is closed, using a discriminator that provably exists.**
`design.md`'s Context notes `usePanelData`'s `isLoading` is already initial-only, but it is also **false
before the fetch is dispatched**: `paginationEntry` is `undefined` on first mount, so `:240`'s
`isLoading` and `:241-242`'s `noData` are both false, and `PanelContent.tsx:115-167` falls through to the
renderer with null data — a metric panel paints **"--" and "No data"** for one frame. That is worse than
a blank flash: it is a data-availability claim made before any request exists, on a surface the ticket
enumerates, contradicting the ticket's verbatim rule. Leaving it silent while D11 spends an entire
decision on the same hazard for lists would be an internal inconsistency in the plan.

Unlike `PanelList`, a sound discriminator is available here: `currentFetchKey !== null &&
paginationEntry == null` is *guaranteed* to be followed by a dispatch — `usePanelData.ts:91-92` early-
returns when there is no fetch key, and `:99`'s dedupe guard is deliberately bypassed when
`paginationEntry == null` (HEL-242). It is not re-entrant the way `panelsSlice`'s `idle` is, so widening
carries none of D11's risk. `PanelDetailModal.tsx:78` uses the same hook and inherits this.

Widening the hook alone is **not sufficient**, and this is the plan's most easily-missed seam:
`PanelCard.tsx:103` reads `isLoading={panel.type === "table" ? tableIsLoading : isLoading}`, and
`tableIsLoading` (`:89-94`) re-derives the flag with `paginationEntry != null` — the very condition
being widened away. Left in place, a grid table panel still falls through to `TableRenderer`'s
`aria-hidden` ghost table (`:183-208`), so the same panel would load differently in the grid than in its
detail modal. `tableIsLoading` is therefore **deleted** and `:103` passes the hook's `isLoading` for
every kind; the two expressions are character-for-character equivalent once the entry exists
(`usePanelData.ts:240`), so the load-more and refresh paths are unaffected. D13 also carries the only
locking test the plan had omitted — the direct cause of this seam surviving four review rounds — driven
through `PanelCardBody`/the hook rather than `PanelContent`, which takes `isLoading` as a prop and
cannot exercise it.

## Risks / Trade-offs

- **Placeholders that don't actually match → layout shift, the headline AC silently unmet.** → Measure
  `getBoundingClientRect()` on each container before and after resolve; never eyeball it. `/registry`'s
  stacked sidebar rows and the phone stack are the two hardest targets — measure them first.
- **Shimmer looks cheap beside the rest of the app.** → D1's duration plus the two-stop
  `--app-surface-soft` → `--app-surface-raised` ramp (`#efece6`→`#ffffff` light, `#161514`→`#232019`
  dark); light has less headroom against the `#f4f2ed` page, so review both themes explicitly.
- **Widening the loading gate changes when the error branch unmounts.** → The three pages' `isRetrying`,
  and `PanelList`'s `isRetryingPanels`, are already effectively unreachable (HEL-539 finding 2); confirm
  none is *more* broken and leave those fixes to their own ticket.

## Planner Notes

Self-approved, none meeting the escalation bar (no new dependency, API break, or architectural change):
(a) including `SourcesPage`/`PipelinesPage`/`TypeRegistryPage`, not enumerated by the ticket but whose
`<p>Loading …</p>` **is** the inherited HEL-539 defect — fixing only the enumerated surfaces would close
the ticket with its motivating bug still on screen; (b) adding one `theme.css` token (D1); (c) narrowing
a shared prop type (D5); (d) the `frontend-code-splitting` delta (D6); (e) the bounded phone-stack shift
(D11). Noted, not fixed: `panel-content-sizing` spec:44 says `border-radius: 4px` while
`PanelContent.css:98` uses `--app-radius-sm` (6px); `.dashboard-list__items`' `2px` gap and
`SourceDetailPanel.css`'s `12px`/`8px` are pre-existing literals — inherited by reuse under D3, not newly
introduced.
