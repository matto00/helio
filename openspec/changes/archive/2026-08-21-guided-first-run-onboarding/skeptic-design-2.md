## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Every finding below is derived from the files in this worktree at `82186dd7`
(`HEL-774`), read directly, plus one reproduced runtime probe. Round 1's conclusions were
re-derived, not inherited — where I agree with it, I say so because I checked, not because
it said so.

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all three
spec deltas, `skeptic-design-1.md`, the two shipped specs
(`openspec/specs/{workspace-create-actions,frontend-panel-empty-state}/spec.md`), and the
current `DESIGN.md` (373 lines, last touched by `82186dd7`).

**Source read as ground truth:** `PanelList.tsx` (full), `PanelList.css`, `SourcesPage.tsx`
(full), `EmptyState.tsx`/`.css`, all four HEL-548 hooks, `App.tsx`, `main.tsx`,
`sections.ts`, `SidebarBody.tsx`, `usePickerSelection.ts`, `UserMenu.tsx`/`.css`/`.test.tsx`,
`CommandBar.tsx`, `ProtectedRoute.tsx`, `store.ts`, `test/renderWithStore.tsx`,
`panelsSlice.ts`, `dashboardsSlice.ts`, `theme.ts`, `jest.config.cjs`.

**One runtime probe, reproduced twice** (temporary Jest file, run, deleted; `git status`
confirmed the worktree is byte-identical afterwards — only the untracked change dir remains).

| Claim under test | Verdict | Evidence |
| --- | --- | --- |
| `/` still dispatches only `fetchDashboards`/`fetchPanels` | **TRUE** | `App.tsx:119-129`. Every other `fetchSources()`/`fetchPipelines()` site re-enumerated by grep: `SourcesPage:36`, `AddSourceModal:90`, `CreatePipelineModal:38`, `PipelineDetailPage:186`, `LookupConfig:46`, `UnionConfig:37`, `ShapeInstantiateStep:95`, `PipelinesPage:31`, `PanelCreationModal:202`, `usePickerSelection:86-89` (gated `pickerId === "registry"`), `SidebarBody:78-95` (gated `section === "sources"/"pipelines"/"registry"`). `/` is `pickerId: "dashboards"` (`sections.ts:58-66`) → none fire. |
| D3's new fetch-trigger is non-circular | **TRUE** | It keys only on `dashboards.*`, which `App.tsx:120` does fetch. Round 1's closed loop is genuinely broken. |
| `.panel-list__add` is an unconditional Primary in this view | **TRUE** | `PanelList.tsx:288-297` (no conditional); `PanelList.css:48-62` — `background: var(--app-accent); color: var(--app-accent-ink)`. Its own comment (`:45-47`) already claims "the one primary action of this view", which `.ui-empty-state__cta` (`EmptyState.css:102-114`, same recipe) already falsified. D6's revised wording is accurate. |
| D8's glyphs exist and are the ones cited | **TRUE** | `sections.ts:9` imports `Database`, `LayoutDashboard`, `Shapes`, `Workflow`; entries at `:58-93` map them to `/`, `/sources`, `/pipelines`, `/registry`. `LayoutGrid` is the panel empty state's icon (`PanelList.tsx:456`). The `Shapes` swap and its HEL-774 rationale are in-file at `sections.ts:80-90`. |
| Every `DESIGN.md` cite in tasks 2.7/2.8/2.9/2.13/2.15/2.16/2.18 | **ALL TRUE** | Fraunces `:224-225`; type/space/weight tokens `:187-228`; Motion `--transition-slow` + "fade + 4–10px rise" + "one entrance per surface" `:230-246`; §7 "never a flash of empty content" / "never render nothing" `:352-362`; §8 focus ring `:366-369`; §6 `IconButton` required `aria-label` `:313-315`; §5 "One primary per view/section." `:262-263`; §3 44px floor at 430/768 **plus** HEL-774's `::after` hit-expander clause `:193-211`. No fabricated rule or exception. |
| `UserMenu` is reachable from Router + store at every render site | **TRUE** | Its only render site is `CommandBar.tsx:254`; `CommandBar` renders only at `App.tsx:155`, under `main.tsx:56-63`'s `BrowserRouter` + `Provider`. `renderWithStore` supplies `MemoryRouter` + `Provider` (`renderWithStore.tsx:281-289`). D9's hooks-in-`UserMenu` wiring does not require touching `CommandBar.tsx`, so HEL-773's fence holds by this route. |
| `PanelList.tsx:193-197` is the unmount-cleanup pattern; `SourcesPage.tsx` lacks it | **TRUE** | `PanelList.tsx:193-197` verbatim; `SourcesPage.tsx`'s only effect is the fetch effect `:28-42`, and `addModalOpen` (read at `:116`) is never reset. |
| The `workspace-create-actions` delta faithfully restates the shipped requirement | **TRUE** | Diffed against `openspec/specs/workspace-create-actions/spec.md`: all four original paragraphs and all four original scenarios are carried verbatim under `## MODIFIED Requirements`, with the carve-out and unmount-generalisation added. |
| `createDashboard.fulfilled` auto-selects the new dashboard | **TRUE** | `dashboardsSlice.ts:281-283` — so step 3 genuinely unlocks step 4's `disabled` (`useCreatePanelAction.tsx:29-30`). |
| **`<React.StrictMode>` is live** | **TRUE** | `main.tsx:57`. React 19.2.5 installed. |

**Probe (reproduced twice).** A component that mounts with a Redux visibility flag already
`true` and carries the exact `PanelList.tsx:193-197` cleanup, rendered under `StrictMode`:

```
PROBE RESULT   >>> flag after mount: false | DOM says: MODAL CLOSED
CONTROL RESULT >>> flag after mount: false   (PanelList's own case — flag started false, harmless)
```

That is the D4 pairing's exact shape, and it fails. See CR2.

---

### Round 1 CR checklist

| # | Round-1 CR | Status |
| --- | --- | --- |
| 1 | Circular fetch/eligibility gate | **Partially closed** — loop broken, but the trigger's *host* is unnamed and reads as the surface itself (CR3 below); and the re-open path never fetches at all (CR1 below) |
| 2 | Content-gated eligibility → vanishes on completion | **Closed in the state model**, one residual placement ambiguity (CR4) |
| 3 | Inert re-open affordance | **Still open** — it now renders, but with two permanently-skeletal steps (CR1) |
| 4 | `CommandBar.tsx` / HEL-773 fence | **Closed** (verified above); one unnamed impact file (CR8) |
| 5 | Unfalsifiable probe + missing `SourcesPage` cleanup | **Probe fixed; cleanup decision is broken** (CR2) |
| 6 | Delta should be `MODIFIED` | **Closed** (verified verbatim restatement); one wording note |
| 7 | False "This satisfies §5" | **Closed** — D6 now states what is actually achieved, and it is accurate |
| 8 | Primary assignment under indeterminacy | **Closed**; a sibling gap it exposes is open (CR6) |
| 9 | Glyphs | **Closed** — glyphs verified, Metrics/Assistant explicitly scoped out |

I traced the sticky-`active` model through all four completions, as asked. Step 1
(`sources.items.length`) and step 3 (`dashboards.items.length`) now appear *only* in the
trigger/activation gates, which task 1.3/1.8 forbid from ever clearing `active`; steps 2 and
4 touch no gate at all. The round-1 fatal defect is genuinely gone. The one residual is
structural, not stateful, and is CR4.

### Verdict: REFUTE

The two decisions round 1 killed have been re-decided correctly in principle. What the
rewrite did not do is re-trace the *consequences* of the new gates. The fetch trigger is now
so narrow that the re-open path — the very path CR3 existed to fix — can never satisfy it, so
"Getting started" now shows a checklist that is permanently half-skeleton for exactly the
users it was added for. And D4's two halves, each individually right, destroy each other
under the StrictMode this repo runs: I reproduced it. Both are re-decisions, not
implementation details, so they belong at this gate.

---

### Change Requests

1. **The re-open path never fetches, so the checklist it opens is permanently
   indeterminate — CR3 is not closed.** The fetch trigger (D3 / task 1.6) is
   `dashboards.status === "succeeded" && dashboards.items.length === 0 && !dismissed &&
   !active`. A user who re-opens from `UserMenu` fails it twice over: they have dashboards,
   and `active` was just set. Nothing else on `/` fetches sources or pipelines (verified
   above against every dispatch site), so `sources.status` and `pipelines.status` stay
   `"idle"`, and task 1.9 renders any `"idle"` step as `indeterminate` — a `Skeleton`
   (task 2.13) that never resolves, for as long as the user looks at it.

   The same holds for the empty-but-dismissed user: `!dismissed` blocks the trigger on load,
   and `!active` blocks it after the re-open clears the dismissal. **Every** re-open path
   lands in this state.

   This change's own delta forbids the outcome, twice:
   - *"Scenario: Re-opening works for a user who already has content — **THEN** the
     checklist is activated and presented, **with its completed steps shown complete**"* —
     their source and pipeline steps can never show complete.
   - *"The system SHALL fetch every collection the checklist reports on … so no step reports
     a completion state that was never observed."* — on re-open it fetches nothing.

   Note this also makes step 1's `indeterminate` state pathological in *both* directions: on
   the auto path it is unreachable (activation requires `sources.status === "succeeded"`), and
   on the re-open path it is permanent. D10's treatment is never once the transient it was
   designed as.

   Required: separate "what triggers the fetches" from "what triggers auto-activation"
   *completely* — the fetches must be dispatched whenever the checklist is `active` **or**
   the auto-activation trigger is armed, guarded on `status === "idle"` (the
   `SourcesPage.tsx:29-37` F-072 pattern, which also avoids the duplicate `GET
   /api/data-sources` task 1.7's unguarded "dispatch once" would issue for a user who
   already has sources loaded). State this in D3 and in tasks 1.6/1.7, and add a test to §6
   that re-opens from a state with dashboards present and asserts both collections are
   fetched and both steps resolve.

2. **D4's two halves destroy each other under `<React.StrictMode>`; task 3.4 + task 3.5
   cannot both ship as written. Reproduced.** Task 3.4 sets `addSourceModalOpen` and
   navigates in one commit, so `SourcesPage` first renders with the flag already `true`.
   Task 3.5 then adds "the missing unmount cleanup … **mirroring `PanelList.tsx:193-197`**".
   `main.tsx:57` wraps the app in `React.StrictMode`, whose dev double-invoke runs that
   cleanup once at mount — clearing the flag before the user ever sees the modal.

   `PanelList`'s own comment states the precondition that makes it safe there, and D4's
   pairing is precisely the case that breaks it:

   > `PanelList.tsx:190-192` — *"StrictMode's dev double-invoke fires this cleanup once at
   > mount too — **harmless, since the flag starts `false`** — so don't 'fix' that by
   > deleting the reset."*

   I built the exact shape (flag `true` at mount + that cleanup + `StrictMode`) and ran it
   twice: `flag after mount: false | DOM says: MODAL CLOSED`. The control (flag starting
   `false`, i.e. `PanelList` today) is unaffected. So step 1 would navigate to `/sources` and
   silently open nothing — and task 3.6 ("verify on the running app that the source modal
   opens after that navigation") would fail on the dev server, as would any Jest test of the
   pairing, since both run React's dev build.

   Required: decide how the two coexist and record it in D4 — e.g. a cleanup that only
   clears a flag this mount actually opened, or opening the modal after mount rather than
   before it (without reintroducing a flag-set-with-nothing-mounted window). Whatever is
   chosen, task 3.6 must state that the pairing is verified **under StrictMode**, and the
   guard from task 3.7 must be proven red against the naïve mirror before it is trusted
   green — this is exactly the "a test that cannot fail" trap the ticket's verification
   standard names, arriving as "a probe that fails for the wrong reason".

3. **Nothing names the always-mounted host that evaluates the trigger, and the design says
   "the surface" — which only exists when `active` is false is impossible.** D3: *"on that
   edge **the surface** dispatches `fetchSources()` and `fetchPipelines()` once."* D1: *"**The
   surface** renders there whenever it is active."* The trigger requires `!active`; the
   surface exists only when `active`. Read literally — and "the surface" is used
   consistently for the rendered component throughout D1/D3/D5/D6 — this reinstates round
   1's closed loop in a new costume. Tasks 1.6–1.8 name no host either.

   Required: one sentence in D3 and in task 1.6 naming the evaluator explicitly — an
   onboarding hook called unconditionally from `PanelList` (always mounted on `/`,
   `AppRoutes.tsx`), never from the checklist component. Then say the same for
   auto-activation, which has the identical constraint.

4. **The surface's position relative to `showPanelGridSkeleton` / `showBootstrapSkeleton` is
   unspecified, and the obvious reading makes it vanish at step 3 → 4.** Both zero-content
   `EmptyState`s live inside `PanelList.tsx:400`'s
   `!(showPanelGridSkeleton || showBootstrapSkeleton)` block. Task 4.1 says only "the top of
   `PanelList`'s content area"; task 4.2 ties the surface to superseding those empty states;
   task 4.3 forbids touching the gates. An implementer who mounts it alongside what it
   supersedes puts it inside that block — and `createDashboard.fulfilled` auto-selects the
   new dashboard (`dashboardsSlice.ts:281-283`), which makes `showPanelGridSkeleton` true
   (`status === "idle"`, `staleDashboardId !== selectedDashboardId`, `items.length === 0`,
   `PanelList.tsx:99-102`) for the whole `fetchPanels` round trip. The checklist would blink
   out at exactly the completion CR2 was raised about, and task 5.3 ("the surface stays
   visible throughout") could not pass.

   Required: state in D1/task 4.1 whether the surface mounts inside or outside line 400's
   gate, and what it renders during both skeleton windows.

5. **On the auto path the "No dashboards yet" hero paints before the checklist replaces it —
   a flash on the one surface this ticket exists to perfect.** Sequence for a genuinely empty
   account: `showBootstrapSkeleton` drops the moment `fetchDashboards` resolves
   (`PanelList.tsx:122-125`); the `dashboards.length === 0` `EmptyState` at
   `PanelList.tsx:414-432` renders immediately; the trigger's effect then dispatches
   `fetchSources()`; only when that resolves does activation supersede it. So a first-run
   user sees *"No dashboards yet / Create your first dashboard…"* plus its Primary "New
   dashboard" button for a full network round trip, then watches it be replaced by
   *"Build your first dashboard"*. `DESIGN.md:352-357` ("never a flash of empty content") is
   the standard, and worse, the flashed CTA is **step 3** — the user is invited to skip the
   lesson before it appears. Task 5.2 checks only the opposite direction (that the checklist
   does not flash for a user with content), so nothing in the plan catches this.

   Required: decide what the region renders between "dashboards resolved empty" and "sources
   resolved" and record it in D3/D5 — the machinery already exists (D10's indeterminate step
   is exactly the honest treatment for an unresolved collection). Add it to §5's
   verification list.

6. **The button recipe for the three non-emphasised steps is unspecified, and the tasks'
   singular "the action" contradicts the spec's per-step actions.** D6 and task 2.11 say
   "**the** action lands on the first step that is not `complete`", and task 2.12 assigns it
   Primary or Secondary by placement. But `specs/first-run-onboarding/spec.md` requires
   *"Each step's action opens that step's real creation flow"* and *"its action can still be
   activated"* while indeterminate — so all four steps carry an action, and three of them
   have no recipe assigned. `DESIGN.md:259-273` offers four, and "A new button style is a
   defect, not a variant." Four stacked Secondaries and one Ghost-plus-one-Primary are very
   different surfaces; this is the plan's single largest un-made visual decision.

   Required: say which §5 recipe the non-emphasised steps use (Ghost is the obvious fit), and
   reword task 2.11 so "the action" reads as "the emphasised action" rather than implying
   only one step is actionable.

7. **The `frontend-panel-empty-state` delta contradicts itself for the post-delete state.**
   The delta added *"**AND** no guided first-run surface is active"* to the
   `succeeded`-with-no-panels scenario, but left the sibling scenario untouched:
   *"Scenario: Empty state renders after the dashboard's last panel is deleted … **THEN** the
   panel area displays the same empty state and its 'Add panel' action"*. With the checklist
   active (trivially reachable: re-open, then delete the last panel), that scenario demands
   the empty state render while the requirement's own new paragraph and task 4.2 demand it
   not. Two scenarios in one requirement, disagreeing about one state — the exact archival
   hazard round 1's CR6 was about, landing in a different file.

   Required: qualify the post-delete scenario the same way, or add the superseding case to it.

8. **`test/renderWithStore.tsx` is an unnamed impact file and every touched test depends on
   it.** Its reducer map (`renderWithStore.tsx:159-171`) is maintained independently of
   `store.ts:23-37` and does not list a new `onboarding` slice. Task 1.2 names only
   `store.ts`; the proposal's Impact names neither. Tasks 4.6 (`UserMenu.test.tsx` moves to
   `renderWithStore`) and 6.8 (extend `PanelList.test.tsx`) both route through it, so any
   `state.onboarding` read is `undefined` in every test until it is added.

   Required: name `frontend/src/test/renderWithStore.tsx` in the proposal's Impact and in
   task 1.2.

---

### Non-blocking notes

- **The copy is genuinely good, and I formed that view independently before reading round
  1's.** *"Shape that source into a type. Types are only ever a pipeline's output — you never
  create one directly."* is the load-bearing sentence the ticket demands, and it is one
  sentence, not a paragraph. The whole surface is ~55 words. "Bind … to that type to see your
  data" uses the app's own vocabulary (`SourcesPage.tsx:109` already says "a bindable type
  with a pipeline"), so it teaches a word the user will meet again. It does not read as
  patronising, cluttered, or as a generic product tour. Keep it verbatim through whatever
  CR1–CR6 force; task 2.2's "verbatim" instruction is right.
- The design should record, as an accepted trade-off rather than leaving it to be discovered,
  that `active` lives only in Redux while auto-activation is content-gated: an empty user who
  completes step 1 and then reloads gets no checklist back automatically (sources is no
  longer empty) despite never dismissing it. That is defensible under the ticket's AC, but it
  makes the re-open affordance the *only* recovery path — which is why CR1 matters more than
  it looks.
- Nothing tells a user who has just completed step 1 on `/sources` how to get back to the
  checklist. The nav provides a way; the surface provides no return affordance and the lede
  promises a four-step sequence. A line in D1 acknowledging this would stop a later reader
  treating it as an oversight.
- Task 4.4 should say the new item reuses `.user-menu__item`, which already carries the 44px
  floor at ≤768 (`UserMenu.css:138-140`); a hand-rolled class would silently miss it. Task
  5.5's "every interactive control" should name that item explicitly, since it lives outside
  the new component.
- Task 2.7 cites `DESIGN.md:224-226` for Fraunces; the bullet is `:224-225` (`:226` starts
  Eyebrows). Trivial, but this ticket's brief specifically warns about cite drift.
- The `workspace-create-actions` delta keeps *"A create action SHALL therefore be wired only
  where its flow is actually mounted"* absolute while adding a carve-out beneath it. The
  carve-out is clearly labelled and self-describing, so I do not consider it blocking — but
  "…actually mounted, except as carved out below" would remove the standing contradiction at
  zero cost. Separately, the restated *"**this change** SHALL introduce no
  flag-set-with-nothing-mounted path"* now dangles across two changes; it was already like
  that in the shipped text, so it is inherited rather than introduced.
- A bespoke checklist component is justified under §6: `EmptyState` takes `title`/`description`
  as `string` and accepts no children (`EmptyState.tsx:24-46`), so a four-step list cannot be
  composed from it. Tasks 2.13/2.16 correctly reach for `Skeleton` and `IconButton` rather
  than hand-rolling them.
- `PanelList.css:45-47` already claims "'Add panel' is the one primary action of this view",
  which `.ui-empty-state__cta` falsified before this ticket existed. Not this change's to fix,
  and D6 correctly declines to make the same claim.
