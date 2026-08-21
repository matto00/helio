## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Every conclusion below is derived from the files in this worktree at `82186dd7`
(`HEL-774`), read directly. I read `skeptic-design-2.md` to know what the eight CRs were, and
then re-derived each verdict from source rather than accepting round 2's — where I agree with
it, it is because I checked.

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas,
`skeptic-design-2.md`, the two shipped specs (`openspec/specs/workspace-create-actions/spec.md`,
`openspec/specs/frontend-panel-empty-state/spec.md`), and the current `DESIGN.md` (373 lines, last
touched by `82186dd7`).

**Source read as ground truth:** `PanelList.tsx` (full), `PanelList.css`, `SourcesPage.tsx` (full),
`EmptyState.tsx`, `StatusChip.tsx`, `AppRoutes.tsx`, `ProtectedRoute.tsx`, `main.tsx`, `App.tsx`,
`CommandBar.tsx`, `UserMenu.tsx`, `UserMenu.css`, `UserMenu.test.tsx`, `ThemeProvider.tsx`,
`theme.ts`, `SidebarBody.tsx`, `sections.ts`, `renderWithStore.tsx`, `dashboardsSlice.ts`,
`sourcesSlice.ts`, `pipelinesSlice.ts`, `CreatePipelineModal.tsx`, and all four HEL-548 hooks.

**Every line-number citation in `design.md`/`tasks.md` re-checked against the file. All exact:**

| Citation | Verdict |
| --- | --- |
| `PanelList.tsx:400` is `!(showPanelGridSkeleton \|\| showBootstrapSkeleton)` | TRUE |
| `PanelList.tsx:193-197` unmount cleanup; `:190-192` the *"harmless, since the flag starts `false`"* precondition | TRUE, verbatim |
| `PanelList.css:48-62` is the Primary recipe (`--app-accent` / `--app-accent-ink`), mounted unconditionally at `:288-297` | TRUE |
| `dashboardsSlice.ts:281-283` — `createDashboard.fulfilled` auto-selects the new dashboard | TRUE |
| `SourcesPage.tsx:29-37` is the F-072 `status === "idle"` guard pattern | TRUE |
| `main.tsx:57` `<React.StrictMode>` | TRUE |
| `App.tsx:119-128` dispatches only `fetchDashboards`/`fetchPanels` | TRUE (`:119-129`) |
| `App.tsx:39-45` / `:67-73` are the try/catch'd `helio.sidebarCollapsed` read+write | TRUE |
| `ThemeProvider`'s own `localStorage` write is unguarded (so D7 is right not to copy it) | TRUE (`ThemeProvider.tsx:73-77`) |
| `UserMenu.css:138-140` — `.user-menu__item { min-height: 44px }` at `≤768` | TRUE |
| `renderWithStore.tsx:159-171` reducer map, no `onboarding` | TRUE |
| `CommandBar.tsx:160` = `onOpenMobileNavSheet` (HEL-773's fence); `:254` renders `UserMenu` under `authStatus === "authenticated" && currentUser !== null` | TRUE — so `currentUser.id` is non-null there, and D9 needs no `CommandBar` edit |
| `DESIGN.md:224-225` = *"Where Fraunces goes … main empty-state titles"* | TRUE (`:226` starts Eyebrows) |
| §3 44px floor at 430/768 + HEL-774's `::after` hit-expander clause | TRUE, `DESIGN.md:193-211` |
| §5 "One primary per view/section" (`:265`); Ghost is one of the four recipes (`:270`); "A new button style is a defect, not a variant" (`:273`) | TRUE |
| §5 *"### Icon-only buttons"* is where `IconButton`'s **required** `aria-label` lives — so task 2.15's "(§5)" cite is right | TRUE (`:275`, `:294-296`) |
| §7 "never a flash of empty content" / "never render nothing" / "never swallow a failed fetch" | TRUE (`:352-362`) |
| §8 focus ring `outline: 2px solid var(--app-accent)`, offset `2px`, `-2px` where it clips | TRUE (`:366-369`) |
| `EmptyState` takes `title`/`description` as `string` and accepts no children | TRUE (`EmptyState.tsx:24-46`) — a bespoke checklist is justified under §6 |

No fabricated rule, section or exception. I found no cite drift anywhere in this round's artifacts.

---

### Round-2 CR checklist — per CR

| # | Round-2 CR | Status |
| --- | --- | --- |
| 1 | Re-open path never fetches | **Genuinely closed** |
| 2 | D4's StrictMode pairing | **Genuinely closed** |
| 3 | Unnamed always-mounted host | **Genuinely closed** |
| 4 | Placement vs. `PanelList.tsx:400` | **Genuinely closed** |
| 5 | "No dashboards yet" hero flash | **Genuinely closed** |
| 6 | Ghost recipe for non-emphasised steps | **Genuinely closed** |
| 7 | `frontend-panel-empty-state` self-contradiction | **Genuinely closed** |
| 8 | `renderWithStore.tsx` unnamed | **Genuinely closed** |

**CR1 — closed.** D3 now separates "what triggers the fetches" from "what triggers auto-activation":
the host hook dispatches `fetchSources()`/`fetchPipelines()` whenever the checklist is visible **or**
auto-activation is armed, each guarded on its own `status === "idle"` (tasks 1.9). The re-open path
lands on `/` (task 4.4 navigates there), where `PanelList` — the `AppRoutes.tsx:88` route element —
mounts and calls the hook. The delta gained matching scenarios ("Re-opening fetches too…",
"An already-loaded collection is not fetched again") and tests 6.4/6.5. Traced: a user with
dashboards who re-opens now resolves steps 1–2 instead of holding two permanent skeletons.
(Nit: `visible || autoActivate` is redundant — `visible` is *defined* as `active || autoActivate` in
task 1.8, so the second disjunct is dead. Harmless.)

**CR2 — closed, and I confirmed the escape rather than accepting it.** Step 1 is navigate-only
(D4/task 3.4) and sets no flag. The safety claim ("the flag is `false` at every mount") only holds if
*nothing* sets `addSourceModalOpen` from off-`/sources`, so I enumerated every writer in the tree:
`useAddSourceAction.tsx:27` (consumed at exactly one site, `SourcesPage.tsx:26`) and
`SidebarBody.tsx:131`'s `onAdd` — which sits inside the `if (section === "sources")` branch
(`SidebarBody.tsx:113-143`), i.e. renders only when `pickerIdForPathname(pathname) === "sources"`,
i.e. only on `/sources`, where `SourcesPage` is mounted. So the new cleanup's StrictMode
double-invoke at mount is always a no-op against a `false` flag — `PanelList.tsx:190-192`'s stated
precondition genuinely holds, and round 2's reproduced failure cannot occur. Task 3.6 pins the
verification to StrictMode and 3.7 requires the guard be proven red first.

**On the "is navigate-only a downgrade that fails the AC?" challenge — no, and I checked the two
places that could have said otherwise.** The ticket's own Scope says steps *"deep-link to the
relevant **section**/modal"*, so a section deep-link is sanctioned by the AC's own parent text; and
the shipped `workspace-create-actions` spec carves out *"a navigation surface that can reach a
section whose flow is mounted elsewhere"* **verbatim** (I read it in
`openspec/specs/workspace-create-actions/spec.md`, not in the deleted delta — D4's citation is real).
The ticket's Inherited-constraints section then *forbids* the alternative in as many words. So
navigate-only is the option the ticket steers toward, not a concession. It costs one extra click, and
what it buys is landing the user on `SourcesPage`'s own hero — *"Helio infers a schema you can then
shape into a bindable type with a pipeline"* — which reinforces the same lesson. I am satisfied.

**CR3 — closed.** D3 and task 1.6 name the evaluator as a hook called unconditionally from
`PanelList`, never from the checklist component. `AppRoutes.tsx:88` confirms `PanelList` is the `/`
route element, so it is always mounted wherever the surface can appear. The hook has no literal
identifier, which is not a gap an implementer can get wrong.

**CR4 — closed, and I verified both halves of the brief's question.** `PanelList.tsx:400` is the gate;
D1/task 4.1 put the surface outside it. Traced the step-3→4 window: `createDashboard.fulfilled`
auto-selects (`dashboardsSlice.ts:281-283`) → `selectedDashboardId !== null`, `panels.status ===
"idle"`, `staleDashboardId !== selectedDashboardId`, `items.length === 0` → `showPanelGridSkeleton`
true (`PanelList.tsx:99-102`) for the whole `fetchPanels` round trip → the line-400 block is `null`,
and a surface outside it survives. It cannot blink out. **Nothing else in `PanelList` breaks:** the
surface is a sibling of `.panel-list__zoom-container`, which stays mounted with the same DOM node
identity, so `useContainerWidth`'s one-time `ResizeObserver` (the F-tracked `1280 → 1152 → 0` hazard
documented at `PanelList.tsx:355-375`) is not re-targeted; only the grid's vertical offset changes,
and the observer reads width. Task 4.3 correctly forbids touching the gates themselves.

**CR5 — closed.** Frame-by-frame on a genuinely empty account: `dashboardsStatus === "loading"` →
`showBootstrapSkeleton` true → line 400 is `null`. `fetchDashboards` resolves empty → `succeeded`,
`items.length === 0`, `selectedDashboardId` stays `null` (`dashboardsSlice.ts:254-256`) →
`showBootstrapSkeleton` false. On **that same render** `autoActivate` is true, because it reads only
`dashboards.*` plus `dismissed`, and `dismissed` is a synchronous `useState` initializer (task 1.4) —
no effect, no await. So `visible` is true on the very first frame the hero could have painted, and
task 4.2 suppresses it off the same value. There is no path where the hero paints first. I could not
construct one.

**CR6 — closed.** D6 and task 2.11 assign Ghost to the non-emphasised steps, Primary/Secondary by
placement to the emphasised one, and a check-no-button to a complete one. All four steps are now
covered and no new style is invented.

**CR7 — closed.** I diffed the `MODIFIED` requirements against the shipped file rather than trusting
the delta. All five shipped scenarios of "Empty state shown when a dashboard has no panels" survive
verbatim; the post-delete one now carries *"AND no guided first-run surface is active"* and a new
superseding scenario was added alongside it, so the two no longer disagree. The failed-create
requirement likewise carries both shipped scenarios plus one new. The untouched third requirement
("Empty state CTA opens the panel create form") is correctly left out of the delta — its `WHEN` is
vacuous when the empty state is superseded, and the delta's new paragraph preserves reachability of
the panel create action.

**CR8 — closed.** Named in the proposal's Impact and in task 1.2 with the exact range; I confirmed
`renderWithStore.tsx:159-171` lists eleven reducers and no `onboarding`, and that
`UserMenu.test.tsx:17` currently uses a bare `render()` with no `Provider`/Router — so task 4.6 is
genuinely required by D9's hooks wiring.

**The `workspace-create-actions` delta deletion is correct, and leaves nothing unspecified.** Both
load-bearing claims D4 makes about the shipped spec are in that file verbatim: the navigation
carve-out quoted above, and — for the `SourcesPage` cleanup specifically — *"A visibility flag held
in shared state SHALL be cleared when the surface that mounts its flow unmounts"* plus its own
scenario. `SourcesPage` has no such cleanup today (its only effect is the fetch at `:28-42`, and
`addModalOpen` read at `:116` is never reset), so task 3.5 brings code into compliance with an
already-shipped requirement — a bug fix, not new behaviour, and correctly delta-free. Everything the
change *does* newly is covered by the `first-run-onboarding` requirement "Each step's action opens
that step's real creation flow", which states both the navigate rule and the never-set-the-flag rule.

---

### Verdict: REFUTE

Round 2's eight CRs are all genuinely closed — this is a real rewrite, not a paper one, and the three
re-decisions the brief asked me to stress-test all survive independent tracing. What is left is a
different set of three, all of which are consequences of the *newly added* state model rather than
leftovers, and none of which an executor can resolve inside the plan's intent because each needs a
decision the plan does not contain. I have kept the list to exactly those; several other things I
found are execution findings and are recorded as such under Non-blocking notes so they are not lost.

---

### Change Requests

1. **The persisted dismissal is silently lost whenever the checklist is re-opened from `UserMenu`
   while the user is already on `/`. D7 borrows `ThemeProvider`'s persistence mechanism without the
   single-owner property that makes it safe.**

   `ThemeProvider` is one Context provider mounted once at the app root (`main.tsx:48`): every reader
   and every writer goes through the same `useState`, which is exactly why "read in an initializer,
   write in an effect" is correct there. This plan keeps that mechanism but splits ownership across
   two subtrees that cannot see each other: `dismissed` is a `useState` inside the host hook called
   from `PanelList` (task 1.4 + task 1.6 — the slice holds *only* `active`, task 1.2), while
   `UserMenu` — rendered from `CommandBar.tsx:254`, a different subtree — *"clears the stored
   dismissal"* by writing `localStorage` directly (task 4.4).

   Trace, on the most ordinary path there is:
   - Empty user auto-activates, dismisses. `dismissed` state `false → true`, effect writes the key. ✓
   - Later, on `/`, they click "Getting started". `UserMenu` removes the key and dispatches
     `active := true`. `navigate("/")` from `/` does not change the matched route element, so
     `PanelList` does **not** remount and its `dismissed` state is still `true`.
   - They dismiss again. The handler calls `setDismissed(true)` — **already `true`, so React bails
     out; no re-render, and the `[dismissed]`-keyed effect never re-runs, so nothing is written.**
     The key stays removed.
   - Reload → no stored dismissal → the account is still empty → the checklist auto-activates again.
     The user has now dismissed it twice and it has come back.

   The same no-op strands task 1.12's *"persist `dismissed`"* on the all-four-complete path, for the
   same reason. This breaks the ticket's third AC (*"Dismiss persists per user across reloads"*) and
   the delta's own "Dismissal survives a reload for that user" scenario, and test 6.7 as scoped
   ("dismissal round-trips per user id") will not catch it — the round trip only fails after a
   `UserMenu` re-open, which 6.7 does not perform.

   Required: give `dismissed` a single owner, and say so in D2/D7 and tasks 1.2/1.4/4.4. The obvious
   fix inside this plan's shape is to hold it in `onboardingSlice` beside `active`, hydrated once
   from `localStorage` and persisted from one place, with `UserMenu` dispatching rather than writing
   storage — which also removes the second writer entirely. Whatever is chosen, add a test that
   dismisses → re-opens from the affordance **while on `/`** → dismisses again → asserts the stored
   dismissal is present, and prove it red first.

2. **Nothing in the plan handles `status === "failed"` for the two collections the surface itself
   fetches, so a rejected `fetchSources`/`fetchPipelines` renders that step as *incomplete* — the
   checklist stating as fact that the user has not done something they may well have done.**

   Task 1.10 pins `indeterminate` to *"`"idle"` or `"loading"`"*. The delta this change is writing
   says something different and broader: *"**Until** a step's underlying collection **has completed a
   fetch**, that step SHALL render an indeterminate state, distinct from both complete and
   incomplete."* A rejected fetch has not completed a fetch, so the task contradicts its own spec,
   and the contradiction resolves the wrong way: `sourcesSlice.ts:152-156` sets `status = "failed"`,
   `items` stays empty, step 1 falls through to `incomplete`, and the host hook's `status === "idle"`
   guard (task 1.9) means it never retries — so the wrong answer is permanent for that session.

   Nothing else on `/` surfaces it either. `PanelList`'s `StatusMessage` is wired to the **panels**
   status only, and `SidebarBody` on `/` is the dashboards section. So the failure is swallowed
   whole, against §7's *"**never swallow a failed fetch**"* (`DESIGN.md:359-360`) — the surface would
   be the one place in this app that does; `SourcesPage.tsx:64-86` and `SidebarItemList` both render
   a real error with Retry. And it directly violates the ticket's own binding standard: *"A checklist
   that lies about what the user has done is worse than no checklist."*

   This is not a one-word fix, which is why it belongs at this gate rather than in execution: the two
   available answers are both ones a previous round rejected. Treating `failed` as indeterminate
   parks a **permanent** skeleton — the exact outcome round 2's CR1 refuted. Treating it as
   incomplete is the lie above. The third answer (an error affordance on the affected step, or the
   surface reporting the failed fetch with a retry, per §7 and the `HEL-539` ladder the ticket names
   as canonical) is a design decision the plan does not make.

   Required: decide what a step renders when its collection's fetch **failed**, record it in D10 and
   in the delta's indeterminate requirement, correct task 1.10 so it no longer enumerates a set
   narrower than the spec it implements, and add it to §5's verification list and a test in §6.

3. **The "completed state" is undefined — on a surface whose brief says the copy *is* the deliverable
   — and D2 and task 1.12 disagree about whether the checklist survives reaching it, with one reading
   making the re-open affordance present nothing.**

   Three distinct problems in one unmade decision:

   a. **Contradiction.** D2 says *"`active` ends only on explicit dismissal or all-four-complete
      (which shows a completed state and writes `dismissed`)"*. If `active` is cleared then
      `visible = active || autoActivate` is `false` and **nothing renders** — so "ends" and "shows a
      completed state" cannot both be true as written. Task 1.12 says only "show the completed state
      and persist `dismissed`", i.e. the opposite reading. An implementer taking D2's sentence ships
      a surface that vanishes the instant the user's fourth resource appears, and — worse — makes
      "Getting started" a no-op for any user with all four resources, which is precisely what the
      delta forbids in as many words: *"An affordance that mutates stored state but presents nothing
      … SHALL NOT be shipped."*

   b. **The re-open case is conflated with the just-finished case.** A returning user with content
      who deliberately clicks "Getting started" has all four steps complete *from the first frame the
      fetches resolve*, so under task 1.12 they get the completion state rather than the lesson. The
      delta says they should get *"the checklist … presented, **with its completed steps shown
      complete**"* — the four-step chain, ticked, which is the whole point of a re-openable lesson on
      a surface HEL-774 named as its mitigation. These are different states and the plan has one.

   c. **No copy exists for it.** D8 specifies every word of the four steps, the lede and the title,
      and task 2.2 requires it verbatim — but says nothing about the completed state, so its copy
      will be invented at execution time on the one surface where *"generic encouragement is a
      defect"* is a binding standard. That is precisely the sort of gap this gate exists to catch:
      the highest risk of a "You're all set! 🎉" card in this change sits in the only region the copy
      spec does not cover.

   Required: state in D2/D8 and task 1.12 (i) whether `active` survives all-four-complete — I believe
   it must, so the completion is actually seen and the affordance is never inert — (ii) what the
   all-complete surface renders for a user who just finished versus one who re-opened, and (iii) the
   verbatim copy for it, held to the same specificity bar as D8's four steps.

---

### Non-blocking notes

**Design/UX judgement — the copy, formed before re-reading either prior round's view.** It is good,
and specifically good rather than merely inoffensive. *"Shape that source into a type. Types are only
ever a pipeline's output — you never create one directly."* is the load-bearing sentence the ticket
demands, and it is one sentence. The whole surface is ~55 words. *"Bind a panel to that type to see
your data"* reuses vocabulary the app already speaks (`SourcesPage.tsx:109` says "a bindable type
with a pipeline"), so it teaches a word the user meets again ten minutes later. The lede's *"each one
feeds the next"* sets the chain framing that makes the four-steps/five-concepts asymmetry legible
rather than confusing, and D8's instruction not to "fix" it into five steps is the right call. It
does not read as patronising, cluttered, or as a generic product tour. Step 3's *"A canvas for your
panels."* is the weakest line — close to tautological — but it is four words and it does define the
noun, so I would not change it. Keep D8 verbatim through whatever CR1–CR3 force.

- **On "existing content" = "has a dashboard" (D3) — I agree, and I tried to break it first.** The
  ticket's Scope line says *"no dashboards / no data sources"*, which reads against D3 on a literal
  parse. But I could not construct a gating rule that both (i) hides the checklist from a
  sources-having user and (ii) avoids a flash in one direction or the other: gating on sources paints
  the hero for a round trip (round 2's CR5), and letting `autoActivate` flip false when sources
  resolves non-empty paints the *checklist* and then removes it, which is worse. The only clean
  third option — a transient skeleton over the region while sources resolves — re-enters exactly the
  territory HEL-528 task 2.4b was careful about, and the ticket forbids undoing that. D3's reading is
  also the one the ticket's own *title* supports. The one wart is a power user who deletes their last
  dashboard and gets a first-run tour over a full data stack; it is one dismiss click and the region
  is empty anyway. Documented trade-off, correctly self-approved.
- **Execution finding (not a gate item): the "Type" marker risks a §6 violation.** Task 2.5 asks for a
  *"compact non-interactive marker"* carrying `Shapes` + the word "Type". §6 names **StatusChip** as
  "the one pill recipe" and says *"do not hand-roll equivalents"*. `StatusChip` accepts
  `intent="neutral"` and arbitrary `children` (`StatusChip.tsx:5-17`), so it fits — but its doc
  comment says it is "not yet adopted by any call site", so an implementer may not find it. Reach for
  it, or make the marker plainly not a pill (inline glyph + word inside the sentence, which I think
  reads better anyway and keeps step 2 visually symmetric with its three siblings).
- **Execution finding: existing `PanelList.test.tsx` cases will go red the moment `onboarding` is
  registered.** Any fixture with `dashboards.status === "succeeded"` and no items now satisfies
  `autoActivate`, so the checklist renders and suppresses the "No dashboards yet" assertion. Task 6.9
  anticipates this ("…still hold when the surface **is not visible**") but the tempting fix — flipping
  those assertions to the checklist — would silently delete shipped `frontend-panel-empty-state`
  guarantees. Preload a stored dismissal instead.
- **Execution finding: `PanelList.tsx:437-441`'s "Select a dashboard" is a third `EmptyState` inside
  the line-400 gate,** and task 4.2's "both" does not say which side of the suppression it falls on.
  It is CTA-less so there is no double-primary either way, and it is only reachable via an explicit
  `setSelectedDashboardId(null)` (`fetchDashboards.fulfilled` auto-selects whenever items exist,
  `dashboardsSlice.ts:259-264`). Purely cosmetic; pick one and move on.
- **Execution finding: how "the superseding placement" is detected** (task 2.11's Primary-vs-Secondary
  switch) is not spelled out, but it is derivable from the same value task 4.2 already computes for
  suppression. Worth a one-line comment in the code so the varying recipe does not read as drift.
- `visible || autoActivate` in task 1.9 is a redundant disjunct given task 1.8's definition. Harmless;
  simplify to `visible` so a later reader does not go looking for the case it covers.
- **A one-click alternative to navigate-only does exist** and D4 does not mention it: carrying the
  intent in the navigation itself (`navigate("/sources", { state: … })`) and having `SourcesPage`
  consume it in a mount effect sets no cross-surface flag and survives StrictMode (effects re-run
  after the double-invoke cleanup, so the net state is open). I am **not** asking for it — D4's choice
  is sanctioned by the ticket and by the shipped spec, and the extra stop on `SourcesPage`'s hero has
  real teaching value. Recording it only so a future reader knows it was on the table.
- D1's accepted gap — a user who completes step 1 is on `/sources` with no way back to the checklist
  — is real and is now correctly written down rather than left to be discovered. Only step 1 leaves
  the page (steps 2–4 all act in place: `useCreatePipelineAction` is shell-mounted for every route
  except `/pipelines`, `useCreateDashboardAction` is a bare thunk, `PanelCreationModal` is mounted by
  the host itself), and `active` is sticky so returning to `/` shows step 1 ticked. Acceptable for v1.
- HEL-774's recorded mitigation is only **partly** discharged here: the checklist teaches
  Sources/Pipelines/Types/Panels but D8 deliberately scopes out Metrics and Assistant, two of the six
  glyphs HEL-774 unlabelled. That is correct for this ticket's scope and honestly stated — but it
  means HEL-774's justification is not fully closed by this change, which may deserve a spinoff.
- Step 2's action is enabled with zero sources. I checked whether that dead-ends the user: it does
  not — `CreatePipelineModal.tsx:165-171` (F-041) already renders *"No data sources yet."* with a link
  to `/sources` and a disabled submit. Nothing to do.
- Cross-run hazard worth being aware of, not acting on: if HEL-773 wires a create-source action into
  the mobile nav sheet that sets `addSourceModalOpen` from a non-`/sources` route, this change's new
  `SourcesPage` cleanup would break it under StrictMode. HEL-773 doing that would itself violate the
  shipped `workspace-create-actions` requirement, so the fence holds — but it is the one way these two
  runs can collide, and it would surface as "the mobile add-source button does nothing".
