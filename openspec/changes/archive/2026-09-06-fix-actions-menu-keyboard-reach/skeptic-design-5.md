## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Fresh cold review. Every finding below is from this worktree's files or from my
own live-browser measurement at 1440x900 against dev 6435 / backend 9342. No
prior report or agent narrative was taken as fact.

### What I verified (with evidence)

**Rig freshness (CON-155), verified functionally, not by health probe.**
Appended a unique marker to `frontend/src/features/dashboards/ui/DashboardList.css`,
fetched `http://localhost:6435/src/features/dashboards/ui/DashboardList.css` →
marker present (grep count 1); `git checkout --` the file → marker absent (grep
count 0). The served module's `__vite__id` is
`/home/matt/.../hel-1003/frontend/src/...`, i.e. this worktree. The probe was
therefore shown able to produce both results (D0d). Worktree left clean
(`git status` shows only the untracked change dir).

**Every cited line/number checked against source.**
- `Popover.css:1-3` = `.popover { position: relative }` — **confirmed**.
- `theme.css:340` = `.sr-only {` — **confirmed**; `theme.css:322-324`'s "feature
  CSS should use this shared class instead of redefining it locally" is real
  text, so D1's documented exception is taken against a genuine rule.
- `ActionsMenu.tsx:152` = `<div className="popover actions-menu">` — **confirmed**;
  `ActionsMenuProps` has no `className`, so D1's "unimplementable via `.sr-only`"
  reasoning holds.
- `DashboardList.css:238-241` resting `display: none`; reveal rule at
  **243-248** (three selectors, one block, `display: inline-flex; align-items:
  center`) — **confirmed**; the cited `243-249` is off by one closing line, not
  materially wrong. All three arms (hover / focus-within / `:has([aria-expanded])`)
  share one block, so extending that block covers all three.
- `App.css:519` `@media (max-width: 768px)`, `:606-607` `.app-sidebar,
  .app-sidebar-toggle { display: none }` — **confirmed** (cited as 604-609,
  which spans the preceding comment). R6 stands.
- `MobileNavSheet.tsx`: sole occurrence of `ActionsMenu` is a comment at line
  **419** — **confirmed**.
- Max migration = **V102** — confirmed; no migration in scope.
- jsdom focus assertions: `ActionsMenu.test.tsx` 6, `MobileNavSheet.test.tsx` 6
  = the stated 12 — **confirmed**.

**Live measurement of the three binding numbers** (negative controls run first:
the element selector returned `false` against `.dashboard-list__header-actions`
and a bogus row; the focus probe returned `BODY` when pointed at a
non-focusable `.dashboard-list__name`, proving it can report failure):
- Resting `flex: 1` row button = **215px** — confirmed.
- Hovered row button = **187px**; hovered wrapper `position: relative`,
  `clip: auto`, trigger rect 24x24 — confirmed. `position: relative` (not
  `static`) is correct; round 4's correction is right.
- `.focus()` on the resting trigger → `document.activeElement === document.body`.
  **Defect (a) independently reproduced.** R4 stands.

**The real end-to-end path exists and the CSS fix completes it.**
`shareDialogContext.tsx:48-53` does `document.querySelector(selector)?.focus()`
with `restoreFocusSelector` set at `DashboardList.tsx:418` to
`button[aria-label="<name> actions"]`. That is literally the `.focus()` call
AC 1 models, so AC 1 is a faithful proxy for spec scenario 1, not a synthetic
stand-in.

**Adversarial construction — attempted, and the plan survives.** I injected the
prescribed treatment into the live page and measured three implementations:
- *Plan as written* (rest: `position:absolute;1x1;margin:-1px;overflow:hidden;
  clip:rect(0,0,0,0)`; reveal undoes all six): resting 215px + `.focus()` works;
  revealed 187px / `relative` / `clip:auto` / 24x24. **The plan's target state
  is achievable — every criterion is satisfiable by correct code.**
- *The green-but-broken trap* (reveal undoes only `display`): resting 215px and
  `.focus()` works, but revealed stays **215px / `absolute` / `clip:
  rect(0,0,0,0)`**. AC 3a's 187px and `clip: auto` checks **do** catch it.
  Confirmed load-bearing.
- *Reveal forgetting `height`*: revealed height stays `1px` while 187px /
  `relative` / `clip:auto` all go green — a visual defect AC 3a misses. But
  task 2.4 enumerates `height` explicitly, so a competent executor following
  tasks.md does not produce it. Noted, not a blocker.

I could not build an implementation that follows tasks.md faithfully and is
still broken.

**Clean on the re-confirmations asked for:** no migration (V102); no overlap
with HEL-973 (`PipelineStepRepository`, pipelines schema) or HEL-845
(Connectors / REST source) — the file set is `DashboardList.css`, `e2e/`, and
two `.test.tsx` files; CONTRIBUTING.md and DESIGN.md respected (D1's exception
is argued against the genuinely binding `theme.css:322-324`, not hand-waved).
Cross-artifact consistency otherwise holds: scope, HEL-1005, the 12-assertion
count, the `position: relative` correction, and the reveal-must-undo-everything
trap all appear consistently in ticket.md, proposal.md, design.md, tasks.md and
the spec delta, and the spec delta's "at a viewport width where that
`ActionsMenu` is rendered" wording is correct.

### Verdict: REFUTE

One change request. It is narrow and mechanical, and nothing else about the
plan needs to move — but it is a **fabricated measurement asserted as measured
ground truth**, reproduced 3/3 as false, in the artifacts whose central subject
is measurement discipline. Given round 4 corrected exactly this failure mode
for `position: static`, letting a second instance into the archive unchallenged
is not something I can sign off.

### Change Requests

1. **The "trigger measures 24x24 in the broken state too" claim is false, and
   the mechanism given for it is wrong.** Measured on this worktree, in the
   exact broken state the artifacts describe (task 2.1's resting treatment
   applied, reveal rule undoing only `display`), reproduced 3 runs out of 3:

   > `triggerRect: [3, 24]`, `wrapperWidth: "1px"`,
   > `triggerComputedWidth: "3px"`, `triggerFlexShrink: "1"`

   The trigger's border box is **3x24, not 24x24**. The governing mechanism is
   **flex shrink**, not paint clipping: the trigger is a flex item
   (`flex-shrink: 1`) of a wrapper forced to `width: 1px`, so it shrinks from
   its declared `width: 24px` (`DashboardList.css:252`) to its 3px min-content
   width. `overflow: hidden` is not what makes the assertion vacuous, because
   the assertion **is not vacuous** — 3x24 vs 24x24 would in fact discriminate.

   Required revisions, in all three places the claim appears:
   - `design.md`, D1, the "Which of these checks actually discriminate"
     paragraph — delete the false measurement and the "`overflow: hidden` clips
     paint, not the child's border box" mechanism. Replace with the measured
     fact (3x24 broken / 24x24 revealed, flex-shrink mechanism) and downgrade
     the prohibition to a preference: 24x24 is a *weak* signal (it depends on
     the trigger's flex-shrink and would silently become vacuous if an
     implementation adds `flex-shrink: 0` or a `min-width` to the trigger), so
     the **187px reflow and `clip: auto` remain the required discriminators** —
     but it must not be forbidden on the strength of a number that was never
     measured.
   - `ticket.md`, AC 3a — same correction to the "Do NOT use a 'trigger rect is
     ~24x24' assertion ... it measures 24x24 in the broken state too" sentence.
   - `tasks.md`, task 2.7 — same correction to the "Do not use 'trigger rect
     ~24x24' — it is green in the broken state" bullet.

   As with the `static` correction, record the correction rather than silently
   swapping the text: a second fabricated measurement surviving four rounds of
   review is itself the most useful thing this gate produced, and D0 is the
   right home for it.

### Non-blocking notes

- `design.md` cites the reveal rule as `DashboardList.css:243-249`; it is
  actually 243-248. Cosmetic.
- `proposal.md` names the mobile-affordance spinoff **HEL-1006**; `ticket.md`
  and `design.md` say only "spun off separately". Naming the id in all three
  would close the loop.
- AC 3a / task 2.7 do not pin the revealed wrapper `height`. An otherwise
  correct reveal rule that omits the `height` reset passes all three stated
  reveal checks while rendering the kebab in a 1px-tall box (measured above).
  Task 2.4 enumerates `height`, so this is covered procedurally; adding
  `height` to 2.7's asserted set would close it at the criterion level too.
