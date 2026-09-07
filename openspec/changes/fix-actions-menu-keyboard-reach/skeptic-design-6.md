## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Scope per the owner's `extend-design-rounds-by-one` ruling: (1) verify the
corrected 24x24 / 3x24 trigger measurement, (2) cross-artifact consistency
sweep. Not a full re-review. Every number below is my own fresh measurement in
Chromium at 1440x900 against base `8231b191`; no prior skeptic report's number
was taken on trust.

### What I verified (with evidence)

**Rig freshness — two-arm, functional, not a health probe (CON-155).**
Appended `/* skeptic6-freshness-marker */` to
`frontend/src/features/dashboards/ui/DashboardList.css`;
`curl .../src/features/dashboards/ui/DashboardList.css?direct | grep -c` → **1**.
Reverted from backup; same probe → **0**. The served bytes track the worktree.
Working tree restored (`git status --short` shows only the untracked change dir).

**Base.** `git diff --name-only ef3b7538..8231b191` filtered for
`DashboardList|ActionsMenu|MobileNav|App.css|theme.css` → **empty**. The
fast-forward is inert for this ticket; rounds 1-5's measurements at `ef3b7538`
remain valid.

**Instrument negative control (D0d), shown in both arms.** In-page probe:
`.dashboard-list__item-row .actions-menu__trigger` → **46**; bare
`.actions-menu__trigger` → **51**. The 5-element gap is D0b's shared-class
hazard, live and real; my scoped selector discriminates. Negative arm:
`.login-form .actions-menu__trigger` → **0**. The probe can return "not found".

**Baseline (unmodified main), 1440x900.**
- Resting: wrapper `display: none`, row button **215px**.
- Revealed via `:focus-within` (row button focused): wrapper `position:
  relative`, `clip: auto`, wrapper 24x24, trigger **24x24**, row button **187px**.
- Defect (a) reproduces: `.focus()` on the resting trigger →
  `document.activeElement` = `BODY.`, trigger rect 0x0.

All of design.md's revealed-state numbers reproduce exactly.

#### 1. The 3x24 / 24x24 claim — REPRODUCES

Constructed the broken state in-page (task 2.1 resting treatment: `position:
absolute; width/height: 1px; margin: -1px; overflow: hidden; clip:
rect(0,0,0,0)`; reveal rule resetting only `display`):

| | resting | revealed (broken) |
|---|---|---|
| row button | 215px | **215px** (no reflow — discriminator fails, as claimed) |
| wrapper | 1x1 | 1x1, `position: absolute`, `clip: rect(0px,0px,0px,0px)` |
| trigger | **3x24** | **3x24** |
| `.focus()` on trigger | lands on `BUTTON.popover__trigger actions-menu__trigger` | — |

So the green-but-broken outcome design.md D1 warns about is real: programmatic
focus succeeds while the kebab is never painted.

**Mechanism claim negative-controlled (this is the part that was fabricated
before).** In the broken revealed state:
- Arm A — set wrapper `overflow: visible`, change nothing else: trigger still
  **3px**. Paint clipping is **not** the mechanism.
- Arm B — set the trigger's `flex-shrink: 0`, change nothing else: trigger
  returns to **24px** (wrapper still 1px). Flex shrink **is** the mechanism.
- Arm C — restore: back to **3px**.

Round 5's correction is confirmed on both counts: the number (3x24) and the
mechanism (flex shrink of a 24px item in a 1px flex container, not
`overflow: hidden`). The earlier "24x24 in the broken state too" claim is
refuted by measurement, and the 24x24-on-reveal check therefore does
discriminate. design.md D1, ticket.md AC 3a and tasks.md 2.8 state this
correctly.

#### 2. The revealed-wrapper-height gap (orchestrator's change #3) — REAL

Reveal resetting everything *except* `height`: `position: relative` ✓,
`clip: auto` ✓, trigger **24x24** ✓, row button **187px** ✓ — every other
assertion passes — while the wrapper's rendered height is **1px**. The added
height assertion is the only one of the set that fails there. The gap is real
and the assertion closes it.

Visual confirmation, and a precision correction to the round-5 rationale:
I screenshotted both variants of the row.
- `height` omitted but `overflow` reset: the kebab **is** still painted (it
  overflows the 1px wrapper) and is hit-testable — screenshot shows all three
  dots.
- `height` **and** `overflow` both omitted: the kebab is clipped to a 1px band
  — screenshot shows a single faint dash where the dots should be. This is the
  genuinely invisible state.

The height assertion catches both (wrapper height = 1px in each), so it is
sound and load-bearing. Only the prose mechanism ("painting the kebab inside a
1px-tall box") is imprecise for the height-only variant. Non-blocking note below.

#### 3. Cross-artifact consistency sweep

Every source citation in `proposal.md`, `design.md`, `tasks.md`, `ticket.md`
checked against the files:
- `DashboardList.css:243-248` — the reveal rule spans exactly 243-248 ✓
  (`243-249` no longer appears anywhere; orchestrator change #1 applied in both
  design.md:189 and tasks.md 2.4).
- `DashboardList.css:244` `:focus-within` ✓ · `:253-254` trigger `width: 24px;
  height: 24px` ✓ · `Popover.css:1-3` `.popover { position: relative }` ✓
- `theme.css:340` `.sr-only` ✓ · `theme.css:322-324` "feature CSS should use
  this shared class instead of redefining it locally" ✓ ·
  `AgentMemoryList.css:42` carries the "defined once, canonically, in
  theme.css" idiom ✓
- `ActionsMenu.tsx:152` is `<div className="popover actions-menu">`, and
  `ActionsMenuProps` exposes no `className` — D1's unimplementability argument
  for `.sr-only` holds ✓
- `App.css:519` `@media (max-width: 768px)`, `:604-609`
  `.app-sidebar, .app-sidebar-toggle { display: none }` ✓
- `MobileNavSheet.tsx` — `ActionsMenu` occurs exactly once, line 419, in a
  comment ✓ · `MobileShell.tsx:47` `secondaryAction=` hardcoded to a single
  `label: "Share"` for `pickerId === "dashboards"` ✓
- `DESIGN.md:399` "Use these; do not hand-roll equivalents"; utilities sentence
  at 401-405 naming `.sr-only` ✓

Provenance re-verified independently: `git show affbec86` (2026-05-10, HEL-235)
contains `focus-within .popover.actions-menu` at the pre-move path
(`grep -c` → 1); its parent → 0. The rule predates HEL-590. ✓

**The two refuted claims have not crept back.** Every occurrence of `static`
in design.md/tasks.md/ticket.md is an explicitly-labelled refutation of the
earlier fabrication (design.md:158's "static markup class" is an unrelated
sense). Every occurrence of "24x24 in the broken state too" is labelled as the
fabricated earlier claim. No artifact asserts a live 430 keyboard defect — R5
is marked WITHDRAWN and R6 refutes it; ticket.md (b) is marked WITHDRAWN.
`HEL-1006` is named consistently in `proposal.md:60`, `design.md:67` and
`ticket.md:114` (orchestrator change #2), and `HEL-1005` in all four artifacts.

Internal consistency of the numbers: design.md D1, ticket.md AC 3 / 3a and
tasks.md 2.6-2.8 agree on 215 / 187 / `position: relative` / `clip: auto` /
24x24 / 3x24 / height-not-1px. No contradiction found.

**Environment left clean.** Injected `<style>` removed (verified: wrapper back
to `display: none`, row button back to 215px); the two screenshots deleted; no
test accounts created; `git status --short` shows only the untracked change
directory, in both the worktree and the main checkout.

### Verdict: CONFIRM

The corrected measurement holds under my own negative-controlled reproduction,
including the mechanism claim that was previously fabricated. The artifacts are
internally consistent, every source citation resolves, and the three
orchestrator edits are each verified against ground truth. This is sound enough
to implement.

### Non-blocking notes

- **The 3x24 figure is implementation-contingent, and the artifacts already
  rank it correctly.** It holds because the trigger keeps its default
  `flex-shrink: 1` inside a 1px-wide flex wrapper (proved by arm B above). An
  implementer who writes the resting treatment so the wrapper is not a flex
  container, or who pins the trigger's `flex-shrink: 0`, would get a broken
  state reading 24x24, and task 2.8 would silently stop discriminating. This is
  not a blocker precisely because design.md D1 and ticket.md AC 3a already name
  the 187px reflow and `clip: auto` as the primary discriminators and 24x24 as
  a third. Worth the executor knowing that 2.8's discriminating power depends
  on the shape of 2.1, not just on 2.4.
- **Round 5's mechanism phrasing for the height gap is slightly off** (carried
  into ticket.md AC 3a as "painting the kebab inside a 1px-tall box"). Measured:
  with `height` omitted but `overflow` reset, the kebab overflows the 1px
  wrapper and stays visible and clickable; it is invisible only when `height`
  and `overflow` are both omitted. The assertion itself is correct and
  load-bearing in both variants — only the explanatory clause overstates the
  height-only case. A one-clause edit if anyone touches that paragraph; not
  worth a round.
- `tasks.md` 2.1 does not mention the pre-existing `flex-shrink: 0` on the
  wrapper (`DashboardList.css:240`), which the resting treatment presumably
  retains. Harmless, but an executor reading "replace the resting `display:
  none` with…" literally could drop it.
