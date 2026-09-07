## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold reviewer. Every conclusion below is from ground truth in this worktree or
from live Chromium measurement, not from round 1's report or the executor's
narrative.

### What I verified (with evidence)

**Server freshness (CON-155), functionally.** `start-servers.sh` reported
"already healthy … reusing" for both ports — not trustworthy on its own. I
confirmed freshness by content, not liveness: `curl http://localhost:6435/src/
features/dashboards/ui/DashboardList.css?direct` returns the hover-reveal block
at lines **238/243/244/245**, byte-for-byte the same line numbers as the
worktree file. Vite is serving this worktree.

**Probe negative control before trusting any measurement (D0d).** My probe
returned `triggerFound: false, rowCount: 0` on the empty dashboard list — it can
report "not found". Within the measurement itself I carried both controls:
positive (`posControl_rowButtonFocused: true` on the row button) and negative
(`negControl_divFocused: false` on a non-focusable `<div>`). The probe is
capable of both outcomes.

**1. Defect (a) is REAL — reproduced twice, independently.** At 1440x900, on a
real dashboard row, resting (no hover, no focus-within):
```
wrapperDisplay: "none",  triggerRects: 0,
trig.focus() -> activeIsTrigger: false,  activeTag: "BODY"
```
Reproduced a second time after removing my injected stylesheet: same result
(`activeTag: "BODY"`). Ground truth for the mechanism:
`DashboardList.css:238-241` sets `display: none` on
`.dashboard-list__item-row .popover.actions-menu`.

**R6 / the desktop narrowing is correct.** `App.css:604-609` (inside the `:519`
`@media (max-width: 768px)` block) sets `.app-sidebar, .app-sidebar-toggle {
display: none }` — verified in the file. `MobileNavSheet.tsx` has no
`ActionsMenu` (single occurrence is the line-419 comment). The narrowing to
desktop is sound.

**R2 is correct.** `DashboardList.css:244` already carries
`.dashboard-list__item-row:focus-within .popover.actions-menu`.

**2. D1's chosen fix works AND is free of the density regression — measured.**
I injected `position: absolute` + `clip-path: inset(50%)` at rest, restoring
`position: static; clip-path: none` on hover/focus-within/open:
```
resting row BEFORE fix: rowBtnWidth 215, rowWidth 215, rowHeight 32
resting row AFTER  fix: rowBtnWidth 215, rowWidth 215, rowHeight 32   (unchanged)
.focus() on resting trigger -> focusOk: true, activeTag "BUTTON"
on focus, reveal restores flow -> position "static", clipPath "none",
   rects 1, trigger width 24, rowBtnWidth 187 (identical to today's hover state)
```
So AC 1 and AC 3 are jointly satisfiable, and hover/focus reveal still works.

**3/5. Two blocking problems remain — see Change Requests 1 and 2.**

**4. The spec delta IS correctly scoped.** `specs/actions-menu-keyboard-access/
spec.md` carries the explicit carve-out "This requirement binds only where the
menu is actually rendered: a surface that does not render an `ActionsMenu` at a
given viewport width is out of its scope". It asserts nothing about
`MobileNavSheet`. The `mobile-dashboard-sheet` delta is gone from `specs/`
(only one spec file exists). `openspec validate --strict` passes.

**Housekeeping re-confirmed.** Max migration on this base is **V102** and this
change adds none (`ls db/migration | sed … | sort -n | tail` → 100, 101, 102).
`e2e/hel1003-premise-probe*.spec.ts` are absent. The 12 in-scope jsdom
assertions check out exactly (`grep -c "toHaveFocus\|activeElement"` → 6 in
`ActionsMenu.test.tsx`, 6 in `MobileNavSheet.test.tsx`). No overlap with HEL-973
(`PipelineStepRepository`/pipelines schema) or HEL-845 (Connectors/REST source):
the planned surface is frontend CSS + `e2e/` only.

### Verdict: REFUTE

Two of the four are blocking; all four are cheap to fix in the artifacts.

### Change Requests

**1. `proposal.md` was never revised. It still states the withdrawn, refuted
claim (b) as fact and directs the executor to do exactly the work D2 withdrew.**
This is the direct answer to review question 5: yes, the plan still pushes an
executor at `MobileNavSheet`'s trap — via the first artifact an executor reads.
`openspec validate` passes because it does not cross-check prose, so the tool is
no defense here. Specific lines:
   - **Why §(b)**: "At 430 the dashboard list renders inside `MobileNavSheet`
     … The row kebab is **never reached in 40 tabs**, so Rename/Duplicate/
     Share/Export/Delete are keyboard-unreachable on phone." This is R5, which
     design.md R6 self-refutes and which I re-verified is false (the sidebar is
     not rendered at all at ≤768px).
   - **Why now**: "the defect makes every destructive dashboard action
     unreachable without a pointer on phone" — same false premise.
   - **What Changes bullet 2**: "Make the row kebab **reachable by keyboard
     inside `MobileNavSheet` at 430**". Unsatisfiable by correct code; the only
     ways to satisfy it are un-hiding the sidebar at phone width or making the
     trap enumerate outside `panelRef` — both explicitly forbidden by D2/D3.
   - **What Changes bullet 3**: "Preserve `MobileNavSheet`'s focus trap in both
     directions" — presupposes touching it.
   - **What Changes bullet 4**: "Add a Playwright regression guard **for (b)**".
   - **Modified Capabilities**: lists `mobile-dashboard-sheet` as gaining "row
     actions are keyboard-reachable inside the sheet" — that spec delta has been
     **deleted**. A Modified Capability with no delta.
   - **Impact**: lists `frontend/src/shared/chrome/MobileNavSheet.tsx` (focus
     trap) as a changed file, "blast radius is the reason the design gate is
     pointed at it".
   Rewrite `proposal.md` to match the restated scope: defect (a) only, at
   desktop width; no `MobileNavSheet` change; no `mobile-dashboard-sheet`
   modified capability; Impact limited to `DashboardList.css`, `e2e/`, and the
   two test files. Keep the refutations, but state them as refutations.

**2. The `reachedAt` red arm mandated by D4 / ticket AC 4 / task 5.4 is
UNSATISFIABLE in the in-scope desktop configuration. Measured.** D4 requires the
red arm to "show `reachedAt` at its sentinel (`-1` / never reached)" when the
fix is reverted. But with the defect fully present (unmodified worktree,
`display: none` at rest) I walked the tab order at 1440 with real key events and
the marked trigger **is reached**:
```
trail: [ {i:1, BUTTON, "HEL-1003 tabwalk"},
         {i:2, BUTTON, "HEL-1003 tabwalk actions", isTarget: true} ]
activeIsTarget: true
targetIndexAmongVisible: 15   (corroborates design.md R1's "Tab #15")
```
The mechanism: focusing the row button fires `:focus-within`
(`DashboardList.css:244`), which reveals the wrapper, so the very next Tab lands
on the kebab. Tab-reachability is **already green on unfixed code**. The
`reachedAt` shape was designed for the withdrawn 430 defect and was carried into
a desktop-only scope unchanged; reverting the fix cannot drive it to `-1`. Under
delivery pressure an executor facing a red arm that will not go red does exactly
what D4's forbidden-list anticipates — reaches for a weaker assertion, or worse,
manufactures a hiding treatment that breaks tab order to make the sentinel
appear. Fix the assertion **shape**, not the prose: the red arm for defect (a)
must be the **programmatic-focus sentinel** — after `.focus()` on the resting
trigger, `document.activeElement` is `<body>` and not the marked trigger, with
the active-element identity recorded. Keep a `reachedAt` walk if desired, but
only as a **non-regression** assertion explicitly labelled as green-before-and-
after (per the red-vs-guard distinction), never as the load-bearing red arm.
Update D4, ticket AC 4, and tasks 5.3/5.4 together.

**3. D1 and task 2.1 must name the canonical `.sr-only` utility rather than
inviting a hand-rolled clip treatment.** DESIGN.md is binding for `frontend/**`
and its shared-utility section says of `.page-title` / `.eyebrow` / `.sr-only`:
"**Use these; do not hand-roll equivalents**" (DESIGN.md:399-405). `.sr-only` is
defined once canonically at `frontend/src/theme/theme.css:340` as exactly D1's
permitted "clip + 1x1" treatment (`position: absolute; width/height: 1px; clip:
rect(0,0,0,0)`), with a comment stating "feature CSS should use this shared
class instead of redefining it locally". Neither D1 nor task 2.1 mentions it, so
the plan as written points the executor at writing a fourth local copy. Note the
resting-state need here is *focusable-but-unpainted*, which `.sr-only` provides;
D1 should state whether the fix composes `.sr-only` (or its exact recipe) and
why, and task 2.1 should reference `theme.css:340`.

**4. Tasks 4.1/4.2 are vacuous-by-construction under the narrowed scope and need
an explicit non-applicable exit.** With D2 withdrawn and the fix being CSS in
`DashboardList.css`, this change plausibly touches **no** trap or modal surface
at all — so "for any popover/modal surface this change touches, walk the full
cycle" can be ticked with zero evidence, which is the same shape of
unfalsifiable check D0 exists to condemn. State the exit condition: if the diff
touches no trap-bearing surface, record that finding **with the diff as the
evidence** and mark 4.1/4.2 N/A — and explicitly forbid manufacturing a
trap-adjacent change in order to have something to walk.

### Non-blocking notes

- The D0/D0d instrument-failure section is genuinely good, and it held up when I
  applied it to my own probes — my first probe silently returned zero rows and
  would have produced a confident wrong answer without the control.
- D3's three leak modes are correct and worth keeping as a standing constraint
  even though nothing in scope reaches a trap.
- After the fix the resting trigger becomes tabbable at rest (it is not today,
  since `display: none` removes it from the tab order). This does not regress
  AC 2 — reveal on `:focus-within` still paints it at the same stop — but the
  executor should expect the tab index of the kebab to be reachable one way
  before as well as after, and should not read that as evidence of anything.
- Two probe dashboards were created and deleted in the shared dev DB during this
  review; the list is back to empty.
