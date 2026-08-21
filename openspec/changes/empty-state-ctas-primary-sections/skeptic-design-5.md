## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Cold spawn. Read from the tree at `2eaf1d26` (worktree HEAD; planning artifacts still untracked —
`git status --short` shows only `?? openspec/changes/empty-state-ctas-primary-sections/`). No browser
(three parallel runs share the Playwright session; nothing at this gate needs one). `DESIGN.md` read,
not edited. I read rounds 1–4 first, then re-derived every load-bearing claim from the files myself;
nothing below is taken from a prior report or from the round-5 brief's summary on trust.

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

### HEADLINE: no round-4 survivors. Both CRs and all four notes are genuinely resolved. **CONFIRM.**

---

### 1. Round 4's two change requests — verified resolved against the artifacts and the tree

**CR1 — the hook contract hole. RESOLVED, in the uniform form of option (a), and the resolution is
internally consistent across all four artifacts.**

- `design.md` D5 (`:178-220`) now states the single shape
  `{ cta: EmptyStateCta; error: string | null; isPending: boolean }` for **all four** hooks, and
  explains *why* it is not a bare `EmptyStateCta` from the code facts rather than by assertion. I
  re-checked each of those facts: `EmptyStateCta` really is `{label, onClick, icon?, disabled?}`
  (`EmptyState.tsx:7-19`) with nothing for an error; `createDashboard.rejected` really has **no** case
  in `dashboardsSlice` (I grepped the whole `extraReducers` block — only `.fulfilled`), so the payload
  genuinely exists only where `.unwrap()` throws; and the three flag-flip actions really cannot fail
  (`setAddSourceModalOpen` / `setCreatePipelineModalOpen` / the lifted `setPanelCreationModalOpen` are
  pure visibility flags whose modals own their own submission). "Whoever owns the `onClick` owns the
  error" is therefore a fact about this code, not a preference.
- Both rejected alternatives are recorded with their consequence (`design.md:206-211`): swallowing
  leaves D6's branch dead **after** 3.6 removes the toast (silent failure), and the `onError` callback
  variant pushes error handling back onto every future consumer.
- The four tasks now agree, which is what CR1 actually demanded:
  - **3.2** moves `handleCreateDashboard` **into** `useCreateDashboardAction()` (hook owns the
    `useState` pair, the `.unwrap()`, the `catch (err)` binding) and says to do it together with 4.3.
  - **3.3** reads `error`/`isPending` **from the hook**.
  - **4.3** repeats the uniform shape and the explicit "do NOT return a bare `EmptyStateCta` and drop
    the rejection", plus the `DashboardList`-is-a-different-flow fence.
  - **4.6** now states `handleCreateDashboard` is *not* orphaned (3.2 moved it) and that
    `DashboardList`'s CTA is *not* rewired. The collision CR1 named is gone: there is no longer a
    reading under which 3.2 and 4.6 both apply and contradict.
  - **3.5** requires `PanelList`'s error test to be driven through the **rewired** CTA (the hook's
    `cta.onClick`) — so resolution (i) (a swallowing hook) cannot pass green. This is the part that
    makes the fix testable rather than merely documented.
- The spec no longer over-claims: `workspace-create-actions:6-10` describes the **descriptor field**
  and says a consumer can pass **that field** directly, so the archived contract matches what ships.
  The new paragraph (`:16-18`) and scenario (`:30-33`) make surfacing an owned failure a requirement
  in its own right, tied back to the toast-ordering rule.

I checked the runtime consequence rather than only the prose: today `PanelList.tsx:395` swaps the CTA
label to `"Creating..."` from `isCreatingDashboard`, and `EmptyStateCta.disabled`/`label` are the only
in-flight affordances the primitive has (`EmptyState.tsx:13-18` — the doc comment there explicitly says
the caller supplies the in-flight label). A hook that owns `isPending` can produce both inside the
descriptor, so "behavior must be identical" (4.6) is achievable with no adapter at the call site.

**CR2 — D8's stale counts. RESOLVED.** `grep -n "exactly four sibling\|five \`emptyIcon\|two hero
icons\|between views" design.md` returns nothing (exit 1). `design.md:321-324` now reads "…plus the
following — **the list is the fence; do not read a count into it**", and `:332` is "Plus these hero
icons inside the in-scope ladders:". The list itself is unchanged and still matches tasks 7.1 / 7.2a /
7.2b / 7.2c one-for-one, which I re-verified against `SidebarBody.tsx` (`:129` Data Sources /
`:161` Data Pipelines / `:198` Metrics / `:240` Data Types / `:326` Assistant — three in, two out) and
against `DataTypeSelectStep.tsx` (no-data `EmptyState` icon `faLayerGroup` at `:178-179`; error branch's
FontAwesome `faArrowRotateRight` Retry beside a lucide `InlineError` at `:165-173`; filter-clear
`faXmark` at `:216`; the bare `<p className="panel-creation-modal__datatype-no-match">` at `:221`).

### 2. Round 4's four notes

| Note | Landed? | Evidence |
| --- | --- | --- |
| **N1** "Clear search" in `proposal.md` | Yes | `grep -rn "Clear search"` across the change dir now hits **only** the four historical skeptic reports; `proposal.md` says `a "Clear filter" CTA`. That matches the existing accessible names I read in all three surfaces: `DashboardList.tsx:220-221`, `SidebarItemList.tsx:287-288`, `DataTypeSelectStep.tsx:213`. |
| **N2** false `datasource-ux-empty-states` requirement | Yes, and mechanically correct | The new `## MODIFIED Requirements` block's header — "### Requirement: TypeRegistryBrowser renders a meaningful empty state" — matches the existing spec's header at `openspec/specs/datasource-ux-empty-states/spec.md:17` **exactly**, so archiving replaces the right requirement rather than appending a duplicate. The old requirement has exactly one scenario ("Empty state shows guidance message"); the delta keeps that scenario name and corrects its `THEN`, and adds two. It also records *why* the old text was retired. The sibling `DataSourceList` requirement is untouched, as it should be. |
| **N3** over-broad "consumers SHALL obtain…" | Yes | `workspace-create-actions:20-23` is now scoped to "a surface that renders an empty state for a section", with an explicit carve-out for a navigation surface dispatching directly — which is exactly `SidebarBody.tsx:131/163`, whose direct dispatch task 4.5 deliberately preserves. (One residual wording risk, non-blocking — note **A** below.) |
| **N4** CTA glyphs inside the in-scope `EmptyState`s | Covered | Task 7.1's clause "the empty-state icons on the five enumerated sections" plainly covers the `faPlus` CTA glyphs at `DashboardList.tsx:289`, `PipelineEmptyState.tsx:22`, `SourcesPage.tsx:110`, `PanelList.tsx:396/415`. Flagged for the final gate's FontAwesome-residue grep, not for the plan. |

### 3. Independent re-derivation of the mechanics (my own reads, this session)

- **D1/D2's seam is real.** `panelsSlice.ts:31-40` is `PanelsState`; `markDashboardPanelsStale`
  (`:84-88`) is guarded by `if (state.loadedDashboardId !== action.payload) return;` and sets
  `loadedDashboardId = null` / `status = "idle"`; `fetchPanels.pending` (`:101-105`) sets
  `loading` + `loadedDashboardId = action.meta.arg`. Tasks 1.2/1.3 hang the new field on exactly those
  two sites.
- **`fetchPanels`' `condition` never blocks from the invalidated state.** `panelThunks.ts:73-83`
  returns `false` only for `loading`/`succeeded` **with a matching `loadedDashboardId`**; invalidation
  always leaves `loadedDashboardId === null`. D2's unstated premise holds, and task 1.6 locks it.
- **`deletePanel` really is the sole producer of the terminal state.** `panelThunks.ts:127-139`
  dispatches `markDashboardPanelsStale` and returns; `createPanel` (`:106-108`) and `duplicatePanel`
  (`:148-150`) both `await dispatch(fetchPanels(...))` on the next line. `deletePanel.fulfilled`
  (`panelsSlice.ts:130-132`) filters `items`, so `items.length === 0` in that state. `App.tsx:118-129`
  is keyed `[dispatch, selectedDashboardId]` and never refires.
- **Task 2.3's added conjunct breaks nothing, and task 2.4's fixture edit is load-bearing.** I read the
  D11 mirror test (`PanelList.test.tsx:570-583`): its fixture is
  `panels: { items: [], loadedDashboardId: null, status: "idle" }` with a dashboard selected. Under the
  *new* skeleton gate and **without** the `staleDashboardId` the task tells the executor to add, this
  test's **kept** `.ui-skeleton` absence assertion would fail. Task 2.4 states that fixture edit
  explicitly. The neighbouring `CR3 bootstrap window` test (`:562-569`) has `selectedDashboardId: null`
  and is unaffected.
- **D6's chain delivers a real message end to end.** `createDashboard`'s catch is bare
  (`dashboardsSlice.ts:66-76`); `dashboardService.createDashboard:24-29` is a bare `httpClient.post`;
  `httpClient`'s only response interceptor re-rejects the original error
  (`httpClient.ts:27-46`, `return Promise.reject(error)`), so a genuine `AxiosError` reaches the thunk
  and `extractErrorMessage` (`services/extractErrorMessage.ts:17-24`) can read `data.error`/`data.message`.
  Task 3.1 is the only place the fix works, as D6 says.
- **D6a is executable and its icon choice is right.** `InlineError.tsx:62` defaults `announced = true`
  and `:72-73` renders `role="alert"` + `ERROR_KIND_ICON[kind]` in the banner variant;
  `ERROR_KIND_ICON.error` is **`TriangleAlert`** (`InlineError.tsx:16-20`), which is exactly what task
  3.3 specifies for `PanelList`'s error hero — so the absorbed HEL-770 surface will match the five
  HEL-539 siblings I read on the pages themselves (`SourcesPage.tsx:61-82`, `PipelinesPage.tsx:42-64`,
  `TypeRegistryPage.tsx:35-50` all render `intent="error"` `EmptyState`s with lucide `ERROR_KIND_ICON`
  glyphs and "Couldn't load …" titles). D8's premise that each page is already mixed against itself is
  therefore true, and the plan's neutral→lucide conversion is the half that resolves it.
- **`EmptyState` really carries the treatments the plan leans on.** `EmptyState.tsx:83-90`:
  `role={intent === "error" ? "alert" : undefined}` and `aria-label={intent === "error" ? undefined : title}`
  — so the conditional error branch announces and the neutral one does not, and existing tests that use
  `getByLabelText("No panels yet")` keep working.
- **Every spec delta is mechanically well-formed.** Both `empty-state-cta-pattern` and
  `workspace-create-actions` are genuinely new capability directories (neither exists under
  `openspec/specs/`). Every `## ADDED Requirements` header is new against its target spec's existing
  headers, which I enumerated for all six touched specs — no ADDED-that-should-be-MODIFIED. Both
  MODIFIED headers match an existing requirement verbatim (`frontend-panel-empty-state:3`,
  `loading-state-pattern:238`), and each preserves **all** of the original scenarios (3 and 4
  respectively) before adding its own. The `loading-state-pattern` delta correctly retires the exact
  paragraph that says the panel list's missing empty state "is NOT closed by this capability" — which
  is the sentence this change makes false.
- **`toast-emission-integrity`'s existing requirements survive.** I read all four
  (`:6/:23/:32/:53`); none names `createDashboard`, so the ADDED requirement contradicts nothing, and
  `A failure that no surface reports SHALL emit an error toast` stays satisfied because both surfaces
  will report inline.
- **The 44px floor claim is true at the CSS level and the plan measures rather than reads it.**
  `EmptyState.css` is 228 lines; the `@media (max-width: 768px)` block opens at `:219` and sets
  `min-height: 44px` (`:226`) on the **base** `.ui-empty-state__cta` / `__secondary-cta` selectors, as
  the last block in the file. Tasks 8.5–8.7 use `getBoundingClientRect().height`, prove the probe
  discriminates at ~28px (`--control-sm`), and correctly exclude the sidebar surfaces (`.app-sidebar`
  is `display:none` ≤768px) while including `DataTypeSelectStep`'s modal, which does render at 430.
  Task 7.5 forbids new CSS above that block — the exact source-order trap that made the floor inert in
  HEL-535's cycle 1.
- **Task 1.4a's file list is right where it matters.** `PatchSetReviewPage.test.tsx:313-323` builds
  `preloadedPanelsState()` and passes it to a `configureStore` whose `preloadedState` is **not** cast,
  and `panelsSlice.test.ts:463-476` is inline with its `@ts-expect-error` on the *dispatch* line — both
  become hard type errors under ts-jest. `usePanelData.test.ts:24-35` casts `as never` and is
  unaffected, which is what the task says to verify. (Two refinements in notes **B**/**C**.)
- **The ticket's ACs all trace to tasks.** Section coverage: Dashboards → `PanelList.tsx:386-399`
  (main variant by default) + 4.6; Data Sources → `SourcesPage.tsx:103-114`; Pipelines →
  `PipelineEmptyState.tsx:14-26`; Type Registry → task 5.1 (`TypeRegistryBrowser.tsx:45-52`, already
  `variant="main"`, CTA added) + 5.3 (sidebar `emptyCta`); panel area → 2.3. Filter-empty: I checked
  that `SourcesPage`, `PipelinesPage` and `TypeRegistryPage` have **no** page-level filter input, so
  the three surfaces tasks 6.1–6.3 name (`DashboardList`, `SidebarItemList`, `DataTypeSelectStep`) are
  the complete set for the enumerated sections. Absorbed HEL-770 → 3.1–3.7. Inherited HEL-528 D11 →
  2.1–2.6 + 8.10. HEL-554 seam → D5/D5a/D5b + 4.1–4.7.
- **Ports match.** Task 8.1's 5980 / 8887 are `workflow-state.md`'s `DEV_PORT` / `BACKEND_PORT`.

---

### Verdict: CONFIRM

Four rounds have extracted the substantive defects; round 4's two CRs are resolved in the artifacts
*and* consistent with the tree, and I found nothing this round that would produce wrong runtime
behavior, a false archived spec, or a literally unexecutable task. The plan is honest about what it
delivers (the two-flows-per-section reality, the page-mount asymmetry, the accepted rare state, the
accepted Metrics/Assistant residue, the deferred copy) and it is testable in the places where a wrong
implementation would otherwise pass green. Ship it to the executor.

---

### Non-blocking notes

**A. `workspace-create-actions:20-21` is still very slightly broader than the change delivers — one
clause would close it.** "A surface that renders an empty state for a section SHALL obtain that
section's create action from its feature's hook rather than re-deriving the flow itself." `DashboardList`
renders an empty state for the Dashboards section (`:282-292`) whose CTA sets `isCreateMode` and is
deliberately **not** rewired (tasks 4.3/4.6). The carve-out sentence covers a *navigation* surface
(`SidebarBody`), not this one. I am not treating it as blocking, for two reasons I checked rather than
assumed: (i) the requirement's own scenario is conditioned on "a section's empty state **needs its
create action**", and `empty-state-cta-pattern`'s NOTE (`:30-32`) explicitly blesses two different
create flows on two surfaces of one section, so a coherent non-contradictory reading exists; (ii) the
executor-facing risk — rewiring `DashboardList` onto the hook and deleting its name-entry step — is
already forbidden twice, in 4.3 and again in 4.6. A half-sentence naming the sidebar's named-create
form as a knowingly-unhooked surface would remove the ambiguity for a 2027 reader.

**B. Task 1.4's justification for `renderWithStore.tsx` is inaccurate; the instruction is still
correct.** `test/renderWithStore.tsx:267-268` passes **both** `reducer as never` and
`preloadedState as never` to `configureStore`, so omitting a `PanelsState` field there is **not** a
compile error — it is a silent `undefined` at runtime. The task's action is still required (tasks
2.4/2.5/4.7 cannot preload `staleDashboardId` / `panelCreationModalOpen` without it) and a forgotten
constructed-slice edit would still fail loudly in 2.4's assertion, so nothing is at risk — but the
executor should not expect `tsc` to catch a partial job in that one file. The genuinely type-checked
files are the two named in 1.4a.

**C. A fifth file enumerates the panels slice shape:** `shared/chrome/SaveStateIndicator.test.tsx:28-37`
(`items` / `loadedDashboardId` / `status` / `error` / `pendingPanelUpdates` / `lastSavedAt`). It casts
`as never` on both `reducer` and `preloadedState`, so it neither breaks nor needs editing —
`SaveStateIndicator` reads neither new field. Mentioned only so the executor's own sweep doesn't stop
at 1.4a's three files and conclude something is missing.

**D. Line-citation drift, cosmetic.** The `@media (max-width: 768px)` floor block opens at
`EmptyState.css:219`, not `:218` as D7 and task 7.5 say (the rule itself is `:226`); the change dir's
`.openspec.yaml` says `created: 2026-08-21` while every artifact reads the tree at `2eaf1d26`. Neither
affects execution.

**E. Copy strings remain unpinned by design** — the registry CTA label, the three filter-empty
titles/descriptions, and the error title ("Couldn't create dashboard" is specified; the rest are
shape-constrained only). That is acceptable at a design gate and is where the requester's rules 3, 4
and 7 land: the final gate must judge the registry copy for a dead create-type path, the filter-empty
copy for genuine distinctness from no-data-yet, and all five sections **side by side** in both themes —
on reading and on screenshots, not on token compliance.

**F. For the final gate, the two claims most worth re-measuring rather than re-reading:** the 44px
floor on `DataTypeSelectStep`'s modal CTA at 430px (the only sidebar-variant CTA that renders below the
breakpoint, and therefore the only one where the base-selector floor is load-bearing), and the
skeleton→empty-state swap on the panel area (task 8.10), since HEL-528's headline no-layout-shift
criterion has already failed once after an evaluator passed it.
