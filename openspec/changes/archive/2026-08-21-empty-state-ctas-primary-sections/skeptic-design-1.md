## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Read cold from the tree at `2eaf1d26` (worktree HEAD; `git diff main...HEAD` is empty — planning
artifacts are still untracked). Every line citation below was opened and read; no claim in
`design.md` was taken on trust. No browser was used (three parallel runs share the Playwright
session, per the brief); nothing in this gate required one.

### What I verified (with evidence)

**Citations that check out exactly.** `panelsSlice.ts:85-89` (`markDashboardPanelsStale`, guard at
`:86`), `:102-106` (`fetchPanels.pending`), state interface `:31-40` / initial state `:42-50` (status
union on `:34`, `status:"idle"` on `:45` — task 1.1's "`:34/45` area" is precise).
`frontend/src/app/App.tsx:123-129` — the panel-fetch effect, keyed `[dispatch, selectedDashboardId]`,
early-returning on `null`. `PanelList.tsx:85-88` (`showPanelGridSkeleton`), `:173-183`
(`handleCreateDashboard`), `:179` (hardcoded `"Failed to create dashboard."`), `:277` / `:415`
(`setIsModalOpen`), `:322` (modal render), `:388-399` (neutral first-run hero), `:408`
(`status === "succeeded" && items.length === 0`). `PanelList.test.tsx:570` — the "D11 mirror-image"
test asserts both `.ui-skeleton` absence and `queryByText("No panels yet")).not.toBeInTheDocument()`,
with a comment naming the gap as pre-existing. `DashboardList.tsx:280` and `SidebarItemList.tsx:230`
— bare `<p className="dashboard-list__status">No matches</p>`. `SidebarItemList.tsx:250-252` — the
no-`emptyIcon` bare-`<p>` fallback. `TypeRegistryBrowser.tsx:46` — `EmptyState`, teaching copy at
`:50`, no `cta`. `SourcesPage.tsx:103`, `PipelineEmptyState.tsx:15`, `toastListeners.ts:151`,
`EmptyState.css:219-227` (the 44px floor, and it is genuinely the **last** block in a 228-line file).

**D4a is correct and well-grounded.** `SidebarItemList` renders `onAdd` twice — as the empty state's
`cta` (`:239-246`) and as a persistent header `IconButton` (`:259-269`) — so passing `onAdd` to the
Data Types section really would put a "+" in a *Data Types* header that creates a *pipeline*. I
confirmed all five call sites (`SidebarBody.tsx:119/150/188/228/310`): all five pass `emptyIcon`,
four pass `onAdd`, and `:228` (registry) is the only one that does not. Exactly as D4a claims.

**Task 6.5's `DashboardList` note is correct.** `DashboardList.tsx:176-183` pins the active dashboard
into `visibleItems` regardless of the query, so a true zero-row filtered state needs no selected
dashboard (or a selected id absent from `items`). That is a real trap the plan already spotted.

**D8's stated rationale is true for all five sections.** SourcesPage/PipelinesPage/TypeRegistryPage
error states use `ERROR_KIND_ICON` (lucide, `InlineError.tsx:16-20`); `DashboardList` and `PanelList`
route failures through `StatusMessage`, which imports lucide `TriangleAlert` (`StatusMessage.tsx:1`).
Every one of the five is currently mixed against itself. (See CR8 for where the conversion still
leaves a mix.)

**D1/D2's core reasoning holds — I tried hard to break it and could not.** I traced every route to
`panels.status === "idle"`: initial state, and `panelsSlice.ts:88` (the only `state.status = "idle"`
in the panels slice). I traced all four `markDashboardPanelsStale` dispatchers (`panelThunks.ts:107`
createPanel, `:135` deletePanel, `:149` duplicatePanel, `patchSetsSlice.ts:219`) and confirmed:
- The reducer's guard (`:86`) means `payload === loadedDashboardId` whenever it takes effect, so a
  stale-mark for a dashboard other than the loaded one is a no-op — including the delete-then-switch
  race, which the guard absorbs in both orderings.
- Every dispatcher except `deletePanel` immediately dispatches `fetchPanels` in the same microtask;
  React 19 (`frontend/package.json:28`) auto-batches, so the stale/idle intermediate does not paint.
  On the one path where it could paint (creating the *first* panel on an empty dashboard), the empty
  state was already on screen, so no new flash is introduced.
- **Question (c) — the guard/discriminator interaction is clean.** Deleting a second panel on an
  already-invalidated dashboard early-returns (`loadedDashboardId` is `null`), leaving the correct
  `staleDashboardId` from the first delete in place.
- **Question (d) — panel *creation* does not misbehave.** `createPanel`/`duplicatePanel` leave
  `items` non-empty or immediately fetch; `fetchPanels.pending` clears the discriminator (task 1.3),
  so `failed` states can never inherit a stale flag.
- **Question (a) — no permanent skeleton.** The widened gate admits only
  `selected !== null && idle && stale !== selected`, and I found no reachable settled state matching
  it without a `fetchPanels` dispatch following. See CR11 for the one unstated premise in that proof.

**D2a is a legitimate closure, not the destruction of a guard.** HEL-528's own task 6.5c-ii says
verbatim: *"Do NOT assert an empty state renders … That missing `EmptyState` is a pre-existing §7 gap
owned by HEL-548; do not close it here."* Its D11 refused only because *"no Redux state distinguishes
them"* — a constraint D1 removes. Inverting the positive assertion while keeping the `.ui-skeleton`
absence assertion is precisely what HEL-528 licensed.

**Spec-delta mechanics are sound.** `openspec validate empty-state-ctas-primary-sections` → *"Change
'empty-state-ctas-primary-sections' is valid"* (exit 0). Both MODIFIED requirement headers match
existing ones (`openspec/specs/frontend-panel-empty-state/spec.md:3`,
`openspec/specs/loading-state-pattern/spec.md:238`) and **no existing scenario is silently dropped** —
both deltas carry every base scenario forward and add to them. The new `toast-emission-integrity`
requirement is the converse of, not a contradiction to, the existing one at `:32`.

**Ticket fidelity.** `ticket.md`'s Description/Scope/Acceptance criteria match Linear HEL-548
verbatim; the absorbed HEL-770 criteria match Linear HEL-770's own AC list. The absorption is
coherent — HEL-770's text does say "HEL-548 owns this surface", and it edits `PanelList.tsx`'s
dashboards-empty branch, the same branch D6 restructures. Task 3.4's ordering constraint ("only after
3.2 is green") is correctly stated and matches HEL-770's scope order. **Only two `createDashboard`
dispatch sites exist** (`PanelList.tsx:177`, `DashboardList.tsx:58`), so "both dispatch paths" is
accurate.

**§ standards read (not edited).** `DESIGN.md` §4 (1440/1100/768/430), §5 (recipes, "one primary per
view/section"), §6/`EmptyState.css:37-44` (`main` title is `--font-display` = Fraunces,
`theme.css:20`), §7, §8. `DESIGN.md` was not modified by this change and must not be (HEL-774).

---

### Verdict: REFUTE

The spine of this plan is good — D1/D2/D2a/D4a are the strongest planning work I have reviewed on
this surface, and I could not break the discriminator. But several load-bearing statements are
**factually wrong against the tree**, and three of the seven spec deltas assert behavior this change
will not deliver. Those specs get archived and become the durable contract; shipping them false is
worse than shipping the gap.

---

### Change Requests

1. **D4 / task 4.3 rest on a premise that is false: `CreatePipelineModal` is already mounted at the
   shell level.** `app/App.tsx:199-209` mounts it for every route except `/pipelines` (comment F-045:
   *"so the sidebar's pipelines '+' works from any route … previously it only set `createModalOpen`
   in Redux with nothing mounted to read it outside `/pipelines`"*), and `PipelinesPage.tsx:104`
   mounts the page-local instance. So "the modal is rendered by the Pipelines page" (D4, task 4.3) is
   wrong, and the prescribed *navigate to `/pipelines` and open* is an unnecessary route change —
   from `/registry` a bare `dispatch(setCreatePipelineModalOpen(true))` opens the modal in place.
   Rewrite D4/4.3 to dispatch only, and state explicitly whether navigating away from the Registry is
   a deliberate UX choice (if so, justify it on UX grounds, not on a mounting constraint that does
   not exist).

2. **The `workspace-create-actions` spec asserts a cross-surface guarantee two of the four actions
   cannot honor.** `specs/workspace-create-actions/spec.md:32-34` — *"The panel creation flow opens
   from any surface … regardless of which surface invoked it."* `PanelCreationModal` is rendered only
   inside `PanelList` (`PanelList.tsx:322`), which only mounts on route `/` (`AppRoutes.tsx:88`);
   `AddSourceModal` is rendered only by `SourcesPage.tsx:118`. Lifting the flag into Redux (D5a) does
   not make either open from elsewhere — it reproduces exactly the bug F-045 fixed for pipelines
   (flag set, nothing mounted, modal opens later on some unrelated navigation). Either (a) hoist
   `PanelCreationModal` to the shell the way `CreatePipelineModal` is, or (b) narrow the requirement
   and record in D5 the mount constraint of each of the four actions, so HEL-554 consumes them with
   open eyes. Do not ship the scenario as written.

3. **The HEL-770 "specific rejection message" is unachievable as designed — task 3.1 is a no-op.**
   `dashboardsSlice.ts:70-76` is `catch { return rejectWithValue("Failed to create dashboard."); }`:
   the rejection payload is *always* that fixed string. RTK's `unwrap()` throws the payload (a plain
   `string`, not an `Error`), and `extractErrorMessage` (`services/extractErrorMessage.ts:17-23`)
   only reads an `AxiosError` body, so it returns the fallback. Net effect of 3.1: the identical
   string. Yet D6, `specs/frontend-panel-empty-state/spec.md:41-43` (*"the specific message the
   rejection produced, not a fixed generic sentence"*) and ticket AC all claim otherwise. Fix at the
   source — `catch (err) { return rejectWithValue(extractErrorMessage(err, "Failed to create
   dashboard.")); }` in the thunk, with both consumers rendering the payload — **or** delete the
   specificity claim from D6, the spec delta and the AC and record it as a follow-up. Add a task
   either way.

4. **Removing the toast (task 3.4) violates this change's own new `toast-emission-integrity`
   requirement on the `DashboardList` path.** That requirement
   (`specs/toast-emission-integrity/spec.md:4-8, 18-21`) licenses removal only once **every**
   dispatching surface reports inline *"with a persistent, error-intent, announced treatment carrying
   the failure's own message"*, and its prose asserts *"one as an error banner"*. Reality:
   `DashboardList.tsx:263` renders `<InlineError error={createError} />` with the **default
   `variant="text"`**, which is a bare `<p className="inline-error">` with no role and no icon
   (`InlineError.tsx:56-65, 99`) — and `DashboardList.tsx:61-62` hardcodes its own generic string.
   After 3.4 a screen-reader user gets **no announcement at all** on that path (§8 regression). Add a
   task to bring `DashboardList`'s create-failure report to the stated bar (`variant="banner"` gives
   `role="alert"` + the lucide error icon for free — `InlineError.tsx:67-73`) and to carry the
   payload, **or** narrow the spec and keep the toast. Task 3.5 as written ("still reports it exactly
   once") does not catch this.

5. **The `empty-state-cta-pattern` ADDED requirement is broader than what will ship — three
   specific over-claims.** `specs/empty-state-cta-pattern/spec.md:4-12`:
   a. *"SHALL render … in its `main` variant … in every reachable no-data state"* contradicts D3,
      which deliberately renders `variant="sidebar"` for the Dashboards / Data Types / data-type-step
      surfaces. Separate "section (page surface)" from "sidebar surface" in the wording.
   b. *"Each such empty state SHALL offer exactly one primary call to action"* and *"A section whose
      resource cannot be created directly SHALL still offer an action"* are not delivered for
      `PanelList.tsx:401-405` ("Select a dashboard"), which has no `cta` and which the plan does not
      change. Either fence it in the requirement or give it an action.
   c. *"No primary section renders a blank region"* — at ≤768px the sidebar is `display: none`
      (`App.css:416-419`), and these same sections are browsed through `MobileNavSheet`, whose empty
      branch is a bare `<p className="mobile-nav-sheet__empty">` with **no `EmptyState` and no CTA**
      (`MobileNavSheet.tsx:203-205`). Either cover it or fence it explicitly in Non-Goals with a
      reason, the way `PipelineRiverView`/`ApiTokensSection` are fenced.

6. **`renderWithStore` must be updated for `staleDashboardId`, and no task says so.** Every
   `PanelList` test builds panels state through `frontend/src/test/renderWithStore.tsx`, whose
   `preloadedState.panels` type (`:59-67`) and constructed slice object (`:189-206`) enumerate the
   panels fields explicitly. Adding a field to `PanelsState` breaks that object's type, and tasks 2.4
   / 2.5 ("with `staleDashboardId` now set", "`staleDashboardId: null`") are **not executable** until
   the helper threads it. Add a task under §1: thread `staleDashboardId` through both the
   `preloadedState` type and the constructed object (`?? null`).

7. **Section 8 does not commit the executor to the session's verification standard, and 8.4 is not
   performable as written.**
   a. "Reproduce on the unfixed build first" appears **only** at task 2.1. Extend it to the toast
      collision (prove a toast fires today on `createDashboard.rejected`, then prove it does not),
      to the three filter-empty surfaces, and — most importantly — to the **probe itself** for 8.4:
      measure a control that is known *not* to be floored (a sidebar-variant CTA at desktop width,
      `height: var(--control-sm)`, `EmptyState.css:163-168`) and show the probe reads it as ~28px, so
      a reading of 44px means something. A probe that returns 44 unconditionally proves nothing.
   b. 8.4 says measure "each rendered empty-state button at 430 and 768". Three of the surfaces this
      change touches (`DashboardList`, `SidebarItemList`, and the registry `emptyCta`) live in
      `.app-sidebar`, which is `display: none` at ≤768 (`App.css:416-419`) — those buttons are not
      rendered at those widths at all. Say which surfaces are actually measurable at ≤768, and state
      that the sidebar CTAs are desktop-only (or reach them via a mobile path if one exists).
   c. Specify **`getBoundingClientRect().height` on a rendered element** (the *used* height), not
      `getComputedStyle(...).minHeight`. The floor works by `min-height` clamping `height`; reading
      the declared `min-height` is the property-level read that the inert-cascade class of bug can
      still slip past, and it returns a value even for an element that never laid out.

8. **D8's "each enumerated section internally consistent" is not delivered by the conversion as
   scoped.** Converting only the empty-state icons leaves, within the same view:
   `PanelList.tsx:281`'s header **"Add panel"** button on FontAwesome `faPlus` next to an empty-state
   "Add panel" CTA on lucide `Plus` — the *same action, two glyphs, one screen*;
   `DashboardList.tsx:2/216-222`'s `faXmark` filter-clear button inches from the new lucide `SearchX`
   filter-empty hero; and, because task 6.2's filter branch is shared, a lucide `SearchX` filter-empty
   above an FontAwesome no-data empty in the Metrics and Chat sidebar sections too. Either widen the
   fence to the sibling affordances on those five sections, or state and accept the residual mix
   explicitly in D8 (with the intent to verify at the final gate that they read consistently).
   "Consistency across sections is the ticket's premise" (requester rule 7).

9. **D5's claim that the seam introduces "no new shared type" rests on an export that does not
   exist.** `EmptyState.tsx:7` declares `interface EmptyStateCta` **without `export`** (nor is
   `EmptyStateProps` exported). So the four hooks cannot annotate against "the primitive's own
   already-exported shape". Meanwhile `proposal.md`'s Impact says *"`shared/ui/EmptyState.tsx`'s API
   is unchanged."* Resolve the contradiction explicitly: export the type (a benign additive change —
   then fix the proposal line), or state that the hooks rely on structural assignability with no
   named contract.

10. **Task 5.2's `emptyCta` scoping is ambiguous in a way that can violate the change's own spec.**
    "consumed only by `renderEmpty()`" — but `renderEmpty()` (`SidebarItemList.tsx:228-253`) covers
    **both** the filtered branch (`:229-231`) and the no-data branch. `emptyCta` must apply only to
    the **no-data** branch; the filtered branch takes "Clear search", because
    `specs/empty-state-cta-pattern/spec.md:34-35` says *"The filtered state SHALL NOT offer the
    section's create action."* Reword 5.2 to name the branch.

11. **Record the unstated premise D2's "provably coming" proof depends on.** `fetchPanels` carries a
    `condition` (`panelThunks.ts:72-83`) that returns `false` — dispatching **no** `pending` at all —
    when `status === "loading" || "succeeded"` with a matching `loadedDashboardId`. So "`App.tsx`
    dispatches" is not by itself "a fetch runs". The conclusion survives (the condition never blocks
    while `status === "idle"`, and `markDashboardPanelsStale` always leaves `status === "idle"` with
    `loadedDashboardId === null`), but this is the single link that, if a future change touches
    `condition`, silently parks a permanent skeleton — exactly the failure HEL-528 wrote D11 to
    prevent. State it in D2 and lock it with a slice test asserting `fetchPanels` is not skipped from
    the invalidated state.

12. *(Minor, but it will cost a cycle.)* Task 9.4's command is wrong for the installed CLI
    (`openspec 1.2.0`): `openspec validate --change empty-state-ctas-primary-sections` →
    `error: unknown option '--change' (Did you mean --changes?)`, exit 1. The working form is
    `openspec validate empty-state-ctas-primary-sections` (verified: *"Change
    'empty-state-ctas-primary-sections' is valid"*, exit 0).

---

### Non-blocking notes

- `design.md`'s "*`panelsSlice.ts:88` is the only assignment of `"idle"` in the entire frontend
  outside initial state*" is false as stated — `settingsSlice.ts:399/402`, `authSlice.ts:201/206/
  211/220/224` and `metricsSlice.ts:131` all assign `"idle"`. The claim is true *within the panels
  slice*, which is all the argument needs. (HEL-528's D11 made the same overreach; it is inherited,
  not introduced.) Worth narrowing so a later reader does not build on it.
- `design.md`'s "*none names what was searched*" is false for `DataTypeSelectStep.tsx:221-223`, whose
  existing copy already renders `No data types match "{filterQuery}"`. The plan's action there
  (become an `EmptyState`, gain a clear CTA) is still right; only the premise is overstated.
- Line-citation drift, all harmless but worth a pass: the `SidebarItemList` header block is
  `:259-269` (cited `:258-268`); `DataTypeSelectStep`'s `<p>` opens at `:221` (cited `:222`); the
  44px media block is `:219-228` (cited `:219-227`); `App.tsx` is `frontend/src/app/App.tsx` (cited
  bare, and there is no `frontend/src/App.tsx`).
- D5a understates its own support: **three** sibling modals already keep their open flag in Redux
  (`setAddSourceModalOpen`, `setCreatePipelineModalOpen`, `setCreateMetricModalOpen`), not two. The
  convergence argument is stronger than written.
- Judgment call, not a blocker: "Clear search" rendered with the **primary** recipe
  (`.ui-empty-state__cta`) is a recovery action getting top emphasis. `EmptyState` already supports
  `secondaryCta` standalone (`EmptyState.tsx:95`). Consider secondary; either reading is defensible
  under §5 since the sidebar header's "+" is `variant="secondary"`.
- Very rare state, worth a comment rather than a task: a `deletePanel` that resolves *after* a
  `fetchPanels` rejection leaves `status: "idle"` + `staleDashboardId === selected` + `items: []`, so
  the new empty gate would claim "No panels yet" on a dashboard whose panels never loaded. Not worth
  a guard; worth a sentence in D2 so nobody rediscovers it as a bug.
