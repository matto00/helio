## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold spawn. Read from the tree at `2eaf1d26` (worktree HEAD; planning artifacts still untracked —
`git status --short` shows only `?? openspec/changes/empty-state-ctas-primary-sections/`). No browser
(three parallel runs share the Playwright session; nothing at this gate needed one). `DESIGN.md` read,
not edited. Every file:line below was opened and read in this session; nothing was taken from rounds
1–3 or from the round-4 brief's summary on trust.

Fresh gate evidence:

```
$ openspec --version
1.2.0
$ openspec validate empty-state-ctas-primary-sections
Change 'empty-state-ctas-primary-sections' is valid
exit=0
$ openspec validate empty-state-ctas-primary-sections --strict
Change 'empty-state-ctas-primary-sections' is valid
strict_exit=0
```

### HEADLINE: no round-3 survivor. The blocking CR **and** its sub-item are genuinely resolved.

Two change requests below, neither a survivor. CR1 is new and substantive: an unresolved collision
between task 3.2/3.3 and task 4.6 that the descriptor contract cannot express, whose wrong resolution
silently guts the absorbed HEL-770 criterion *after* the toast is removed. CR2 is a one-word stale
count inside D8 that now contradicts its own list.

---

### 1. Round 3's blocking CR — verified resolved against the tree

Round 3 required picking a resolution for task 7.2a and correcting D8's false "between views rather
than within one" sentence. Option (b) was taken. I verified each half independently:

- **Task 7.2a now converts exactly three `emptyIcon`s**; **task 7.2b explicitly excludes Metrics and
  Assistant**. Ground truth (`grep -n "emptyIcon\|heading=" shared/chrome/SidebarBody.tsx`):
  `:120` Data Sources / `:129 faDatabase`, `:151` Data Pipelines / `:161 faCodeBranch`, `:189` Metrics /
  `:198 faGaugeHigh`, `:229` Data Types / `:240 faLayerGroup`, `:316` Assistant / `:326 faComments`.
  7.2a's three and 7.2b's two match exactly.
- **7.2b's justification is factually correct, not just plausible.** `SidebarBody.tsx:197-198` passes
  `emptyText="Define your first metric"` + `faGaugeHigh`; `MetricEmptyState.tsx:13-14` is
  `icon={faGaugeHigh}` + `title="Define your first metric"` — identical glyph, identical title.
  `SidebarBody.tsx:325-326` is `"No conversations yet"` + `faComments`;
  `ActiveConversationPanel.tsx:141` is `icon={faComments}` with
  `title={items.length > 0 ? "New conversation" : "No conversations yet"}` — the same pair in the
  empty case. So converting one half really would manufacture the defect.
- **The four in-scope pairs really do get both halves**, which is what makes option (b) the smaller
  regression: Sources `SidebarBody:129` + `SourcesPage.tsx` hero (`variant="main"`, `faDatabase`,
  "Connect a data source"); Pipelines `:161` + `PipelineEmptyState.tsx` (`faCodeBranch`, "Build your
  first pipeline"); Data Types `:240` + `TypeRegistryBrowser.tsx:48` (`faLayerGroup`, "No types
  defined"); Dashboards `DashboardList.tsx:284` + `PanelList.tsx:389/402/410`. All five citations are
  exact (`grep -n faXmark\|faTableColumns\|faPlus DashboardList.tsx` → `:224/:284/:289`).
- **The false sentence is gone.** `grep -n "between views" design.md tasks.md proposal.md` → no match
  (exit 1). D8's replacement residue paragraph (design.md:323-327) describes the true accepted
  residue: the Metrics/Assistant *filtered* hero (lucide `SearchX`) vs their *no-data* hero
  (FontAwesome), two mutually exclusive branches.

**Sub-item — resolved.** New task 7.2c converts `DataTypeSelectStep.tsx:178`'s no-data `EmptyState`
icon, and D8 names it in the enumeration. Verified in the file: the `EmptyState` opens at `:178` with
`icon={faLayerGroup}` at `:179`; the error branch's FontAwesome `faArrowRotateRight` Retry is at
`:172` beside a lucide `InlineError`; the filter-clear `faXmark` is at `:216` under
`aria-label="Clear filter"` (`:213`); the bare `<p className="panel-creation-modal__datatype-no-match">`
is at `:221`. Every citation exact.

### 2. The eight adopted notes — spot-checked in the tree

| Note | Landed? | Evidence |
| --- | --- | --- |
| **A** file list | Yes, and the file list is exactly right | `PatchSetReviewPage.test.tsx:313-323` is `preloadedPanelsState()` with **no** cast, and its `renderPageWithStore` (`:324-336`) passes it to a store whose reducer map includes `panels: panelsReducer` — so a partial shape really is a type error. `panelsSlice.test.ts:463-476` is the inline `preloadedState`, and its `@ts-expect-error` sits on the `store.dispatch(action)` line (~`:484`), not the store. `usePanelData.test.ts:24-35` casts `as never` (and its reducer map too) — unaffected, as 1.4a says. |
| **B** two dashboard flows | Yes | Task 4.3 names `PanelList`'s quick-create and marks `DashboardList.tsx:281-296` deliberately untouched; 4.7 defers to 4.3; `empty-state-cta-pattern`'s scenario now reads "the create control **co-located with that empty state**" plus a NOTE permitting two flows on two surfaces. Ground truth confirms they are genuinely different flows: `DashboardList.tsx:190-198`'s "+" and its CTA both set `isCreateMode` (a named form, submitted by `handleCreateDashboard` at `:55-66`), while `PanelList.tsx:173-183` dispatches `createDashboard({name:"Untitled dashboard"})` immediately. |
| **C** unmount reset in spec | Yes | `workspace-create-actions` gained both the paragraph ("A visibility flag held in shared state SHALL be cleared when the surface that mounts its flow unmounts") and the scenario. |
| **D** cleanup form | Yes | Task 4.2a specifies `useEffect(() => () => { dispatch(setPanelCreationModalOpen(false)); }, [dispatch])` and the StrictMode comment. |
| **E** "Clear filter" | **Under-matched — one residue.** `proposal.md:16` still says `a "Clear search" CTA`. design.md D3/D8 and tasks 5.2/6.1 all say "Clear filter". Non-blocking (note N1) — the binding artifacts agree, and "Clear filter" is the right choice: it is the existing accessible name at `DashboardList.tsx:218-219`, `SidebarItemList.tsx:~287-288` and `DataTypeSelectStep.tsx:213`, all of which I read. |
| **F** stale comment | Yes | Task 2.2 requires replacing it. The comment is `PanelList.tsx:74-84` (cited as `:75-84`); the now-false sentence "widening to `idle` there would park a permanent skeleton over either state" is inside it. |
| **G** rare state | Yes | design.md:114-119 records the `deletePanel`-after-`fetchPanels.rejected` state as knowingly accepted. |
| **H** copy unpinned | Yes, with shape constraints | Acceptable at a design gate; the final gate judges the strings. |

### 3. Independent re-derivation of the load-bearing mechanics (not taken on trust)

- **D1/D2's seam is real and the gates are correct.** `PanelsState` is `panelsSlice.ts:31-40`;
  `markDashboardPanelsStale` is `:85-89` with the `loadedDashboardId !== payload` early return at
  `:86`; `fetchPanels.pending` is `:102-106`. `fetchPanels`' `condition` (`panelThunks.ts:72-83`)
  returns `false` only for `loading`/`succeeded` **with a matching `loadedDashboardId`**, so it never
  blocks from the invalidated state — D2's unstated premise holds, and task 1.6 locks it.
  `App.tsx:123-129` is keyed `[dispatch, selectedDashboardId]`. `deletePanel` (`panelThunks.ts:127-139`)
  really is the only stale-dispatcher with no follow-up `fetchPanels` — `createPanel` (`:107-108`) and
  `duplicatePanel` (`:149-150`) both refetch on the next line.
- **The empty-state branch is actually reachable in the terminal state.** It sits under
  `!(showPanelGridSkeleton || showBootstrapSkeleton)` (`PanelList.tsx:384`), and
  `showBootstrapSkeleton` (`:107-110`) requires `selectedDashboardId === null` — false post-delete. So
  task 2.3's gate change genuinely closes the blank.
- **Task 2.3's added `selectedDashboardId !== null` conjunct breaks nothing.** Both existing
  "No panels yet" tests (`PanelList.test.tsx:293-319`, `:321-349`) preload
  `selectedDashboardId: "dashboard-1"`. I re-enumerated every `status: "idle"` fixture in that file
  (`:165, 180, 184, 208, 233, 259, 563, 576`); only `:576` (the D11 mirror-image test) pairs `idle`
  with a selected dashboard, and that is exactly the test task 2.4 inverts — including the fixture
  edit ("now with `staleDashboardId` set to the selected dashboard") without which its **kept**
  `.ui-skeleton` absence assertion would fail under the new skeleton gate. The only other file
  rendering `PanelList` is `PanelList.gridWidthSharing.test.tsx`, whose fixtures are `loading` /
  `succeeded` only — unaffected.
- **D6's chain actually delivers a specific message, end to end.** `createDashboard`'s catch is bare
  (`dashboardsSlice.ts:73`), `createDashboard.rejected` has **no** case in the slice (only
  `.fulfilled` at `:273`), `dashboardService.createDashboard` (`:24-29`) does a bare `httpClient.post`
  with no catch, and `httpClient`'s only response interceptor re-rejects the original error
  (`httpClient.ts:27-46`) — so a real `AxiosError` reaches the thunk's catch and
  `extractErrorMessage(err, fallback)` (`services/extractErrorMessage.ts:18-24`) can read
  `data.error`/`data.message`. Task 3.1 is the only place the fix works, as D6 says.
- **D6a is executable as written.** `InlineError`'s `variant="banner"` (`:67-73`) supplies
  `role="alert"` (via `announced`, default `true`) and a lucide `ERROR_KIND_ICON`; the default
  `variant="text"` really is a bare `<p className="inline-error">`. `DashboardList.tsx:263`'s
  `<InlineError error={createError} />` lives inside the `isCreateMode` form, which stays open on
  failure (`setIsCreateMode(false)` runs only on success), so the banner is actually visible.
- **No archived spec is falsified by the toast removal.** `grep -rn "createDashboard" openspec/specs/`
  returns nothing toast-related; `toast-emission-integrity`'s existing requirements (`:6/:23/:32/:53`)
  are all compatible with the new ADDED one.
- **Both MODIFIED deltas preserve every existing scenario.** `frontend-panel-empty-state`'s existing
  requirement (`specs/.../spec.md:3-18`) has three scenarios; the delta keeps all three verbatim and
  adds two. `loading-state-pattern`'s existing `:238-283` requirement has four; the delta keeps all
  four and adds one. Its sibling requirement "Empty state CTA opens the panel create form" (`:19`)
  stays true after the D5a lift, since both entry points still open `PanelCreationModal`.
- **D7's floor claim is correct at the CSS level.** `EmptyState.css`'s last block is
  `@media (max-width: 768px) { .ui-empty-state__cta, .ui-empty-state__secondary-cta { min-height: 44px } }`
  on the **base** selector, so it clamps the sidebar variant's `height: var(--control-sm)`
  (`:162-168`) — which matters because `DataTypeSelectStep`'s new filtered CTA is `variant="sidebar"`
  inside a modal that *does* render at 430px. Task 8.7 correctly lists that modal among the
  measurable surfaces, and 8.6's ~28px discriminator is real.
- **`TypeRegistryBrowser`'s branch is a true no-data state, not a selection prompt.**
  `selectedType = items.find(...) ?? items[0] ?? null` (`:31-32`), so `null` ⟺ zero pipeline-output
  types; and `TypeRegistryPage.tsx:29/62` keeps the browser behind a skeleton while the fetch is in
  flight, so task 5.1's CTA will not flash on cold boot.
- **D4's shell-mount claim holds.** `App.tsx:208-210` renders `CreatePipelineModal` when
  `location.pathname !== "/pipelines" && pipelines.createModalOpen`, so `useCreatePipelineAction()`
  opens in place on `/registry`. `PipelinesPage.tsx:69/88/103-104` is the page-local instance.
  `App.tsx:108-117`'s `Cmd/Ctrl+K` listener is ungated, so D5a/4.2a's reachable defect is real.

---

### Verdict: REFUTE

Two change requests, **neither a round-3 survivor**. CR1 is a genuine hole the three prior rounds did
not touch (I grepped rounds 1–3 for `isCreatingDashboard` / `createDashboardError` / "in-flight" —
no hits): the create-action seam's descriptor contract cannot carry the in-flight and error state that
the same plan requires `PanelList` to render, so tasks 3.2 and 4.6 cannot both be executed literally.
Its wrong resolution is not loud — it is a dead error branch on a surface whose toast task 3.6 removes.

---

### Change Requests

1. **`useCreateDashboardAction()` is the one hook of the four that owns in-flight and error state, and
   the plan gives that state nowhere to live — tasks 3.2 and 4.6 collide.** (NEW; not a survivor.)

   Three of the four hooks are pure flag flips (`setAddSourceModalOpen`, `setCreatePipelineModalOpen`,
   and after 4.2 `setPanelCreationModalOpen`). The dashboard one is not: `PanelList.tsx:173-183`'s
   `handleCreateDashboard` awaits `dispatch(createDashboard(...)).unwrap()` and drives **two** pieces
   of component state — `isCreatingDashboard` (`:40`), which supplies the CTA's `"Creating..."` label
   at `:395`, and `createDashboardError` (`:41`), which task 3.3 turns into the branch's `intent`,
   title, icon and description.

   Now read the two tasks together:
   - **3.2** keeps that handler in `PanelList` (`catch (err)` binds and stores the thunk's payload).
   - **4.6** rewires "`PanelList`'s two" CTAs to consume their hook. Per design.md's Context
     ("`PanelList.tsx:388/409` … render `EmptyState variant="main"` with a working CTA") those two are
     the **dashboards** hero CTA and the panels hero CTA — so the dashboards CTA's `onClick` becomes
     the hook's, and `handleCreateDashboard` is orphaned.

   The descriptor cannot bridge them. `EmptyStateCta` (`EmptyState.tsx:7-18`) is
   `{ label, onClick, icon?, disabled? }` — enough for the in-flight state (label swap + `disabled`),
   **nothing for the error**. And the error cannot be read from Redux instead: `createDashboard.rejected`
   has no case in `dashboardsSlice` (only `.fulfilled`, `:273`), so the payload exists only where
   `.unwrap()` throws. Whoever owns the `onClick` owns the error.

   So an executor must invent one of these, unaided:
   - **(i) Hook swallows the rejection.** `createDashboardError` is never set → task 3.3's conditional
     error branch is dead code → the absorbed HEL-770 criterion is unmet → and because task 3.6 has
     already removed `error(createDashboard.rejected, …)` from `ERROR_TOASTS`, a failed create from the
     panel area reports **nothing at all**. This is precisely the silent-failure trade D6a's ordering
     argument exists to forbid, arriving through the seam instead of through the toast.
   - **(ii) Hook returns a bundle** (`const { cta, error, isPending } = useCreateDashboardAction()`).
     Behaviorally correct, but it falsifies D5's "return value is directly assignable to
     `EmptyState`'s existing `cta` prop" **and** `workspace-create-actions`' shipped requirement
     "…in the shape the shared empty-state primitive already accepts for a call to action, so that a
     consumer can pass it directly **without adapting it**" — a false archived spec.
   - **(iii) Leave the dashboards CTA un-rewired**, contradicting 4.6 and leaving the HEL-554 seam
     unbuilt for the one action HEL-554 most obviously needs.

   Decide it in D5 and say so in the tasks. Either shape is defensible; what is not defensible is
   leaving it to the executor:
   - **(a)** the hook returns the descriptor **plus** its own `error`/`isPending` (it owns the
     `useState`, the `unwrap()` and the `extractErrorMessage` fallback), `PanelList` binds
     `error` into task 3.3's conditional branch — and `workspace-create-actions`' "pass it directly
     without adapting it" is reworded to describe the descriptor **field**, not the hook's whole
     return; or
   - **(b)** the hook takes the completion callbacks (`useCreateDashboardAction({ onError })`) and
     `PanelList` keeps `isCreatingDashboard`/`createDashboardError` exactly as 3.2 says — in which
     case say so in 4.6, since "behavior must be identical" then has a concrete meaning.

   Whichever is chosen, task 4.6's "`PanelList`'s two" needs one clause naming what happens to
   `handleCreateDashboard`, and task 3.5's test for `PanelList`'s error surface should be stated to
   exercise the **rewired** CTA (not the orphaned handler), so resolution (i) cannot pass green.

2. **D8's enumeration lead-in still carries the pre-round-3 counts and now contradicts its own list
   eight lines below.** design.md:293 reads "Applied exhaustively, that is exactly four sibling
   controls and **five** `emptyIcon` values:", and design.md:301 reads "Plus **two** hero icons inside
   the in-scope ladders:" — but the list is four sibling controls, `DataTypeSelectStep.tsx:178`, and
   "The **three in-scope** `emptyIcon` values" (design.md:305-306), i.e. three `emptyIcon`s and four
   hero icons. Task 7.2a/7.2b are unambiguous, so this is mechanical, not a re-litigation — but "five
   `emptyIcon` values" is the *old* fence, the one round 3 blocked, sitting in the binding decision
   record. Correct both numbers (or drop the counts and let the list speak).

---

### Non-blocking notes

**N1. `proposal.md:16` still says `a "Clear search" CTA`** — the only place the note-E rename
under-matched. design.md D3, tasks 5.2/6.1 and the existing controls' accessible names all say
"Clear filter". One word.

**N2. `openspec/specs/datasource-ux-empty-states/spec.md:17` governs this exact surface and is already
false** — "`TypeRegistryBrowser` SHALL render an empty state containing … a CTA note directing the
user to **add a data source**", with a scenario asserting guidance "directing the user to add a data
source". Today's code already directs to pipelines ("Types are created by pipelines…"), so the
falsehood predates this change and I am not treating it as a missing delta. But this change
deliberately re-specifies that surface, and after archiving, `empty-state-cta-pattern` ("points at the
producing step") and `datasource-ux-empty-states` ("add a data source") will contradict each other on
one component. A three-line `## MODIFIED Requirements` block would retire it cleanly; a sentence in
Non-Goals naming it as knowingly-stale would also do.

**N3. `workspace-create-actions` is written broader than the change delivers.** "Consumers SHALL
obtain a create action from its feature's hook rather than re-deriving the flow by dispatching thunks
or toggling modal state themselves" — after this change `SidebarBody.tsx:131` and `:163` still
dispatch `setAddSourceModalOpen`/`setCreatePipelineModalOpen` inline, and for the source one that is
*correct*: task 4.5 forbids the set-flag-nothing-mounted path that wiring the hook there would create.
Consider scoping the sentence to surfaces where the flow is mounted, so a later reader does not treat
the sidebar as a violation of an archived requirement.

**N4. D8's enumeration doesn't name the `faPlus` CTA icons *inside* the in-scope `EmptyState`s**
(`DashboardList.tsx:289`, `PipelineEmptyState.tsx:22`, `SourcesPage.tsx:110`, `PanelList.tsx:396/415`).
Task 7.1's general clause ("empty-state icons on the five enumerated sections") plainly covers them
and nobody would convert a hero glyph while leaving its own CTA glyph FontAwesome — flagging it only
so the final gate's FontAwesome-residue grep expects them gone.

**N5. Copy strings remain unpinned by design** (registry CTA label, the three filter-empty
titles/descriptions, the error title). The shape constraints are specific enough for a design gate;
requester rules 3, 4 and 7 are wholly deferred to the final gate and will be judged there on reading
and side by side, not on token compliance.
