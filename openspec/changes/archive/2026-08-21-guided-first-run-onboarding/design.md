## Context

Route `/` renders `PanelList` (`AppRoutes.tsx`), which owns both zero-content surfaces. Four HEL-349 leaves
merged 2026-08-21 constrain this: HEL-548 built the create-action hooks and `staleDashboardId`; HEL-528
shaped this surface's skeleton gates; HEL-539/HEL-535 fixed the error/toast ladder; HEL-774 dropped the
bottom nav's labels and named *this ticket* the mitigation. `App.tsx:119-128` dispatches only
`fetchDashboards`/`fetchPanels` on `/`; `main.tsx:57` wraps the app in `React.StrictMode`, whose dev
double-invoke runs every effect cleanup once at mount. `workspace-create-actions` forbids setting a
visibility flag no mounted component reads and requires it cleared on unmount; `frontend-panel-empty-state`
requires the panel area is never blank and announces a failed create.

**Three design-gate rounds refuted earlier drafts** — a circular fetch gate; content-gated visibility that
vanished on completion; gates too narrow for re-open; a flag-set/navigation pairing **reproduced** as broken
under StrictMode; a split-owner `dismissed` that lost the second dismissal. D2–D4, D7, D10 carry those
corrections and must not be simplified back.

## Goals / Non-Goals

**Goals.** Teach source→pipeline→type→panel where a new user lands; derive every step from observed state;
consume HEL-548's seam; persist dismissal per user; stay non-blocking.

**Non-goals.** Editing the four hooks, `EmptyState`, or `CommandBar.tsx` (D9). Hoisting the source/panel
modals to the shell. Backend state. Templates (HEL-421) / NL authoring (HEL-341). Teaching Metrics or
Assistant — two of HEL-774's six glyphs stay outside this surface, so its risk is only partly discharged.

## Decisions

**D1 — One placement, mounted OUTSIDE `PanelList.tsx:400`'s skeleton gate.** The surface renders at the top
of `PanelList`'s content area whenever visible; whatever renders beneath is unchanged, except that the
zero-dashboard and zero-panel `EmptyState`s are suppressed while it is visible (D5). Mounting it *inside*
line 400's `!(showPanelGridSkeleton || showBootstrapSkeleton)` block would blink it out at the step-3→4
transition: `createDashboard.fulfilled` auto-selects the new dashboard (`dashboardsSlice.ts:281-283`),
making `showPanelGridSkeleton` true for the whole `fetchPanels` round trip. *Rejected:* a shell overlay; a
`Modal` (blocking); rendering only inside the zero-content branches (inert re-open, vanishes when step 4
goes live). Accepted gap: only step 1 leaves the page and offers no return affordance — the nav is the way
back, and `active` is sticky so returning shows step 1 ticked.

**D2 — Three separate notions, and visibility is derived, not awaited.**
- **Dismissed** — held in `onboardingSlice`, mirrored to `localStorage` per user (D7); suppresses
  auto-activation only. It has exactly **one owner**; D7 explains why that is load-bearing.
- **Active** — sticky session state in the same slice, alongside this app's other cross-component UI flags.
- **Auto-activation** — a pure derivation: `dashboards.status === "succeeded" && dashboards.items.length
  === 0 && !dismissed`.

**Visible = `active || autoActivate`.** Deriving visibility rather than waiting for an effect to set `active`
removes the flash: the checklist renders on the *same* frame the zero-dashboard `EmptyState` would otherwise
have appeared on. An effect then sets `active`, so visibility survives `autoActivate` going false once the
user creates a dashboard. **`active` is cleared only by explicit dismissal.** Reaching all-four-complete
writes `dismissed` (so it does not auto-activate next load) but leaves `active` set, so the completion is
actually seen and the re-open affordance is never inert for a user who already has all four resources —
which the spec forbids in as many words.

**D3 — Auto-activation is gated on dashboards alone.** Requiring `sources.status === "succeeded"` paints the
"No dashboards yet" hero — including its "New dashboard" Primary, which is *step 3* — for a full network
round trip before the checklist replaces it, inviting the user to skip the lesson before it appears. A user
with sources but no dashboard therefore still sees the checklist with step 1 ticked: working as intended,
not a leak. The ticket is titled *first-dashboard* onboarding and its surface is the zero-dashboard view, so
"existing content" is read as "has a dashboard". *Rejected:* treating one data source as disqualifying — it
costs the flash above and hides the lesson from a user demonstrably mid-onboarding.

**The trigger is evaluated by a hook called unconditionally from `PanelList`**, never from the checklist
component, which does not exist in the state the trigger detects. That hook dispatches `fetchSources()` and
`fetchPipelines()` whenever the checklist is visible, each guarded on its own `status === "idle"` (the
`SourcesPage.tsx:29-37` pattern), so the re-open path fetches too and nothing is fetched twice. Round 2's
trigger was so narrow a re-opening user could never satisfy it, leaving steps 1–2 permanently skeletal.

**D4 — Step 1 navigates to `/sources`; it does not set the modal's flag.** The other three invoke their hook
directly: `useCreatePipelineAction` (shell-mounted, any route), `useCreateDashboardAction` (thunk, no modal),
`useCreatePanelAction` (modal mounted by `PanelList`, the host surface, honouring its existing `disabled`).
`useAddSourceAction` sets `addSourceModalOpen`, read only by `SourcesPage`, so the checklist navigates there
and `SourcesPage`'s own empty-state CTA — the same hook, wired where its flow is mounted — opens the modal.

*Rejected: pairing the flag-set with navigation.* Round 2 reproduced its failure — `SourcesPage` mounts with
the flag already `true`, and the cleanup below fires on StrictMode's double-invoke and clears it before the
user sees anything. `PanelList.tsx:190-192` states the precondition it breaks: the cleanup is *"harmless,
since the flag starts `false`"*. Navigate-only is what the shipped spec sanctions for *"a navigation surface
that can reach a section whose flow is mounted elsewhere"*, and the ticket's Scope says steps deep-link to
the relevant *section* or modal.

**This change still adds the missing unmount cleanup for `addSourceModalOpen` to `SourcesPage.tsx`**,
mirroring `PanelList.tsx:193-197`. A shipped spec requires it, `SourcesPage` lacks it, and this surface makes
the path ordinary. With step 1 navigating rather than flag-setting the flag is `false` at every mount, so
`PanelList`'s precondition holds and the cleanup is safe.

**D5 — The surface supersedes the two zero-content empty states; it never stacks on them.** Suppression is
keyed off the *same* `visible` value the surface renders on, so the two can never both render or both vanish;
when not visible they render exactly as today. `PanelList.tsx:437-441`'s CTA-less "Select a dashboard" is
**not** suppressed — dashboards exist there, so it is not a first-run surface and has no CTA to double up.
`frontend-panel-empty-state`'s guarantees survive because the surface carries them: never blank, the panel
create action stays reachable, and `useCreateDashboardAction().error` renders the same announced error.

**D6 — Recipes, stated for all four steps.** `.panel-list__add` (`PanelList.css:48-62`) is the Primary
recipe, mounted unconditionally in `PanelList`'s header, so this view already carries a Primary and §5 is not
satisfied by it today. Honestly stated: **in the superseding placement this adds no primary the region did
not already have**; **above the grid the emphasised action uses Secondary**, since the header's Primary owns
that view. No code comment may claim §5 compliance here. Every incomplete, indeterminate or failed step
carries an action; the **emphasised** one is the first not-`complete` step and takes Primary or Secondary per
placement. The others use **Ghost** — one of §5's four, so no new style is invented. A completed step renders
a check and no button.

**D7 — Persistence: `helio-onboarding-dismissed-<userId>`, with exactly one owner.** Hyphen family per
`theme.ts:3-4`. Keyed by `currentUser.id`, non-null under `ProtectedRoute`, with try/catch on both read and
write per `App.tsx`'s `helio.sidebarCollapsed` (`:39-45`, `:67-73`) — not `ThemeProvider`, whose writes are
unguarded.

`ThemeProvider`'s read-in-initializer/write-in-effect shape is safe **only because it has a single owner**.
Holding `dismissed` as `useState` in `PanelList`'s hook while `UserMenu` (a different subtree,
`CommandBar.tsx:254`) clears the key directly loses the next dismissal: `navigate("/")` from `/` does not
remount `PanelList`, so `setDismissed(true)` is a no-op and the keyed effect never re-runs. So `dismissed`
lives in `onboardingSlice`, hydrated once per user id by the host hook and persisted by one effect watching
it. `UserMenu` **dispatches**; it never touches storage.

**D8 — Copy and glyphs, because the copy is the deliverable and HEL-774's risk is a glyph problem.** Title
(Fraunces, `DESIGN.md:224-225`): **"Build your first dashboard"**. Lede: *"Helio turns a data source into a
dashboard in four steps — each one feeds the next."* Steps: **Connect a data source** — *"A CSV, a database,
or an API."*; **Build a pipeline** — *"Shape that source into a type. Types are only ever a pipeline's
output — you never create one directly."*; **Create a dashboard** — *"A canvas for your panels."*; **Add a
panel** — *"Bind a panel to that type to see your data."* The lede says four steps while the chain names five
concepts: the type is deliberately not a step because it has no create path, which is the entire lesson — do
not "fix" this into five steps.

When all four are complete the surface keeps showing the same chain, ticked — that is the lesson, and a
re-opening user must see it rather than a celebration — with the title replaced by **"That's the whole
chain"**, the lede by *"Source, pipeline, type, panel — every dashboard you build follows it."*, and the
emphasised action by a **Done** button that dismisses. One surface serves both the just-finished and the
already-complete re-opener, so no separate completion screen gets its copy invented at execution time.

Each step carries its section's glyph from `shared/chrome/sections.ts` — the registry every other surface
derives from — never re-picked: `Database`, `Workflow`, `LayoutDashboard`. Panels have no nav section, so
step 4 reuses `LayoutGrid`, the glyph the panel empty state already uses. Step 2 renders `Shapes` (the
`/registry` glyph) **inline beside the word "Type" in its own sentence** — not as a pill, which would collide
with §6's "StatusChip is the one pill recipe" and break step 2's symmetry with its siblings. HEL-774 recorded
`Shapes` as the weakest-reading of the six, which is why text alone does not discharge its risk.

**D9 — Re-opened from `UserMenu`, wired with hooks to stay outside HEL-773's fence.** `UserMenu` is
prop-driven and rendered only at `CommandBar.tsx:254`; line 160 of that file is the sheet-opening control
fenced to HEL-773, so a callback prop would mean editing it. Instead `UserMenu` calls
`useAppDispatch`/`useNavigate` itself — the ordinary pattern here — reusing `.user-menu__item`, which already
carries the 44px floor at ≤768 (`UserMenu.css:138-140`). `UserMenu.test.tsx` moves to `renderWithStore`.

**D10 — A step has four states: complete, incomplete, indeterminate, failed.** Indeterminate (collection
`idle`/`loading`) renders its status indicator as a `Skeleton` — §7 forbids a flash of empty content and
HEL-528 shipped `Skeleton` for this; only the indicator is a skeleton, so label, description and action stay
live. **A `failed` collection is neither complete nor incomplete**: rendering it incomplete states as fact
that the user has not done something they may well have done — the lie the ticket calls worse than no
checklist — and the `idle` guard would make that permanent for the session, while rendering it indeterminate
parks a permanent skeleton (round 2 refuted that). So a failed step renders an inline error affordance with a
**Retry** re-dispatching that fetch, per §7's "never swallow a failed fetch" and the HEL-539 ladder; its
completion is reported unknown, never unmet.

## Risks / Trade-offs

- **Existing `PanelList.test.tsx` fixtures go red** once `onboarding` is registered — any fixture with
  `dashboards.status === "succeeded"` and no items now satisfies `autoActivate`. Preload a stored dismissal;
  never flip those assertions to the checklist, which would delete shipped guarantees.
- **The `SourcesPage` cleanup** must be proven red against the pre-cleanup build before it is trusted green.
- **44px floor has regressed six times here** → `getComputedStyle` on the running app at 430/768, both
  themes, never off the stylesheet. **HEL-773 collision** → merge `origin/main` before the gates.

## Planner Notes

Self-approved: D1–D10, notably "existing content" = "has a dashboard" (D3), navigate-only step 1 (D4), the
`SourcesPage` cleanup, single-owner `dismissed` (D7), the completion copy (D8), and hooks-in-`UserMenu`
(D9). None introduces a dependency, breaking change, or scope beyond the ticket.
