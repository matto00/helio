# Design — ActionsMenu keyboard reachability

## Premise refutations (recorded so the archive does not preserve the false premise)

The originating ticket's framing was materially wrong. All four findings below
are from direct measurement in Chromium (Playwright 1.55.1) at 1440x900 and
430x900 against base `ef3b7538`, not from reading code.

**R1 — REFUTED: "every dashboard-row action is keyboard-unreachable".**
False at 1440. The row kebab is reached at Tab #15; Enter opens the menu; focus
lands on "Rename"; the menu contains Rename/Duplicate/Share/Export/Delete; and
Escape restores focus to the kebab. The desktop path works.

**R2 — REFUTED: the proposed fix is already on main.**
Scope item 1 proposed revealing on `:focus-within` as well as `:hover`.
`frontend/src/features/dashboards/ui/DashboardList.css:244` has carried
`.dashboard-list__item-row:focus-within .popover.actions-menu` since commit
**`affbec86e`, dated 2026-05-10** — four months before HEL-590, the run that
"found" this bug. That rule is exactly what makes R1's desktop path work.
Implementing scope item 1 as written would have been a no-op change.

**R3 — The ticket's Notes were wrong about 430, AND SO WAS ITS REPLACEMENT.**
The Notes asserted "the 430px path works". An earlier revision of this document
replaced that with "430 is the broken path; 1440 is the working one" — which is
*also* false, and is superseded by R6. The truth is neither: **430 is not a
path at all.** Below the 768px breakpoint the sidebar, `DashboardList`, and the
kebab are not rendered, so there is no 430 rendering of this surface to be
working or broken. Any statement framing 1440 and 430 as two comparable "entry
points" to the same surface is wrong regardless of which one it calls broken.

**R4 — CONFIRMED: programmatic focus-restore genuinely fails at desktop
width.** `.focus()` on the resting trigger leaves `document.activeElement` on
`<body>`. This is the real HEL-590 symptom and is defect (a).
**Do not describe this as "failing at both widths."** The earlier phrasing was
misleading: at 430 `.focus()` also fails, but only because nothing is rendered
to focus — a different fact with a different cause, not a second instance of
this defect. Defect (a) exists only where the trigger is rendered, i.e. above
the 768px breakpoint.

**R5 — WITHDRAWN. Its mechanism was wrong, and this document asserted it.**
R5 previously claimed: "at 430 the row kebab is never reached in 40 tabs; the
mechanism is MobileNavSheet's focus trap plus `display: none`." That is false.
It was produced by a broken probe (see D0c instance 3) and is refuted by R6.

**R6 — REFUTED (self-refutation of R5): there is no keyboard defect at 430,
because there is no rendered surface at 430.**
Measured from source ground truth, independently verified:
- `frontend/src/app/App.css:604-609`, inside the `:519`
  `@media (max-width: 768px)` block, sets
  `.app-sidebar, .app-sidebar-toggle { display: none }`. At phone width the
  entire desktop sidebar subtree — `DashboardList` and its kebab included — is
  **not rendered at all**.
- `MobileNavSheet.tsx` contains **no `ActionsMenu`**. Its single occurrence of
  that string is a **comment at line 419**. Its `li.mobile-nav-sheet__item-row`
  holds exactly a selection button plus an optional `secondaryAction`, which
  `MobileShell.tsx:47` hardcodes to a single `"Share"`, for the dashboards
  section only.
- Therefore the observed tab cycle `Share -> New dashboard -> row button` is the
  **complete and correct** set of the sheet's tabbables. `MobileNavSheet`'s
  focus trap is behaving correctly by not enumerating the kebab: the kebab is
  not in its panel, and is not on the page.

Consequences, all of which shaped this revision:
- The real gap at phone width is that users have **no host for Rename /
  Duplicate / Export / Delete at all — for any input modality, pointer
  included**. That is a *missing mobile affordance*, a product question, not an
  accessibility defect. It is spun off as **HEL-1006** (see "Scope boundary" below) and is
  explicitly NOT fixed here.
- An acceptance criterion requiring `.focus()` to succeed at 430 is
  **unsatisfiable by correct code**: no descendant of a `display: none` ancestor
  is focusable. Under delivery pressure such a criterion becomes an instruction
  to break something until it passes — here, to un-hide the desktop sidebar at
  phone width, a far larger regression. It has been removed, not weakened.
- Any instruction to "fix why the trap excludes the trigger" would force the
  trap to enumerate outside `panelRef` — precisely the sheet-leak D3 forbids as
  worse than the defect being fixed. Withdrawn (see D2).

## D0 — Instrument-failure notes (the run's most valuable output)

Three of this change's measurements were wrong. None were wrong because the
code was misread; all three were wrong because **the measuring instrument was
lying and was not itself checked**. This section is the generalized lesson, not
an apology — the escalating subtlety across the three is the point.

**D0a — jsdom cannot falsify a focus assertion.** jsdom has no layout engine.
It will focus a `display: none` or 0x0 element and report it as
`document.activeElement`; a real browser refuses and focus falls to `<body>`.
So "focus returns to the trigger" is satisfied under jsdom by a trigger no user
could focus. This is why the original defect shipped green. Every acceptance
criterion here is therefore verified in Playwright, never in jsdom.

**D0b — a selector matching a shared class name is not a selector for a
component.** *(Instance 1.)* The first premise probe reported "reachable at
Tab #4" at both widths. It matched `.actions-menu__trigger` anywhere in the
document and had actually measured **CommandBar's** identically-classed kebab
(items "Add panel" / "Refine with AI", versus the row's Rename / Duplicate /
Share / Export / Delete). In a repo with shared chrome this fails silently and
yields a confident, wrong number.

**D0c — the three instances, in ascending subtlety.**

1. **Wrong component, shared class.** As D0b. The selector matched a real,
   rendered element — just not the one meant.
2. **A predicate that cannot return false.** Probe 3's visibility filter was
   `(r) => r.getClientRects().length > 0 || true`. The `|| true` makes it
   unfalsifiable. **A filter that always admits is worse than no filter at
   all**, because it produces a number that *looks* filtered and therefore
   invites trust it has not earned.
3. **Right component, surface not rendered at the measured width.** The probe
   marked the correct row trigger and walked the tab order — but at 430 that
   trigger sits inside a `display: none` sidebar and in a different subtree from
   the portalled sheet being walked. It was never going to be reached. This
   produced the false R5, which this document asserted and the coordinator
   approved.

The single shape shared by all three: **the finding was checked; the instrument
was not.** Each probe found what it went looking for, and its output was
plausible, so nothing prompted a second look at the tool that produced it.

**D0d — THE RULE, binding on every probe and guard in this change: before
trusting a probe, verify it can produce the negative result.** Run it against a
case that is known to fail, and confirm it reports failure. **A probe that has
never returned "not found" has not been shown to be capable of returning it.**
This is exactly the standard already demanded of a test mutation — that the red
arm be shown genuinely red before the green arm means anything — applied to
measurement itself rather than only to tests. All three failures above would
have been caught by one negative-control run apiece:
- instance 1 by pointing the selector at a surface with no kebab and confirming
  "not found";
- instance 2 by feeding the predicate an element known to be hidden and
  confirming it is rejected;
- instance 3 by running the 430 walk against a trigger known to be absent and
  observing the identical "never reached" result — which would have exposed
  that the probe could not distinguish "hidden by the trap" from "not on the
  page".

This rule is carried into HEL-1005 as well: replacing a vacuous jsdom assertion
with a browser probe that cannot fail gains nothing.

## Decisions

**D1 — Fix (a) with a host-CSS visually-hidden treatment in
`DashboardList.css`, and make the reveal rule undo ALL of it.**

The trigger must remain a real focus target at rest while staying unpainted,
and must paint normally on hover/focus as it does today.

*Why not the `.sr-only` class itself.* An earlier revision mandated
`.sr-only` (`theme.css:340`). **That is unimplementable here**, and the reason
must be stated so nobody re-proposes it: `.sr-only` is a **markup** class
(documented at `theme.css:318-324` as "visually-hidden *text*"), but the
wrapper needing the treatment is
`<div className="popover actions-menu">` — hardcoded at
`frontend/src/shared/chrome/ActionsMenu.tsx:152`, with no `className` prop on
`ActionsMenuProps`. Adding the class inside `ActionsMenu.tsx` would change the
shared component for all five consumers, against D6's narrower-placement rule
and outside proposal.md's Impact list. And plain CSS has no `@extend`/
`composes`, so `DashboardList.css` cannot apply the class — nor could a static
markup class express what is needed anyway, since **hidden-at-rest vs.
painted-on-reveal is a CSS state, not a fixed property of the element.**

*Chosen route.* Write the visually-hidden declarations directly in
`DashboardList.css`, scoped to the resting state, **with a comment naming
`theme.css:340` as the canonical source of the recipe** — the idiom already
used by `AgentMemoryList.css` ("`.sr-only` is defined once, canonically, in
theme.css"). This is a deliberate, documented exception to
`theme.css:322-324`'s "feature CSS should use this shared class instead of
redefining it locally", taken because the shared class cannot be state-scoped
from host CSS. There is **no prohibition on writing these declarations here** —
an earlier revision forbade a "bespoke clip rule", which this route necessarily
is; that prohibition is withdrawn as self-contradictory.

*Note on DESIGN.md.* DESIGN.md:399's binding "use these; do not hand-roll
equivalents" governs the **chrome-component** list; the utilities sentence
(401-405) merely names `.sr-only`. The genuinely binding text for this utility
is `theme.css:322-324`, and the exception above is taken against that.

*Permitted declarations at rest:* `position: absolute`, 1x1 size,
`margin: -1px`, `overflow: hidden`, `clip: rect(0,0,0,0)` — mirroring
`.sr-only`. `position: absolute` is what keeps the trigger from consuming row
width.

*FORBIDDEN at rest:* `display: none`, `visibility: hidden`,
`content-visibility: hidden`, or an `inert` ancestor. Browsers refuse to focus
all of these; `visibility: hidden` is the easy mistake because it reads as
"just hidden".

**THE REVEAL RULE MUST UNDO EVERY DECLARATION — this is the trap.**
`DashboardList.css:243-248`'s hover/`:focus-within`/`aria-expanded` rule
currently sets only `display: inline-flex`. That was sufficient against
`display: none`; it is **not** sufficient against the treatment above.
Measured: applying the resting treatment without extending the reveal rule
leaves the kebab **never painted again**, for mouse and keyboard users alike —
while programmatic focus succeeds, keyboard operation still works (it is focus,
not paint), resting geometry is unchanged, and **both guard arms go green**.
That is a green-but-broken outcome the plan must forbid explicitly. The reveal
rule must therefore reset `position`, `width`, `height`, `margin`, `overflow`,
and `clip` — not just `display`.

*Density, both states.* At rest the row must be geometrically unchanged
(`position: absolute` ensures the trigger consumes no row width): the `flex: 1`
row button measures **215px** today and must still measure 215px. On reveal the
row must return to its pre-change hover geometry: row button **187px**, wrapper
**`position: relative`**, `clip: auto`.

**`position: relative`, NOT `static`.** An earlier revision of this decision
asserted `static`. That was **fabricated, not measured**, and it would have
failed a correct implementation: `Popover.css:1-3` sets
`.popover { position: relative }`, and the wrapper carries the `popover` class,
so `relative` *is* the correct baseline. Verified on this worktree.

**Which of these checks actually discriminate — and a correction, recorded
rather than silently swapped.** An earlier revision of this decision asserted
that the trigger "measures 24x24 in the broken state too, because
`overflow: hidden` clips paint rather than the child's border box", and on that
basis **forbade** a 24x24 assertion as vacuous. **That was fabricated, and it
was wrong twice over.** Measured directly (3/3, negative-controlled per D0d):
in the broken state the trigger measures **3x24**, the wrapper is `1px` wide,
and `flex-shrink: 1` on a 24px flex item inside a 1px flex container is the
mechanism — **not** paint clipping. `overflow: hidden` was never the cause.

The consequence is that the earlier prohibition inverted the truth: since the
trigger is **24x24 when correctly revealed** (`DashboardList.css:253-254`) and
**3x24 in the broken state**, a "trigger rect is 24x24 on reveal" assertion
**does discriminate** and is permitted — indeed useful. It is *not* vacuous.

So all three of these are load-bearing on reveal, and any of them fails in the
broken state: the **187px row-button reflow**, **`clip: auto`**, and the
**24x24 trigger rect**. The 187px reflow and `clip: auto` are the primary
discriminators (verified load-bearing across rounds 3-5); the 24x24 check is a
genuine third.

**D2 — WITHDRAWN.** This decision previously instructed the executor to find
"why `MobileNavSheet`'s focus trap excludes the trigger" and fix that cause.
Per R6 the trap's exclusion is **correct behaviour** — the kebab is not in its
panel and is not rendered at phone width at all. The only way to satisfy the
withdrawn D2 would have been to make the trap enumerate outside `panelRef`,
which is exactly the leak D3 forbids. **No change to `MobileNavSheet`'s trap is
in scope.** If any trap change is ever proposed, it must stand on its own probe
evidence, never on R5.

**D3 — Focus-trap verification: the bidirectional check is necessary but NOT
sufficient.** This is the correction that matters most, and it survives the
re-scoping. `handleFocusTrapKeyDown` is bound to `panel`, not `document`, and
acts only when `document.activeElement` is exactly the `first` or `last` of a
`querySelectorAll` re-taken **per keystroke**. Three leak modes that a
"Tab from last, Shift-Tab from first" pair would pass straight through:

1. **Focus already outside the panel** — the listener never fires at all, so
   nothing wraps it back.
2. **The tabbable set changing between keystrokes** — opening the kebab's
   popover mutates it, so the element that *was* `last` no longer is, and no
   wrap fires at the real boundary.
3. **A popover portalled outside `panelRef`** — the menu's own items then sit
   outside the enumeration entirely.

Therefore any trap verification in this change must walk the **full cycle**
(N+1 tabs from the first element, asserting every stop remains inside the
panel and that the walk returns to its start), **with the actions menu both
closed and open** — not two boundary presses. Note this applies to whatever
trap-adjacent surface is actually touched; per D2 no `MobileNavSheet` change is
in scope, so this stands as a binding constraint on any future work and on the
`Modal`/popover surfaces this change's fix does reach.

**D4 — The regression guard is Playwright, and its red arm is the
PROGRAMMATIC-FOCUS SENTINEL — not a tab-reachability sentinel.**

A previous revision of this decision required the red arm to drive a
`reachedAt` tab-index to `-1`. **That was unsatisfiable, and the reason matters
more than the fix.** Measured on the unmodified worktree with the defect fully
present: the marked kebab *is* reached by Tab at desktop width (index 15 among
visible tabbables, 2 stops after the row button), because focusing the row
button fires `:focus-within` (`DashboardList.css:244`) and reveals the wrapper.
**Tab-reachability is already green pre-fix**, so reverting the fix could never
turn it red. The shape had been carried over unchanged from the withdrawn 430
defect.

This is the same failure class as the unsatisfiable 430 acceptance criterion
(R6) — a criterion that correct code cannot satisfy — and it appeared *inside
the very decision written to prevent a weakened red arm*. Recorded here rather
than quietly corrected, because a red arm that cannot go red is exactly the
instruction to weaken an assertion that D4 exists to forbid.

The correct shape, which matches the actual defect:

- The guard asserts **`document.activeElement` is the trigger** after calling
  `.focus()` on the **resting** (unhovered, unfocused-within) row trigger at
  desktop width.
- The **red arm** — fix reverted — must show the **sentinel
  `document.activeElement === document.body`**, i.e. focus fell to `<body>`.
  Record the actual `activeElement` tag/class in the output, not just a
  pass/fail.
- The guard must locate the trigger by a **unique marker**, never a bare
  `.actions-menu__trigger` class selector (D0b), and must **assert the marked
  element is rendered** before acting (D0c instance 2). Probe 3's
  `getClientRects().length > 0 || true` filter is forbidden in any form.
- Per **D0d**, the guard must be shown to produce its negative result before
  its positive result is trusted.
- **Explicitly forbidden** as ways to satisfy the red arm: `toBeVisible`,
  `toHaveCount`, `toBeInTheDocument`, snapshot diffs, or any element-presence
  assertion — and, now, any **tab-reachability** assertion, which is green both
  before and after the fix and therefore discriminates nothing.
- **Green arm:** with the guard removed and the defect present, the rest of CI
  must pass — proving nothing else already catches this.

A separate, non-discriminating tab-walk MAY be included as a *no-regression*
check (desktop tab reachability must not break), but it must be labelled as a
guard rather than proof, and must never be offered as the red arm.

**D5 — Triage, do not sweep, the 12 in-scope jsdom assertions.** The 6
assertions in `ActionsMenu.test.tsx` and 6 in `MobileNavSheet.test.tsx` are in
scope only because these are files this change touches. Each is individually
either (i) genuinely falsifiable under jsdom and kept as-is, or (ii) annotated
with an explicit note of what it cannot prove. The remaining 27 across 9 files
are **HEL-1005** and are not touched here.

**D6 — Blast radius is every `ActionsMenu` consumer.** The component is shared
by `DashboardList`, `PanelCard`, `SidebarItemList`, `CommandBar`, and
`PipelineDetailHeader`. The hover-reveal itself is host-surface CSS applying
only to `DashboardList`'s rows, so a fix placed in `DashboardList.css` has a
narrower radius than one in `ActionsMenu.css` — **prefer the narrower
placement** unless the defect is genuinely in the shared component.

## Scope boundary

**In scope: defect (a) only, at desktop widths** — programmatic focus-restore
onto the resting dashboard-row `ActionsMenu` trigger above the 768px
breakpoint.

**Spun off, explicitly not fixed here:** the missing mobile affordance for
Rename / Duplicate / Export / Delete at phone width. It is a product question
(which of the five actions belong on a phone) requiring DESIGN.md review, not
a defect.

**Also out of scope:** the 27 jsdom assertions in 9 other files (HEL-1005), and
any change to `MobileNavSheet`'s focus trap (D2).

## Risks

- **Trap leak (D3)** — highest risk; explicitly guarded.
- **Density regression** — an always-laid-out trigger could shift row layout
  even at zero opacity. Must be checked against the resting row at 1440.
- **CON-155 stale server** — `start-servers.sh` reports "already healthy …
  reusing" on a liveness probe, which does not prove the running binary matches
  the working tree. Verify freshness functionally before trusting any browser
  observation.
- **Quarantined-e2e neighbourhood** — several `e2e/` specs are quarantined for
  flake (HEL-991, HEL-992). A new guard must be demonstrated stable, and an
  intermittent red must not be read as a real defect without measurement.

## Non-goals

- Redesigning the hover-reveal density behaviour.
- The 27 jsdom assertions in HEL-1005.
- Any backend, API, contract, or schema change. **No migration** — main is at
  V102 and this change adds none.
