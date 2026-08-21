## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold re-derivation from ground truth: I read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` and
all four spec deltas, then re-derived the plan against the tree at `3d93e82a` before reading
`skeptic-design-1.md`/`-2.md`. Every claim below is grounded in a file or command I ran myself.

### What I verified (with evidence)

#### 1. Gates — both re-run by me

```
$ openspec validate skeleton-loaders-list-detail-panel --strict
Change 'skeleton-loaders-list-detail-panel' is valid
$ node scripts/check-openspec-hygiene.mjs
openspec/ is clean
```

(`npx openspec` fails — no local install; the CLI is at `/usr/bin/openspec`.)

#### 2. The plan's factual grounding is accurate everywhere I sampled it

Independently confirmed, from the files: `Panel.dashboardId` (`panel.ts:321`, on `PanelBase`);
`theme.css:70-71` (`--app-transition: 0.16s ease`, `--transition-slow: 0.28s cubic-bezier(…)`);
the global reduced-motion block at `theme.css:240-247` setting `animation-duration`/
`animation-iteration-count` `!important` and **not** `animation-name` (D2's mechanism is exactly
right); `StatusMessage.tsx:18` loading branch with three consumers (`PanelList:209`,
`DashboardList:265`, `SidebarItemList:287`); `SuspenseFallback.tsx:10-17` takes no props and
documents the HEL-512 indistinguishability invariant; `usePanelData.ts:240`
`isLoading = isLoadingMore && rows.length === 0` (initial-only, and `isLoadingMore && rows.length > 0`
renders nothing — so D8 removes no refresh spinner and the polling fence holds);
`EmptyState.css:16` `min-height: 320px`; `DataGrid.css:34-39` `max-height: 320px`;
`.dashboard-list__button` `height: var(--control-md)` / `--app-radius-sm` (`DashboardList.css:424-434`)
and `--stacked` at `:507-513`; `SidebarBody`'s five `SidebarItemList` call sites at
119/148/183/221/299 with the subtitle produced only in the registry branch; `PanelGrid.tsx:50-64`
branching on `panelGridConfig.breakpoints.sm`; `panelGridConfig` `rowHeight: 52`, `margin: [18,18]`,
`itemHeights.default: 5`; `defaultDashboardLayout` = four empty arrays.

The four `aria-busy` non-goal divs are now correct in **path, line and reason** — I checked all
four class names against every stylesheet: `proposal-review__loading`,
`pipeline-proposal-review__loading`, `patch-set-review__loading`,
`combined-proposal-review__loading` → **0** matching CSS rules each. Round 2's note is folded in.

D10's motivating statistic reproduces on the dev DB:

```
$ psql helio -tAc "select count(*) from dashboards d where exists (select 1 from panels p where p.dashboard_id=d.id)"
71
$ psql helio -tAc "... and jsonb_array_length(coalesce(d.layout->'lg','[]'::jsonb))=0"
45
```

#### 3. Round 2's six CRs are genuinely resolved (verified, not taken on trust)

CR1 → D10 names `resolveDashboardLayout` as the target and adds the non-zero fallback (mirrored to
`loading-state-pattern:127-155` + tasks 2.6/2.6a/2.8/6.5a). CR2 → D11. CR3 → D12. CR4 → D6 is now
kind-agnostic and task 3.2 no longer says "shaped to the renderer type". CR5 → task 6.9 (I re-read
`/usr/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js`'s `parseDeltaSpec`; round 2's
reading is right — delta `## Purpose` is inert, so the archive-time task is the correct fix).
CR6 → task 1.2a, and `DESIGN.md:227-248` is indeed the exhaustive primitives list closing with
"Use these; do not hand-roll equivalents". Round 1's CR4a restoration is verbatim — the chart
scenario again carries "(same requirements as `echarts-chart-panel`)" and "on mount or unmount".

#### 4. D12's discriminator is sound *as a discriminator*

`items` are homogeneous by construction: `fetchPanels.fulfilled` replaces them wholesale,
`update*.fulfilled` map in place, `deletePanel.fulfilled` filters, and `createPanel`/`duplicatePanel`
**refetch** rather than optimistically inserting (`panelThunks.ts:100-113,140-154`) — so there is no
mixed-dashboard window and `items[0]` is a valid representative. `PatchSetReviewPage.tsx:224` calls
the *service* function, not the thunk, so it never touches the store.

#### 5. D11's widening is safe on five surfaces — and unsafe on the sixth

I checked the dispatch owner of every surface D11/task 2.4a names:

- `SourcesPage.tsx:25-38` self-dispatches (guarded on `idle`) — idle is transient. ✓
- `PipelinesPage.tsx:28-30` and `TypeRegistryPage.tsx:14-16` self-dispatch unconditionally. ✓
  (task 4.2 is right that `TypeRegistryPage.tsx:12` selects only `{status, error, errorKind}`.)
- `DashboardList` — `App.tsx:119-121` dispatches `fetchDashboards()` unconditionally on mount. ✓
- `SidebarItemList` — the call-site flag is correct and safe.
- **`PanelList` — not safe.** See CR1.

On the sidebar exception's *stated reason*: `SidebarBody` early-returns per section, so only the
active section's list is ever mounted, and `section === "chat" && isFreeTier` returns a locked-notice
`<section>` at `SidebarBody.tsx:246` — it never renders a `SidebarItemList` at all. So the free-tier
justification in D11 is factually wrong. The mechanism it prescribes is still the right one; only
the sentence is wrong (note 1).

---

### Verdict: REFUTE

This is a strong plan — better grounded than most implementations I review, honestly scoped, and
its self-approved calls are all defensible. Two rounds of review have made it materially better,
and I confirm D6, D8, D10 and D12 on my own reading.

It fails this gate on **one blocker**: D11's blanket idle-widening, applied to `PanelList` as
tasks.md 2.4a explicitly directs, parks a **permanent skeleton** on two reachable application
states — including a plain user action (delete the last panel on a dashboard) and the zero-dashboard
onboarding screen. That is a user-visible regression, not a polish item, and the plan currently
directs it and locks it with a test. CR2 is a cheap spec-precision fix I am attaching because it
would otherwise make the final gate's headline measurement unjudgeable; I flag its low cost
explicitly so the cost of this REFUTE is visible.

On the disclosed 183-line `design.md`: **keep it.** Every decision earns its place and the three
longest (D10/D11/D12) exist because reviewers demanded them. I am not asking for a cut. If you
want one anyway, D7 duplicates `loading-state-pattern`'s "Short in-place work" requirement almost
verbatim and could become a pointer.

---

### Change Requests

**1. BLOCKER — `PanelList`'s `idle` is not a pre-dispatch frame; it is re-entrant and terminal, so
   D11's widened gate renders a permanent skeleton on two reachable states.
   (`design.md` D11:138-149, `tasks.md` 2.4a / 2.7a / 6.5c, `specs/loading-state-pattern/spec.md:174-194`)**

D11's premise is "these surfaces mount at `status === "idle"` and dispatch from a mount effect", and
it names `PanelList.tsx:224` alongside the others. `PanelList` does **not** dispatch its own fetch —
`App.tsx:123-129` does, and it **early-returns when `selectedDashboardId === null`**. Worse, the
panels slice is the one slice in the whole frontend that can go *back* to `idle`:

```
$ grep -rn 'status = "idle"' frontend/src --include=*.ts --include=*.tsx
features/panels/state/panelsSlice.ts:88:        state.status = "idle";      # markDashboardPanelsStale
```

Two states therefore satisfy `(status === "idle" || status === "loading") && no-panels-for-selected`
**forever**, because nothing re-dispatches `fetchPanels` (its only dispatch sites are `App.tsx:128`,
`PanelList.tsx:216`'s retry, `panelThunks.ts:108/150`, `patchSetsSlice.ts:220` — none keyed on status):

  a. **Zero dashboards (the onboarding screen).** `fetchDashboards.fulfilled` with an empty payload
     sets `selectedDashboardId = null` (`dashboardsSlice.ts:246-249`); `App.tsx:124` then never
     dispatches, so panels status stays `idle` and `items` stays `[]`. Under the widened gate the
     grid area renders panel-card skeletons permanently, and `PanelList.tsx:225-237`'s "No dashboards
     yet" + **"New dashboard" CTA** — the F-003 main-pane bootstrap path, cited by name in
     `SourcesPage.tsx:82-86`'s own comment — never renders. A new user gets a dashboard that loads
     forever and hides its only way forward.

  b. **Deleting the last panel on a dashboard — and this one is *not* fixed by adding
     `selectedDashboardId !== null`.** `PanelCard.tsx:211` → `deletePanel` → `panelThunks.ts:135`
     dispatches `markDashboardPanelsStale(dashboardId)`, whose reducer (`panelsSlice.ts:85-89`) sets
     `status = "idle"`; then `deletePanel.fulfilled` (`panelsSlice.ts:130-132`) empties `items`.
     Final state: `selectedDashboardId = "d1"`, `status = "idle"`, `items = []`, no fetch pending and
     none coming (the reducer's own comment says the refetch happens on "the next dashboard switch").
     Gate → true → permanent skeleton. Today this path renders a blank grid area (a pre-existing
     empty-state gap, HEL-548's territory); this change would convert a blank area into a
     **permanently lying loading state**, which is strictly worse and is a §7 violation this ticket
     would be introducing.

This is not a hazard the executor can be expected to catch: task 2.4a names `PanelList.tsx:224` in
its "widen this" list, and task 6.5c ("a surface mounted at `status === "idle"` with no items renders
the skeleton on its first frame, not its empty state") would lock the behaviour in a test.

Required: make the initial-load condition for `PanelList` express "a fetch is actually going to
happen", not "status is not yet succeeded". The gate needs to distinguish the genuine pre-dispatch
frame (`selectedDashboardId !== null` and `App.tsx`'s effect has not yet committed) from the two
terminal-idle states above — e.g. by keeping `PanelList` on `status === "loading"` and accepting its
one pre-dispatch frame, or by pairing the widened gate with a signal that a dispatch is pending. Also
correct D11's factual premise for this surface (it does not self-dispatch), fix task 2.4a's citation
of `PanelList.tsx:224`, scope 6.5c so it cannot be satisfied by locking the defect, and add the
mirror-image test: **at `status === "idle"` with a selected dashboard and no panels after a delete,
and with no dashboards at all, the empty state renders and the skeleton does not.**
`specs/loading-state-pattern/spec.md:181-185` already states the general rule ("A surface whose fetch
may never be dispatched at all SHALL NOT use that widened condition") — it just names only the
sidebar as its instance, and `PanelList` is the more dangerous one.

**2. The absolute no-layout-shift requirement is unsatisfiable on the list surfaces, because the row
   count is unknowable pre-fetch and no bounded-delta concession covers them.
   (`specs/loading-state-pattern/spec.md:22-41`, `tasks.md` 7.1)**

The requirement reads, unqualified: *"the container it occupies has the same geometry as the resolved
content … so no layout shift occurs on resolve"*, with the scenario *"the container's measured
geometry is unchanged by the swap"*. The plan carves an explicit, stated concession for exactly three
places — the grid's card count (D10), the phone stack's per-card height, and `SourceDetailPanel`'s
preview height (D3) — and for no others. But `SidebarItemList` (×5 sections), `DashboardList` and
`PipelineDetailPage` have the identical problem: **N skeleton rows versus M resolved rows is a
container-height delta that nothing can predict**, and task 7.1 makes `getBoundingClientRect()`
before/after the *headline* acceptance evidence on precisely those containers.

As written, the final gate has no way to judge its own headline measurement: a good implementation
will show a delta on six of the ten surfaces, and the spec says zero. Given the care spent bounding
the other three concessions, the silence here reads as an oversight rather than intent.

Cheap fix (one clause, no design change): state that per-row/per-card **geometry** must match
exactly and be inherited from the resolved content's own wrapper and classes (which D3 already
requires), while the **count** of placeholders for a collection of unknowable length is a stated,
documented delta — and say what the verifier should therefore measure (row height, gap, padding,
horizontal geometry, and the container's non-collapse against `EmptyState --main`'s 320px floor —
not total list height).

---

### Non-blocking notes

1. **D11's sidebar-exception rationale is wrong, though its prescription is right.**
   `design.md:145-149` says the free-tier chat section would "park a permanent skeleton". It cannot:
   `SidebarBody.tsx:246` returns a locked-notice `<section>` for `chat` + free tier and never renders
   `SidebarItemList`; and because `SidebarBody` early-returns per section, only the active section's
   list mounts — the section the effect dispatches for. Keep the call-site flag (it is explicit and
   safe), but fix the sentence: the real reason is that `SidebarBody` alone owns the dispatch
   decision. This repo has a documented history of confidently-false design-doc claims outliving the
   ticket; this one is one line.

2. **Task 1.5's "easing from `--transition-slow`" is not extractable.** `--transition-slow` is a
   *shorthand* (`0.28s cubic-bezier(0.3, 0.9, 0.4, 1)`, `theme.css:71`), not a timing function.
   Dropped into the `animation` shorthand it parses as *delay + easing* (`animation: shimmer 1.6s
   0.28s cubic-bezier(…) infinite`), silently adding a 0.28s start delay. Decide it now: either use
   a bare keyword (a timing-function keyword is not a token-drift literal — the spec's own scenario
   only bans colour/font-size/duration literals) or use the shorthand knowingly and say so.

3. **The phone-stack requirement body lost the non-zero-fallback clause the desktop one gained.**
   `specs/loading-state-pattern/spec.md:157-160` still says only "with one placeholder per saved
   layout entry"; `xs` layouts are empty at least as often as `lg` (45/71 measured on `lg`), so the
   body alone yields zero cards — round 2's CR1 defect, surviving in the sibling requirement. The
   scenario at `:165-167` and task 2.8 do carry the fallback, so this is documentation drift rather
   than a functional gap. Mirror the clause into the body.

4. **"There is one deliberate exception" is now two.** `specs/loading-state-pattern/spec.md:50` reads
   as exhaustive, but the dashboard-switch requirement at `:196-209` is a second, deliberate
   departure from "a surface that already has content SHALL continue rendering that content" (on a
   switch, `PanelList` *has* content and replaces it). D12 reconciles this in `design.md:158-159`;
   the spec should cross-reference it so the archived text is not self-contradictory.

5. **D10's fallback trigger is not evaluable at skeleton time.** "when `layout[activeBreakpoint]` is
   empty **or shorter than the panel set**" (and `spec.md:134-136`'s "covers fewer panels than the
   dashboard has") both reference a panel count the code does not have before `fetchPanels` resolves
   — that is the whole premise of the concession. The only implementable trigger is "the saved layout
   for the active breakpoint is empty"; partial coverage should be folded into the accepted-delta
   clause rather than into the trigger. Related: stale entries cut the other way — a deleted panel's
   layout entry survives until the next drag (`resolveDashboardLayout` emits entries only for current
   panels, `dashboardLayout.ts:207-251`), so "one placeholder per entry" can also over-count.

6. **Name the fallback card count.** Tasks 2.6a/2.8 say "a documented fixed count" and never say what
   it is; `itemHeights.default` fixes the height, not the count. Naming it (3? 4?) in the plan gives
   the final gate a fixed target instead of a judgement call.

7. **Say how the grid skeleton gets its geometry and its width.** `PanelGrid` measures with RGL's
   `useContainerWidth` (`PanelGrid.tsx:43-45`, `initialWidth: 1280`) and the desktop cards' pixel
   positions come from RGL's own math over that width; `.panel-grid-card` is `height: 100%` with no
   intrinsic size. Hand-rolling `x/y/w/h → px` from `rowHeight`/`margin` is the most likely way this
   plan produces a measurable shift, and it contradicts D3's own principle ("reuse the real layout,
   not re-guess it"). Rendering the placeholders as children of the same `ResponsiveGridLayout`
   (drag/resize disabled) and sourcing the width from the same `useContainerWidth` would make D3 hold
   on the one surface where it is hardest — and would settle the 768px branch consistently, which
   matters because 768 is one of the three mandated verification widths.

8. **Stale cross-reference:** `design.md:179` credits "(e) the bounded phone-stack shift (D11)" —
   that is D10 after the renumber.

9. **Environment:** the worktree's `scripts/concertino/` carries only the tracked subset (no
   `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`); I ran them from the main
   checkout at `/home/matt/Development/helio/scripts/concertino/`. Same quirk both prior rounds hit;
   not a blocker.
