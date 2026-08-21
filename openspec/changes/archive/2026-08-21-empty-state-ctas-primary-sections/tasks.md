# Tasks — HEL-548 Empty-state CTAs across primary sections

Fences, before anything else: **do not edit** `DESIGN.md` (HEL-774), `.app-shell`/`.app-command-bar` in
`App.css`, `App.css:424`, `index.html` meta tags, `theme.css`'s `--app-safe-top`, `BottomNav.*` (HEL-772 /
HEL-774), or `MobileNavSheet.tsx` (fenced in design.md's Non-Goals). Never touch another worktree.
`lucide-react` is the icon library; no `concertino sync`.

## 1. The `staleDashboardId` discriminator (D1)

- [x] 1.1 Add `staleDashboardId: string | null` to `panelsSlice`'s state interface and initial state
      (`frontend/src/features/panels/state/panelsSlice.ts:34/45` area). Do **not** widen the `status`
      union — D1 rejects that explicitly
- [x] 1.2 In the `markDashboardPanelsStale` reducer (`:85-89`), set `state.staleDashboardId = action.payload`
      alongside the existing `loadedDashboardId = null` / `status = "idle"`, inside the existing
      `if (state.loadedDashboardId !== action.payload) return;` guard
- [x] 1.3 Clear it (`state.staleDashboardId = null`) in `fetchPanels.pending` (`:102-106`)
- [x] 1.4 **Thread BOTH new `PanelsState` fields through `frontend/src/test/renderWithStore.tsx`** — its
      `preloadedState.panels` type (`:59-71`) and its constructed slice object (`:189-206`) enumerate the
      panels fields explicitly, and tasks 2.4/2.5/4.7 cannot preload them until this is done. Thread
      `staleDashboardId` (default `?? null`) **and** task 4.2's panel-creation-modal flag (default
      `?? false`) — this change adds two fields, not one.
      **Do not expect `tsc` to catch a partial job here**: `:267-268` passes both `reducer as never` and
      `preloadedState as never` to `configureStore`, so an omitted field is a silent `undefined` at
      runtime, not a compile error. (It would still fail loudly in 2.4's assertion.) The genuinely
      type-checked files are the two in 1.4a
- [x] 1.4a **Three more files enumerate `PanelsState` field-by-field and become hard type errors** (ts-jest
      runs with diagnostics on, so these fail `npm test`, not silently): update
      `features/patchSets/ui/PatchSetReviewPage.test.tsx:313-323` (`preloadedPanelsState()`, no cast) and
      `features/panels/state/panelsSlice.test.ts:463-476` (inline). `features/panels/hooks/usePanelData.test.ts:24-35`
      casts `as never` and is unaffected — verify rather than assume
- [x] 1.5 Slice tests: after `markDashboardPanelsStale(id)` for the loaded dashboard, `staleDashboardId === id`,
      `status === "idle"`, `loadedDashboardId === null`; after a subsequent `fetchPanels.pending`,
      `staleDashboardId === null`; dispatching for a *different* dashboard id leaves all three untouched
- [x] 1.6 **Lock D2's unstated premise** (design.md D2): assert `fetchPanels`' `condition`
      (`panelThunks.ts:72-83`) does **not** skip the dispatch from the invalidated state — i.e. from
      `status: "idle"`, `loadedDashboardId: null`, a `fetchPanels` dispatch really does emit `pending`.
      Without this, a future edit to `condition` silently parks a permanent skeleton — the exact failure
      HEL-528 wrote D11 to prevent
- [x] 1.7 Confirm by tracing (and note in the commit) that `createPanel`/`duplicatePanel`/`patchSetsSlice`
      each refetch immediately, so `deletePanel` is the only path that leaves the stale state standing

## 2. Close the panel area's terminal blank and its pre-dispatch frame (D2)

- [x] 2.1 **Reproduce first, on the unfixed build.** With the dev servers up, delete a dashboard's last
      panel in the browser and capture evidence that the panel area renders nothing — e.g. the content
      region's `childElementCount`/`getBoundingClientRect()` and the absence of both `.ui-empty-state` and
      `.ui-skeleton`. A fix verified only against the fixed build proves nothing
- [x] 2.2 Widen `showPanelGridSkeleton` (`PanelList.tsx:85-88`) to
      `selectedDashboardId !== null && (status === "loading" || (status === "idle" && staleDashboardId !== selectedDashboardId)) && (items.length === 0 || items[0].dashboardId !== selectedDashboardId)`.
      Comment it with D2's reason and why this is not the widening HEL-528 task 2.4b forbade.
      **Also replace the now-false comment at `PanelList.tsx:75-84`**, which states that widening to `idle`
      "would park a permanent skeleton over either state" — precisely the claim D1's discriminator refutes.
      Leaving it would put a contradiction directly above the code
- [x] 2.3 Change the "No panels yet" gate (`PanelList.tsx:408`) to
      `selectedDashboardId !== null && items.length === 0 && (status === "succeeded" || staleDashboardId === selectedDashboardId)`.
      Note the added `selectedDashboardId !== null` — today the CTA is conditionally `undefined` for that
      case; hoisting it into the gate keeps a CTA-less hero from rendering in a state the branch above
      already covers. Verify no reachable state loses its empty state as a result
- [x] 2.4 **Invert HEL-528's locking test, do not delete it** (D2a). `PanelList.test.tsx:570` currently
      asserts `queryByText("No panels yet")).not.toBeInTheDocument()` at the terminal state (now with
      `staleDashboardId` set to the selected dashboard). Rename it, assert the empty state and its
      "Add panel" CTA **do** render, and **keep** the sibling `.ui-skeleton` absence assertion unchanged.
      Comment that HEL-528 task 6.5c-ii assigned this closure to HEL-548 by name
- [x] 2.5 Add a test for the pre-dispatch frame: dashboard selected, `status: "idle"`, `items: []`,
      `staleDashboardId: null` → skeleton renders, "No panels yet" does not
- [x] 2.6 Confirm HEL-528's other `PanelList` loading tests still pass untouched — in particular the
      zero-dashboards case (`selectedDashboardId === null`, bootstrap skeleton) and D12's dashboard-switch
      test. If any needs changing, that is a signal the gate is wrong, not that the test is

## 3. HEL-770 — a real message, two conforming surfaces, then the toast (D6, D6a)

- [x] 3.1 **Fix at the source.** `createDashboard` (`dashboardsSlice.ts:66-76`, `catch` at `:73`) is
      `catch { return rejectWithValue("Failed to create dashboard."); }` — the payload is *always* that
      fixed string. Change to `catch (err)` and
      `rejectWithValue(extractErrorMessage(err, "Failed to create dashboard."))` using
      `services/extractErrorMessage.ts`. Without this, every downstream "specific message" claim is a no-op
      (`unwrap()` throws the payload as a plain `string`, and `extractErrorMessage` only reads an
      `AxiosError`, so extracting at the component returns the fallback)
- [x] 3.2 Move `PanelList.tsx:173-183`'s `handleCreateDashboard` **into `useCreateDashboardAction()`**
      (task 4.3): the hook owns the `isPending`/`error` `useState` pair, the `.unwrap()`, and `catch (err)`
      binding the thunk's payload (no re-extraction). `PanelList` stops holding `isCreatingDashboard` /
      `createDashboardError` itself and reads `error`/`isPending` from the hook. Do this together with 4.3
      — splitting them orphans the handler (D5)
- [x] 3.3 Make `PanelList`'s dashboards-empty branch (`:388-399`) render conditionally: when the hook's
      `error` is non-null → `intent="error"`, error **title** ("Couldn't create dashboard"), error **icon**
      (`TriangleAlert`, matching HEL-539's five siblings), description = that message. When null → today's
      neutral hero, unchanged, no `role="alert"`. The CTA's in-flight label comes from the hook's
      `isPending`
- [x] 3.4 **Bring `DashboardList`'s create failure to the same bar** (D6a). `DashboardList.tsx:263` renders
      `<InlineError error={createError} />` at the default `variant="text"` — a bare `<p>` with **no role
      and no icon** (`InlineError.tsx:58/99`) — and `:62` hardcodes its own generic string. Pass
      `variant="banner"` (which supplies `role="alert"` + the lucide error icon, `InlineError.tsx:67-73`)
      and bind the thunk's payload instead of the hardcoded string.
      **Note `createError` has three producers** — the create catch (`:62`), the import failure (`:160`)
      and the file-read failure (`:168`). The payload binding applies to the **create catch only**; do not
      restructure `createError` in a way that clobbers the other two messages. The `variant="banner"`
      upgrade correctly improves all three
- [x] 3.5 Tests, both surfaces: a failed create renders an announced (`role="alert"`), error-intent report
      carrying the **specific** message from the thunk (assert a non-generic message, so a regression to
      the fixed string fails the test); the no-failure case on `PanelList` renders neutral with no alert
      role. **Drive `PanelList`'s test through the rewired CTA** (the hook's `cta.onClick`), not a
      leftover local handler — otherwise a hook that swallows the rejection still passes green
- [x] 3.6 **Only after 3.3 and 3.4 are both green**, remove
      `error(createDashboard.rejected, "Failed to create dashboard.")` from `ERROR_TOASTS`
      (`toastListeners.ts:151`). Removing it before either surface conforms converts a redundant report
      into a silent one
- [x] 3.6a **Update HEL-535's regression guard deliberately, and comment why.**
      `frontend/src/features/toasts/state/toastListeners.test.ts:85-95`, inside the describe block
      *"toastListeners — regression guard (every pre-existing entry still fires, HEL-535 D7/3.7)"*, asserts
      `createDashboard.rejected` still toasts `"Failed to create dashboard."`. Task 3.6 makes that
      assertion fail **by design**. Remove that one entry with a comment naming HEL-548/HEL-770 as the
      owner and pointing at the two now-conforming inline surfaces — exactly the treatment 2.4 gives
      HEL-528's D11 test. **Do NOT** resolve the red suite the other way (leaving the toast in place),
      which would silently fail the absorbed HEL-770 criterion while looking green
- [x] 3.7 **Reproduce first**: prove a toast *does* fire today on `createDashboard.rejected`, then prove it
      does not after 3.6, and that each surface still reports exactly once

## 4. The create-action seam (D5, D5a, D5b)

- [x] 4.1 Export `EmptyStateCta` from `shared/ui/EmptyState.tsx:7` (declared without `export` today). Type-only
      change; the primitive's rendering and props are untouched
- [x] 4.2 Lift `PanelCreationModal`'s open flag out of `PanelList`'s local `useState` into `panelsSlice`,
      mirroring `setAddSourceModalOpen` / `setCreatePipelineModalOpen` / `setCreateMetricModalOpen`. Update
      `PanelList.tsx:277`, `:415` and the modal render at `:322`. **Do not weaken** the dashboard-selected
      precondition, and **do not move where the modal is mounted**
- [x] 4.2a **Reset the flag on unmount** (D5a). A slice flag outlives `PanelList`, which `useState` did not.
      Reachable defect: open the modal → `Cmd/Ctrl+K` (`App.tsx:108-117`'s listener is not gated on any
      open modal) → navigate away → `PanelList` unmounts with the flag `true` → returning to `/` opens the
      creation modal unbidden; browser Back does the same. Use a **stable-dependency** cleanup —
      `useEffect(() => () => { dispatch(setPanelCreationModalOpen(false)); }, [dispatch])`. A changing
      dependency would fire the cleanup on every change and close a legitimately-open modal. Comment that
      StrictMode's dev double-invoke fires this cleanup once at mount (harmless — the flag starts `false`)
      so nobody later "fixes" it by deleting the reset
- [x] 4.2b Test it: with the flag preset `true`, mounting → unmounting → remounting `PanelList` does not
      render `PanelCreationModal`. **Reproduce first** in the browser (open modal, `Cmd+K` away, return)
      to prove the probe detects the defect before the reset is added
- [x] 4.3 Add one hook per feature, each returning the **uniform shape**
      `{ cta: EmptyStateCta; error: string | null; isPending: boolean }` (D5):
      `useCreateDashboardAction()`, `useAddSourceAction()`, `useCreatePipelineAction()`,
      `useCreatePanelAction()`. The three flag-flip hooks return `error: null, isPending: false` — true of
      those actions, since the modal owns its own submission. `useCreateDashboardAction()` is the one that
      really owns outcome state (task 3.2). **Do not** return a bare `EmptyStateCta` from it and drop the
      rejection: that leaves task 3.3's error branch dead, and with the toast removed by 3.6 a failed
      create would report nothing at all.
      **`useCreateDashboardAction()` encodes `PanelList`'s immediate quick-create**
      (`createDashboard({name: "Untitled dashboard"})`). `DashboardList.tsx:281-296`'s CTA is a
      *different* flow — it sets `isCreateMode` to reveal a **named**-create form — and is deliberately
      **untouched**. Do not collapse the two: rewiring `DashboardList`'s CTA onto this hook would silently
      delete its name-entry step
- [x] 4.4 `useCreatePipelineAction()` **dispatches `setCreatePipelineModalOpen(true)` only — no navigation.**
      `CreatePipelineModal` is mounted at the shell (`frontend/src/app/App.tsx:208`, comment F-045) for
      every route except `/pipelines`, so it opens in place on `/registry`. Verify in the browser from
      `/registry`, not only in a test
- [x] 4.5 Wire each CTA **only where its flow is mounted** (D4b): `useAddSourceAction` on `SourcesPage`,
      `useCreatePanelAction` in `PanelList`, `useCreatePipelineAction` anywhere (shell-mounted). Introduce
      no set-flag-with-nothing-mounted path
- [x] 4.6 Rewire the existing conforming CTAs to consume their hook (`SourcesPage.tsx:103`,
      `PipelineEmptyState`/`PipelinesPage.tsx:69`, and `PanelList`'s two — the dashboards hero at `:388`
      and the panels hero at `:409`) so there is one flow per action. Behavior must be identical — this is
      a refactor, not a redesign. `handleCreateDashboard` is **not** left behind: task 3.2 moves it into
      `useCreateDashboardAction()`, and `PanelList` renders from the hook's `cta`/`error`/`isPending`.
      `DashboardList`'s CTA is **not** rewired (task 4.3)
- [x] 4.7 Test each hook: invoking the descriptor's `onClick` opens the **flow that hook encodes** (per 4.3
      — for dashboards that is `PanelList`'s quick-create, not `DashboardList`'s naming form); the panel
      action stays unavailable with no dashboard selected

## 5. Type Registry CTAs (D4, D4a)

- [x] 5.1 `TypeRegistryBrowser.tsx:46` — add `cta` from `useCreatePipelineAction()`, labelled to name the
      pipeline it creates. Keep the existing teaching sentence about types coming from pipelines. Do **not**
      offer any create-type path
- [x] 5.2 Add `emptyCta?: EmptyStateCta` to `SidebarItemList`, consumed **only by `renderEmpty()`'s no-data
      branch** — *not* its filtered branch (`:229-230`), which takes "Clear filter" per §6 and per
      `empty-state-cta-pattern`'s "the filtered state SHALL NOT offer the section's create action". Fall
      back to `onAdd` when `emptyCta` is absent so the four existing call sites are unchanged
- [x] 5.3 Wire `emptyCta` on `SidebarBody.tsx:228`'s Data Types section only. Verify no "+" appears in that
      section's header — that is the whole reason `emptyCta` exists rather than `onAdd` (D4a)
- [x] 5.4 Tests: registry main-content and sidebar empty states each render a CTA that opens the pipeline
      create flow; the Data Types sidebar header renders no add button

## 6. Filter-empty as a distinct state (D3)

- [x] 6.1 `DashboardList.tsx:280` — replace `<p className="dashboard-list__status">No matches</p>` with
      `EmptyState variant="sidebar"`, `SearchX` icon, a title distinct from "No dashboards yet", a
      description quoting the query, and a "Clear filter" `cta` wired to the existing clear handler. No
      create-dashboard CTA in this branch
- [x] 6.2 `SidebarItemList.tsx:229` (`renderEmpty()`'s filtered branch) — same treatment, generic over
      `heading` so all five sections read consistently
- [x] 6.3 `DataTypeSelectStep.tsx:221` — same treatment, `variant="sidebar"` to match its no-data sibling at
      `:178`, `cta` wired to the existing `setFilterQuery("")` clear control. Its copy already quotes the
      query; keep that and gain the primitive + CTA
- [x] 6.4 Tests: for each of the three, a query matching nothing renders the filtered empty state naming the
      query; activating its clear CTA restores the list; the no-data state still renders its own copy and
      create CTA with no query active. `DashboardList`'s branch has **no test today** — add one
- [x] 6.5 Note `DashboardList` pins the active dashboard outside the filter (`:176-183`), so reaching a true
      zero-row state requires no selected dashboard (or a selected id absent from `items`). Set the fixture
      up accordingly rather than asserting an unreachable state
- [x] 6.6 **Reproduce first** on the unfixed build for at least one of the three: capture that today's
      branch renders a bare `<p>` with no `.ui-empty-state` and no clear affordance

## 7. Icons and tokens (D8, D7)

- [x] 7.1 Convert to `lucide-react` the empty-state icons on the five enumerated sections, **plus exactly
      these four sibling controls**, each performing the same action as a converted CTA in the same view
      (D8): `PanelList.tsx:281` header add-panel `faPlus`; `DashboardList.tsx:224` filter-clear `faXmark`;
      `SidebarItemList.tsx:290` filter-clear `faXmark` (shared by all five sidebar sections);
      `DataTypeSelectStep.tsx:216` filter-clear `faXmark`
- [x] 7.1a **Do NOT convert the section-header "+" controls.** `DashboardList.tsx:190-198` and all five
      `SidebarItemList` headers (`:259-269`) render `<IconButton icon="+" />` — a literal `"+"`
      **character**, not a FontAwesome icon. Converting one would make that header differ from the other
      five. All six stay as they are (D8)
- [x] 7.2 **First widen the prop type**: `SidebarItemList.tsx:41-42` declares `emptyIcon?: IconDefinition`
      with no `| ReactNode`, so passing a lucide element is a type error at all five call sites. Widen to
      `IconDefinition | ReactNode` and update the doc comment. `renderEmpty()`'s `emptyIcon !== undefined`
      guard (`:231`) still selects correctly, since `EmptyState.renderIcon` dispatches on `isValidElement`
      (`EmptyState.tsx:44-49`). This is the **second** prop-surface change to a shared component, alongside
      D4a's `emptyCta` — keep `proposal.md`'s Impact line true
- [x] 7.2a Then convert **only the three in-scope** `emptyIcon` values `SidebarBody` passes: `:129` Data
      Sources, `:161` Data Pipelines, `:240` Data Types
- [x] 7.2b **Do NOT convert Metrics (`SidebarBody.tsx:198`) or Assistant (`:326`)** (D8). `SidebarBody`
      renders one section at a time by route, and on `/metrics` with zero metrics the sidebar's
      `faGaugeHigh` / "Define your first metric" sits beside `MetricEmptyState.tsx:13-14`'s **identical
      glyph and identical title** on the page; `/chat` has the same pair on `faComments` /
      "No conversations yet". Converting one half of a duplicated pair manufactures the "same thing, two
      glyphs, one screen" defect this fence exists to remove. Their page halves are out of scope (HEL-443)
- [x] 7.2c Convert `DataTypeSelectStep.tsx:178`'s no-data `EmptyState` icon (`faLayerGroup`) — task 6.3
      gives that same view a lucide filtered hero, and the file's error branch already pairs a lucide
      `InlineError` with a FontAwesome `faArrowRotateRight` Retry (`:172`), so leaving it puts a **third**
      icon system in one file
- [x] 7.3 Leave every other `EmptyState` call site on FontAwesome — HEL-443 owns the app-wide migration
- [x] 7.4 Grep the diff for hardcoded colors, spacing, radii and font sizes. Zero literals introduced —
      HEL-652/680/677 exist because past work leaked them
- [x] 7.5 If any new CSS is added, it goes **after** the existing `@media (max-width: 768px)` floor block
      (`EmptyState.css:219-228`) or is added to that block's selector list. Never above it — that
      source-order trap is exactly how the 44px floor went inert before

## 8. Verification — measured, in a real browser

- [x] 8.1 Start the dev servers on this worktree's own ports (5980 / 8887) via the canonical script. Launch
      your **own headless Chromium** at `/home/matt/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`
      — the MCP Playwright session is shared with two other live runs and must not be used
- [x] 8.2 Reach each empty state through the **real application path**, never by forcing props: an account
      with no sources; no pipelines; no types; no dashboards; a dashboard whose last panel you delete; a
      filter query that matches nothing in each of the three filtering surfaces
- [x] 8.3 **Reproduce-then-fix applies to every defect, not just the panel blank** (tasks 2.1, 3.7, 6.6).
      For each, capture the failing observation on the unfixed build first, then the same probe passing
- [x] 8.4 For every CTA, confirm it performs the **same operation** as its existing counterpart elsewhere
      (same modal opens, same flow, same resulting record). Include opening the pipeline modal from
      `/registry` **without a route change** (task 4.4)
- [x] 8.5 **Measure the 44px floor correctly.** Use `getBoundingClientRect().height` on the **rendered**
      button — never `getComputedStyle(...).minHeight`, which reads a declared property that an inert
      cascade slips past and that returns a value even for an element that never laid out
- [x] 8.6 **Prove the probe discriminates** before trusting it: measure a control known *not* to be floored
      — a `variant="sidebar"` CTA at desktop width, `height: var(--control-sm)` (`EmptyState.css:163-168`)
      — and show the probe reads ~28px there. A probe that returns 44 unconditionally proves nothing
- [x] 8.7 Measure the floor only on surfaces that render at those widths: the page-surface heroes
      (`SourcesPage`, `PipelinesPage`, `TypeRegistryBrowser`, `PanelList`, `DataTypeSelectStep`'s modal).
      `DashboardList`, `SidebarItemList` and the registry `emptyCta` live in `.app-sidebar`, which is
      `display: none` at ≤768px (`App.css:416-419`) — they are desktop-only and are verified at 1440
- [x] 8.8 Check every touched empty state at 1440 / 768 / 430 in **both** light and dark themes
- [x] 8.9 **Compare the five sections side by side.** If two empty states end up visibly different, the
      ticket has failed even if each looks fine alone — consistency is its premise
- [x] 8.10 Confirm no layout shift is introduced at the skeleton→empty-state swap on the panel area
      (`getBoundingClientRect()` before and after), so HEL-528's headline criterion is not regressed
- [x] 8.11 Keyboard-only pass: every CTA is focusable, has an accessible name, and activates with Enter and
      Space (§8). Confirm the two error surfaces announce (`role="alert"`) and the neutral ones do not

## 9. Gates

- [x] 9.1 `npm run lint` — zero warnings (zero-warnings policy)
- [x] 9.2 `npm test` and `npm --prefix frontend test` from **this worktree** (root jest no longer runs
      worktree tests — HEL-768)
- [x] 9.3 `npm run format:check`
- [x] 9.4 `openspec validate empty-state-ctas-primary-sections` — note the installed CLI (1.2.0) rejects
      `--change` with `unknown option`; the bare positional form is correct
- [x] 9.5 Commit. `check-openspec-hygiene.mjs` false-positives "complete but not archived" on
      implementation commits (HEL-657) — if `git commit -n` is needed, **disclose it** and confirm the
      other five checks passed first. Never bypass for anything else
- [x] 9.6 Clean up your own probe artifacts (scratch JSON/screenshots you created). **Leave the ~109 stray
      `*.png` at the repo root alone** — gitignored, pending a separate user decision
