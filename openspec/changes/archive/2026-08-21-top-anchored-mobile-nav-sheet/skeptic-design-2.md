## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold read. Every claim below comes from a file I opened in this worktree, not from
`skeptic-design-1.md`'s narrative or the planners'. Read in full: `ticket.md`, `proposal.md`,
`design.md`, `tasks.md`, `specs/mobile-dashboard-sheet/spec.md`, `skeptic-design-1.md`, the current
`DESIGN.md`, and the ground truth each artifact depends on.

**Round-1's six change requests — verified individually**

| R1 CR | Status | Evidence |
| --- | --- | --- |
| 1. Create action rendered twice | **Genuinely fixed** | D5 adds explicit arbitration (empty-branch CTA wins, header action suppressed), mirroring `SidebarItemList.tsx:260-282`'s `emptyCta ?? onAdd`; task 3.6; spec requirement "Exactly one create affordance SHALL be visible at a time" + scenario "Never two create affordances at once"; test 5.5. Self-collision between old tasks 5.2/5.6 is gone. |
| 2. `EmptyState` icon/title/description unspecified | **Partially** — see CR6 | D7 adds a shared per-section table + a parity lock, which closes the hole for the five `SidebarBody` sections. It does not close it for **dashboards**, whose desktop copy lives in `DashboardList.tsx:301-309`, not `SidebarBody`. |
| 3. `clip-path` stacking context / illusory fallback | **Genuinely fixed** | D2 now states the wrapper carries `--z-popover`, the panel drops to a non-competing `z-index`, and — the better fix — the panel becomes `position: relative`, which makes the `overflow: hidden` fallback actually clip and moots the fixed-descendant containing-block question. Tasks 1.5/1.6 carry it. I re-derived the premise myself: `theme.css:81-82` (`--z-popover-scrim: 99` / `--z-popover: 100`), `App.css:74` (`.app-command-bar { z-index: 2 }`). Sound. |
| 4. `prefers-reduced-motion` had no runtime proof | **Genuinely fixed** (premise sentence is wrong — see notes) | D10 + task 1.8 + task 6.5 + spec scenario now require computed `animation-name: none` for **both** panel and wrapper, emulated on the running app. |
| 5. MODIFIED requirement kept a false name | **Partially** — see CR7 | REMOVED "Bottom sheet dashboard picker" + ADDED "Top-anchored item picker" with Reason/Migration is present and correct. But the *other* stale requirement and the capability Purpose are still untouched/unowned. |
| 6. Drag strip shrank with no minimum | **Genuinely fixed**, and it exposed a new gap — see CR5 | D3 now specifies a literal `44px` min-height for the bottom strip; task 2.3; spec scenario "The drag strip remains a usable target"; task 6.3 sweeps it. |

None of the six "fixes" made the plan worse. CR3's fix is materially better than what round 1 asked for.

**Independently re-derived ground truth**

- **HEL-772 seam (D1) holds.** `theme/theme.css:118-134` declares `--app-safe-top: env(safe-area-inset-top, 0px)`, `--app-command-bar-height: var(--space-9)`, `--app-top-chrome-height: calc(...)`; `:137-143` overrides `--app-command-bar-height` on `:root` at `max-width: 768px`, so the seam recomputes at phone width. `App.css:60-76` gives `.app-command-bar` `height: var(--app-top-chrome-height)` + `padding-top: var(--app-safe-top)` with global `box-sizing: border-box`. D1's "places the sheet's top edge exactly at the bar's bottom edge" is true, and task 6.2's forced-token probe works (the override and the `calc()` are both on `:root`, so substitution re-runs).
- **Hooks are inert (D6).** `useCreateDashboardAction.tsx:29-44` = `useAppDispatch` + 2 × `useState`; `useAddSourceAction.tsx:20-31` and `useCreatePipelineAction.tsx:21-33` = `useAppDispatch` only. No `useEffect` in any of the three. Calling all three unconditionally is legal and side-effect-free.
- **D8's mount argument holds.** `SourcesPage.tsx:116` mounts `AddSourceModal`; `App.tsx:207` mounts `CreatePipelineModal` off-`/pipelines` and `PipelinesPage.tsx:105` mounts it on-route; dashboards dispatch a thunk with no modal.
- **DESIGN.md, read fresh (not recalled).** HEL-774 bottom-nav opacity carve-out: `DESIGN.md:104-130` — real, and explicitly scoped ("this carve-out does not widen"); it also names `MobileNavSheet`'s backdrop as intentionally flat (`:118-121`). Sanctioned `::after` hit-expander: `DESIGN.md:204-208`, scoped to "a painted chrome control that must not visually grow" — D4's statement that it does **not** apply to a labeled sheet button is correct. 44px floor: `DESIGN.md:198-203`, literal `44px`, phone-only. §5 recipes `:259-273`; §6 primitives `:309-331`; §7 states `:352-362`. Every citation in `design.md` that I checked against the current file is accurate except D10's premise (see notes).
- **`openspec validate top-anchored-mobile-nav-sheet --strict`** → `Change 'top-anchored-mobile-nav-sheet' is valid`. (Ran `/usr/bin/openspec` from the worktree root; `npx openspec` fails here — no local install.)
- Did **not** start dev servers and did **not** touch the shared MCP Playwright session, per instructions. No code modified; this report is the only file I wrote.

### Verdict: REFUTE

The load-bearing mechanics (the safe-area seam, the clip-wrapper stacking correction, the hook
legality, the fold-in bounding) survive adversarial checking — round 1 was right about them and the
revisions are real. What fails is a layer round 1 never reached: **the plan describes the sheet but
never the scrim that sits in front of it**, and the ticket's whole premise ("reads as anchored to the
control that opened it") is decided by that scrim, not by the panel. On top of that, the create
action — the ticket's other half — is under-specified in three ways that each produce a visible
divergence from a sibling surface that already ships the same action.

All seven are artifact-level fixes. None requires new dependencies or scope.

### Change Requests

**1. The backdrop covers the trigger, so the delta's own "un-occluded / hit-testable" scenario
cannot pass — and the anchoring read is undecided.**
`MobileNavSheet.css:5-9` renders the backdrop `position: fixed; inset: 0; z-index: var(--z-popover-scrim)` with
`background: var(--app-overlay)`. `App.css:38-53` gives `.app-shell { position: relative; z-index: 1 }` — a
stacking context — so the command bar (and its trigger, `CommandBar.tsx:156-169`) paints **below** the
scrim, whatever `.app-command-bar`'s local `z-index: 2` says. `--app-overlay` is
`rgba(10,9,8,0.62)` dark / `rgba(33,29,25,0.42)` light (`theme.css:185`, `:232`) — a heavy dim, faded in over
`--app-transition` (`MobileNavSheet.css:13`). Consequences:
- The spec delta's scenario **"Trigger is never covered by its own sheet"** ("remains visible and
  hit-testable at every frame") is not satisfiable: `document.elementFromPoint()` at the trigger's
  centre returns the backdrop button. **Task 6.4 as written will fail**, and the failure is in the
  spec, not the code.
- D2's entire clip-wrapper apparatus is justified by "motion that hides the control it claims to
  originate from" — but the trigger is visually suppressed by the scrim within 160 ms regardless of
  whether the panel sweeps over it. The wrapper buys "not covered by the opaque panel"; it does not
  buy "reads as anchored to that control".

This is a design decision the plan has simply not made, and it is *the* decision for the ticket's
stated intent. Required: add a decision to `design.md` that states the scrim's relationship to the
top chrome, with its trade-off named — either (a) the scrim starts at `--app-top-chrome-height` like
the panel, leaving the command bar undimmed so the sheet visibly hangs off the bar (cost: chrome
stays interactive beneath an `aria-modal="true"` dialog, which must then be handled deliberately —
e.g. the bar's other controls become inert while open), or (b) the scrim stays full-viewport and the
trigger is accepted as dimmed-but-visible. Then rewrite the scenario and task 6.4 to assert what is
actually true under the choice ("not occluded by the panel at any frame" is measurable; "hit-testable"
is not, and arguably shouldn't be — a tap there should dismiss).

**2. The dashboards create action does not do what the spec says it does, and its label is
unspecified.**
Three separate defects, all on the ticket's flagship section:
- **Flow divergence.** The delta's scenario "Create action opens the same flow as the desktop
  control" says the sheet opens "the same creation flow that section's desktop control triggers".
  For dashboards it does not. `DashboardList.tsx:301-309` — the desktop sidebar's own "New dashboard"
  CTA — sets `isCreateMode(true)`, opening an inline **named-create form**. `useCreateDashboardAction`
  (which D6/task 3.2 consumes) immediately POSTs `{ name: "Untitled dashboard" }`
  (`useCreateDashboardAction.tsx:34-44`), and its own docstring says so verbatim: *"This is
  `PanelList`'s own immediate quick-create, a **different** flow from `DashboardList`'s named-create
  form … the two are deliberately not collapsed into one hook"* (`:26-28`). Same label, two flows,
  sibling surfaces. Either the scenario/AC3 must be reworded to what is actually being wired, or the
  divergence must be an explicit, reasoned decision.
- **Label.** `ticket.md` Scope names the actions "**Add dashboard**, **Add source**, **Add
  pipeline**", and the delta repeats that wording. The read-only hooks produce `label: "New
  dashboard"` (`useCreateDashboardAction.tsx:51`), `"Add source"` (`useAddSourceAction.tsx:25`),
  `"New pipeline"` (`useCreatePipelineAction.tsx:26`). `design.md` never says whether the header
  action's label comes from `cta.label` or is authored locally, so a test writer following the spec
  will query `/Add dashboard/` and find "New dashboard". Decide it, and if `cta.label` wins (the
  right call — it keeps phone and desktop identical), fix the spec wording so it doesn't promise
  strings that cannot appear, and state that the resulting "New …"/"Add …" verb mix across sections
  is inherited from the hooks, not introduced here.
- **Glyph.** D4 says "a leading `+` glyph" without saying where it comes from. The empty-branch CTA
  will render lucide `<Plus />` (it is `cta.icon`). A hand-rolled `+` character in the header action
  reproduces exactly the defect a prior skeptic already made this repo fix — see the CR comment at
  `SidebarItemList.tsx:262-275` ("the same action … showed a glyph on the main-surface CTA but not
  the sidebar one"). Specify `cta.icon`.

Also record, as an accepted consequence with a spinoff: `App.css:499-501` sets `.app-sidebar {
display: none }` below 768px, and Rename lives only in `DashboardList`'s per-row `ActionsMenu`. So
this action creates an "Untitled dashboard" that a phone user has **no way to rename anywhere in the
app**. That may be fine as a v1, but it should be a stated decision rather than an emergent one.

**3. Task 3.7's error/pending treatment has no design decision and diverges from the established one
for the same error.**
`design.md`, `proposal.md` and the spec delta contain **zero** occurrences of "error", "isPending" or
"InlineError" (grepped). The only statement of intent is `tasks.md` 3.7, which prescribes
`InlineError` and "reflect `isPending` on the control". Both conflict with shipped precedent for this
exact hook:
- `PanelList.tsx:414-423` renders `createDashboardAction.error` as `EmptyState intent="error"` with
  `<TriangleAlert />`, title "Couldn't create dashboard", the message as `description`, and the same
  CTA for retry — the treatment HEL-539 standardised across five siblings. In the sheet's **empty**
  branch, where an `EmptyState` is already being rendered (task 4.2), `InlineError` would be a third
  treatment for one error, against DESIGN.md §7's consistency requirement.
- `useCreateDashboardAction.tsx:48-51` documents a deliberate behaviour-preserving choice: *"the
  pre-existing PanelList handler never disabled the button while pending, only swapped its label —
  unchanged here"*. The hook already swaps `label` to "Creating...". "Reflect `isPending` on the
  control" invites disabling it, i.e. reverting a decision the hook explicitly locked.

Required: promote this to a numbered decision in `design.md` naming the treatment per branch (empty
branch → `EmptyState intent="error"` mirroring `PanelList`; list branch → whatever is chosen, with
the reason it can't reuse the primitive), state that `isPending` is expressed by the hook's own label
swap and the control is **not** disabled, and add a spec scenario so the error state is a requirement
rather than a task footnote (§7 requires all three states be handled).

**4. Initial focus silently moves from the list to the create action — while the plan claims focus
behaviour is untouched.**
`MobileNavSheet.tsx:76-87` focuses `panel.querySelector(FOCUSABLE_SELECTORS)` — the first focusable
in DOM order. Today the drag handle is a non-focusable `<div>` (`:193-202`), so that is the first
dashboard row. D4 places the create action "in the sheet header, under the title, above the list", so
after this change the first focusable is the create button, in both branches. On dashboards that
means opening the picker and pressing Enter immediately creates an untitled dashboard (see CR2).
`design.md`'s Goals claim "keep every existing dismissal/focus/reduced-motion behaviour intact"; D2
says only that "`panelRef`, the focus trap, `role="dialog"` and `aria-modal` stay on the panel", which
is true and beside the point. No task or test covers initial focus (5.6 covers trap + restore only).
Required: state the intended initial-focus target in `design.md` (the active/first item is the
picker-appropriate choice; the sheet's purpose is switching), and add it to task 5.6.

**5. D11 leaves the sheet's max-height unquantified, and the new bottom drag strip can land in the
worst possible band of the screen.**
D3 moves the drag affordance to the sheet's **bottom free edge** and gives it a 44px strip; D11 says
only that `max-height` "derives from the dynamic viewport minus the top-chrome seam … so the sheet
leaves the lower screen free" — which, read literally (`100dvh - --app-top-chrome-height`), puts the
sheet's bottom edge at the viewport bottom. Consequences at a full list on a 430×932 phone:
- `BottomNav.css:9-40` floats the capsule at `bottom: calc(var(--bottom-nav-inset) +
  env(safe-area-inset-bottom))`, `height: var(--bottom-nav-capsule-height)` (56px), `z-index: 5` —
  below the scrim (99) and below the panel (100). A sheet extending into that band paints **over** a
  translucent floating capsule; a bottom edge landing *inside* the band leaves the capsule half-covered
  by the sheet and half dimmed under the scrim. That is a visible break, not a nicety.
- The 44px strip would then sit in the iOS home-indicator band — and the dismissal gesture is now an
  **upward** drag, i.e. the same direction as the system's home/app-switcher edge swipe, on the exact
  platform (installed iOS PWA) this ticket was filed from.

D11 currently treats clearing HEL-774's capsule as "a legitimate future need". D3 makes it a present
one. Required: quantify `max-height` in D11 so the sheet's bottom edge — and therefore the drag strip
— clears both `--bottom-nav-height` and the home-indicator inset, and add the clearance to task 6.3's
measured sweep (assert the strip's rect bottom is above the capsule's rect top at 430px).

**6. D7's "single shared source" is not what D7 builds, and the dashboards parity target is both
ambiguous and fenced.**
The spec delta states: "The empty-state icon, title and description SHALL come from a **single shared
per-section source**, so that the sheet and the desktop sidebar cannot present different copy." D7
builds a table "consumed by the sheet" and explicitly does **not** edit `SidebarBody`, so after this
change the copy lives in two places held together by a test — a materially weaker guarantee than the
requirement asserts. Worse, for **dashboards** there is no `SidebarBody` entry at all and two
different desktop strings already exist:
- `DashboardList.tsx:301-309` (sidebar, `variant="sidebar"` — the surface the sheet mirrors): "No
  dashboards yet" / "Create your first dashboard to start **visualizing data**."
- `PanelList.tsx:424-428` (main surface of the same page): "No dashboards yet" / "Create your first
  dashboard to start **adding panels**."

So task 5.8 ("matches the desktop sidebar's copy for the same section") is ambiguous exactly where it
matters most, and the target it most likely means — `DashboardList`'s zero-dashboard empty state — is
the surface `workflow-state.md`'s fence puts off-limits ("HEL-554 is live: do not touch … the
zero-dashboard surface"). A parity test pinned to copy another live run is rewriting is a scheduled
breakage. Required: (a) soften the spec sentence to what is actually built (one shared table consumed
by the sheet, locked by test against the sidebar's rendered copy), (b) name the source for all six
sections in D7 including dashboards, (c) state explicitly which dashboards surface is the parity
target and how the lock survives HEL-554 — or scope the dashboards lock out and say why.

**7. Stale spec text left behind, an unowned promise, and one tap target missing from the sweep.**
- `openspec/specs/mobile-dashboard-sheet/spec.md:8-21`, "**Tappable command-bar title on phone**", is
  not touched by the delta and its scenario still reads "tapping it opens the **bottom sheet**". That
  is the identical defect round 1's CR5 was raised for; the fix caught the sibling requirement and
  missed this one. Add it to the MODIFIED set.
- D9 promises the capability's stale "bottom-sheet picker" Purpose (`spec.md:4-6`) is "corrected at
  archive time", but **no task covers it**. A decision with no task is a decision that gets dropped.
- Task 6.3 sweeps "every row, the create action, AND the drag strip". Under D5 the create affordance
  in the empty branch is `EmptyState`'s CTA, a *different* element (`.ui-empty-state__cta`), and the
  spec's "Create action meets the tap-target floor" scenario covers it too. It is floored today only
  by `EmptyState.css:219-227`, whose own comment says the floor is "defensively — the sidebar column
  is **not mounted at this breakpoint**". This change is what makes `variant="sidebar"` render at
  phone width for the first time, so that rule stops being defensive and becomes load-bearing, and
  its comment becomes false. Required: name the empty-branch CTA explicitly in task 6.3's measured
  sweep (six prior regressions; two of them rules that read right and computed wrong), and add a task
  to correct that comment.

### Non-blocking notes

- **D10's premise sentence is factually wrong about the current file.** It says "The existing
  `prefers-reduced-motion` block sits *before* the rules it must override". It does not:
  `MobileNavSheet.css:42` declares the panel's `animation`, and the reduced-motion block is at
  `:54-59` — after it, so it currently wins. The real hazard is the one D10's *prescription* handles
  (a new wrapper rule declared after `:59` would win at equal specificity), and that prescription is
  correct. Worth correcting the sentence so an executor doesn't "fix" working behaviour — this repo
  has already spent a cycle on a comment that cited something that didn't exist.
- **The panel does not visually follow the drag today, and won't after.** `MobileNavSheet.css:42`
  is `animation: … both`; a filling animation's `transform: translateY(0)` sits at the animation
  cascade origin, which outranks the inline `transform` set at `MobileNavSheet.tsx:173-174`. So
  dismissal fires at threshold (JS state) but the sheet doesn't track the finger — except under
  reduced motion, where `animation: none` removes the fill and it does. Pre-existing and out of scope
  (HEL-565 is parked), but flagging it so the executor doesn't burn a debug cycle on it while
  verifying AC4.
- **`CreateActionResult` is declared four separate times** (`useCreateDashboardAction.tsx:8`,
  `useAddSourceAction.tsx:7`, `useCreatePipelineAction.tsx:7`, `useCreatePanelAction.tsx:7`), not
  once. D6/task 3.1 speak of it as a single type. The three in scope are structurally identical so
  importing any one type-checks; the HEL-554 fence forbids consolidating them. Worth one clarifying
  word so the executor doesn't try.
- **The assistant section is not actually create-less on phone.** `CommandBar.tsx:170-180` already
  ships a phone-only "New chat" affordance (HEL-746) dispatching `startNewConversation()`, added
  precisely because the desktop trigger is hidden below 768px. The plan's "registry/metrics/chat get
  no create action, no hook exists" is true about hooks but leaves chat with a create control in the
  bar and none in the sheet, one tap apart. Ticket-sanctioned; name it in the spinoff so the
  asymmetry is tracked accurately.
- **D2's `pointer-events: none` rationale is inert as stated** ("so the clipped region never eats taps
  meant for the trigger" — the wrapper's box starts at the seam and never overlaps the trigger). It
  is load-bearing for a different reason worth writing down: if the wrapper is given `bottom: 0`
  (the natural instinct for a fixed clipper), it would otherwise swallow backdrop taps below the
  panel and break AC4.
- **A simpler alternative to D2 exists** if the wrapper proves troublesome: animate `clip-path:
  inset(0 0 100% 0)` → `inset(0)` on the panel itself. The panel already owns `--z-popover` in the
  root stacking context, so a stacking context on itself changes nothing, and no second element is
  needed. Cost: the panel's `box-shadow` is clipped, which is exactly what D2's negative-inset trick
  preserves. D2 is sound as written; noting the option because D2 calls itself the riskiest decision.
- **Budgets** (`openspec/config.yaml`): `design.md` is 155 lines against a 150 max; `proposal.md` is
  338 words against "under 300" (down from 385); `tasks.md` has one 242-char line. `openspec validate
  --strict` passes regardless. Cosmetic.
- **Environment:** the worktree's `scripts/concertino/` still has no `next-report-number.sh`,
  `persist-evidence.sh` or `emit-event.sh`; used `/home/matt/Development/helio/scripts/concertino/`
  as instructed. The final gate will hit the same gap.
