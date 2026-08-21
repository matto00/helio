## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Read from the tree at `2eaf1d26` (worktree HEAD; planning artifacts still untracked —
`git status` shows only `?? openspec/changes/empty-state-ctas-primary-sections/`). No browser was used
(three parallel runs share the Playwright session, per the brief); nothing at this gate needed one.
Every citation below was opened and read; nothing was taken from round 1's report or from the revised
prose on trust. `DESIGN.md` was read, not edited.

`openspec validate empty-state-ctas-primary-sections` → *"Change 'empty-state-ctas-primary-sections' is
valid"*, exit 0 (CLI 1.2.0). Both MODIFIED requirement headers still match their base
(`specs/loading-state-pattern/spec.md:238`, `specs/frontend-panel-empty-state/spec.md:3`) and **no base
scenario is dropped** — I diffed both base requirements against the deltas scenario-by-scenario. None of
the five capability names collides with an existing requirement header.

Note: `WORKTREE_PATH/scripts/concertino/` predates `next-report-number.sh`/`persist-evidence.sh` (the
worktree branched at `2eaf1d26`); I used the canonical copies in the main checkout, read-only. Not a
blocker.

---

### Round 1's twelve change requests — verified against the tree

**Resolved (10):**

1. **D4's navigate premise — resolved.** `frontend/src/app/App.tsx:207-208` mounts `CreatePipelineModal`
   at the shell for every route except `/pipelines` (comment F-045 at `:200-206`), and
   `PipelinesPage.tsx:104` mounts the page-local instance. D4 now dispatches only, cites `:208` correctly,
   and justifies staying put on UX grounds. Task 4.4 matches.
2. **`workspace-create-actions` over-claim — resolved.** The "opens from any surface" scenario is gone;
   the capability now carries a second requirement bounding reach by mount point, with a
   page-mounted-flow scenario and an explicit "moving a flag into shared state is not a widening of
   reach" clause. D5b records the per-action reach honestly.
3. **HEL-770's specific message — resolved at the source.** Task 3.1 changes the thunk
   (`dashboardsSlice.ts:66-76`; the `catch {` is at `:73`) rather than the component. I checked every
   consumer of the widened `rejectValue` — see "New attacks" below; nothing breaks.
4. **D6a / `DashboardList` announced report — resolved.** `InlineError.tsx:58` (default `variant="text"`),
   `:99` (bare `<p>`), `:67-73` (banner: `role="alert"` + `ERROR_KIND_ICON.error` = lucide `TriangleAlert`)
   all check out. Task 3.4 raises the bar and 3.6 sequences the toast removal after it.
5. **`empty-state-cta-pattern` over-claims (a/b/c) — resolved.** (a) page-surface vs sidebar-surface split
   is explicit; (b) the selection-prompt carve-out matches `PanelList.tsx:401-405`'s "Select a dashboard";
   (c) `MobileNavSheet` is fenced in Non-Goals and the requirement is scoped to page surfaces, so it no
   longer over-claims. I verified the mobile page surfaces *do* carry working CTAs
   (`SourcesPage.tsx:103-113` and `PipelineEmptyState.tsx:14-25` both carry explicit F-102/F-174 comments
   blessing the mobile CTA), so the sheet is genuinely secondary.
6. **`renderWithStore` — resolved for `staleDashboardId`** (task 1.4). Citations check out: the
   `preloadedState.panels` type is `:59-71` and the constructed slice object `:189-206`. See CR3 for the
   *second* field this change adds that is not threaded.
7. **Verification standard — resolved.** 8.3 generalizes reproduce-first beyond 2.1 (to 3.7 and 6.6),
   8.5 specifies `getBoundingClientRect().height` on a rendered element, 8.6 adds the discriminating
   control, 8.7 names the desktop-only surfaces. I verified the control is real: `EmptyState.css:162-168`
   sets `height: var(--control-sm)` on sidebar CTAs and the floor block's own comment names it as **28px**,
   so "~28px" is the right expected reading. The floor block is `:218-228` and is the last block in a
   228-line file.
9. **`EmptyStateCta` export — resolved.** `EmptyState.tsx:7` is indeed `interface EmptyStateCta` with no
   `export`; task 4.1 exports it and `proposal.md`'s Impact line now says so instead of claiming the API
   is untouched.
10. **Task 5.2 branch naming — resolved.** `renderEmpty()` is `SidebarItemList.tsx:227-252`; the filtered
    branch returns at `:229` and the no-data branch is `:231-247`. 5.2 now names the no-data branch and
    cites the spec clause forbidding a create action in the filtered one.
11. **D2's unstated `condition` premise — resolved.** `panelThunks.ts:72-83` reads exactly as described
    (skips only on `loading`/`succeeded` **with a matching `loadedDashboardId`**), and
    `panelsSlice.ts:85-89` always leaves `status="idle"` with `loadedDashboardId=null`, so the condition
    cannot block from the invalidated state. Task 1.6 locks it.
12. **`openspec validate` command — resolved and re-verified** (positional form, exit 0).

**Partial survivor (1):**

8. **D8's fence.** The *decision* was fixed — D8 now states the right rule ("every icon in the empty-state
   ladder of the five enumerated sections, **plus any sibling control in the same view that performs the
   same action as a converted CTA**"). But the *task list under it* re-opens the gap it closed: task 7.1
   enumerates only two siblings and misses two more of exactly the same kind, and names one that does not
   exist. Details in CR5. I am flagging this as a partial survivor per the brief, with the judgment that
   it is a task-enumeration omission rather than a rejected decision — not, in my view, escalation-worthy
   on its own.

---

### New attacks on the revisions (what I went looking for)

**Does widening `createDashboard`'s `rejectValue` break any other consumer of `createDashboard.rejected`?**
No. I enumerated every reference (`grep -rn "createDashboard" src`): `dashboardsSlice.ts` has an
`.addCase` for `.fulfilled` only (`:273`) — **no reducer reads the rejection**; there is no `addMatcher`,
`isRejected` or `isAnyOf` anywhere in `frontend/src` (grep returns nothing), so no generic error
middleware consumes it; the only readers are `PanelList.tsx:177`'s and `DashboardList.tsx:58`'s
`.unwrap()` catches (both restructured by 3.2/3.4) and `toastListeners.ts:151` (removed by 3.6). The
payload type stays `string`, which is what `toastListeners.ts`'s `error<A extends { payload?: string }>`
builder requires. Clean. **But** there is one consumer the plan does not mention — a *test* — see CR2.

**D4b's "introduces no set-flag-with-nothing-mounted path" — true as scoped, incomplete as reassurance.**
I traced every CTA the plan wires: registry main (`/registry`, shell-mounted modal), registry sidebar
(sidebar renders on every desktop route; `/pipelines` is covered by the page-local instance and every
other route by the shell one), the three "Clear search/filter" actions (component-local state),
`SourcesPage`, `PipelinesPage`, and `PanelList`'s two. Every one is co-located with its mount or uses the
shell-mounted modal. The claim holds **for where the flag is set**. It does not cover where the flag
*persists* — see CR4, which is the same defect class arriving through a different door.

**Task 7.2's lucide conversion of the five `SidebarBody` `emptyIcon` values.** It collides with the prop
type. See CR1.

**The `MobileNavSheet` exclusion — is the file-ownership reason honest?** Half of it is not, and I will
say so plainly. The *substantive* reason is sound and load-bearing: it is a navigation sheet
(`MobileShell.tsx:26-33`, driven by `usePickerSelection`), not a section's content area; it renders a
message rather than nothing (`MobileNavSheet.tsx:203-205`, with real per-section copy from
`usePickerSelection.ts:105/121/136/158/173/190`), §7 is met, and the mobile *page* surfaces for the same
sections do carry working CTAs. That alone justifies the fence, and the spec no longer claims coverage.
The *parallel-run file-ownership* half is **not accurate**: `MobileNavSheet.tsx` appears on neither
fence list in `ticket.md:77-83` (HEL-772 owns `.app-shell`/`.app-command-bar`/`index.html`/`--app-safe-top`;
HEL-774 owns `BottomNav.*`, `DESIGN.md`, `App.css:424`). Calling it unsafe-to-touch dresses a legitimate
scoping decision in an ownership claim that does not exist. It is not a dodge of a real gap — the gap is
real but genuinely secondary — but the reason should be corrected rather than leaned on. Non-blocking
(CR6 below is the wording fix).

**Task 2.3's added `selectedDashboardId !== null` — no reachable state loses its empty state, and the
conjunct is load-bearing, not cosmetic.** I traced `PanelList.tsx:381-416`. The only states removed from
the gate are those with `selectedDashboardId === null`, all of which the sibling branch at `:386-400`
already covers ("No dashboards yet" / "Select a dashboard"). More importantly, **without** the conjunct
the new disjunct `staleDashboardId === selectedDashboardId` evaluates `null === null` → `true` in the
ordinary no-dashboard-selected state, so a CTA-less "No panels yet" hero would render *underneath*
"No dashboards yet" on a cold boot. Task 2.3's stated reason ("the CTA is conditionally `undefined`")
understates this; the conjunct is required for correctness. Worth strengthening the comment, not a defect.

**D1/D2 re-derived independently.** `markDashboardPanelsStale` is `panelsSlice.ts:85-89` with the guard at
`:86`; `fetchPanels.pending` is `:102-106` and sets `loadedDashboardId = action.meta.arg`. Only
`deletePanel` (`panelThunks.ts:133`) omits the immediate refetch that `createPanel` (`:105-106`) and
`duplicatePanel` (`:146-147`) perform. I tried the delete-during-switch orderings again: if
`markDashboardPanelsStale(A)` lands after `fetchPanels(B).pending`, the guard no-ops
(`loadedDashboardId === B ≠ A`); if before, `pending` clears the discriminator. No parked skeleton either
way. `PanelList.test.tsx:570` is the D11 mirror-image test D2a targets, and its `.ui-skeleton` sibling
assertion is on the line above the one being inverted — the split D2a describes is accurate.

---

### Verdict: REFUTE

The revisions did real work: the three substantive plan changes (thunk-level fix, `variant="banner"`,
dispatch-without-navigating) are correct against the tree, and the spec narrowing is honest now. What
remains is a set of concrete, checkable omissions — two of which can produce a **wrong shipped behavior**
rather than a compile error: an executor that keeps the toast to keep a suite green (CR2), and a modal
that opens by itself on a route the user did not ask for (CR4).

---

### Change Requests

1. **Task 7.2 will not compile: `SidebarItemList`'s `emptyIcon` prop does not accept a `ReactNode`.**
   `frontend/src/shared/chrome/SidebarItemList.tsx:41-42` declares
   `/** FontAwesome icon to show in the sidebar empty-state hero. */ emptyIcon?: IconDefinition;` — no
   `| ReactNode`, unlike `EmptyState.icon` (`EmptyState.tsx:23`). Converting the five `SidebarBody`
   `emptyIcon` values (`:129 faDatabase`, `:161 faCodeBranch`, `:198 faGaugeHigh`, `:240 faLayerGroup`,
   `:326 faComments`) to lucide elements is a type error at all five call sites. Add a task widening it to
   `IconDefinition | ReactNode` and updating the doc comment; confirm `renderEmpty()`'s
   `emptyIcon !== undefined` branch guard (`:231`) still selects correctly for a `ReactNode` (it does —
   `EmptyState`'s `renderIcon` dispatches on `isValidElement`, `EmptyState.tsx:44-49`). Record it as the
   second prop-surface change to a shared component (alongside D4a's `emptyCta`) so `proposal.md`'s Impact
   stays true.

2. **Task 3.6 breaks an existing, deliberately-installed regression guard, and no task says so.**
   `frontend/src/features/toasts/state/toastListeners.test.ts:85-95` — inside the describe block
   *"toastListeners — regression guard (every pre-existing entry still fires, HEL-535 D7/3.7)"* — asserts
   `expectToast({ type: createDashboard.rejected.type, ... }, "error", "Failed to create dashboard.")`.
   Removing the `ERROR_TOASTS` entry makes that assertion fail. This is precisely the situation D2a
   reasons about for HEL-528's D11 test, and it deserves the same treatment: an explicit, **commented**
   removal naming HEL-548/HEL-770 as the owner of the change, not a silent deletion — and not the
   alternative an executor under a green-suite constraint may reach for, which is to leave the toast in
   place and quietly fail the absorbed HEL-770 acceptance criterion. Add a task under §3, sequenced with
   3.6.

3. **A second new `PanelsState` field is added (D5a) but only one is threaded through `renderWithStore`.**
   Task 4.2 lifts `PanelCreationModal`'s open flag into `panelsSlice`, so `PanelsState`
   (`panelsSlice.ts:31-40`) gains a *second* field — but task 1.4 threads only `staleDashboardId`.
   `frontend/src/test/renderWithStore.tsx:189-206` constructs the panels slice value field-by-field, so a
   missing property is a type error there, exactly as round 1's CR6 established for the first field.
   Extend 1.4 (or add to 4.2) to thread the modal flag too, defaulting `false`, and add it to the
   `preloadedState.panels` type at `:59-71` if any test needs to preset it (task 4.7's "the panel action
   stays unavailable with no dashboard selected" likely does).

4. **D5a moves a modal's visibility flag into Redux without specifying its lifecycle — that is the
   flag-outlives-mount half of the very defect this change's spec condemns.** Today
   `PanelList.tsx:39` holds `isModalOpen` in `useState`, so unmounting `PanelList` resets it. After 4.2
   the flag lives in `panelsSlice` and survives unmount, while the modal stays mounted only inside
   `PanelList` (`:322`, route `/` only). Reachable path: open the panel-creation modal → `Cmd/Ctrl+K`
   (App.tsx's `window` keydown listener at `:108-117` is **not** gated on any modal) → navigate to another
   route via the quick launcher → `PanelList` unmounts with the flag still `true` → return to `/` and the
   creation modal opens unbidden. Browser Back does the same. This is `workspace-create-actions`'s own
   language — *"a flow that silently opens later, on whatever route next mounts the modal"* — arriving
   through unmount instead of through a stray dispatch. (`SourcesPage`'s `addSourceModalOpen` already
   behaves this way — I verified there is no reset anywhere: the only writers are `SourcesPage.tsx:111/118`
   and `SidebarBody.tsx:131` — so "convergence on the convention" is convergence on a known wart, not a
   safe default.) Either add to task 4.2 an unmount/route-change reset (`dispatch(setPanelCreationModalOpen(false))`
   in a `PanelList` cleanup effect) plus a test that remounting `PanelList` does not render the modal, **or**
   state and accept the behavior explicitly in D4b/D5a — but do not leave D4b's "introduces no
   set-flag-with-nothing-mounted path" standing as if it covered this, because it does not.

5. **D8's fence is stated correctly but applied to only half the same-action siblings, and names one that
   does not exist.** Task 7.1 converts `PanelList.tsx:281`'s `faPlus` and `DashboardList.tsx:224`'s
   `faXmark`, but by D8's own rule two more qualify and are missing:
   a. `SidebarItemList.tsx:290` — `<FontAwesomeIcon icon={faXmark} />` in the filter-clear button, which
      sits directly above the new lucide `SearchX` filtered hero and performs **the same action** as its
      new "Clear search" CTA, in **all five** sidebar sections (task 6.2's branch is shared).
   b. `DataTypeSelectStep.tsx:216` — the same `faXmark` filter-clear, directly above the new filtered
      empty state task 6.3 adds at `:221`.
   c. Task 7.1's *"`DashboardList`'s … header add icons"* has no referent: `DashboardList.tsx:190-198`
      renders `<IconButton icon="+" …/>` — a literal `"+"` **character**, not a FontAwesome icon, and the
      identical `icon="+"` is used by all five `SidebarItemList` headers (`SidebarItemList.tsx:259-269`).
      Converting only the Dashboards one would make one sidebar header's "+" differ from the other five —
      manufacturing the within-view inconsistency D8 exists to remove. Drop it from 7.1, or convert all
      six together and say so.

6. **Correct the `MobileNavSheet` exclusion's second reason.** `MobileNavSheet.tsx` is on neither
   file-ownership fence in `ticket.md:77-83`, so "three delivery runs are editing mobile chrome in parallel
   … which makes an uncoordinated edit to a mobile navigation surface unsafe" asserts an ownership
   constraint that does not exist. The nav-surface-not-content-area reason is sufficient and true; keep
   that, drop or downgrade the ownership claim to what it actually is (prudence about adjacent mobile work,
   not a fence). Same discipline round 1 applied to the "only assignment of `idle`" overreach.

---

### Non-blocking notes

- **`DashboardList`'s `createError` is shared by three producers**, not one: the create catch (`:62`),
  the import failure (`:160`) and the file-read failure (`:168`). Task 3.4 should say the payload binding
  applies to the create catch only, so an executor restructuring `createError` does not clobber the other
  two messages. Upgrading the shared `<InlineError>` at `:263` to `variant="banner"` correctly improves all
  three — but note the banner renders inside the create form in a ~240px sidebar column; worth an explicit
  look at the final gate (it is a desktop-only surface, so 1440 is where to judge it).
- **The `sidebar-dashboard-filter` scenario is satisfiable only with no dashboard selected.** The base
  capability's existing requirement (`openspec/specs/sidebar-dashboard-filter/spec.md:32`, "Active dashboard
  is always reachable regardless of filter") is implemented by the pin at `DashboardList.tsx:176-183`, so
  with a dashboard selected `visibleItems` is never empty. Task 6.5 handles this for the executor, but the
  spec scenario ("WHEN at least one dashboard exists and the active filter query matches none of the
  visible rows") reads as if it were reachable in general. Consider adding "and no dashboard is currently
  selected" so the archived contract does not mislead.
- **Line-citation drift, all harmless:** `dashboardsSlice`'s `createDashboard` is `:66-76` with the `catch`
  at `:73` (cited `:69-76`); `SidebarItemList`'s filtered `<p>` is `:229` (cited `:230`); the
  `EmptyState.css` floor block opens at `:218` (cited `:219-228`); the sidebar-CTA height rule is
  `:162-168` (cited `:163-168`).
- **Round 1's very-rare state is still unrecorded.** A `deletePanel` that resolves *after* a `fetchPanels`
  rejection leaves `status:"idle"` + `staleDashboardId === selectedDashboardId` + `items: []` (the guard
  passes because `fetchPanels.rejected` does not clear `loadedDashboardId`), so the new gate claims "No
  panels yet" on a dashboard whose panels never loaded. Still not worth a guard; still worth one sentence
  in D2 so nobody rediscovers it as a bug.
- **`TypeRegistryBrowser`'s empty state is properly gated upstream** — `TypeRegistryPage.tsx:62` renders it
  only when `!showTypesSkeleton && status !== "failed"`, so adding a CTA there will not make a load-flash
  more actionable. No action needed; recording it because it was the obvious way this could have gone wrong.
- **Copy is still unpinned.** D4/5.1 commit to the *shape* ("label names the thing it creates", teaching
  sentence retained) but not the strings; D3 commits to quoting the query but not the wording. That is
  acceptable at a design gate — but it means requester rule 3 ("the copy is the deliverable") and rule 7
  (side-by-side consistency) are entirely deferred to the final gate, where they will be judged strictly.
