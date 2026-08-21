## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Cold read. Every claim below comes from a file I opened in this worktree — not from the three
predecessors' narratives and not from the planners'. Read in full: `ticket.md`, `proposal.md`,
`design.md`, `tasks.md`, `specs/mobile-dashboard-sheet/spec.md`, all three prior skeptic reports,
`workflow-state.md`, the current `DESIGN.md`, and the ground truth each artifact depends on.

Did **not** start dev servers and did **not** touch the shared MCP Playwright session, per
instructions. No code modified; this report is the only file I wrote.

**Round 3's five — verified individually against the current artifacts**

| R3 CR | Status | Evidence |
| --- | --- | --- |
| 1. Dismissal timing made D9 unreachable | **Genuinely fixed** | D9 now carries the per-section rule verbatim ("Sources/pipelines/registry dismiss on fire … Dashboards keeps the sheet open while pending and dismisses only on success"); task 3.9 matches it clause for clause; task 5.9 asserts both the presentation and the timing; the spec gains "The sheet does not dismiss out from under a create that can fail" + "A stale failure does not resurface". The premise re-derived: `useAddSourceAction.tsx:29-30` and `useCreatePipelineAction.tsx:30-31` hardcode `error: null, isPending: false`, so only dashboards can fail. Correct. **But the mechanism is not available on the fenced hook — CR2.** |
| 2. "Registry has no create hook" was false | **Genuinely fixed** | Re-derived independently: `SidebarBody.tsx:70` calls `useCreatePipelineAction()`, `:239-249` passes `emptyCta={createPipelineAction.cta}` with `emptyText="No types defined"` / `emptyDescription="Types are created by pipelines."` and no `onAdd`. D7 describes exactly that shape; D6/task 3.1 add the second slot (`createAction` vs `emptyCreateAction`) that makes it expressible; the spec's "Sections without a hook offer no create action" scenario is now scoped to metrics/assistant only, and a separate registry scenario states the empty-branch-only rule. `App.tsx:207-209` mounts `CreatePipelineModal` for every route except exactly `/pipelines`, so `/registry` is covered with no new mount. |
| 3. D5 hand-composed `--bottom-nav-height` | **Genuinely fixed** | D5 and task 1.5 both now consume the aggregate token and task 1.5 explicitly forbids re-inlining its three inputs. `theme.css:96-105` confirms the token is exactly `capsule-height + inset + env(safe-area-inset-bottom)` and its comment claims single-source-of-truth status. Task 5.3's lock is correctly scoped to the `top` declaration, not the file, so bottom clearance stays legal. |
| 4. Stale `padding-bottom: env(safe-area-inset-bottom)` | **Genuinely fixed** | `MobileNavSheet.css:41` still carries it; task 1.2 now names it explicitly with the reason, and task 5.3 locks against it lingering. |
| 5. Spec/proposal still promised "Add dashboard"/"Add pipeline" | **Genuinely fixed** | The requirement now reads "create a dashboard on the dashboards picker, add a source on sources, create a pipeline on pipelines — … labelled and glyphed from that hook rather than from strings authored here"; the proposal bullet says "Labels and glyphs come from the HEL-548 hooks". No artifact now promises a string the app cannot render (verified against `useCreateDashboardAction.tsx:51` "New dashboard", `useAddSourceAction.tsx:25` "Add source", `useCreatePipelineAction.tsx:26` "New pipeline"). |

All six adopted non-blocking items are present: `left: 0; right: 0` (task 1.7), empty-branch initial
focus (D10 + task 2.5 "else the panel itself"), `documentElement` for the forced-inset probe (task
6.2), the dashboards carve-out in the modal test (task 5.4), `emptyMessage` retirement (task 4.3),
and the seven-member `PickerId` (task 4.1; confirmed seven at `sections.ts:18-25`).

**Rounds 1 and 2 — checked for regression.** All thirteen survive. R1: arbitration (D6 + task 3.7 +
"Never two create affordances at once"), `EmptyState` prop sourcing (D11 + task 4.1), clip-path
stacking (D3 + tasks 1.7/1.8), reduced-motion runtime proof (D12 + tasks 1.10/6.6), REMOVED+ADDED
with Reason/Migration, drag-strip floor (D4 + task 2.3 + task 6.3). R2: the scrim decision (D2 +
tasks 1.3/1.4 + three scenarios), dashboards flow/label/glyph, error+pending treatment (D9), initial
focus (D10), quantified `max-height` (D5 + task 6.5), the softened "single shared source" sentence,
and the stale sibling requirement (`Tappable command-bar title on phone` is in MODIFIED and now says
"top-anchored"). Nothing was reworded away or quietly narrowed.

**Independently re-derived ground truth**

- **D1's seam.** `theme/theme.css:118-137` declares `--app-safe-top`/`--app-command-bar-height`/
  `--app-top-chrome-height` on `:root`, and `:139-146` overrides the input on `:root` so the seam
  recomputes at phone width (56px). `App.css:60-76`: `.app-command-bar { height:
  var(--app-top-chrome-height); padding-top: var(--app-safe-top); border-bottom: 1px; position:
  relative; z-index: 2 }` with global `box-sizing: border-box`. The bar's border-box bottom edge is
  exactly `--app-top-chrome-height` from the viewport top and structurally cannot move. D1 is sound,
  and task 6.2's forced-inset probe works because the override and the `calc()` both land on
  `documentElement`.
- **D2's stacking premise.** `.app-shell { position: relative; z-index: 1 }` (`App.css:2-19`) is a
  stacking context; the sheet portals to `document.body`; `theme.css:81-82` gives
  `--z-popover-scrim: 99` / `--z-popover: 100`. Today's `inset: 0` backdrop
  (`MobileNavSheet.css:5-9`, `background: var(--app-overlay)`) really does paint over the whole bar
  regardless of its local `z-index: 2`. The diagnosis is correct and the fix is minimal.
- **D2's feasibility.** `CommandBar` already receives `isMobileNavSheetOpen`
  (`CommandBar.tsx:35-36`), so the toggle and the inert-siblings wiring need no state lifting. The
  trigger already carries `aria-haspopup="dialog"` + `aria-expanded` (`:161-163`).
- **Hooks.** `useCreateDashboardAction.tsx:29-57` (dispatch + two `useState`, real error/pending),
  `useAddSourceAction.tsx:20-31` and `useCreatePipelineAction.tsx:21-33` (dispatch only). No
  `useEffect` in any of the three — D8's "verified inert" holds. All three icons are lucide `<Plus/>`.
  All three declare their own `CreateActionResult` (four counting `useCreatePanelAction`), so task
  3.1's "import one, do not consolidate" is the right instruction.
- **`MobileShell` never unmounts** — `App.tsx:196-199` renders it as a direct child of `.app-shell`
  for the whole `AppShell` lifetime. D9's second-order claim is true.
- **`EmptyState`.** `EmptyState.tsx:24-46` requires `icon`/`title`/`description`; `.ui-empty-state__cta`
  is the Primary recipe (`EmptyState.css:99-117`, `background: var(--app-accent)`), so D6's
  "one primary per view" arithmetic is right. I re-checked the cascade hazard the user flagged:
  `EmptyState.css:162-167` sets `height: var(--control-sm)` at specificity (0,2,0) while `:219-227`
  sets `min-height: 44px` at (0,1,0) — `min-height` clamps `height` as a used value regardless of
  specificity, so the empty-branch CTA computes to 44px. **No HEL-535-class inert-cascade bug here**,
  and task 6.3's measurement is still the right proof rather than the CSS read.
- **`PanelList.tsx:405-432`** renders `createDashboardAction.error` as `EmptyState intent="error"` +
  `<TriangleAlert/>` + title "Couldn't create dashboard" + the message as `description` + the same
  `cta` for retry. D9's "mirroring `PanelList`'s shipped treatment" is accurate, and
  `variant="sidebar"` + `intent="error"` compose correctly (`EmptyState.tsx:80-86`; the error block
  is placed after the variant blocks to win the specificity tie).
- **`InlineError`** (`shared/chrome/InlineError.tsx`) defaults to `variant="text"` — a bare `<p>`, no
  new tap target; and if the executor picks `variant="banner"` with a retry, `InlineError.css:68-71`
  already floors `.inline-error__retry` at 44px below 768px. Either choice is safe.
- **The existing guards this change must edit.** `MobileNavSheet.test.tsx:84-90` is the "no CRUD
  affordances" test (`/add/i`, `/delete/i`, `/actions/i` — "Add source" would trip it, "New
  dashboard"/"New pipeline" would not), and `:92-97` is the `emptyMessage` test that task 4.3's prop
  retirement invalidates. `MobileNavSheet.css.test.ts:54-59` scans the first `max-width: 768px`
  `@media` block for `.mobile-nav-sheet__item { min-height: 44px }`; nothing the plan adds collides
  with its `findMediaBlock`/`findRuleBody` scan.
- **`.app-command-bar__mobile-title`** is `display: inline-flex; min-height: 44px` inside
  `@media (max-width: 768px)` (`App.css:432-435`), so the sheet is genuinely openable at **exactly**
  768px and task 6.3's "430 and 768" sweep is measurable at both widths.
- **`openspec validate top-anchored-mobile-nav-sheet --strict`** → `Change
  'top-anchored-mobile-nav-sheet' is valid` (`/usr/bin/openspec`, run from the worktree root). All
  four MODIFIED headers and the one REMOVED header match the base spec's requirement names exactly
  (`openspec/specs/mobile-dashboard-sheet/spec.md:8,23,38,52,66`), so the delta will apply cleanly.
- **`DESIGN.md`, read fresh (373 lines, current file).** HEL-774 bottom-nav opacity carve-out is
  real at `:35-43` and `:104-130`, explicitly scoped ("this carve-out does not widen"), and it names
  `MobileNavSheet`'s backdrop as intentionally flat/no-blur (`:115-121`) — the plan adds no blur, so
  it stays compliant. Sanctioned `::after` hit expander: `:200-208`, scoped to "a painted chrome
  control that must not visually grow" — the plan correctly does **not** invoke it for the labeled
  create action or the drag strip. 44px floor: `:193-209`, literal `44px`, phone-only, "intentional,
  not drift". §5 recipes `:259-273` (Secondary = transparent + `--app-border-subtle` hairline + muted
  text; "One primary per view/section"). §3 Motion `:229-245`. §4 Breakpoints `:247-259`. **Every
  `DESIGN.md` citation in `design.md` and `tasks.md` that I checked against the current file exists
  and says what the plan claims it says** — no repeat of the HEL-774 nonexistent-exception defect.
  (One *internal* cross-reference is wrong; see notes.)
- **Token discipline.** The only literals the plan introduces are `44px` (explicitly sanctioned),
  `-100vmax`/`100dvh` (geometry, no token exists), and `--space-N` (a metavariable — see notes). No
  hardcoded color, no literal `font-size`, no literal spacing. Clean.

### Verdict: REFUTE

This plan is close, and most of it is genuinely good. D2 — the decision I re-judged hardest — is
right: the scrim, not the panel, is what decides "reads as anchored to its trigger", and cutting it
at the seam is the minimal intervention that buys it. I would not take the fallback either. D5's
clearance reasoning, D7's registry correction, D10, D11, D12 and D14 all survive adversarial
checking, and the 44px story is the most rigorous I have seen in this repo (four named elements,
computed-style measurement at two widths, red-first discipline).

Two things fail, and both are the same species: **a fix from an earlier round invalidated an
instruction from an earlier round, and nobody re-checked the pair.**

CR1 is the serious one. Round 1's CR3 asked that "wrapper and panel must both carry
`top: var(--app-top-chrome-height)`" — correct advice for a `position: fixed` panel. The *same* CR
also produced the fix that makes the panel `position: relative`. Under `position: relative`, `top`
is a relative offset from the panel's already-correct in-flow position, so the plan as written
places the sheet's top edge at **twice** the seam. That is AC1 and AC2's exact failure mode, written
into the design and into two task checkboxes.

CR2 is the same shape: D9's dismissal/error lifecycle (added in round 3) is stated in terms of an
API the fenced hook does not have, so the literal instruction can only be followed by editing a file
`workflow-state.md` forbids.

Both are one- or two-sentence artifact fixes. Nothing else I found is blocking.

### Change Requests

**1. The plan puts the seam offset on BOTH the wrapper and the panel while making the panel
`position: relative` — that double-counts the anchor and detaches the sheet from the command bar.**

The three instructions, read together, are incompatible:
- `design.md` D1: "The sheet is `top: var(--app-top-chrome-height)`" — "the sheet" is
  `.mobile-nav-sheet__panel`; `tasks.md` 1.2 repeats it as a checkbox ("Re-anchor the sheet to
  `top: var(--app-top-chrome-height)`").
- `design.md` D3 / `tasks.md` 1.7: the wrapper is `position: fixed`, **"same `top`"**.
- `design.md` D3 / `tasks.md` 1.8: **"The panel becomes `position: relative` inside it."**

`top` on a relatively positioned box is a *relative offset from its normal-flow position*, not an
anchor. The panel's normal-flow position inside the wrapper is already the seam (the wrapper is
fixed at `top: var(--app-top-chrome-height)` and the panel is its in-flow child), so a second
`top: var(--app-top-chrome-height)` shifts it a further 56px + inset down. At phone width that is a
112px-plus gap between the command bar's bottom edge and the sheet's top edge — the sheet floating
detached in the middle of a dimmed screen, which is precisely the "reads as anchored" property D2's
whole apparatus exists to buy. Note this is not rescued by reverting task 1.8: `clip-path` on the
wrapper establishes a stacking context (so it still clips a `fixed` panel) but is **not** in the set
of properties that make an ancestor the containing block for `position: fixed` descendants
(transform/perspective, filter, `contain`, `backdrop-filter`, `container-type`) — so a `fixed` panel
would resolve `top` against the viewport correctly, and *that* is the configuration round 1's advice
was written for. As soon as the panel became `relative`, "both carry `top`" became wrong.

Required: state in D1/D3 and in tasks 1.2/1.7/1.8 that **the wrapper owns the anchor and the panel
carries no `top` of its own** — the panel's existing `position: fixed; left: 0; right: 0; bottom: 0`
declarations are all removed, `position: relative` replaces them, and its top edge comes from the
wrapper. Add the assertion to task 6.2 in unambiguous form: `sheetRect.top === commandBarRect.bottom`
(the requirement's own prose already says "its top edge coincides with the bottom edge of the command
bar"), which is measurable without the "height plus inset" ambiguity flagged in the notes below.

**2. D9's create lifecycle is specified in terms of an API `useCreateDashboardAction` does not
expose, and the only literal way to follow the instruction is to edit a fenced file.**

`useCreateDashboardAction.tsx:46-57` returns exactly `{ cta, error, isPending }`. There is **no**
error-reset function and **no** success signal; `setError(null)` happens only at
`useCreateDashboardAction.tsx:36`, i.e. at the top of the *next* `handleCreate()`.
`workflow-state.md`'s fence is unambiguous ("Do not edit the HEL-548 create-action hooks"), and
`tasks.md` 4.1 tells the executor to escalate rather than cross a fence. Yet:

- `design.md` D9 and `tasks.md` 3.9 both say **"the error is cleared when the sheet opens"**. Nothing
  in the returned shape can clear it. An executor following the sentence literally goes to the hook,
  hits the fence, and escalates — or crosses it, which collides with the concurrent HEL-554 run.
- `design.md` D9 and `tasks.md` 3.9 say dashboards **"dismisses on success"**. The hook emits no
  success callback either; the only in-fence signal is an `isPending` true→false transition observed
  with `error === null` in the same commit (safe, because `handleCreate`'s `setError` and its
  `finally { setIsPending(false) }` batch into one render — but it needs a ref to distinguish a
  transition from the initial `false`).

Both are satisfiable inside the fence, and cheaply — the sheet (or `MobileShell`) keeps its own
"a create was fired during this open session" flag, reset when `open` flips true, and surfaces
`createAction.error` only while that flag is set; the same flag plus an `isPending` transition drives
the dismiss-on-success. The spec already makes both behaviours `SHALL`s ("The sheet does not dismiss
out from under a create that can fail", "A stale failure does not resurface") and task 5.9 tests
them, so this is not optional scope — it just has no stated mechanism.

Required: replace "the error is cleared when the sheet opens" in D9 and task 3.9 with the
consumer-side formulation — *the sheet surfaces `createAction.error` only for an attempt fired during
the current open session, and infers success from the hook's own `isPending`/`error` transition;
neither is achieved by editing the hook* — so the executor is not sent at a fenced file for a
capability that does not exist there.

### Non-blocking notes

- **`--space-N` is a metavariable, not a token** (D5 and task 1.5). It survived three rounds. Any
  `--space-*` satisfies task 6.5's measured clearance, so an executor can pick — but naming one
  (`--space-3` matches `--bottom-nav-inset`, which is what the capsule already uses for its own edge
  gap, and would make the two gaps read as one rhythm) costs nothing and removes the last placeholder
  from the plan.
- **The spec's AC2 scenario is ambiguously worded.** "the sheet's measured bounding-client-rect top
  equals **the command bar's height** plus that inset" reads two ways: `--app-command-bar-height`
  (56px, so 56 + inset) or `commandBar.getBoundingClientRect().height` (which *already* includes the
  inset, so adding it again over-counts). The requirement's own prose gives the unambiguous form
  ("its top edge coincides with the bottom edge of the command bar"). Worth aligning the scenario
  with the prose — see CR1's second half.
- **Task 6.6's wrapper assertion is vacuously true under D3-as-designed.** Task 1.9 puts the entrance
  on the panel, so the wrapper never has an `animation` and `animation-name: none` computes for it
  whether or not the reduced-motion block works. The load-bearing half is the panel's. Keeping both
  is right (it defends D3's clip-path fallback, which *would* animate the wrapper), but task 5.10's
  red-first discipline should be applied to whichever element actually carries the animation —
  otherwise AC5's proof is half-theatre. Same for the backdrop, which is already in that block.
- **Task 3.5 cites "(design D7)" for the label/glyph rule, and D7 does not contain it.** D7 is the
  registry-empty-CTA decision. The rule itself is stated authoritatively in `ticket.md` AC3 and in the
  spec scenario "Action label and glyph come from the hook", so nothing is lost — but the pointer is
  wrong, and after three rounds of renumbering it is worth a sweep. `workflow-state.md`'s fold-in line
  has the same drift: it points at "design.md D8" (per-section plumbing) for HEL-782, which is D11 +
  D14 now.
- **`App.tsx` is missing from the proposal's Impact list.** Task 1.4's toggle wiring necessarily
  touches it — `App.tsx:156-157` passes `onOpenMobileNavSheet={() => setIsMobileNavSheetOpen(true)}`,
  so either that callback becomes a toggle or `CommandBar` gains a close prop passed from there.
  Cosmetic, but Impact is what the evaluator diffs against.
- **`emptyMessage` has seven values, not six** (`usePickerSelection.ts:105,121,136,158,173,190,204` —
  the `other` case's `""` is the seventh). D11 and task 4.3 both say six. TypeScript will point at all
  of them the moment the interface field goes, so this is bookkeeping only.
- **Task 5.7/4.2 supersede an existing test nobody has named.** `MobileNavSheet.test.tsx:92-97`
  ("shows the empty-state message when there are no items") passes `emptyMessage` as a prop and
  asserts on the bare string; task 4.3 deletes that prop. Task 5.7 replaces its coverage, but the old
  test's removal isn't owned by any checkbox.
- **Design judgment — the chevron is now a direction affordance and the plan doesn't mention it.**
  `CommandBar.tsx:168` renders `<ChevronDown size={16}>`. Under a bottom sheet that glyph pointed away
  from the motion; under a top sheet it finally points *at* it, which is a free win. But D2 makes the
  trigger a toggle, so its direction now also encodes state, and a chevron that stays down while the
  sheet is open reads as "still more to pull". Flipping it to `ChevronUp` while `isMobileNavSheetOpen`
  (or rotating it over `--app-transition`) is one line, uses no new token, and is the smallest
  possible reinforcement of the ticket's actual thesis. Worth doing; not worth blocking on.
- **Design judgment — `variant="sidebar"` for the empty branch is the right call.** I checked the
  alternative: `.ui-empty-state--main` (`EmptyState.css:12-52`) is a 320px-min-height hero with a
  64px icon plate and a Fraunces `--text-2xl` title. Inside a nav picker whose job is switching, that
  is over-weighted, and DESIGN.md `:222` scopes Fraunces to "main empty-state titles". The compact
  sidebar form (36px plate, `--text-sm` title, `--text-xs` description) is both lighter and exactly
  the copy the parity lock targets. AC8 is correct as written.
- **Design judgment — the motion reads right, with one honest gap.** Panel translating `-100%`→`0`
  inside a top-clipped wrapper, behind an undimmed bar, with the radius/border mirrored to the bottom
  edge and the shadow surviving on three sides, is the standard top-sheet/garage-door read and it
  genuinely originates at the trigger's chrome. Two things to look at on the running app at the final
  gate rather than argue here: (a) in dark theme the panel (`--app-surface-strong` #262320) is
  *lighter* than the bar (`--app-surface` #1a1816), separated only by the bar's hairline, so "hanging
  off" vs "floating in front of" is a visual call; (b) there is still no **exit** animation — the
  sheet unmounts instantly (`MobileNavSheet.tsx:147`), so an upward flick dismisses with no motion
  back toward the bar it came from. That is pre-existing and HEL-565 is fenced, but on a ticket whose
  entire premise is that direction carries meaning, the asymmetry is worth naming in the HEL-565
  spinoff alongside the "no gestural feedback" note already planned.
- **Budgets** (`openspec/config.yaml`): `design.md` is 151 lines against a 150 max (one over);
  `proposal.md` is 311 words against "under 300" (down from 385 → 338 → 311 across rounds);
  `tasks.md` has a 334-char line. `openspec validate --strict` passes regardless. Cosmetic.
- **Environment:** the worktree's `scripts/concertino/` still lacks `next-report-number.sh`,
  `persist-evidence.sh` and `emit-event.sh`; used `/home/matt/Development/helio/scripts/concertino/`
  as instructed. The final gate will hit the same gap.
