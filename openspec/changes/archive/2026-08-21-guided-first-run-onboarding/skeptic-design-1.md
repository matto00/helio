## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Every claim below is derived from the files in this worktree at
`82186dd7` (`HEL-774`), read directly. No conclusion is taken from the planner's narrative.

### What I verified (with evidence)

**Grounding claims the brief flagged for independent check**

| Claim under test | Verdict | Evidence |
| --- | --- | --- |
| HEL-548 (`09a7a65c`) shipped four create-action hooks with a uniform `{cta, error, isPending}` | **TRUE** | `frontend/src/features/{dashboards/hooks/useCreateDashboardAction,panels/hooks/useCreatePanelAction,pipelines/hooks/useCreatePipelineAction,sources/hooks/useAddSourceAction}.tsx` — all four export `CreateActionResult` with those three fields |
| D5b reach constraint: pipeline = shell-mounted (any route); dashboard = thunk, no modal; source + panel = page-mounted flags | **TRUE** | `App.tsx:199-208` mounts `CreatePipelineModal` at the shell; `useCreateDashboardAction.tsx:34-44` dispatches the thunk directly; `useAddSourceAction.tsx:27` sets `addSourceModalOpen`, read only at `SourcesPage.tsx:116`; `useCreatePanelAction.tsx:39` sets `panelCreationModalOpen`, read only at `PanelList.tsx:336` |
| HEL-548's `staleDashboardId` discriminator exists and `PanelList` reads it | **TRUE** | `panelsSlice.ts:48` (field), `:120` (set on `markDashboardPanelsStale`), `:142` (cleared on `fetchPanels.pending`); read at `PanelList.tsx:101` and `:454` |
| D3's claim that route `/` never dispatches `fetchSources`/`fetchPipelines` | **TRUE** | `App.tsx:119-128` dispatches only `fetchDashboards()` and `fetchPanels(selectedDashboardId)`. Every `fetchSources`/`fetchPipelines` dispatch site is `SourcesPage.tsx:36`, `AddSourceModal.tsx:90`, `CreatePipelineModal.tsx:38`, `PipelineDetailPage.tsx:186`, `LookupConfig.tsx:46`, `UnionConfig.tsx:37`, `ShapeInstantiateStep.tsx:95`, `PipelinesPage.tsx:31`, `PanelCreationModal.tsx:202`, `usePickerSelection.ts:86-89` (gated `pickerId === "registry"`), `SidebarBody.tsx:78-95` (gated `section === "sources"`/`"pipelines"`/`"registry"`). `/` resolves to `pickerId: "dashboards"` (`sections.ts:58-66`), so none fire. |
| The plan does **not** disturb HEL-528 task 2.4b | **TRUE** | Both zero-content branches (`PanelList.tsx:402-440`, `:452-461`) sit *inside* `!(showPanelGridSkeleton \|\| showBootstrapSkeleton)` (`:400`). Mounting there inherits the gates untouched; task 4.3 forbids altering them. The brief's suspicion does not bear out. |
| D8's §3 Fraunces citation is accurate to the current `DESIGN.md` | **TRUE** | `DESIGN.md:225-226` — "**Where Fraunces goes** [judgment]: the wordmark, auth headlines, main empty-state titles." (§6:314 independently says `EmptyState` `main` titles are Fraunces; both statements exist, design's §3 cite is the more precise one) |
| D6's §5 quote "one primary per view/section" | **QUOTE TRUE, APPLICATION FALSE** | `DESIGN.md:262-263` reads verbatim "One primary per view/section." But `.panel-list__add` (`PanelList.css:48-62`: `background: var(--app-accent); color: var(--app-accent-ink)`) is a persistent second Primary in the same view — see CR7 |
| Other DESIGN.md cites (tasks 2.4/2.5/2.9/2.10/2.12) | **ALL TRUE** | §3 tokens `:82`, Motion "one entrance per surface" `:230-246`, §8 focus ring `:366-369`, §5 `IconButton` required `aria-label` `:275-308`, §3 Control metrics 44px floor `:193-211` (incl. HEL-774's `::after` hit-expander clause). No cited rule or exception is fabricated. |
| HEL-774 (`82186dd7`) names HEL-554 as the icon-only-nav mitigation | **TRUE** | `openspec/changes/archive/2026-08-21-liquid-glass-bottom-nav/design.md:124-129` and `:339-341`. It also records that the Data Types glyph was the weakest read (`BookOpen` → `Shapes`, `sections.ts:84-93`). See CR9. |
| No pre-existing onboarding surface | **TRUE** | `grep -rni "getting started\|onboarding" frontend/src` → no hits |

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/{first-run-onboarding,frontend-panel-empty-state,workspace-create-actions}/spec.md`,
plus the two shipped specs `openspec/specs/workspace-create-actions/spec.md` and
`openspec/specs/frontend-panel-empty-state/spec.md`, and current `DESIGN.md` (373 lines,
last touched by `82186dd7`).

No browser was launched: no code exists yet at this gate, and every finding below is
derivable from the artifacts and the shipped source.

### Verdict: REFUTE

The plan is unusually well-grounded — its factual claims about today's code are almost all
correct, and D8's copy is the strongest part of it. But the two decisions that govern
*whether the surface ever appears* (D2) and *whether it survives long enough to be a
checklist* (D1 vs D2/D7) contradict each other and D3. Implemented literally, this ships a
feature that renders for nobody; implemented with the obvious local patch, it ships a
checklist that unmounts the instant the user completes its first step. Neither is
recoverable inside execution without re-deciding the design, so it belongs here.

### Change Requests

1. **D2 and D3 are mutually exclusive; as written the checklist can never render on route
   `/` for anyone.** Task 1.5 / D2 define eligibility as `... && sources.status ===
   "succeeded" && sources.items.length === 0 && !dismissed`. Task 1.7 / D3 dispatch
   `fetchSources()` **"when the surface becomes eligible."** Nothing else on `/` fetches
   sources (verified above — `App.tsx:119-128` plus the `section === "sources"` gate at
   `SidebarBody.tsx:78-80`, and `/` is `pickerId: "dashboards"`). So `sources.status`
   starts and stays `"idle"` → never eligible → the fetch never fires → never
   `"succeeded"`. Closed loop. The canonical target user — signed up, lands on `/`, has
   never visited `/sources` — sees nothing, ever.

   D3's own prose confirms the contradiction independently of the deadlock: *"each step
   renders an indeterminate state — not an unchecked one — **until its status resolves**"*
   requires the surface to be **on screen while `sources.status` is unresolved**, which is
   exactly what D2's gate forbids.

   Required: split the one overloaded notion of "eligible" into two explicitly named,
   separately specified gates — a **fetch-trigger gate** derivable only from what route `/`
   actually resolves (`dashboards.status === "succeeded"`, `dashboards.items.length === 0`,
   `!dismissed`), and a **presentation gate**. State in task 1.7 which of the two it keys
   off. Any gate that makes the fetch conditional on the fetch's own result is not
   implementable.

2. **D1 and D2/D7 contradict each other; content-gated eligibility makes the checklist
   unmount the moment the user completes any step, so the ticket's core AC is
   unsatisfiable.** Eligibility includes both `sources.items.length === 0` and
   `dashboards.items.length === 0`:
   - completing **step 1** (add a source) makes `sources.items.length === 0` false → the
     surface disappears one step in, leaving the user on the plain "No dashboards yet"
     empty state with no guidance for steps 2–4;
   - completing **step 3** (create a dashboard) makes `dashboards.items.length === 0` false
     → the surface disappears again.

   Step 3 is fatal to D1's own stated rationale. D1 justifies covering both zero-content
   branches because *"covering only the zero-dashboard branch would make the surface vanish
   the moment step 3 completes."* It vanishes anyway — D2's gate kills it independently of
   which branch hosts it. D1 assumes a visibility that is not content-gated; D2 and D7
   specify one that is. Both cannot hold.

   D7 confirms the intended (broken) semantics in as many words: *"Completion is not stored
   separately — a completed account has content and is therefore no longer eligible."*

   The spec delta enshrines the contradiction inside a single file:
   `specs/first-run-onboarding/spec.md` asserts both *"Scenario: A step checks off when its
   resource exists — **WHEN** the user creates a data source, a pipeline, a dashboard, or a
   panel — **THEN** the corresponding step is shown as complete"* and *"Scenario: A
   returning user with content never sees the checklist automatically — **WHEN** a
   signed-in user has at least one dashboard, or at least one data source — **THEN** the
   checklist is not presented."* Those two `SHALL`s cannot both be satisfied for the source
   or the dashboard case. Ticket AC #2 ("Steps reflect real completion (creating a
   source/pipeline/dashboard/panel checks the step)") is unreachable under D2.

   Required: decide and document the **missing sticky/active concept** D1 silently depends
   on — specifically (a) the one-shot first-show trigger vs. the stay-shown condition, (b)
   where "active" lives (Redux, `localStorage`, or session), (c) what ends it (explicit
   dismiss only? all four steps complete? does a completed checklist show a done state
   before it goes?), and (d) restate the spec scenarios so the check-off scenario and the
   suppression scenario are no longer in direct conflict.

3. **The re-open affordance (D9 / task 4.4) is inert for exactly the users D2 says it is
   for.** D2 states *"the Getting-started affordance remains available to everyone."* But
   the surface renders only inside `PanelList`'s two zero-content branches (D1), and a user
   with a dashboard that has panels hits neither (`PanelList.tsx:400-461`). Activating
   "Getting started" would clear the stored dismissal (a real, persisted side effect) and
   navigate to `/`, and then show nothing — a menu item that silently does nothing for the
   majority of users, while quietly mutating stored state. The change's own delta forbids
   this: *"Scenario: The re-open affordance restores the checklist — **THEN** the checklist
   is presented again, on the surface that hosts it."*

   Required: pick one and specify it — gate the menu item's *presence* on the surface being
   reachable, or make an explicit re-open a visibility path that bypasses the content-based
   gate (which CR2's sticky-active concept would naturally provide).

4. **`UserMenu.tsx` cannot be wired without editing `CommandBar.tsx`, which sits inside
   HEL-773's fence — and the plan names neither.** `UserMenu` is purely prop-driven
   (`UserMenu.tsx:49-55`: `currentUser`, `onNavigateToSettings`, `onLogout`) with no
   `useNavigate` and no `useAppDispatch`. A working "Getting started" item needs either a
   new callback prop supplied at its single render site, `CommandBar.tsx:254`, or for
   `UserMenu` to start calling hooks itself (a pattern change that pulls Router + store
   providers into `UserMenu.test.tsx`). D9 calls the item *"additive"* and never mentions
   the parent; `proposal.md`'s Impact list omits `CommandBar.tsx` entirely; task 4.5 fences
   `MobileNavSheet.*` and says nothing about `CommandBar`.

   This matters because `CommandBar.tsx:160` is `onClick={onOpenMobileNavSheet}` — literally
   "the control that opens the sheet", the artifact the scope fence assigns to the
   concurrent HEL-773 run.

   Required: name `CommandBar.tsx` in Impact and in a task, choose the wiring approach
   (prop vs. hooks-in-`UserMenu`, with its test consequence stated), and state explicitly
   where the HEL-773 fence line falls inside that file — or escalate if it falls across the
   edit.

5. **Task 3.6 and the `workspace-create-actions` delta probe a failure mode that cannot
   occur, and miss the one the shipped spec already forbids.** The shipped capability
   requires: *"A visibility flag held in shared state SHALL be cleared when the surface that
   mounts its flow unmounts"* (`openspec/specs/workspace-create-actions/spec.md`, plus its
   scenario "A visibility flag does not survive its surface unmounting").
   `PanelList.tsx:193-197` implements this for `panelCreationModalOpen`. **`SourcesPage.tsx`
   does not** — its only effect is the fetch effect (`:28-42`), and `addModalOpen` is never
   reset on unmount.

   So the realistic leak D4's pairing walks into is not "interrupted navigation" but:
   step 1 → `/sources` → modal opens → user navigates away with it open (bottom nav, browser
   back, Cmd/Ctrl+K) → `SourcesPage` unmounts with the flag still `true` → next visit to
   `/sources` opens the modal unbidden. That is a plausible path for a confused first-run
   user, and it is the exact defect the shipped spec names.

   Meanwhile "an interrupted navigation" is not a reachable state in this app — there is no
   route blocker anywhere, so `navigate("/sources")` always completes. Task 3.6 and the
   delta's third scenario therefore encode a probe that **can never go red**, which the
   ticket's own binding rule ("A test that cannot fail is worse than no test") forbids, and
   which would ship into a permanent spec.

   Required: replace the probe in task 3.6 and in the delta scenario with the
   unmount-with-flag-set path, and decide explicitly whether to add the missing cleanup
   effect to `SourcesPage` (not fenced; mirrors `PanelList.tsx:193-197` exactly) or to
   accept and record the residual.

   *For the record, D4's core pairing is upheld as a genuine reach, not a rationalisation.*
   `dispatch(setAddSourceModalOpen(true))` and `navigate("/sources")` in one handler batch
   into a single commit, so `SourcesPage` first renders with the flag already `true` and
   there is no window in which the flag is set with nothing mounted. That is structurally
   different from "set and hope", and D4's insistence on verifying it live (task 3.5) is
   right. The problems are the wrong probe (above) and the delta's shape (CR6) — not the
   decision.

6. **The `workspace-create-actions` delta should be `## MODIFIED Requirements`, not
   `## ADDED`.** It carves an exception into a shipped `SHALL` — *"A create action SHALL
   therefore be wired only where its flow is actually mounted, and this change SHALL
   introduce no flag-set-with-nothing-mounted path"* — but leaves that sentence standing
   verbatim. On archive the capability would assert both "wired only where its flow is
   mounted" and "may be wired elsewhere when paired with navigation", with nothing
   indicating which governs. Restate the existing requirement under `## MODIFIED
   Requirements` with the reach carve-out written into it.

7. **D6's conclusion "This satisfies §5" is false as written, and would become a false code
   comment.** `.panel-list__add` (`PanelList.css:48-62`) is the Primary recipe — solid
   `var(--app-accent)`, `var(--app-accent-ink)` ink — and is unconditionally mounted in
   `PanelList`'s header (`PanelList.tsx:288-297`). The view will still carry two primaries
   whichever step gets the Primary recipe. (This is pre-existing: today's header primary +
   `EmptyState`'s `.ui-empty-state__cta`, also the Primary recipe per `EmptyState.css`,
   already coexist.) D5's supersede-not-stack decision is *correct* — two beats three — but
   D6 must say what is actually achieved ("no additional primary beyond the one the header
   already carries") rather than claiming §5 compliance the surface will not have. The
   brief flags this failure mode by name: HEL-774 burned a cycle on a shipped comment citing
   a rule the file did not support.

8. **D6's primary-assignment rule is undefined once D3 introduces a third step state.** D6
   says *"Only the first incomplete step renders the §5 Primary recipe"*, but task 1.4 adds
   `indeterminate` as a state distinct from both `complete` and `incomplete`. While the
   sources/pipelines fetches are unresolved — which per D3 is precisely when the surface is
   first painted — steps 1 and 2 are `indeterminate`, not `incomplete`. A competent
   implementer can read this two ways: the Primary lands on step 3 ("Create a dashboard"),
   jumping the user past the very step the surface exists to teach; or no step renders a
   Primary at all and the checklist paints with no action. Neither is specified.

   Compounding this, **no task anywhere says what an `indeterminate` step looks like** —
   tasks 2.1–2.12 never mention the state that task 1.4 and the spec's *"An unresolved
   collection renders as indeterminate, not incomplete"* requirement both depend on. §7's
   "never a flash of empty content" and HEL-528's `Skeleton` primitive are the established
   treatments here and neither is named.

   Required: define the Primary-assignment rule under indeterminacy, and add a task
   specifying the indeterminate step's visual treatment.

9. **D8's copy does not discharge HEL-774's recorded risk, because that risk is a glyph
   problem and the plan is text-only.** HEL-774's design (`archive/2026-08-21-liquid-glass-
   bottom-nav/design.md:124-129`) accepts *"Six unlabelled glyphs are harder for a beta user
   still learning source -> pipeline -> type -> panel"* and names HEL-554 as the remedy —
   and separately records that the Data Types glyph is the weakest read, changing
   `BookOpen` → `Shapes` for that reason (`sections.ts:84-93`). D8's copy teaches the
   *vocabulary* well, but a user who reads "Connect a data source" still has no way to map
   the bottom nav's cylinder to it. The plan never mentions step icons at all.

   Required (cheap and on-pattern — `EmptyState` already renders lucide nodes): each step
   carries the same lucide icon its section uses, sourced from `sections.ts` /
   `navDestinations.ts` rather than re-picked, so the surface binds glyph→concept. Most
   importantly `Shapes` alongside the sentence that explains what a type is — the one glyph
   HEL-774 recorded as not reading on its own. Additionally, state explicitly that Metrics
   and Assistant (two of the six unlabelled tabs) are **out of scope** for this surface, so
   a later reader does not conclude HEL-774's risk was fully discharged when it was
   partially discharged by design.

### Non-blocking notes

- **The copy is the best part of this plan and should survive re-planning intact.** D8 is
  specific to Helio's model, not generic encouragement, and it is short. *"Shape that
  source into a type. Types are only ever a pipeline's output — you never create one
  directly."* is exactly the load-bearing sentence the ticket demands, and it earns its
  place. It does not read as patronising, cluttered, or as a generic product tour. Keep it
  through whatever CR2 forces.
- One polish note on that copy: step 4's *"Bind a panel to your type to see it"* — "it" is
  ambiguous (the type? the panel? the data?). *"Bind a panel to that type to see your
  data."* resolves it at no cost in length.
- The lede promises "four steps" while the chain names five concepts (source → pipeline →
  type → dashboard → panel). This is fine — the type is deliberately not a step because it
  has no create path, which is the point — but it is worth a sentence in D8 saying so, so a
  later reader doesn't "fix" it into five steps.
- D7's *"mirroring `ThemeProvider`'s mechanism"* slightly oversells the parallel:
  `ThemeProvider.tsx:76` and `:91` write to `localStorage` **without** try/catch, and only
  the reads are guarded (`theme.ts:65-72`, `:74-81`, via `typeof window`). Task 1.3
  correctly cites `App.tsx:39-45` / `:67-73` (`helio.sidebarCollapsed`) for the try/catch
  instead, so the plan lands in the right place — the design's phrasing is just looser than
  the tasks.
- Storage key: `helio-onboarding:<userId>` introduces a third separator convention
  alongside `helio-theme` / `helio-accent` (hyphen, `theme.ts:3-4`) and
  `helio.sidebarCollapsed` (dot). Harmless, but worth picking the hyphen family
  deliberately rather than by accident.
- No task covers the surface's **layout at 430px** — four steps plus lede plus title inside
  `PanelList`, above HEL-774's floating bottom-nav capsule. Task 5.4 measures tap targets
  and 5.5 covers themes, but nothing checks the surface fits or scrolls cleanly on a phone.
  Worth a line in §5.
- Task 2.6 requires `prefers-reduced-motion` be respected but §5's verification list never
  checks it on the running app. Worth adding, given §3's explicit warning at `DESIGN.md:242-244`
  that the global rule alone does not fully disable every animation.
- No task mentions the new component's CSS file, though tasks 2.4/2.5/2.12 all presuppose
  one. Cosmetic omission.
- `D2`'s handling of `staleDashboardId` is correct and I could not break it: never reading
  `panels.status === "idle"` as a signal is consistent with `panelsSlice.ts:48/120/142`, and
  first-run detection as designed does not fight the discriminator.
