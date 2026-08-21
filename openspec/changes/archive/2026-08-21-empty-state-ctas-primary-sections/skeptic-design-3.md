## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Read from the tree at `2eaf1d26` (worktree HEAD; planning artifacts still untracked —
`git status` shows only `?? openspec/changes/empty-state-ctas-primary-sections/`). No browser (three
parallel runs share the Playwright session; nothing at this gate needed one). `DESIGN.md` read, not
edited. Every file:line below was opened and read; nothing taken from rounds 1–2 or from the revised
prose on trust.

`openspec validate empty-state-ctas-primary-sections` → *"Change 'empty-state-ctas-primary-sections' is
valid"*, exit 0 (CLI 1.2.0).

### HEADLINE: no round-2 survivors. All six of round 2's change requests are genuinely resolved.

One new blocking defect, found by attacking the revised text (CR1 below): task 7.2a, as written, will
make two screens visibly inconsistent, and D8's justification for its fence contains a claim that the
plan itself falsifies. Everything else I found is non-blocking and listed as notes.

---

### Round 2's six change requests — verified against the tree

1. **CR1 (`emptyIcon` prop widening) — RESOLVED.** `SidebarItemList.tsx:42` is the *only* declaration
   (`emptyIcon?: IconDefinition;`, doc comment at `:41`); it is destructured once (`:117`) and used once
   (`:232`/`:236`); the only call sites are `SidebarBody.tsx:129/161/198/240/326` — exactly the five
   task 7.2a names. No second typing anywhere (`grep -rn "emptyIcon"` returns those nine lines and
   nothing else; no test or story passes it). Task 7.2 correctly sequences the widening *before* 7.2a's
   conversion, and `EmptyState`'s `renderIcon` does dispatch on `isValidElement` (`EmptyState.tsx:44-49`),
   so the `emptyIcon !== undefined` guard still selects correctly for a `ReactNode`. `proposal.md`'s
   Impact records it as the second prop-surface change.
2. **CR2 (HEL-535's regression guard) — RESOLVED, and removing the single entry is sufficient.** I
   checked the structural question the brief raised: `toastListeners.test.ts` has **no** count assertion,
   no `it.each` table, no snapshot, and never imports `ERROR_TOASTS`. `expectToast` (`:63-83`) asserts
   `items).toHaveLength(before + 1)` per call, so the *only* thing that fails after task 3.6 is the one
   `expectToast({ type: createDashboard.rejected.type … }, "error", "Failed to create dashboard.")` block
   (`:92-96`, inside the HEL-535 D7/3.7 describe at `:85`). No other test in the repo asserts that toast
   (`grep -rn "Failed to create dashboard"` → `PanelList.tsx:179`, `dashboardsSlice.ts:74`,
   `DashboardList.tsx:62`, `toastListeners.test.ts:95`, `toastListeners.ts:151`, and nothing else).
   Task 3.6a's "do NOT resolve the red suite by keeping the toast" instruction is the right guard.
3. **CR3 (both new `PanelsState` fields threaded) — RESOLVED for `renderWithStore`.** `TestState.panels`
   is `:59-71` and the constructed slice is `:189-206`, both enumerating fields explicitly; task 1.4
   threads both fields into both. (Three *other* files enumerate the same shape — see non-blocking note
   A, where I prove they become type errors.)
4. **CR4 (the flag-outlives-mount hazard) — RESOLVED, and the mechanism is sound.** D5a now specifies
   the unmount reset, tasks 4.2a/4.2b add the cleanup dispatch and the remount test, and D4b's claim is
   narrowed to "at the point the flag is set" so it no longer appears to cover persistence. I re-derived
   the reachable path: `PanelList` is mounted at exactly one place (`AppRoutes.tsx:88`, route `/`), the
   `Cmd/Ctrl+K` listener (`App.tsx:107-117`) is ungated, and `isModalOpen` is local `useState` today
   (`PanelList.tsx:277`/`:322`/`:415`). Answering the brief's specific attacks: a cleanup effect is
   correct here — unmounting `PanelList` *is* the route change for `/`, so a route-change listener would
   be strictly more machinery for the same effect, and the modal's own close path already dispatches
   `false`. StrictMode **is** on (`main.tsx:57`), so the cleanup fires once during the dev double-mount;
   that is a no-op because the flag is `false` at mount and nothing outside `PanelList` sets it
   (task 4.5 forbids wiring `useCreatePanelAction` elsewhere). It does not race a legitimate open:
   `PanelList` has no key that would remount it mid-session, and RTL does not wrap in StrictMode, so
   4.2b is unaffected. One implementation caveat in note D.
5. **CR5 (D8's same-action siblings) — RESOLVED as to the four it names, and I verified all four exist
   and qualify:** `PanelList.tsx:281` (`faPlus`, "Add panel" header button, co-renders with the empty
   state), `DashboardList.tsx:224` (`faXmark` filter-clear), `SidebarItemList.tsx:290` (`faXmark`,
   shared by all five sidebar sections), `DataTypeSelectStep.tsx:216` (`faXmark`; real path
   `features/panels/ui/creationSteps/DataTypeSelectStep.tsx`). The exclusion is also correct:
   `DashboardList.tsx:190-198` and `SidebarItemList.tsx:259-269` render `<IconButton icon="+" />` — a
   literal `"+"` character, no FontAwesome referent. I swept for *missed* siblings by enumerating every
   trigger of each converted action (`setAddSourceModalOpen(true)` → `SourcesPage.tsx:111`,
   `SidebarBody.tsx:131`; `setCreatePipelineModalOpen(true)` → `PipelinesPage.tsx:69/88`,
   `SidebarBody.tsx:163`; `PanelCreationModal` → `PanelList.tsx:322` only) and every `faPlus` consumer
   (`CommandBar.tsx:183` is "New chat", gated on `pickerId === "chat"` at mobile width where the sidebar
   is `display:none` — not a co-render). No fifth sibling of that kind exists. **But the icon fence has
   a different, unlisted hole — CR1 below.**
6. **CR6 (`MobileNavSheet`'s false ownership claim) — RESOLVED.** `design.md`'s Non-Goals now states the
   nav-surface reason alone and explicitly retracts the fence claim. Consistent with `ticket.md:77-83`,
   which lists neither `MobileNavSheet.tsx` on either parallel run's fence.

Round 2's three non-blocking items also landed: task 3.4 names `createError`'s three producers
(verified: `DashboardList.tsx:62` create, `:160` import, `:168` file-read; the shared
`<InlineError error={createError} />` is `:263`), the `sidebar-dashboard-filter` scenario now carries the
no-selection precondition (correct — the pin is `DashboardList.tsx:174-183`), and the line citations I
spot-checked are accurate.

### Independent re-derivation of the load-bearing claims (not taken on trust)

- **D1/D2's seam.** `PanelsState` is `panelsSlice.ts:31-40`; `markDashboardPanelsStale` is `:85-89` with
  the guard at `:86`; `fetchPanels.pending` is `:102-106`. `showPanelGridSkeleton` is
  `PanelList.tsx:85-88` and the "No panels yet" gate is `:408`, both exactly as cited.
- **D2 breaks exactly one existing test, and the plan owns it.** I enumerated every
  `renderWithStore(<PanelList …>)` case with `panels.status: "idle"` (`PanelList.test.tsx:165, 180, 184,
  208, 233, 259, 563, 576`). All but `:576` have `selectedDashboardId: null`, which the unchanged
  `selectedDashboardId !== null` conjunct excludes — so only the D11 mirror-image test at `:570-583` is
  affected, which is precisely what task 2.4 inverts. Its sibling `.ui-skeleton` assertion (`:578`) stays
  green under the new gate *provided* the fixture sets `staleDashboardId` to the selected dashboard, which
  task 2.4 says to do. `PanelList.gridWidthSharing.test.tsx` is the only other file rendering `PanelList`.
- **D6's "extracting at the component is a no-op".** Verified: `createDashboard`'s catch is bare
  (`dashboardsSlice.ts:72-74`) and `extractErrorMessage` only reads an `AxiosError` body
  (`services/extractErrorMessage.ts:18-24`). The thunk-level fix is the only one that works.
- **D7's floor.** `EmptyState.css` is 228 lines; the `@media (max-width: 768px)` floor block is the last
  block (`:217-228`), and the sidebar-CTA `height: var(--control-sm)` rule is `:162-168`, so task 8.6's
  discriminating ~28px control is real.

---

### Verdict: REFUTE

One blocking change request. It is not a stylistic preference: the plan as written instructs the
executor to *introduce* a side-by-side icon-system mismatch on two screens, and D8 justifies its fence
with a sentence the plan falsifies. It is a one-line decision + one-line task fix.

---

### Change Requests

1. **Task 7.2a converts the Metrics and Assistant sidebar `emptyIcon`s, whose page-surface twins stay
   FontAwesome — so the shipped result is the *same empty state rendered twice on one screen in two icon
   libraries*. D8's "the residual mix is now *between* views rather than *within* one" is false as
   planned.**

   `SidebarBody` renders exactly one section, selected by route (`SidebarBody.tsx:72`,
   `pickerIdForPathname`; branches at `:113/148/186/210/297`). So:

   - **`/metrics` with zero metrics.** Sidebar: `SidebarItemList` with `emptyText="Define your first
     metric"`, `emptyIcon={faGaugeHigh}` (`SidebarBody.tsx:197-198`). Page: `MetricsPage.tsx:48-50`
     renders `MetricEmptyState`, whose `EmptyState` is `icon={faGaugeHigh}`, title **"Define your first
     metric"** (`MetricEmptyState.tsx:1,13-14`). Identical title, identical glyph, both on screen at
     once. Task 7.2a converts the sidebar one to lucide and nothing converts the page one (D8 explicitly
     leaves "every other `EmptyState` call site" to HEL-443).
   - **`/chat` with zero conversations.** Same pattern: sidebar `emptyText="No conversations yet"`,
     `emptyIcon={faComments}` (`SidebarBody.tsx:325-326`) beside `ActiveConversationPanel.tsx:139-145`'s
     `icon={faComments}`, title **"No conversations yet"**.

   For the four in-scope sidebar sections the plan converts *both* halves of that duplicated pair
   (Sources: `SidebarBody.tsx:129` + `SourcesPage.tsx:105`; Pipelines: `:161` +
   `PipelineEmptyState.tsx:17`; Data Types: `:240` + `TypeRegistryBrowser.tsx:48`; Dashboards:
   `DashboardList.tsx:284` + `PanelList.tsx:389/402/410`) — which is exactly right. Metrics and
   Assistant are the two 7.2a reaches *outside* the five enumerated sections, and only their sidebar
   half gets converted. That is the "same thing, two glyphs, one screen" defect D8 was written to
   prevent, manufactured rather than removed, on the axis this ticket exists to improve.

   Pick one resolution and record it in D8, and correct the "between views rather than within one"
   sentence to whatever ends up true:
   a. Also convert the two page-surface twins — `MetricEmptyState.tsx` (`faGaugeHigh`, `faPlus`) and
      `ActiveConversationPanel.tsx:106/141` (`faComments`, both branches) — bounded, four icons, keeps
      every pair internally consistent; or
   b. Drop Metrics (`:198`) and Assistant (`:326`) from task 7.2a, converting only the three in-scope
      sidebar `emptyIcon`s plus Dashboards' own. The cost is that those two sections' *filtered* hero
      (lucide `SearchX`, task 6.2's shared branch) differs from their *no-data* hero (FontAwesome) — but
      those two branches are mutually exclusive and are different glyph concepts anyway, so nothing ever
      renders side by side in two styles. This is the strictly smaller regression of the two.

   Sub-item, same fence, same fix round: **`DataTypeSelectStep.tsx:178`'s no-data `EmptyState`
   (`icon={faLayerGroup}`) is in the empty-state ladder of a view task 6.3 gives a lucide `SearchX`
   filtered hero**, and it is named nowhere in D8's "applied exhaustively, that is exactly four sibling
   controls and five `emptyIcon` values" enumeration. Task 7.1's general clause covers it only if a
   reader counts the panel-creation modal as one of "the five enumerated sections" — an executor can
   reasonably read it either way, and D8's exhaustiveness claim invites the wrong reading. State
   explicitly whether that icon converts (it should — the same file's *error* branch already sits beside
   it with a FontAwesome `faArrowRotateRight` Retry at `:172` and a lucide `InlineError`, so the file is
   already mixed and 6.3 adds a third system to it if left alone).

---

### Non-blocking notes

**A. Three more files enumerate the panels slice field-by-field, not just `renderWithStore` — two of them
become type errors, and `npm test` (gate 9.2) is where they surface.** `proposal.md`'s Impact and task
1.4 both single out `renderWithStore.tsx`. Also enumerating the full shape:
`features/patchSets/ui/PatchSetReviewPage.test.tsx:313-323` (`preloadedPanelsState()`, no cast),
`features/panels/state/panelsSlice.test.ts:463-476` (inline, the `@ts-expect-error` there is on the
*dispatch* line, not the store), and `features/panels/hooks/usePanelData.test.ts:24-35` (cast `as never`,
so unaffected). I did not take the type behavior on trust — I built a probe against this worktree's own
`node_modules` (RTK 2.10 + `strict: true`, the frontend's exact tsconfig) with a 6-field state and a
4-field `preloadedState`, both inline and via a helper's `ReturnType<>`, and both forms error:

```
error TS2322: Type 'Reducer<PanelsState>' is not assignable to type 'Reducer<PanelsState, UnknownAction, { … }>'.
  Type '{ items: …; loadedDashboardId: …; status: "idle"; error: null; }' is missing the following
  properties from type 'PanelsState': staleDashboardId, panelCreationModalOpen
```

`jest.config.cjs` uses `preset: "ts-jest"` with diagnostics at their default (on), so these fail `npm
test` rather than passing silently. Non-blocking because it is loud, immediate, and the fix (add the two
fields to each helper) is mechanical — but naming the three files in task 1.4 costs nothing and saves a
red-suite detour.

**B. `useCreateDashboardAction()` has two different real-world flows behind one name; say which one it
encodes.** `PanelList.tsx:173-183`'s CTA dispatches `createDashboard({name: "Untitled dashboard"})`
immediately; `DashboardList.tsx:281-296`'s CTA (and its header "+") instead sets `isCreateMode`, revealing
a *named*-create form. D5b implies the thunk flavor ("dispatches a thunk directly, no modal"), and task
4.6 pointedly does not list `DashboardList`'s CTA among those to rewire — good. The trap is task 4.7
("invoking the descriptor's `onClick` opens the same flow as the section's existing create control") plus
`empty-state-cta-pattern`'s scenario "the same creation flow opens as when that section's ordinary create
control is used": read literally against the Dashboards *section*, both point at the inline naming form,
and an executor chasing them could rewire `DashboardList`'s CTA onto the hook — silently deleting the
name-entry step. One sentence in task 4.3 ("the dashboard hook encodes `PanelList`'s quick-create;
`DashboardList`'s inline naming form is deliberately untouched") closes it.

**C. The unmount reset is not reflected in any spec delta.** `workspace-create-actions` forbids the
flag-set-with-nothing-mounted half but says nothing about the flag outliving its reader — the exact
hazard D5a fixes and 4.2b locks. Consider a scenario ("WHEN the surface that mounts a create flow's modal
unmounts with the flow's visibility flag set THEN the flag is cleared, so re-entering that surface does
not open the flow unbidden"), so the archived contract carries the behavior rather than leaving it in
tasks only.

**D. Implementation caveat for 4.2a.** Use a cleanup on a stable-dependency effect
(`useEffect(() => () => { dispatch(setPanelCreationModalOpen(false)); }, [dispatch])`). With a changing
dependency the cleanup would fire on every dependency change and close a legitimately-open modal. As
noted above, StrictMode's dev double-invoke fires this cleanup once at mount; harmless today because the
flag starts `false`, but worth the comment so it is not "fixed" later by removing the reset.

**E. Copy micro-consistency (§8).** D3's CTA label is "Clear search" while every existing clear control's
accessible name is "Clear filter" (`DashboardList.tsx:222`, `SidebarItemList.tsx:288`,
`DataTypeSelectStep.tsx:213`) and the filter inputs' labels say "Filter … by name". Two names for one
action on one screen. Pick one word and use it for both the CTA label and the icon button's `aria-label`.

**F. `PanelList.tsx:75-84`'s existing comment will be false after task 2.2.** It states that widening to
`idle` "would park a permanent skeleton over either state" — the exact claim D1's discriminator refutes.
Task 2.2 says to comment the new gate; it should also *replace* that stale comment rather than leaving a
contradiction above the code.

**G. Still-unrecorded rare state (carried from rounds 1–2).** A `deletePanel` resolving after a
`fetchPanels` rejection leaves `status:"idle"` + `staleDashboardId === selectedDashboardId` + `items: []`
(the `markDashboardPanelsStale` guard passes because `fetchPanels.rejected` never clears
`loadedDashboardId`), so the new gate would claim "No panels yet" on a dashboard whose panels never
loaded. It needs a panel to be visible to delete, so it is close to unreachable; still worth one sentence
in D2 so nobody rediscovers it as a bug.

**H. Copy strings remain unpinned** (registry CTA label, the three filter-empty titles/descriptions, the
error title). The *shape* constraints are specific enough (teaching sentence retained, query quoted, no
create-type path, error title named), so this is acceptable at a design gate — but requester rules 3 and
7 are wholly deferred to the final gate and will be judged strictly there, including side-by-side.
