## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold read. I derived every finding below from the tree at `3d93e82a` (worktree HEAD, confirmed
via `git log --oneline -3`), not from the plan's narrative. Where the plan asserts a file:line
fact I opened the file and read it.

---

### What I verified (with evidence)

#### 1. Every factual claim I spot-checked in `design.md` is accurate

This plan is unusually well-grounded. I could not find a fabricated citation. Verified:

| Claim (design.md) | Ground truth |
| --- | --- |
| `--app-transition` = `0.16s ease`, `--transition-slow` = `0.28s cubic-bezier(…)` | `theme/theme.css:70-71` ✓ |
| Global reduced-motion rule is `theme.css:240-248`, sets only `animation-duration: 0.01ms !important` + `animation-iteration-count: 1 !important` (+ `transition-duration`) | verified verbatim, lines 240-248 ✓ |
| `usePanelData.ts:240` already computes `isLoading = isLoadingMore && rows.length === 0` | `const isLoading = paginationEntry?.isLoadingMore === true && rows.length === 0;` at line 240 ✓ |
| `markDataTypeRowsStale` at `panelsSlice.ts:94-101` deletes the pagination entry | verified; `delete state.paginationState[panel.id]` ✓ |
| No slice clears `items` on `pending` | verified in all five: `dashboardsSlice:237`, `panelsSlice:102`, `dataTypesSlice:126`, `sourcesSlice:142`, `pipelinesSlice:391`. Each sets only `status`/`error`/`errorKind` (+`loadedDashboardId`). ✓ |
| `EmptyState --main` floor is `min-height: 320px` at `EmptyState.css:16` | ✓ |
| `.dashboard-list__items` gap is `2px`; `.dashboard-list__button` height is `var(--control-md)` (=32px, `theme.css:60`), radius `--app-radius-sm` | `DashboardList.css:185` (gap), `:424-434` ✓ |
| `SuspenseFallback.tsx:4-9` documents the HEL-512 "chunk-load and data-load are visually indistinguishable" invariant | verified verbatim ✓ |
| `SourceDetailPanel` keeps showing the "Click Preview…" hint during load (`:281`); local `isLoading` at `:44` | ✓ |
| `PipelineDetailPage:626` is a `currentPipeline === null` full-page `Spinner xl` early return | ✓ |
| `SourcesPage.tsx:53` / `PipelinesPage.tsx:35` / `TypeRegistryPage.tsx:24` loading treatments | ✓ all three, exactly as tabulated |
| The three pages' `isRetrying` dead code | ✓ `isRetrying* = status === "loading"` with the error branch gated on `=== "failed"` |

I also confirmed the inherited-context claims against the source: HEL-539's
`skeptic-final-2.md:212-224` does contain both the 331px→15px `/sources` collapse trace
explicitly deferred to HEL-528, and the `isRetrying` dead-code finding naming all three pages.
`openspec validate skeleton-loaders-list-detail-panel --strict` → `Change ... is valid`, exit 0.
`node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.

#### 2. D2 — the reduced-motion analysis: right answer, and one cascade detail that must not drift

I verified the global rule and independently worked the cascade. **The plan's mitigation is
correct, but for a reason worth writing down**, because a plausible-looking variant of it would
silently fail:

`theme.css:244` is `animation-duration: 0.01ms !important`. A normal declaration cannot beat it.
Task 1.5's `animation: none` works *only* because the shorthand also sets `animation-name: none`,
a longhand the global rule never touches and therefore faces no competing `!important`. Written
instead as `animation-duration: 0s` (or `animation-iteration-count: infinite`), the mitigation
would be overridden and do nothing. Task 1.5's exact wording is right; it must stay exact.

One correction to the *rationale*: with the default `animation-fill-mode: none`, an animation
that runs once in 0.01ms does not park at its final keyframe — it reverts to the element's base
computed style. So the visible artifact is the gradient at its *base* `background-position`, not
its final one. The conclusion (a static, visibly lopsided gradient rather than a neutral fill)
and the mitigation (flat `background`) are unaffected, but the delta asserts the wrong mechanism
(see CR4c).

#### 3. D4/D8 — the initial-load predicate, and where it collides with the plan's own spec

D4's predicate is sound: I confirmed no `.pending` reducer clears `items` (table above), so
`status === "loading" && items.length === 0` is a valid initial-load discriminator with zero new
Redux state. `fetchPanels.rejected` *does* set `items = []` (`panelsSlice:113`), which means a
retry after failure reads as a first load — correct behaviour for this ticket, and no regression.

D8's mechanism also checks out, precisely: `markDataTypeRowsStale` deletes the entry, then
`fetchPanelPage.pending` (`panelsSlice:196-205`) rebuilds it as `{ isLoadingMore: true, rows:
existing?.rows ?? [] }` → `rows: []` → `usePanelData:240` yields `isLoading === true`. So a
pipeline-run refresh does present as a first load.

**I accept D8's decision.** Today that path renders a full `Spinner xl` + "Loading..." takeover
(`PanelContent.tsx:80-87`) — a skeleton is the same structural class and arguably preserves more
structure. This is not "a skeleton flashes on every pipeline run" being waved through; it is an
existing full takeover getting a better-looking treatment. Preserving `rows` behind a stale flag
is a real behavioural change to refresh semantics and correctly fenced out.

**What I do not accept is the spec text D8 leaves behind** — see CR2.

#### 4. D9 — verified, and correctly reasoned

`.dashboard-list__button--stacked` exists at `DashboardList.css:508-513` (`height: auto;
min-height: var(--control-md); padding-top/bottom: var(--space-1)`), the subtitle is `--text-xs`
(12px, `theme.css:26`). `SidebarItemList.tsx:338` / `:359` apply the modifier per-item on
`item.subtitle !== undefined`, and `grep -n "subtitle:"` over `SidebarBody.tsx` returns exactly
one hit — line 217, the Data Types section. So the claim is exactly right: only `/registry` is
stacked, and with zero items the component genuinely cannot infer it. Call-site prop is correct.

#### 5. Coverage against the ticket's enumerated surfaces

`PanelList`/`PanelGrid`, `SidebarItemList` consumers, `PipelineDetailPage`, `SourceDetailPanel`,
`PanelContent` — all have tasks. I confirmed `SidebarItemList` is rendered from `SidebarBody`
only (every other file matching the string is a comment or a type import), so "SidebarItemList
consumers" = SidebarBody's sections + `DashboardList`, both covered. No enumerated surface is
silently omitted. But the flagship one is under-specified — CR1.

#### 6. Spec deltas — one scenario silently narrowed, two Purpose lines left contradicted

I diffed both MODIFIED deltas against `openspec/specs/`. No scenario was *dropped*. One was
weakened, and both edited specs keep a Purpose the change falsifies — CR4.

---

### Verdict: REFUTE

The plan is strong: correctly grounded, honestly scoped, and each of the four self-approved
calls is defensible on its merits (I say so explicitly below). It fails this gate on one
material gap — the dashboard grid, which is both the ticket's flagship surface and the surface
the headline no-layout-shift AC is hardest on, is the least specified thing in the plan — plus
three cheap corrections.

**On the four Planner Notes, for the record:**

- **(a) `SourcesPage`/`PipelinesPage`/`TypeRegistryPage` — justified, not scope creep.** The
  ticket's own inherited-context section hands this ticket the `/sources` collapse as "a concrete
  first defect, already traced and deferred here", and HEL-539's skeptic names all three pages.
  Closing HEL-528 with `<p>Loading sources…</p>` still on screen would close it with its
  motivating bug intact. Within the fence.
- **(b) `--app-skeleton-shimmer` — right resolution.** Neither named token is usable: `0.16s`/
  `0.28s` are one-shot durations and `--transition-slow` is a *shorthand* (`0.28s cubic-bezier(…)`),
  so it cannot even be dropped into an `animation-duration` slot without also carrying its easing.
  A 0.28s infinite sweep strobes. Adding a token beats a literal (the drift HEL-652/680/677 exist
  to clean up) and beats escalating a non-conflict. But see CR3 — the token must be added to
  DESIGN.md too.
- **(c) Narrowing `StatusMessage.status` — correct.** All three consumers stop routing loading
  through it (verified: `PanelList:209`, `DashboardList:265`, `SidebarItemList:287` are the only
  render sites), so the branch becomes dead code in a shared primitive. Trading a silent blank
  region for a compile error is the right direction.
- **(d) The `frontend-code-splitting` delta — correct.** `ChartRenderer` renders
  `PanelSuspenseFallback` inside the same `.panel-grid-card` whose data-load becomes a skeleton.
  Keeping the spinner puts two loading treatments in one frame, which is the ticket's consistency
  premise failing in the most visible possible place. Re-stating the requirement to lock the
  *invariant* rather than the *widget* preserves why HEL-512 wrote it. Right call — but the
  re-statement must not quietly change unrelated text (CR4a).

---

### Change Requests

**1. Specify the dashboard-grid skeleton's geometry, and decide what happens below 768px.
   (`tasks.md` 2.5/2.6, `design.md` D3, `specs/loading-state-pattern/spec.md`)**

This is the ticket's headline surface and its headline AC, and the plan currently says only
"panel-card skeletons ... in place of `PanelGrid`, matching `.panel-grid-card`'s radius/border/
padding and its top/body/footer bands". That specifies the card's *chrome* and nothing about its
*box*, on the one surface where the box is not derivable from CSS. Three concrete sub-gaps:

  a. **The card has no intrinsic size.** `PanelGrid.css:31` is `height: 100%` — a
     `.panel-grid-card`'s geometry comes entirely from its React Grid Layout cell, i.e. from the
     dashboard's saved per-panel `x/y/w/h`. N generic placeholders cannot satisfy
     `loading-state-pattern`'s own "the container's measured geometry is unchanged by the swap".
     The plan does not say how many cards, at what sizes, or in what positions.
     **The information is already available and the plan should say to use it:**
     `PanelList.tsx:271-276` already reads `selectedDashboard?.layout ?? defaultDashboardLayout`
     from the dashboards slice, which is independent of `state.panels`, so it is populated while
     panels are still fetching. `DashboardLayout` (`features/dashboards/types/dashboard.ts:12-25`)
     carries `lg/md/sm/xs` arrays of `{ panelId, x, y, w, h }`. Driving the skeleton cards from
     the active breakpoint's layout array is the only approach that makes the headline AC
     achievable here rather than aspirational. State this as a decision.

  b. **The phone branch is entirely unaddressed.** `PanelGrid.tsx:50-64` branches internally on
     `width < panelGridConfig.breakpoints.sm` (768px) and mounts `MobilePanelStack` instead of
     `DesktopPanelGrid`. `MobilePanelStack.css:5-50` is a different geometry model altogether — a
     flex column with `--space-3` gap/padding, fixed `--mobile-panel-height` for metric/chart from
     `mobilePanelHeights.ts`, and intrinsic height for table/markdown/text/image/collection/
     timeline. A skeleton derived from the desktop grid will shift badly at 430px, a width
     `tasks.md` 7.2 mandates verification at. Worse: on the stack the resolved height depends on
     `panel.kind`, which does **not** exist before `fetchPanels` resolves — so "no layout shift"
     is not achievable on the phone stack the way it is on desktop. Grepping the whole plan for
     `mobile|MobilePanelStack|breakpoint|430` returns only the 7.2 verification line and the
     relayed ticket text. Make an explicit decision: either a stack-shaped skeleton with a stated,
     bounded, accepted shift, or an explicit deferral with rationale. Do not leave the executor to
     improvise on a surface the ticket requires be verified.

  c. **The zoom container.** `PanelGrid` renders inside `.panel-list__zoom-container`
     (`PanelList.tsx:258-270`), which applies `transform: scale(var(--zoom-level))` and
     `height/width: 100/zoom%`. A skeleton rendered "in place of" that whole `items.length > 0 &&
     selectedDashboardId !== null` block sits outside the transform, so at any saved zoom ≠ 1 the
     swap shifts by the zoom factor. Say whether the skeleton renders inside the zoom container.

**2. `specs/loading-state-pattern/spec.md`'s "initial loads only" requirement contradicts D8 —
   carve out the pipeline-run path or the archived spec will assert a rule the code breaks.**

The requirement reads, unqualified: *"A surface that already has content SHALL continue rendering
that content while a subsequent fetch is in flight, rather than replacing it with skeletons."*
D8 knowingly ships the opposite on one path: after `markDataTypeRowsStale`, a panel that is
visibly displaying a chart has its content replaced by a full skeleton. Nothing will catch this —
`tasks.md` 6.5 scopes its refetch-does-not-skeleton tests to "each list surface", and the panel
path is not a list surface.

Amend the requirement to name the exception explicitly (a panel whose bound type is invalidated
by a pipeline run re-enters the initial-load state because its row cache is cleared, and renders
a skeleton takeover — the same structural treatment as today's `Spinner xl`), and add a scenario
asserting that behaviour so it is locked deliberately rather than violated silently. I am not
asking you to change D8's decision; I am asking the spec to stop contradicting it.

**3. Add a task to update `DESIGN.md` §3 when `--app-skeleton-shimmer` is added.**

D1 cites DESIGN.md §3 as the mechanism that sanctions adding a token — correctly. But §3's Motion
bullet (`DESIGN.md:160-162`) currently enumerates exactly the two motion tokens that exist in
`theme.css:70-71`; the list is exhaustive today. Adding a third without updating it leaves the
binding design standard stale, in a ticket whose relay names token drift as the specific thing not
to add to. Add a task alongside 1.1: extend §3's Motion bullet with `--app-skeleton-shimmer`
(1.6s, continuous shimmer loop) and note why it is separate from the two transition shorthands.

**4. Fix three spec-delta accuracy problems.**

  a. **A scenario the change has no reason to touch was silently narrowed.**
     `specs/frontend-code-splitting/spec.md`, "Chart panel renders normally once its chunk loads".
     Existing (`openspec/specs/frontend-code-splitting/spec.md`): *"the chart renders exactly as
     it did before this change **(same requirements as `echarts-chart-panel`)**, with no console
     errors **on mount or unmount**"*. Delta: *"the chart renders exactly as it did before this
     change, with no console errors"*. Both the cross-reference and the mount/unmount scoping are
     dropped. Since openspec re-states MODIFIED requirements wholesale, this permanently weakens
     the requirement. Restore both clauses verbatim.

  b. **Both edited specs keep a Purpose line the change falsifies.**
     `openspec/specs/frontend-code-splitting/spec.md:4` says the fallbacks are "behind a shared
     **`Spinner`-based** `Suspense` fallback" — false for the panel-level fallback after D6.
     `openspec/specs/shared-status-message/spec.md:1-3` says the component renders "a **loading**
     or failed status block" — false after D5. Deltas can carry a `## Purpose`
     (four archived changes in this repo do). Add corrected Purpose sections to both deltas.

  c. **`specs/shared-skeleton/spec.md` asserts the wrong cascade mechanism.** The reduced-motion
     requirement states the global rule *"leaves a gradient parked at its final keyframe
     position"*. With the default `animation-fill-mode: none` the element reverts to its base
     computed style, so the artifact is the gradient at its **base** position. Reword (the
     requirement and both scenarios are otherwise correct and should stand). While there, consider
     stating in the requirement *why* the mitigation must be the `animation` shorthand or an
     explicit `animation-name: none` — `theme.css:244`'s `!important` on `animation-duration`
     cannot be beaten by a normal declaration, so a duration-based mitigation would silently fail.

---

### Non-blocking notes

1. **`tasks.md` 2.3 says "`SidebarBody`'s six call sites"; there are five.**
   `grep -c "<SidebarItemList" shared/chrome/SidebarBody.tsx` → `5` (lines 119, 148, 183, 221,
   299). The sixth section is Dashboards, which renders `DashboardList` and is task 2.4's job —
   it takes no row-shape prop. Fix the count so nobody hunts for a missing call site.

2. **The `aria-busy` non-goals list is inaccurate and incomplete.** The three divs are *not*
   "classless" — they carry `proposal-review__loading`, `pipeline-proposal-review__loading` and
   `patch-set-review__loading`. Those class names have **zero** matching rules in any stylesheet
   (grepped repo-wide), which is why they render nothing; the conclusion holds, the reason
   doesn't. The line numbers are all correct. There is also a **fourth** instance the list omits:
   `features/proposals/ui/CombinedProposalReviewPage.tsx:85`.
   **Excluding all four is defensible** and I am not asking for them: none is an enumerated
   surface, the ticket's "never render nothing" AC is scoped to the listed surfaces, and two of
   them (`PipelineProposalReviewPage`, `CombinedProposalReviewPage`) carry code comments stating
   they are unreachable type-narrowing guards. But if this list is seeding a follow-up, make it
   correct and complete.

3. **The stacked sidebar row is the plan's most fragile no-layout-shift target.** The flat variant
   gets a hard number (`--control-md`); the stacked variant (task 2.2) gets only "a row-shape
   prop". Its resolved height is content-derived (`height: auto` + `min-height: 32px` +
   `2 × --space-1` + a `--text-xs` subtitle line), so it cannot be matched by a token. Task 7.1's
   measurement is the right backstop — treat `/registry`'s sidebar as the first thing measured,
   not the last.

4. **`TypeRegistryPage.tsx:12` selects only `{ status, error, errorKind }`** — task 4.2's
   `items.length === 0` gate needs `items` added to that selector. `PipelinesPage` and
   `SourcesPage` already have it. Trivial, just unstated.

5. **`PanelList`'s `isRetryingPanels`/`retrying` becomes fully dead** once its loading branch
   renders skeletons instead of `StatusMessage` (`PanelList.tsx:34-38`, `:209-224`). Its own
   comment already concedes it "only matters for the brief window before that re-render commits".
   Task 4.3 covers the three pages' equivalent dead code but not this one — worth the same
   "no more broken than before" check.

6. **The visible "Loading..." text disappears from panel bodies** (both `PanelContent` and
   `PanelSuspenseFallback`), and the code-splitting delta correspondingly drops the existing
   requirement's "a visible ... loading message". That is a legitimate consequence of choosing the
   skeleton branch of DESIGN.md §7, and the accessible name is preserved by
   `shared-skeleton`'s wrapper requirement — noting it only so the swap is a decision on the
   record rather than a side effect.

7. **`findMediaBlock` is now copy-pasted into seven CSS test files** (`EmptyState`, `IconButton`,
   `inputs`, `Modal`, `ActionsMenu`, `MobileNavSheet`, and `Skeleton` when 6.2 lands). Pre-existing
   and out of scope, but a shared test helper is overdue.

8. **Environment note, not a blocker:** `scripts/concertino/` is gitignored (`.gitignore:57`), so
   the worktree copy carries only the six tracked scripts — `next-report-number.sh` and
   `persist-evidence.sh` are absent there. I ran the canonical copies from the main checkout
   against this worktree's change dir; they are path-parameterised, so the result is identical.
