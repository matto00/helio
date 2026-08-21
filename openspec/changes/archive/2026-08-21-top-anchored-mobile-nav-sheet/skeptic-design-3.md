## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Cold read. Every claim below comes from a file I opened in this worktree — not from
`skeptic-design-1.md`/`skeptic-design-2.md`'s narratives and not from the planners'. Read in full:
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/mobile-dashboard-sheet/spec.md`, both
prior skeptic reports, the current `DESIGN.md`, and the ground truth each artifact depends on.

Did **not** start dev servers and did **not** touch the shared MCP Playwright session, per
instructions. No code modified; this report is the only file I wrote.

**Round 2's seven — verified individually against the current artifacts**

| R2 CR | Status | Evidence |
| --- | --- | --- |
| 1. Scrim never designed; anchoring read undecided | **Genuinely fixed** | D2 is a real decision with named consequences, not a reword. Tasks 1.3/1.4; spec scenarios "The command bar is not covered or dimmed by the sheet" / "The trigger toggles the sheet closed" / "Nothing else outside the sheet is reachable"; task 6.4 rewritten. It also *improved* on R2's suggestion: R2 said "hit-testable" isn't measurable, but under option (a) it is — `elementFromPoint` at the trigger centre returns the trigger, since nothing paints above the seam. Judgment below. |
| 2. Dashboards flow divergence / label / glyph | **Fixed except the spec prose** — see CR5 | D7 states the divergence plainly; AC3 carries a "Refined during planning" note; task 3.5 forbids local strings and a hand-rolled `+`; scenario "Action label and glyph come from the hook". But R2 asked to "fix the spec wording so it doesn't promise strings that cannot appear" and the delta + `proposal.md` still say "Add dashboard … Add pipeline". |
| 3. Error/pending had no design counterpart | **Genuinely fixed** — but see CR1 | D9 names a per-branch treatment; task 3.8; two new spec scenarios; task 5.9. I re-derived the premise: `useAddSourceAction.tsx:29-30` and `useCreatePipelineAction.tsx:30-31` hardcode `error: null, isPending: false`, so D9's "one treatment, not three" is true. The treatment is now, however, unreachable — CR1. |
| 4. Initial focus would silently move to create | **Genuinely fixed** | D10; task 2.5; scenario "Initial focus lands on the list, not the create action"; task 5.6. Premise re-derived: `MobileNavSheet.tsx:81-82` focuses the first `FOCUSABLE_SELECTORS` match, and today's drag handle (`:193-202`) is a non-focusable `<div>`, so the change really would move it. Empty-branch gap noted below (non-blocking). |
| 5. Unquantified max-height / drag strip in the home-indicator band | **Addressed, but the fix re-derives a token** — see CR3 | D5 quantifies it and gives the right *reason* (capsule at `z-index: 5` per `BottomNav.css:25`, below scrim 99 / panel 100; upward dismissal in the home-indicator band on the filing platform). Spec scenario + task 6.5 added. The clearance is hand-composed from `--bottom-nav-height`'s three inputs instead of the token. |
| 6. D11 "single shared source" wasn't what it built | **Genuinely fixed** | The spec sentence is softened to "a single shared per-section table consumed by the sheet … locked … for the sections the sidebar owns"; the parity scenario is fenced to "a section whose sidebar empty state is owned by the shared sidebar body"; task 5.8 excludes dashboards with the HEL-554 reason. I confirmed the five/one split is real: `SidebarBody.tsx:128-130, 160-162, 197-199, 239-241, 333-335` own five sections; dashboards' sidebar copy is not there. |
| 7. Stale spec text / unowned promise / CTA missing from sweep | **Genuinely fixed** | "Tappable command-bar title on phone" is now in MODIFIED and its scenario says "top-anchored navigation sheet" (base file still says "bottom sheet" at `openspec/specs/mobile-dashboard-sheet/spec.md:16-17` — correctly, that's what the delta changes). Purpose correction is owned by task 7.1. Task 6.3 names the empty-branch CTA; task 4.4 corrects `EmptyState.css:220-222`'s now-false comment. |

**Round 1's six — checked for regression while round 2's fixes landed**

All six survive. D6 + task 3.7 + "Never two create affordances at once" + test 5.5 (R1-CR1);
D11 + task 4.1 (R1-CR2); D3 + tasks 1.7/1.8 (R1-CR3); D12 + tasks 1.10/6.6 + scenario (R1-CR4);
REMOVED+ADDED with Reason/Migration (R1-CR5); D4 + task 2.3 + scenario + task 6.3 (R1-CR6).
None was reworded away or quietly narrowed.

**Where a prior skeptic was wrong, and I disagree with the fix**

- R1-CR6's premise ("D3 narrows the pointer region to the grabber only, permitting a ~12–24px
  target") was right to demand a floor, and D4's literal `44px` is the correct answer. No dispute.
- R2's non-blocking claim that D10's premise sentence was factually wrong is itself correct and was
  fixed: D12 now says the reduced-motion block "currently sits *after* the panel's `animation`, so it
  wins today", which matches `MobileNavSheet.css:42` vs `:54-59`. Good — this repo has already spent
  a cycle on a comment citing something that didn't exist.
- I found no prior change request whose fix made the plan worse. CR3 below is the one place a fix
  introduced a smaller new problem.

**Independently re-derived ground truth (not taken from either predecessor)**

- **D1 seam.** `theme/theme.css:118-134` declares `--app-safe-top`/`--app-command-bar-height`/
  `--app-top-chrome-height`; `:137-143` overrides the input on `:root` so the seam recomputes at
  phone width. `App.css:60-76` — `.app-command-bar { height: var(--app-top-chrome-height);
  padding-top: var(--app-safe-top); border-bottom: 1px; position: relative; z-index: 2;
  background: var(--app-surface) }`, `box-sizing: border-box` globally, and its comment confirms the
  bar is structurally non-scrolling (not `position: sticky`). So the bar's border-box bottom edge is
  exactly `--app-top-chrome-height` and cannot move. D1 is sound.
- **D2's stacking premise.** `App.css:38-53` `.app-shell { position: relative; z-index: 1 }` is a
  stacking context; the sheet is portalled to `document.body`; `theme.css:81-82` `--z-popover-scrim:
  99` / `--z-popover: 100`. So today's `inset: 0` backdrop (`MobileNavSheet.css:5-9`) really does
  paint over the whole bar regardless of its local `z-index: 2`. D2's diagnosis is correct.
- **What "the bar's other controls" actually are at phone width** (task 1.4's real scope): the
  wordmark `<Link>` (`App.css:428-430`, min-height 44px), the phone-only "New chat" `IconButton`
  (`CommandBar.tsx:170-180`), "Refine with AI", the quick-launcher, and the `UserMenu` trigger.
  Undo/redo, the appearance editor and the save-state indicator are `display: none` here
  (`App.css:487-494`). Crucially, `CommandBar` **already receives `isMobileNavSheetOpen`**
  (`CommandBar.tsx:35-36`, `App.tsx:155-157`), so tasks 1.4's toggle + inert wiring need no state
  lifting. That was my main feasibility worry about D2 and it does not survive contact with the code.
- **Hooks.** `useCreateDashboardAction.tsx:29-57` (dispatch + 2 × `useState`, real error/pending),
  `useAddSourceAction.tsx:20-31`, `useCreatePipelineAction.tsx:21-33` (dispatch only). No `useEffect`
  in any of the three — D8's "verified inert" holds. Labels are "New dashboard" / "Add source" /
  "New pipeline"; all three icons are lucide `<Plus />`.
- **`EmptyState`.** `EmptyState.tsx:24-46` requires `icon`/`title`/`description`; `cta` is the
  Primary recipe (`:30`, `EmptyState.css:102-117`); `intent="error"` exists (`:42-45`). D6's "one
  primary per view" reasoning is right. I also checked the cascade hazard the user flagged:
  `EmptyState.css:163-165` sets `height: var(--control-sm)` on the sidebar variant at specificity
  (0,2,0) while `:219-227` sets `min-height: 44px` at (0,1,0) — **`min-height` clamps `height`
  regardless of specificity, so the empty-branch CTA computes to 44px.** No HEL-535-class bug here.
  Task 6.3's measurement remains the right proof.
- **`--bottom-nav-height`** (`theme.css:96-105`) is already *exactly* capsule + inset +
  `env(safe-area-inset-bottom)`, and its own comment calls it "the single source of truth for every
  OTHER consumer that just needs to clear the bar … Consolidated from three inlined copies". CR3.
- **Registry already has a wired create action.** `SidebarBody.tsx:70` calls
  `useCreatePipelineAction()`; `:249` passes `emptyCta={createPipelineAction.cta}` for the Data
  Types section, with a comment at `:242-248` explaining the deliberate "empty CTA, no header +"
  shape. CR2.
- **Modal reach.** `App.tsx:207-209` mounts `CreatePipelineModal` for every route except exactly
  `/pipelines`; `AppRoutes.tsx:92-93` registers `/registry` and `/registry/:id`. So D14's structural
  argument extends to registry with no new mount. `AddSourceModal.tsx` does **not** call
  `useOverlay`, so opening a modal will not auto-dismiss the sheet — task 3.9 is genuinely needed.
- **`openspec validate top-anchored-mobile-nav-sheet --strict`** → `Change
  'top-anchored-mobile-nav-sheet' is valid` (ran `/usr/bin/openspec` from the worktree root).
- **`DESIGN.md`, read fresh (373 lines, current file).** HEL-774 bottom-nav carve-out: `:104-130` —
  real, explicitly scoped ("this carve-out does not widen"), and it names `MobileNavSheet`'s backdrop
  as intentionally flat (`:115-121`). Sanctioned `::after` hit expander: `:200-208`, scoped to "a
  painted chrome control that must not visually grow". Mobile 44px floor: `:193-209`, literal `44px`,
  phone-only, "intentional, not drift". §5 recipes `:259-273`. §6 primitives `:309-331` (InlineError
  and SidebarItemList both listed). §7 states `:352-362` — "**Error:** visible, human-readable,
  intent-error styled — **never swallow a failed fetch**". §3 Motion `:230-246` — "Modals/popovers/
  auth card animate in once (fade + 4–10px rise) … one entrance per surface". Every `design.md`
  citation I checked against the current file is accurate.

### Verdict: REFUTE

D2 — the decision I was asked to judge hardest — is **sound, and I would not take the fallback.**
The planner correctly identified that the scrim, not the panel, decides "reads as anchored", and
cutting the scrim at the seam is the minimal intervention that achieves it (the alternatives —
raising `.app-shell`'s stacking context or portalling the bar — are far more invasive). "Inert
everything except the trigger" is coherent, not a fudge: `aria-modal="true"` already removes the bar
from the AT tree, the trap already prevents keyboard escape, and the single remaining reachable
control is the disclosure button that owns the popup — which already carries `aria-haspopup="dialog"`
+ `aria-expanded` (`CommandBar.tsx:161-163`) and whose tap already dismisses today via the backdrop.
The deviation is documented, narrow, and unobservable to the users the strict rule protects. The
fallback named in Risks (full-viewport scrim, dimmed trigger, anchoring carried by geometry alone) is
also the right fallback — it degrades to today's behaviour minus the anchoring read, not to something
new. D3, D5's reasoning, D10, D11 and D12 all survive adversarial checking too.

What fails is a layer neither predecessor reached. Round 2 correctly demanded an error/pending
decision and got D9 — but nothing reconciled D9 with the dismissal task that predates it, so the
entire treatment, plus two spec scenarios, is now unreachable code (CR1). And a factual premise
inherited from the ticket — "type registry has no create-action hook" — is false, contradicted by a
line the plan is already consuming (CR2). The remaining three are cheap but real: a token
re-derivation against that token's own documented contract (CR3), a stale declaration that
double-counts the home-indicator inset and breaks D4's "bottom free edge" (CR4), and a durable spec
sentence that still promises strings the app cannot render (CR5).

All five are artifact-level. None needs new dependencies, and none touches a fenced file.

### Change Requests

**1. Task 3.9 ("dismiss when the action fires") makes D9, task 3.8, task 5.9 and two spec scenarios
unreachable — and the failure mode is silently swallowing a failed create.**
Task 3.9 says, unqualified: "Dismiss the sheet when the action fires." D9 says a failed create is
surfaced *in the sheet* and `isPending` is expressed by the hook's own label swap *on the control in
the sheet*. Both spec scenarios are explicit about the sheet being open — "**WHEN** a create action
fails **while the sheet is open**", "**WHEN** a create action is in flight — **THEN** its label
reflects the pending state". `useCreateDashboardAction.tsx:34-44` is the only one of the three that
can go pending or fail, and it is `async`: if the sheet unmounts on click, its "Creating..." label
(`:51`) and its error (`:40`) both land on a control that no longer exists. Nothing in `design.md`
reconciles the two. Consequences:
- A failed dashboard create reports **nothing at all** — which is precisely the outcome the hook's
  own docstring says it exists to prevent: "after HEL-770's toast removal (D6a) a hook that swallowed
  it would leave a failed create reporting nothing at all" (`useCreateDashboardAction.tsx:19-20`).
  That is a `DESIGN.md:359-360` violation ("never swallow a failed fetch"), not a nicety.
- Second-order, and worth stating because it bites either way: the hook is called from
  `usePickerSelection`, which lives in `MobileShell` — a component that **never unmounts**. The sheet
  itself unmounts (`MobileNavSheet.tsx:147`), but the error state does not, and `setError(null)`
  happens only at the top of the *next* `handleCreate()` (`:36`). So a failure that occurred with the
  sheet closed will render as a stale error the next time the user opens the sheet, minutes later.

Required: add a decision (or extend D9) stating the dismissal rule per section, and reconcile task
3.9 with it. The shape that satisfies both halves: **sources/pipelines dismiss on fire** (pure flag
flips, cannot fail, and the modal must not open behind the sheet); **dashboards keeps the sheet open
while pending and dismisses only on success**, leaving it open on failure so D9's treatment can
actually render. Also state when the error clears (on sheet open, or on close) so a stale error
cannot resurface, and make task 5.9 assert both the in-sheet presentation and the dismissal timing.

**2. The delta asserts, as a `SHALL`, something the codebase contradicts — and the affected section
ships as a phone dead end.**
The spec delta states: "Sections with no corresponding create-action hook (type registry, metrics,
assistant) SHALL offer no create action rather than a fabricated one", and `ticket.md`'s Out-of-scope
and D7 carry the same premise. It is false for type registry. `SidebarBody.tsx:70` calls
`useCreatePipelineAction()` and `:249` passes `emptyCta={createPipelineAction.cta}` to the Data Types
list, with a comment at `:242-248` recording the deliberate decision: "This section has no create
action of its own, so it gets the CTA without the header icon." The hook exists, is already in this
change's dependency set (D8 calls it unconditionally for the pipelines case), and
`App.tsx:207-209` mounts `CreatePipelineModal` on every route except `/pipelines` — so
`/registry` and `/registry/:id` (`AppRoutes.tsx:92-93`) are covered, and AC9's "no new hook, no new
modal mount" holds unchanged. Consequences as planned:
- The phone registry empty state renders "No types defined" / "Types are created by pipelines." with
  no way to create a pipeline — the sidebar is `display: none` below 768px (`App.css:499`). That
  contradicts the sheet's own founding principle, quoted in the file being edited: "every section
  must be a picker, never a dead end" (`MobileNavSheet.tsx:23-24`), and makes the delta's scenario
  "Empty section without a create action is still not a dead end" untrue for this section.
- The delta's scenario "Phone and desktop empty states agree" is scoped to sidebar-owned sections,
  which **includes** registry — and desktop registry renders a CTA the phone one will not. Task 5.8's
  lock will either fail or have to be written to compare only three of the four rendered parts.
- `PickerSelection.createAction: CreateActionResult | null` (D8, task 3.1) cannot express registry's
  shipped shape at all: "empty-branch CTA only, no header action" is a distinction `SidebarItemList`
  already carries as `emptyCta` vs `onAdd`, and D6 collapses it to one slot.

Required, minimum: correct the false premise everywhere it appears (delta, `ticket.md` Out-of-scope,
D7) — the true reason is a scope choice, not an absent hook — and fix the parity scenario so registry
cannot fail it. Strongly recommended, and cheap: wire registry's **empty-branch CTA only** to
`createPipelineAction`, which needs one `case` arm and a header/empty distinction in
`PickerSelection` mirroring `SidebarItemList`'s. Metrics and assistant genuinely have no hook
(`SidebarBody.tsx:200, 336` dispatch inline), so the premise is true for those two.

**3. D5 / task 1.5 re-derive `--bottom-nav-height` by hand, against that token's own documented
contract.**
D5 specifies the clearance as "the HEL-774 capsule height plus its inset plus
`env(safe-area-inset-bottom)` plus a spacing token", and task 1.5 repeats the three-part expansion.
`theme.css:103-105` already defines `--bottom-nav-height` as exactly
`calc(var(--bottom-nav-capsule-height) + var(--bottom-nav-inset) + env(safe-area-inset-bottom))`, and
its comment (`:96-102`) is explicit that this is "the single source of truth for every OTHER consumer
that just needs to clear the bar … Consolidated from three inlined copies of the old flat-height
expression … onto one definition." Task 1.5 instructs the executor to create a fourth inlined copy —
one that goes stale the moment HEL-774's capsule geometry moves again, on a surface with no
compile-time link to it. Required: `max-height: calc(100dvh - var(--app-top-chrome-height) -
var(--bottom-nav-height) - var(--space-N))`, and reword D5 to consume the aggregate token rather than
its inputs. Note this does not weaken the HEL-772 prohibition — D5 already says correctly that the
ban is on deriving the **top anchor** from bottom-nav tokens; task 5.3's lock should be scoped to the
`top` declaration accordingly, not to the file.

**4. `MobileNavSheet.css:41`'s `padding-bottom: env(safe-area-inset-bottom)` is stale under a top
anchor, and no task removes it.**
That declaration is correct for a panel flush with the viewport bottom. After this change the panel's
bottom edge sits well above it, by construction (CR3's clearance). Two consequences, and the second
is the one that matters:
- Combined with a `max-height` that already subtracts the home-indicator inset, the inset is counted
  **twice** — the exact double-count `BottomNav.css:19-23` documents removing ("this offset already
  carries the home-indicator clearance, so stacking a second copy … would crush it").
- It puts up to 34px of dead padding *below* the new 44px drag strip, so the grabber is no longer at
  "the sheet's **bottom free edge**" that D4 places it at — it floats a third of a strip-height above
  it, on exactly the notched-iPhone PWA this ticket was filed from.

Tasks 1.2/1.5/1.6 enumerate the anchor-related CSS changes line by line and omit this one, so an
executor working the list will keep it. Required: a task removing it (task 1.2 is the natural home),
and fold it into task 5.3's CSS lock, which already touches that file.

**5. The spec requirement still promises labels that cannot render — the half of R2-CR2 that was not
applied.**
The delta's "Section-appropriate create action in the sheet" opens: "a create action appropriate to
the current section — Add dashboard on the dashboards picker, Add source on sources, Add pipeline on
pipelines". `proposal.md`'s What-Changes bullet repeats it. The hooks render "New dashboard"
(`useCreateDashboardAction.tsx:51`), "Add source" (`useAddSourceAction.tsx:25`), "New pipeline"
(`useCreatePipelineAction.tsx:26`), and the delta's own scenario "Action label and glyph come from
the hook" says the label *is* `cta.label` — so the requirement contradicts its own scenario. R2-CR2
asked for exactly this ("fix the spec wording so it doesn't promise strings that cannot appear");
`ticket.md` AC3 and D7 were fixed and these two were not. This is the artifact that survives archive
into the capability spec, so the false statement is the durable one, and a test writer following the
requirement will query `/Add dashboard/` and find nothing. Required: reword the requirement (and the
proposal bullet) to name the actions functionally — "create dashboard / add source / create pipeline,
labelled and glyphed from the section's shared create-action hook".

### Non-blocking notes

- **Task 1.7 omits `left: 0; right: 0` on the clip wrapper.** A `position: fixed` element with only
  `top` set is shrink-to-fit at its static position; the panel is `position: relative` inside it
  (task 1.8), so it would inherit that width and the sheet would not be full-bleed. The `clip-path`
  itself still clips correctly at the seam (the other three insets are `-100vmax`), so the symptom is
  a narrow sheet, not a broken entrance. Obvious on first render — but the task list is otherwise
  declaration-by-declaration exhaustive, so it reads as "these five are all you need".
- **D3's stated cost for its own fallback is overstated.** "Animate `clip-path: inset(0 0 100% 0)` →
  `inset(0)` on the panel itself, at the cost of clipping its shadow" — the shadow only needs to
  survive at rest, which `inset(0 -100vmax 100% -100vmax)` → `inset(0 -100vmax -100vmax -100vmax)`
  gives you. Worth correcting so the executor isn't discouraged from the simpler path. That said, I'd
  keep the wrapper as primary: a `clip-path` wipe reveals static content (a garage-door read), while
  the translate genuinely carries the panel down from the bar, which is the ticket's whole point.
- **D10 doesn't define initial focus for the empty branch.** "Active item, else first item" has no
  answer when `items` is empty, and a literal
  `(active ?? first ?? firstFocusable ?? panel).focus()` lands on the `EmptyState` CTA — reintroducing
  D10's own hazard (open dashboards picker on an empty account, press Enter, get an untitled
  dashboard). Focusing the panel is the choice consistent with D10's reasoning; the CTA is one Tab
  away. Worth one clause in D10 and in task 5.6.
- **Task 6.2's forced-inset probe can silently no-op.** `theme.css:123-127` warns that
  `--app-top-chrome-height` is substituted at computed-value time on the element that declares it, so
  a forced `--app-safe-top` set anywhere but `document.documentElement` will not recompute the seam —
  and the probe would then measure the same rect three times and pass. Given the user's emphasis on
  this and task 5.10's "prove each guard goes red" discipline, task 6.2 should say `documentElement`
  explicitly and assert the three measured tops actually differ.
- **Inert-but-undimmed is a small honesty gap.** Under D2 the bar's other controls keep full opacity
  while silently ignoring taps; the scrim used to carry "not now" for them. I would not add a
  de-emphasis treatment (there's no `DESIGN.md` pattern for it, and any dimming partly re-creates the
  problem D2 solves) — but it's worth a look on the running app at the final gate.
- **Dark-theme seam is worth a screenshot, not a rule.** The bar is `--app-surface` (`#1a1816` dark)
  and the panel is `--app-surface-strong` (`#262320`), so in dark theme the sheet is visibly lighter
  than the bar it hangs off, separated only by the bar's own `--app-border-subtle` hairline. That is
  on-pattern for a popover-class surface (`DESIGN.md:330`) and reads as "in front of" — but "reads as
  anchored" is the acceptance criterion, so judge it visually in both themes rather than by token.
- **Header-action placement costs a full row at the top of a top-anchored sheet.** Task 3.4 puts a
  labeled, full-width Secondary row under the title; the desktop twin puts a trailing icon in the
  heading row (`SidebarItemList`). The plan's choice is defensible — the ticket asks for "a distinct
  action rather than another list row", and D7 requires the label — but it pushes the list down on a
  surface whose purpose is switching. Also worth reconsidering `MobileNavSheet.css:84`'s centred
  title now that the grabber (the thing that motivated centring) has moved to the bottom edge.
- **`PickerId` has seven members, not six** (`sections.ts:18-25` — `"other"` included). Task 4.1's
  "all six sections" table will not satisfy a `Record<PickerId, …>`. The sheet is unreachable on
  `"other"` (`CommandBar.tsx:86` hides the trigger), so a defined fallback entry is enough.
- **Task 5.4 doesn't carve out dashboards.** "Assert the modal appears" has no modal to appear for
  the dashboards action; D14 says so but the task doesn't.
- **`emptyMessage` goes dead.** Once task 4.2 feeds `EmptyState` from the shared table, the
  `emptyMessage` prop (`MobileNavSheet.tsx:25`) and the six `emptyMessage` fields in
  `usePickerSelection.ts` are unused. Task 4.3 retires the CSS rule but not the prop.
- **The panel still won't track the finger, and this is a motion ticket.** `MobileNavSheet.css:42`'s
  `animation: … both` leaves `translateY(0)` at the animation cascade origin, which outranks the
  inline transform at `MobileNavSheet.tsx:173-174` — so dismissal fires at threshold with no visual
  response (except under reduced motion, where `animation: none` removes the fill and it does track).
  D4 names it, calls it pre-existing, and tells the executor not to debug it; HEL-565 is parked and
  `ticket.md` fences it. I agree it stays out — but note the direction inversion has no gestural
  feedback to teach it, which is worth a sentence in the HEL-565 spinoff.
- **Budgets** (`openspec/config.yaml`): `design.md` is exactly 150 lines (at the max), `tasks.md` 67
  of 80, `proposal.md` **338 words against "Keep under 300"** — flagged in both prior rounds and
  still over. `openspec validate --strict` passes regardless. Cosmetic.
- **Environment:** the worktree's `scripts/concertino/` still lacks `next-report-number.sh`,
  `persist-evidence.sh` and `emit-event.sh`; used `/home/matt/Development/helio/scripts/concertino/`
  as instructed. The final gate will hit the same gap.
