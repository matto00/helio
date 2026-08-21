## Context

Read from the tree at `2eaf1d26`, after HEL-539 (error states) and HEL-528 (skeletons) landed. Loading,
empty and error are three branches of one ladder in the same components; this change owns exactly one of
them and must coexist with the other two rather than restyle them.

**What already conforms.** `SourcesPage.tsx:103` ("Connect a data source" + `setAddSourceModalOpen`),
`PipelineEmptyState.tsx:15` ("Build your first pipeline" + `setCreatePipelineModalOpen`), and
`PanelList.tsx:388/409` all render `EmptyState variant="main"` with a working CTA. `MetricEmptyState.tsx`
is the same wrapper shape. The primitive itself (`shared/ui/EmptyState.tsx`) already carries everything
this change needs — `cta`, `secondaryCta`, `intent`, `IconDefinition | ReactNode` icons, `role="alert"`
on error, and a `44px` mobile floor at `EmptyState.css:219-228` — all added by HEL-539/HEL-319.

**What does not.**
- `TypeRegistryBrowser.tsx:46` renders "No types defined" with correct teaching copy and **no `cta`**.
  `SidebarBody.tsx:228` (the Data Types sidebar section) is the only one of five `SidebarItemList` call
  sites that passes no `onAdd`, so its empty state has no CTA either. The Type Registry has no create
  action at all — correctly, since types exist only as pipeline output.
- Every filter-to-zero state renders a bare paragraph rather than the primitive:
  `DashboardList.tsx:280` and `SidebarItemList.tsx:229` render
  `<p className="dashboard-list__status">No matches</p>`; `DataTypeSelectStep.tsx:221` renders
  `<p className="panel-creation-modal__datatype-no-match">`. None is an `EmptyState`; none offers a way
  back. Two of the three do not name what was searched — `DataTypeSelectStep`'s copy already does
  (`No data types match "{filterQuery}"`), and that is the bar the other two are being raised to.
  `DashboardList`'s branch has **no test at all**.
- `PanelList.tsx:408` gates "No panels yet" on `status === "succeeded"`. `markDashboardPanelsStale`
  (`panelsSlice.ts:85-89`) sets `status = "idle"` and clears `loadedDashboardId`; `deletePanel.fulfilled`
  empties `items`; `App.tsx:123-129` is keyed on `[dispatch, selectedDashboardId]` and never refires. So
  after deleting a dashboard's last panel the panel area renders **nothing at all, permanently**.
- `PanelList.tsx:179` writes a hardcoded `"Failed to create dashboard."` into `createDashboardError`, which
  `:391` renders as the **description of a neutral** `EmptyState` titled "No dashboards yet" — not
  error-styled, not announced — while `toastListeners.ts:151` also fires a toast for the same rejection.

**The seam the fix turns on.** HEL-528 D11 states that no Redux state distinguishes `PanelList`'s two
`idle` states, and that is true today: in both the pre-dispatch frame and the post-delete terminal state,
`loadedDashboardId === null`, `items === []`, and `status === "idle"`. `panelsSlice.ts:88` is the only
assignment of `"idle"` **within the panels slice** outside its initial state, which is all the argument
below needs. (Other slices assign their own `"idle"` — `settingsSlice.ts:399/402`, `authSlice.ts:201`ff,
`metricsSlice.ts:131`; HEL-528's D11 overreached by saying "the entire frontend", and that overreach is
not repeated here.)

**Which paths actually reach the terminal state.** `markDashboardPanelsStale` has four dispatch sites, and
only one leaves the stale state standing: `createPanel` (`panelThunks.ts:107`), `duplicatePanel` (`:149`)
and `patchSetsSlice.ts:219` each `dispatch(fetchPanels(...))` on the very next line, so their stale window
closes within the same tick. **`deletePanel` (`panelThunks.ts:135`) does not refetch** — it is the sole
producer of the permanent terminal state this change closes.

## Goals / Non-Goals

**Goals:** every enumerated section renders an `EmptyState` with a working, correct CTA in every reachable
no-data state; filter-empty reads as a different situation from nothing-created-yet; the copy teaches the
data model rather than decorating; a create-action seam HEL-554 consumes rather than re-derives.

**Non-Goals:** loading treatment beyond the one gate D2 revises (HEL-528); error treatment beyond the two
surfaces absorbed from HEL-770 (HEL-539); toast policy beyond removing the one collision HEL-770 named
(HEL-535); an app-wide FontAwesome→lucide migration (HEL-443 — see D8's fence); onboarding itself
(HEL-554); editing `DESIGN.md` (HEL-774 owns it this session); `PipelineRiverView.tsx:256`'s two
hand-rolled sibling buttons and `ApiTokensSection.tsx:126`'s separate create form, both CTA-less
`EmptyState`s outside the five enumerated sections.

Three further exclusions, each stated rather than left implied:

- **`MobileNavSheet.tsx:203-205`** renders `<p className="mobile-nav-sheet__empty">{emptyMessage}</p>` —
  the surface these same sections are browsed through below 768px, where `.app-sidebar` is `display: none`
  (`App.css:416-419`). It is **not** a blank region (§7's "never render nothing" is met; it renders a
  message), but it is not the primitive and has no CTA. Excluded deliberately, on one sufficient reason: it
  is a *navigation* sheet rather than a section's own content area, so it is not one of the five section
  surfaces this ticket enumerates. (An earlier draft also claimed a file-ownership fence covered it — it
  does not; `MobileNavSheet.tsx` is on neither parallel run's fence. What remains is ordinary prudence about
  editing mobile chrome while two mobile tickets are in flight, which is a reason to sequence the work, not
  a constraint that forbids it.) Recorded as a follow-up, not silently skipped.
- **`PanelList.tsx:401-405` ("Select a dashboard")** stays without a CTA. It is a *no-selection* prompt,
  not a no-data state: dashboards exist, and the resolution is to pick one from a list already on screen.
  There is nothing to create, so an action here would be invented rather than purposeful. The
  `empty-state-cta-pattern` requirement is worded to exclude selection prompts rather than to over-claim
  and then be contradicted by the shipped code.
- **The `EmptyState` primitive's rendering** is unchanged; the only edit to that file is exporting an
  existing type (D5).

## Decisions

**D1 — `panelsSlice` gains a `staleDashboardId` discriminator; the `status` union is NOT widened.**
`markDashboardPanelsStale` sets `state.staleDashboardId = action.payload` alongside its existing
`status = "idle"` / `loadedDashboardId = null`; `fetchPanels.pending` clears it to `null`. This is
purely **additive**: no existing reader of `panels.status` changes meaning, and no exhaustive switch
anywhere can break. *Rejected: adding `"stale"` to the `status` union* — a widened union still compiles
at every `status === "…"` comparison site, so it would silently change nothing at some readers while
requiring an audit of all of them; the risk is all downside for no extra expressiveness. *Rejected:
re-dispatching `fetchPanels` after the delete* (via an `App.tsx` effect keyed on `status`) — it spends a
round trip to learn what the client already knows, makes the post-delete empty state arrive **after** a
skeleton flash rather than immediately, and changes `markDashboardPanelsStale`'s deliberate
invalidate-until-next-switch contract for every caller, including panel *creation*.

**D2 — The two `idle` states now split cleanly, and both halves of D11 are closed.** With D1's
discriminator:
- **Terminal (post-delete)** — `status === "idle" && staleDashboardId === selectedDashboardId`: renders
  the "No panels yet" `EmptyState` with its "New panel" CTA. `PanelList.tsx:408`'s gate becomes
  `selectedDashboardId !== null && items.length === 0 && (status === "succeeded" || staleDashboardId === selectedDashboardId)`.
- **Pre-dispatch frame** — `status === "idle" && staleDashboardId !== selectedDashboardId`: a fetch is
  *provably* coming (`frontend/src/app/App.tsx:123-129`'s effect dispatches on mount and on every
  `selectedDashboardId` change, and D1 makes invalidation the only other route to `idle`), so
  `showPanelGridSkeleton` widens to
  `selectedDashboardId !== null && (status === "loading" || (status === "idle" && staleDashboardId !== selectedDashboardId)) && (items.length === 0 || items[0].dashboardId !== selectedDashboardId)`.

**D2's proof depends on one unstated link — state it, and lock it.** "`App.tsx` dispatches" is not by
itself "a fetch runs": `fetchPanels` carries a `condition` (`panelThunks.ts:72-83`) that returns `false`,
emitting **no** `pending` at all, when `status` is `"loading"`/`"succeeded"` with a matching
`loadedDashboardId`. The conclusion still holds — the condition never blocks while `status === "idle"`,
and `markDashboardPanelsStale` always leaves `status === "idle"` with `loadedDashboardId === null` — but
this is the single link that, if a future change touches `condition`, would silently park a permanent
skeleton, which is exactly the failure HEL-528 wrote D11 to prevent. It is therefore locked by its own
test (task 1.5), not left as an inherited assumption.

**One rare state, recorded so nobody rediscovers it as a bug.** A `deletePanel` resolving *after* a
`fetchPanels` rejection leaves `status: "idle"` + `staleDashboardId === selectedDashboardId` + `items: []`
— `fetchPanels.rejected` never clears `loadedDashboardId`, so `markDashboardPanelsStale`'s guard passes —
and the new gate would render "No panels yet" for a dashboard whose panels never actually loaded. It
requires a panel to have been visible in order to delete one, so it is close to unreachable, and the
alternative (rendering nothing) is worse. Accepted knowingly, not overlooked.

This is **not** the widening HEL-528 task 2.4b forbade. 2.4b's stated reason was that a bare `idle` gate
"parks a permanent skeleton" over the terminal state and the zero-dashboard bootstrap; D1's discriminator
excludes the terminal state by construction, and the zero-dashboard case is excluded by the pre-existing
`selectedDashboardId !== null` conjunct, which is unchanged. Closing the frame here rather than deferring
it is required by this ticket's own headline criterion — "no section renders blank" — which a knowingly
blank frame on the enumerated panel surface would not meet.

**D2a — HEL-528's D11 locking test is inverted, deliberately, not deleted.**
`PanelList.test.tsx:570` ("D11 mirror-image…") currently asserts
`expect(screen.queryByText("No panels yet")).not.toBeInTheDocument()` at exactly the terminal state, with
a comment naming HEL-548 as the owner of closing it. That assertion is inverted and the test renamed; its
sibling assertion that **no skeleton** renders there is **kept unchanged**, because D2 must not regress it.
This must be an explicit, commented inversion — an executor that instead weakens the fix to keep the old
assertion green would satisfy the suite while leaving the ticket's headline gap open.

**D3 — Filter-empty is its own state, named, with a way out.** All three filtering surfaces render
`EmptyState` instead of a bare `<p>`, with a `SearchX` (lucide) icon, a title distinct from the no-data
title, a description that **quotes the query** (`No dashboards match "sale"`), and a `cta` of
"Clear filter" wired to the existing clear handler. `DashboardList` and `SidebarItemList` use
`variant="sidebar"` (matching their no-data siblings and the narrow column); `DataTypeSelectStep` uses
`variant="sidebar"` too, matching its own no-data sibling at `:178`. The no-data copy on each surface is
left as-is where it already teaches; only the *filter* branch is new. The distinction is carried by
**title, icon and copy** — never by color alone (§8).

**D4 — The Type Registry's CTA creates a pipeline, in place, and says so.** Both registry empty states
gain a "New pipeline" CTA. The copy keeps today's correct teaching sentence ("Types are created by
pipelines…") and the CTA label names the thing it actually creates — a "New type" label over a
pipeline-creating action would be the dead path the ticket forbids, relabelled.

The action **dispatches `setCreatePipelineModalOpen(true)` and does not navigate.** An earlier draft of
this decision required navigating to `/pipelines` first, on the belief that the modal is rendered by the
Pipelines page; that is false. `CreatePipelineModal` is mounted at the **shell** level
(`frontend/src/app/App.tsx:208`) for every route except `/pipelines`, precisely so a create action works
from any route (comment F-045), with `PipelinesPage.tsx:104` mounting the page-local instance on that one
route. So the modal opens in place on `/registry` with no route change. Staying put is also the better
behavior on its own merits: the user asked to create a pipeline *because* they were looking at an empty
registry, and yanking them to another list before the modal appears loses that context for no gain.

**D4b — The shell-mount asymmetry is real, and only the pipeline action is safe from it.** Of the four
creation modals, only `CreatePipelineModal` is shell-mounted. `AddSourceModal` (`SourcesPage.tsx:118`),
`CreateMetricModal` (`MetricsPage.tsx:73`) and `PanelCreationModal` (`PanelList.tsx:322`) are each mounted
by a single page. This change relies on the mounted one and never introduces a set-flag-with-nothing-
mounted path **at the point the flag is set**: every CTA it wires is either on the page that mounts its own
modal (`SourcesPage`, `PipelinesPage`, `PanelList`) or uses the shell-mounted pipeline modal (both registry
surfaces). That claim is about where a flag is *set*; where a flag *persists* after its reader unmounts is
a separate hazard, introduced by D5a's lift and closed there — the two must not be conflated. Noted,
not fixed: the sidebar's Data Sources and Metrics "+" buttons already have F-045's bug today, since
`SidebarBody` dispatches their flags from any route — pre-existing, outside this change's fence, and
recorded in Planner Notes as a follow-up.

**D4a — The registry sidebar gets an `emptyCta`, NOT an `onAdd`.** `SidebarItemList` renders `onAdd` twice:
as the empty state's `cta` **and** as a persistent header "+" `IconButton` (`:259-269`). Passing `onAdd` to
the Data Types section would therefore put a "+" in a *Data Types* header that creates a *pipeline* — an
affordance whose label and result disagree, on a section that has no create action of its own. So
`SidebarItemList` gains an optional `emptyCta?: { label, onClick, icon? }` consumed only by `renderEmpty()`,
falling back to `onAdd` when absent so all four existing call sites are untouched.

**D5 — The create-action seam: one hook per feature, returning a descriptor plus its own outcome state.**
Each feature exports a hook — `useCreateDashboardAction()`, `useAddSourceAction()`,
`useCreatePipelineAction()`, `useCreatePanelAction()` — returning the **same uniform shape**:

```ts
{ cta: EmptyStateCta; error: string | null; isPending: boolean }
```

`cta` is directly assignable to `EmptyState`'s existing `cta` prop, so no adapter is needed at any call
site; `error`/`isPending` carry the outcome state the *action* owns.

**Why the shape is not bare `EmptyStateCta`.** Three of the four actions are pure flag flips
(`setAddSourceModalOpen`, `setCreatePipelineModalOpen`, and after D5a `setPanelCreationModalOpen`) — they
cannot fail and are never in flight, because the modal owns its own submission. The **dashboard** action
is different: it `await`s `dispatch(createDashboard(...)).unwrap()` and today drives two pieces of
`PanelList` state — `isCreatingDashboard` (`:40`, supplying the CTA's `"Creating..."` label at `:395`) and
`createDashboardError` (`:41`), which D6 turns into that branch's `intent`, title, icon and description.
`EmptyStateCta` is `{label, onClick, icon?, disabled?}`: enough for in-flight (label swap + `disabled`),
**nothing for the error**. Nor can the error be read from Redux instead — `createDashboard.rejected` has
**no case** in `dashboardsSlice` (only `.fulfilled`, `:273`), so the payload exists only where `.unwrap()`
throws. Whoever owns the `onClick` therefore owns the error, and after this change that is the hook.

So `useCreateDashboardAction()` owns the `useState` pair, the `.unwrap()`, and the message binding;
`PanelList` reads `error` from the hook into D6's conditional error branch and stops holding that state
itself. The three flag-flip hooks return `error: null, isPending: false` — a true statement about those
actions, not a placeholder — which keeps one shape for every consumer, including HEL-554, instead of
making each caller learn which hook is the special one.

**Rejected: letting the hook swallow the rejection.** It leaves D6's error branch as dead code, and since
D6a removes the toast, a failed create from the panel area would report **nothing at all** — the exact
silent failure D6a's ordering argument exists to forbid, arriving through the seam instead of the toast.
**Rejected: `useCreateDashboardAction({ onError })` callbacks** with `PanelList` keeping its own state —
workable, but every future consumer (HEL-554 first) must then re-derive error handling, which is the
duplication this seam exists to remove.

*Rejected: a `useWorkspaceCreateActions()` registry* — nothing in this change consumes it, and this repo
deletes speculative contracts rather than shipping them (HEL-337 removed `OutputFieldContract` for exactly
this reason). The per-feature hooks are the seam; composing them is one line at HEL-554's call site.

`EmptyStateCta` is declared **without `export`** today (`EmptyState.tsx:7`), so the hooks cannot annotate
against it as-is. It is exported — a benign, additive, type-only change, and the one edit this change makes
to the primitive's surface. (`proposal.md`'s Impact line is corrected to say so rather than claiming the
API is untouched.)

**D5b — What HEL-554 inherits, stated with its constraint rather than glossed.** These hooks make each
create flow *reusable*; they do **not** make every flow openable from anywhere, because three of the four
modals are page-mounted (D4b). Recorded for HEL-554, explicitly:
- `useCreatePipelineAction()` — works from **any** route (shell-mounted modal).
- `useAddSourceAction()`, `useCreatePanelAction()` — set a flag read only by `SourcesPage` / `PanelList`
  respectively, so today they are usable **only from those surfaces**. An onboarding flow that needs them
  elsewhere must first hoist those modals to the shell the way F-045 hoisted the pipeline one — a
  follow-up, deliberately not done here, because hoisting `PanelCreationModal` (which is large, heavily
  tested, and takes its dashboard from `PanelList`'s own context) is a refactor this ticket does not need.
- `useCreateDashboardAction()` — dispatches a thunk directly, no modal, no mount constraint.

The `workspace-create-actions` spec is written to this narrower, true guarantee. An earlier draft asserted
the panel flow "opens from any surface", which lifting the flag into Redux does **not** achieve — it would
have reproduced exactly the set-flag-nothing-mounted bug F-045 fixed for pipelines.

**D5a — `PanelCreationModal`'s open state lifts into Redux, matching its three siblings — and is reset on
unmount, which the siblings are not.** `useCreatePanelAction` cannot be a hook while the modal's open
state is `useState` local to `PanelList` (`:277`/`:415`). Three sibling modals already keep their flag in
Redux (`setAddSourceModalOpen`, `setCreatePipelineModalOpen`, `setCreateMetricModalOpen`), so the lift
itself is convergence on the established convention. `PanelList`'s two setter call sites and its modal
render (`:322`) move to the slice flag; the dashboard-selected precondition stays exactly where it is, and
the modal stays mounted where it is (D4b).

**But the lift introduces a lifecycle hazard the local state did not have, and it must be closed here.**
`useState` is destroyed when `PanelList` unmounts; a slice flag is not. `PanelList` mounts only on route
`/` (`AppRoutes.tsx:88`), and `App.tsx:108-117`'s `Cmd/Ctrl+K` quick-launcher listener is not gated on any
open modal — so: open the creation modal → `Cmd/Ctrl+K` → navigate away → `PanelList` unmounts with the
flag still `true` → returning to `/` **opens the creation modal unbidden**. Browser Back reaches the same
state. That is this change's own `workspace-create-actions` language — *"a flow that silently opens later,
on whatever route next mounts the modal"* — arriving through unmount rather than through a stray dispatch.

So `PanelList` dispatches `setPanelCreationModalOpen(false)` from a cleanup effect on unmount, locked by a
test that remounting does not render the modal. *Not* copied from the siblings: `SourcesPage`'s
`addSourceModalOpen` has no reset anywhere (its only writers are `SourcesPage.tsx:111/118` and
`SidebarBody.tsx:131`), so the convention here is a known wart, and converging on it unexamined would
import a defect rather than a pattern. Recorded as a follow-up for the sibling flags; fixed for the one
this change creates.

**D6 — The specific message must be produced at the thunk, not extracted at the component (HEL-770).**
An earlier draft had `PanelList.tsx:173-183`'s `catch {` become `catch (err)` and "extract the rejection's
own message". That is a **no-op**: `createDashboard` (`dashboardsSlice.ts:66-76`, `catch` at `:73`) is
`catch { return rejectWithValue("Failed to create dashboard."); }`, so the payload is *always* that fixed
string; `unwrap()` throws the payload — a plain `string`, not an `Error` — and `extractErrorMessage` only
reads an `AxiosError` body, so at the component it returns the fallback. The identical sentence, laundered.

So the fix is at the source: `createDashboard`'s own `catch (err)` calls
`extractErrorMessage(err, "Failed to create dashboard.")`, where `err` genuinely **is** the Axios error, and
**both** consumers render the payload they are handed. Without this, D6, the `frontend-panel-empty-state`
delta and the ticket's absorbed AC all assert a specificity the code cannot deliver.

`PanelList`'s dashboards-empty branch then renders `intent="error"` **conditionally** — error title
("Couldn't create dashboard"), error icon (`TriangleAlert`, matching HEL-539's five siblings), description =
the bound message — while the ordinary no-failure branch stays exactly as neutral as today, with no
`role="alert"`.

**D6a — The toast may only be removed once BOTH paths meet the bar, and `DashboardList` does not today.**
This change's own `toast-emission-integrity` requirement licenses removal only when every dispatching
surface reports inline with a persistent, error-intent, **announced** treatment carrying the failure's own
message. `DashboardList.tsx:263` renders `<InlineError error={createError} />` at its **default
`variant="text"`** — a bare `<p className="inline-error">` with no `role` and no icon
(`InlineError.tsx:58/99`) — and `:62` hardcodes its own generic string. Dropping the toast against that
surface would leave a screen-reader user with **no announcement at all** on that path: an §8 regression
traded for a tidier notification policy.

`DashboardList`'s create failure is therefore raised to the bar first — `variant="banner"`, which supplies
`role="alert"` and the lucide error icon for free (`InlineError.tsx:67-73`), and binds the thunk's payload
instead of its hardcoded string. Only then does `error(createDashboard.rejected, …)` leave `ERROR_TOASTS`
(`toastListeners.ts:151`). Order is load-bearing: removing the toast before either surface conforms
converts a redundant report into a silent failure.

**D7 — The 44px floor is verified by measuring a laid-out box, on the surfaces that actually render at
that width.** The existing floor (`EmptyState.css:219-228`) sets `min-height: 44px` on
`.ui-empty-state__cta` / `.ui-empty-state__secondary-cta` from a media block placed **last in the file**,
and floors the sidebar variant's `height: var(--control-sm)` because `min-height` clamps `height`
regardless of specificity. This change adds no new CTA class, so the floor already covers every button it
introduces — but that is a claim to **measure**, not to read. Three things make the measurement valid:

- **Measure the used height, not the declared property.** `getBoundingClientRect().height` on a rendered
  element, never `getComputedStyle(...).minHeight` — the floor works by `min-height` clamping `height`, so
  reading the declared `min-height` is exactly the property-level read an inert cascade slips past, and it
  returns a value even for an element that never laid out.
- **Prove the probe discriminates.** Measure a control known *not* to be floored — a sidebar-variant CTA at
  desktop width, `height: var(--control-sm)` (`EmptyState.css:163-168`) — and show the probe reads it at
  ~28px. A probe that returns 44 unconditionally proves nothing.
- **Only measure what renders there.** `.app-sidebar` is `display: none` at ≤768px (`App.css:416-419`), so
  `DashboardList`, `SidebarItemList` and the registry `emptyCta` are **desktop-only surfaces** and cannot
  be measured at 430/768 at all. The floor is measurable at those widths on the main-content heroes:
  `SourcesPage`, `PipelinesPage`, `TypeRegistryBrowser`, `PanelList`, and `DataTypeSelectStep`'s modal.

`EmptyState.css.test.ts`'s static guard stays as the cheap mirror, not as the evidence.

**D8 — lucide covers each touched empty-state ladder AND the same-action affordance beside it.** Those
pages' *error* states are already lucide (HEL-539), so each page is currently mixed against itself, and
converting the neutral empty states is the obvious half. But converting *only* the empty states leaves a
sharper inconsistency than it fixes: `PanelList.tsx:281`'s header **"Add panel"** button on FontAwesome
`faPlus` sitting beside an empty-state **"Add panel"** CTA on lucide `Plus` — the same action, two glyphs,
one screen — and `DashboardList.tsx:216-222`'s `faXmark` filter-clear control inches from the new lucide
`SearchX` filter-empty hero.

The fence is therefore: **every icon in the empty-state ladder of the five enumerated sections, plus any
sibling control in the same view that performs the same action as a converted CTA.** Applied exhaustively,
that is the five sections' own empty-state hero and CTA icons, plus the following — the list is the fence;
do not read a count into it:

- `PanelList.tsx:281` — header add-panel `faPlus`, same action as the empty-state "Add panel" CTA.
- `DashboardList.tsx:224` — filter-clear `faXmark`, same action as the new "Clear filter" CTA.
- `SidebarItemList.tsx:290` — filter-clear `faXmark`, same action as the new "Clear filter" CTA, in **all
  five** sidebar sections (the filtered branch is shared).
- `DataTypeSelectStep.tsx:216` — filter-clear `faXmark`, directly above the new filtered empty state.

Plus these hero icons inside the in-scope ladders:
- `DataTypeSelectStep.tsx:178`'s no-data `EmptyState` (`faLayerGroup`) — task 6.3 gives that same view a
  lucide filtered hero, and the file's error branch already pairs a lucide `InlineError` with a FontAwesome
  `faArrowRotateRight` Retry (`:172`), so leaving it would put a **third** icon system in one file.
- The **three in-scope** `emptyIcon` values `SidebarBody` passes: Data Sources (`:129`), Data Pipelines
  (`:161`), Data Types (`:240`).

**Explicitly out — Metrics (`SidebarBody.tsx:198`) and Assistant (`:326`).** These are the two
`SidebarItemList` sections *outside* this ticket's five, and converting their sidebar `emptyIcon` alone
would manufacture the exact defect this decision exists to remove. `SidebarBody` renders one section at a
time by route (`:72`, `pickerIdForPathname`), and on `/metrics` with zero metrics the sidebar's
`emptyIcon={faGaugeHigh}` / "Define your first metric" sits beside `MetricEmptyState.tsx:13-14`'s
**identical glyph and identical title** on the page; `/chat` has the same pair on `faComments` /
"No conversations yet". Converting one half of a duplicated pair is "the same thing, two glyphs, one
screen" — worse than leaving both. Converting the page halves too would pull two out-of-scope files into
this change, which is HEL-443's job.

For the four in-scope sections the plan converts **both** halves of that duplicated pair (Sources
`:129` + `SourcesPage.tsx:105`; Pipelines `:161` + `PipelineEmptyState.tsx:17`; Data Types `:240` +
`TypeRegistryBrowser.tsx:48`; Dashboards `DashboardList.tsx:284` + `PanelList.tsx:389/402/410`), which is
what keeps each pair internally consistent.

The accepted residue, stated precisely rather than waved at: in the Metrics and Assistant sidebar
sections only, the *filtered* hero (lucide `SearchX`, from task 6.2's shared branch) differs in icon
system from the *no-data* hero (FontAwesome). Those two branches are mutually exclusive and are different
glyph concepts anyway, so nothing ever renders side by side in two styles. That is the smaller of the two
available regressions, and it is the one taken.

**Explicitly out:** the section-header "+" controls. `DashboardList.tsx:190-198` and all five
`SidebarItemList` headers (`:259-269`) render `<IconButton icon="+" />` — a literal `"+"` **character**,
not a FontAwesome icon. Converting one would make that header's "+" differ from the other five,
manufacturing the within-view inconsistency this decision exists to remove; converting all six is an
icon-system change beyond this ticket. All six stay as they are. (An earlier draft listed "`DashboardList`'s
header add icon" as in-scope; it has no FontAwesome referent.)

Every other `EmptyState` call site (proposal/patch-set review, settings, run history, assistant panel,
metrics page) keeps FontAwesome and belongs to HEL-443. `EmptyState` already dispatches on
`isValidElement`, so this remains a call-site-only change with no rendering change to the primitive.
Within the five enumerated sections, no two icons for the same thing differ; the residue is the two
mutually-exclusive out-of-scope sidebar branches named above. The final gate verifies the five sections
read consistently side by side.

## Risks / Trade-offs

- **Closing the pre-dispatch frame (D2) touches a gate HEL-528 deliberately left alone.** → The exclusion
  D2 relies on is a Redux fact this change adds, not a re-litigation of 2.4b's reasoning; HEL-528's own
  no-skeleton assertions at both no-fetch-coming states are kept and must stay green.
- **D5a moves state out of a component mid-session while `PanelList.tsx` is heavily tested.** → Smallest
  possible lift: one boolean, two setters, one render site; no change to the dashboard-selected gate.
- **Two of the three filter-empty surfaces are shared components** (`SidebarItemList` serves five
  sections). → `emptyCta` is additive and defaulted, and the filter branch is uniform across all sections
  by construction, which is the consistency the ticket asks for rather than a risk to it.
- **The copy is the deliverable.** → Registry copy must name pipelines and must not offer a create-type
  path; filter copy must quote the query. Judged at the gate on reading, not on token compliance.

## Planner Notes

Self-approved, none meeting the escalation bar (no new dependency, no API break, no architectural change):
(a) absorbing HEL-770, which the user pre-authorized and whose own text names HEL-548 as this surface's
owner; (b) D1's additive slice field and D2's gate revision, required by the ticket's own "no section
renders blank" criterion; (c) D4a's `emptyCta` prop; (d) D5a's modal-state lift onto the existing
three-sibling convention; (e) D8's bounded lucide conversion; (f) D6's one-line widening of
`createDashboard`'s `catch` to produce a real message — without it the absorbed HEL-770 criterion is
unmeetable; (g) D6a's `variant="banner"` upgrade to `DashboardList`'s create-failure report, without which
removing the toast is an §8 regression rather than a cleanup; (h) exporting `EmptyStateCta` (type-only).

Follow-up candidates, flagged and not fixed:
- `MobileNavSheet.tsx:203-205`'s bare `<p>` empty branch (see Non-Goals for why it is excluded here).
- The sidebar's Data Sources and Metrics "+" buttons have F-045's set-flag-nothing-mounted bug today,
  since `SidebarBody` dispatches `setAddSourceModalOpen`/`setCreateMetricModalOpen` from any route while
  those modals mount only on their own pages (D4b). Pre-existing; this change adds no such path.
- `SidebarItemList.renderEmpty()`'s no-`emptyIcon` fallback (`:250-252`) returns a bare `<p>` — currently
  unreachable, since all five call sites pass `emptyIcon`, but a latent §7 hole.
- `PipelineRiverView.tsx:256` renders a CTA-less `EmptyState` with two hand-rolled sibling buttons because
  the primitive takes one `cta` — outside the five sections.

Line-citation note: references were re-checked against the tree at `2eaf1d26` after round 1
(`SidebarItemList`'s header block is `:259-269`, `DataTypeSelectStep`'s `<p>` opens at `:221`, the 44px
media block is `:219-228`, and `App.tsx` is `frontend/src/app/App.tsx`).
