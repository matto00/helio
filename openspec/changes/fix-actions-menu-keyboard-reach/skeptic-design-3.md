## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold reviewer. Everything below is from this worktree's files or from my own
Chromium measurement against dev 6435 / backend 9342. Rounds 1 and 2 were read
as claims; where they are load-bearing I re-measured them.

### What I verified (with evidence)

**Server freshness (CON-155), functionally.** `curl
http://localhost:6435/src/features/dashboards/ui/DashboardList.css?direct`
returns the hover-reveal block at lines 238-245, byte-identical to the worktree
file. Vite is serving *this* worktree.

**Instrument check first (D0d), and it caught something.** My first attempt used
the shared Playwright MCP session; `browser_navigate` reported
`http://localhost:6435/dashboards` while the very next `evaluate` reported
`location.href = http://localhost:6277/sources` — a *different worktree's* dev
server — and matched 92 `.dashboard-list__item-row` elements there. That is
D0b's shared-class trap and the parallel-Playwright hazard firing together. I
discarded that channel and drove my own `chromium.launch()` script instead
(register → login → `POST /api/dashboards` → measure), which pins the origin.
Negative control inside every run: `negControlFocused: false` on a synthetic
non-focusable `<div>`; positive control: the row button focuses. The probe can
produce both outcomes.

**Q2 — the new red arm is satisfiable AND discriminating. Both arms
reproduced.** Marked trigger, resting (mouse parked at 1400,880, everything
blurred), 1440x900:

```
PRE-FIX  (unmodified worktree, display:none at rest)
  wrapperDisplay "none", trigRects 0, trigRect 0x0
  trig.focus() -> focusOk false, activeTag "BODY", activeIsBody TRUE   <-- sentinel fires
POST-FIX (sr-only recipe at rest + reveal rules extended to undo it)
  trig.focus() -> focusOk true,  activeTag "BUTTON", activeIsBody FALSE
```
So `document.activeElement === document.body` goes red pre-fix and green
post-fix. Round 2's CR2 correction is right and the replacement shape is sound.

**Q3 — `.sr-only`'s exact recipe keeps the trigger focusable in Chromium, and
the reveal still restores normal geometry.** With `position: absolute; width:
1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0)` applied
to the resting wrapper: `focusOk: true` (so the 1x1-clipped case does *not*
break focusability), and on `:focus-within` the wrapper returns to
`position: static`, `clip: auto`, trigger rect 1, row button 215 → 187 px —
exactly today's hover geometry.

**AC 3 (resting geometry) is satisfiable.** Resting row button width is `215`
before the change and `215` after — unchanged, because `position: absolute`
takes the wrapper out of flow.

**Hit-testing is not regressed at rest** — `elementFromPoint` at the resting
trigger's centre returns `button.dashboard-list__button`, not the trigger. The
clipped 1x1 wrapper steals no clicks.

**Housekeeping re-confirmed.** Max migration = **V102**, none added. No
`e2e/hel1003-premise-probe*` files present. `git status --porcelain` shows only
the change dir untracked (my probe scripts were deleted). Planned surface is
frontend CSS + `e2e/` + two `.test.tsx` files — no overlap with HEL-973
(`PipelineStepRepository`/pipelines schema) or HEL-845 (Connectors/REST source).

**Q5 — nothing remaining pushes an executor at `MobileNavSheet` or at
un-hiding the sidebar.** `proposal.md` has genuinely been rewritten: the Why
carries R6 as a refutation, "What Changes" is defect (a) only, Modified
Capabilities is `None`, Impact excludes `MobileNavSheet.tsx` and says so
explicitly, and the "Explicitly NOT in this change" section names the trap,
phone rendering, HEL-1005 and HEL-1006. `grep`ing all five artifacts, every
remaining `MobileNavSheet` mention is either a prohibition (D2, task 4.4,
ticket "Out of scope") or the jsdom-triage file (D5) — both legitimate. Round
2's CR1 is discharged.

### Verdict: REFUTE

The two biggest round-2 findings are correctly fixed. But the replacement fix
mandate (round 2's CR3, which I asked myself to verify rather than defer to)
introduces a new blocking problem, and I measured a way for a literal
implementation of the current plan to go **fully green while silently breaking
the hover affordance**. That is the same "green proves nothing" family the whole
document is built to prevent, so it must not pass.

### Change Requests

1. **`.sr-only` cannot be attached to this element, and every route to it
   contradicts another binding statement in the artifacts. D1 and task 2.1 are
   currently unimplementable as written.** The element to be hidden is the
   wrapper `<div className="popover actions-menu">` — hardcoded at
   `frontend/src/shared/chrome/ActionsMenu.tsx:152`; the component exposes no
   `className` prop (`ActionsMenuProps` = `label`, `items`, `align`). `.sr-only`
   is a *markup* class (`theme.css:340`, documented at `theme.css:318-324` as
   "visually-hidden **text**"), and plain CSS has no `@extend`/`composes`, so
   `DashboardList.css` cannot apply it and cannot state-scope it to "at rest
   only". The two available routes each break something the plan forbids:
   - add `sr-only` inside `ActionsMenu.tsx` → changes the shared component for
     all five consumers (`PanelCard`, `SidebarItemList`, `CommandBar`,
     `PipelineDetailHeader`), outside proposal.md's Impact list and against
     D6's "prefer the narrower placement";
   - write the same declarations in `DashboardList.css` → precisely the
     "bespoke clip rule" task 2.1 forbids in its next sentence.
   Resolve this explicitly rather than leaving the executor to discover it: pick
   the host-CSS route, say **why** the utility class is not usable here (it is a
   markup class and the resting/revealed distinction is a CSS state), require a
   comment in `DashboardList.css` pointing at `theme.css:340` as the canonical
   source of the recipe (the idiom `AgentMemoryList.css:42` and
   `PipelineListTable.css:9` already use), and drop the "do not write a bespoke
   clip rule" prohibition that this route necessarily violates. Also soften D1's
   citation: DESIGN.md:399's "use these; do not hand-roll equivalents" governs
   the *chrome-component* list; the utilities sentence (401-405) merely names
   `.sr-only`. The real binding text is `theme.css:322-324`.

2. **The existing reveal rules do NOT undo the sr-only declarations, and no
   criterion anywhere catches that. Measured — this is a green-but-broken
   implementation the current plan permits.** `DashboardList.css:243-249`'s
   hover/`:focus-within`/`aria-expanded` rule sets only `display: inline-flex`.
   I ran the literal instruction in task 2.1 ("replace the resting
   `display: none` with `.sr-only`", reveal rules untouched):
   ```
   NAIVE (sr-only at rest, reveal rules NOT extended)
     resting: rowBtnW 215                      -> AC 3 GREEN
     .focus() -> focusOk true, activeTag BUTTON -> AC 1 GREEN, D4 guard GREEN
     after focus: wrapper position "absolute", clip "rect(0,0,0,0)",
                  rowBtnW 215 (working reveal gives 187)
   ```
   i.e. the kebab is **never painted again**, for mouse or keyboard users, while
   AC 1, AC 2 (keyboard operation still works — it is focus, not paint), AC 3
   and the D4 red/green arms all pass. Nothing in ticket.md or tasks.md asserts
   the kebab becomes *visible* on hover or focus. Fix both halves:
   - D1/task 2 must require the reveal rule to undo **every** sr-only
     declaration (`position`, `width`, `height`, `margin`, `overflow`, `clip`),
     not just `display`;
   - add an acceptance criterion and task asserting **painted geometry on
     reveal**, verified in a real browser: on `:hover` and on `:focus-within`
     the wrapper is `position: static`, `clip: auto`, the trigger has a rendered
     rect of ~24x24, and the `flex: 1` row button reflows to its pre-change
     hover width (measured today: 215 → 187). Without this, "resting geometry
     unchanged" is the only geometry assertion in the plan and it is satisfied
     precisely by the broken outcome.

3. **design.md R3 is a stale claim that R6 refutes, and ticket.md repeats it.**
   R3 (design.md:22-25) still asserts "**430 is the broken path; 1440 is the
   working one**". R6 establishes there is no 430 surface at all — the sidebar,
   `DashboardList` and the kebab are not rendered below 768px — so 430 is not
   "the broken path"; it is *not a path*. ticket.md:8 carries the same
   surviving phrasing ("found the ticket's two entry points described
   backwards"). This is exactly the archive-preserves-a-false-premise failure
   the refutation section exists to prevent, and it is the one artifact-to-
   artifact contradiction still standing. Rewrite R3 to say what is true (the
   Notes' claim about 430 was wrong, but so was its replacement; there is no
   430 rendering of this surface at all), and amend ticket.md:8 to match. While
   there, qualify R4/ticket.md (a)'s "fails at both widths": at 430 `.focus()`
   fails only because nothing is rendered, which is not the same defect.

### Non-blocking notes

- D1's density paragraph says "**Task 3.3** must not merely detect a shift".
  The geometry task is now **2.4**; 3.3 is the phone-width check. Stale pointer.
- ticket.md:84 says the mobile affordance is "spun off separately";
  proposal.md:52 names it **HEL-1006**. Name the ID in ticket.md too.
- Task 5.5 / AC 4 call "guard removed, defect present, CI still passes" the
  *green* arm. It is consistently labelled across D4/ticket/tasks so it will not
  mislead, but it is the inverse of the usual naming.
- The clipped resting wrapper does not intercept pointer events
  (`elementFromPoint` → `.dashboard-list__button`), so no click-target
  regression to worry about.
- Two probe accounts and one probe dashboard were created in the shared dev DB
  during this review; the dashboard was deleted.
