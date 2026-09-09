## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Contrast arithmetic — re-derived independently in Node, not taken from design.md.**
Own implementation of sRGB relative luminance + WCAG ratio, own re-implementation of
`deriveFocusRingColor`'s darken-toward-black search, own alpha compositing for the
`color-mix(..., transparent)` tokens. Surfaces and preset hexes read from
`frontend/src/theme/theme.css` and `frontend/src/theme/theme.ts`. **Every figure in
design.md reproduces:**

- Raw `#f97316` vs the five light surfaces: **2.377 / 2.505 / 2.734 / 2.803 / 2.803** —
  design.md's "2.38–2.80" is exact. Dark: 5.576–6.729, matches.
- Binding surfaces confirmed by computation, not assertion: light minimum is
  `--app-surface-soft` `#efece6`; dark minimum is `--app-surface-strong` `#262320`.
  The extremes `#ffffff`/`#121110` are indeed the *easiest*. Design.md is right, and
  `appearance.ts`'s `FOCUS_RING_SURFACES` takes a min over all ten, so the shipped
  derivation is already conservative-correct.
- `deriveFocusRingColor("#f97316")` → **`#db6513`**, light **3.028–3.570**, dark
  **4.378–5.284**. Design.md's "3.03–3.57 / 4.38–5.28" is exact.
- All 8 presets' derived rings clear 3:1 in both themes (min observed 3.010, Cyan light).
- **D3 verified and it holds.** `--app-accent-strong` light = `color-mix(accent 76%, black)`
  (`theme.css:222`). Minima against light surfaces: Orange **3.927**, Red 5.046, Pink 4.794,
  Purple 5.238, Blue 4.928, Cyan **3.454**, Green **3.240**, Yellow **2.775**. Yellow is the
  sole failure, exactly as claimed. D3 does not invert; site 7 must be touched.
- Halo `--app-accent-dim`: 1.075–1.084 light, 1.129–1.155 dark. D2's "1.08 / 1.14" is right;
  it cannot carry the obligation.
- `--app-accent-mid` (dark, 30% over surface) vs its own surface: **1.629–1.648**, i.e. the
  ticket's 1.63 headline reproduces at `PipelineDetailPage.css:796`. The hypothesis is well
  founded; deferring final confirmation to task 2.3 is **legitimate** — nothing in the fix
  depends on it (the remedy for site 11 is the same whichever element the gate measured).

**`applyAccentTokens` premise — confirmed.** `appearance.ts:~440` writes
`--app-accent`/`--app-accent-ink`/`--app-focus-ring-color` via
`document.documentElement.style.setProperty`, and `theme.css:161-168` / `:216-221` carry
in-tree comments stating both `:root[data-theme]` accent blocks are dead post-hydration.
The accent is `#f97316` in both themes. This premise stands.

**Site inventory — `git grep -n "outline:\s*none"` returns exactly 11 files/lines matching
the design's list.** I read every one of the eleven rules. Confirmed: site 6
(`DashboardList.css:675`) has a *permanent* `border: 1px solid var(--app-accent)` and its
focus rule adds only the halo — D2's remedy is correctly aimed. Site 7 has
`box-shadow: none` and an `--app-accent-strong` `border-bottom-color`. Site 10's
`:focus-visible` (`AccentPicker.css:36-40`) and `--selected` (`:42-46`) box-shadows are
byte-identical — that second defect is real. Sites 5/9/10/11 are base-rule suppressions.

**HEL-1046's guard read in full** (`frontend/src/theme/focusRingTokenGuard.css.test.ts`,
328 lines) to judge D5 mechanically.

### Verdict: REFUTE

The measurement work is unusually good — I tried hard to break the arithmetic and could
not move a single figure. The refutation is not about the numbers. It is about two sites
whose ground truth contradicts the design's central claim, and a guard specification that
cannot be written as worded.

### Change Requests

1. **D1's "AC-1 by construction" is false for site 7 — its binding surface is
   user-controlled, not a theme token.**
   `PanelGrid.css:222-231`: `.ui-input.panel-grid-card__title-input` has
   `background: transparent` and `border: none; border-bottom: 1px solid …`. The surface
   its focus border actually renders against is the panel card's,
   `PanelGrid.css:41` → `background: var(--panel-surface-override, var(--app-surface))`.
   `--panel-surface-override` is set per-panel in `PanelCard.tsx:29` from
   `buildPanelSurface(theme, appearance.background, appearance.transparency)`
   (`appearance.ts:229-243`) — a **user-chosen colour** tinted at 0.24, with a
   user-chosen alpha down to 0.15 (so the user-chosen *dashboard* background shows
   through beneath it).
   `deriveFocusRingColor` guarantees ≥3:1 against the ten literal theme surfaces only —
   `FOCUS_RING_SURFACES` deliberately excludes even the accent-tinted `--app-bg-accent`.
   It says nothing about an arbitrary user-picked panel background. A user who picks a
   panel background near `#db6513` drops site 7's focus indicator well below 3:1, and
   D1's "by construction rather than by coincidence" would have shipped as a claim the
   code does not support.
   Note task 5.3's 64 measurements would **not** catch this: taken on default-appearance
   panels, they return a green that is silent on the only case that fails.
   Required: state this explicitly in the design and rule on it. Either give site 7 a
   mechanism whose contrast does not depend on user-chosen panel appearance, or name it
   as a known non-conformance with a reason and an owning ticket — which is exactly what
   AC-4 and the spec delta's third requirement already demand. Silence is not an option
   the design's own spec permits.

2. **Site 9 (`AddSourceModal.css:146-161`) is orphaned CSS — zero rendered instances.**
   `grep -rn "cell-input\|cell-select" frontend/ --exclude-dir=node_modules`, excluding
   `AddSourceModal.css` itself, returns **zero hits** (reproduced twice, once scoped to
   `src` excluding `.css`, once across all of `frontend/`). No markup anywhere sets
   `add-source-modal__cell-input` or `add-source-modal__cell-select`. By contrast I
   spot-checked the live sites and every other one resolves to real markup
   (`DashboardList.tsx`, `SidebarItemList.tsx`, `PanelCard.tsx`,
   `PipelineDetailFooter.tsx`, `AccentPicker.tsx`).
   This is the same condition on which D6 excludes `PanelDetailModal.binding.css:137`
   ("HEL-1049 already owns it as orphaned CSS") — so the design applies its own criterion
   to one orphan and not the other. It also breaks the ticket's explicit constraint
   *"Size from rendered instances, not grep counts"*: the inventory is a grep count, and
   task 1.1 re-runs the same grep rather than checking rendered instances.
   Required: rule on site 9 on the same basis as `PanelDetailModal.binding.css:137`
   (delete-as-dead, fold into HEL-1049's orphan sweep, or fix-anyway with the reason
   stated), and add a task step that establishes rendered instances for the whole
   inventory rather than restating the grep.

3. **D5's guard cannot be written as worded — the conforming indicator is in a
   different rule from the `outline: none` at four of the eleven sites.**
   D5 requires "a rule declaring `outline: none` must also declare a conforming focus
   indicator." But D4's own remedy for sites 5, 9, 10, 11 leaves `outline: none` on the
   *base* rule while the indicator lives in a *sibling* `:focus-visible` rule. A
   same-rule check therefore goes red on all four correctly-fixed base-rule sites unless
   each is pinned — and pinning the four most dangerous sites hollows out the guard that
   exists because of them.
   Required: specify the granularity. Either the guard resolves the base selector to its
   sibling focus rule (say so, and say how selector matching works), or base-rule
   suppression is itself made the violation and D4's remedy changes to move the
   suppression into the focus state. Task 4.1 currently restates D5's wording verbatim
   and so inherits the same gap.

4. **D5's "conforming" predicate is underspecified in two ways that make it either
   self-rejecting or vacuous.**
   (a) D5 and task 4.1 define conforming as `border-color`/`box-shadow` resolving to
   `--app-focus-ring-color`. Task 3.5's own fix for site 7 produces
   **`border-bottom-color`**, which that predicate rejects. Enumerate the accepted
   property set (`border-color`, `border-*-color`, `box-shadow`, at minimum).
   (b) D2 deliberately *keeps* `box-shadow: 0 0 0 3px var(--app-accent-dim)` in the very
   same focus rules the guard inspects (tasks 3.1/3.2). So a conforming rule will contain
   a `box-shadow` carrying a non-ring accent token. The guard must state how it
   distinguishes the retained decorative halo from a raw-accent indicator — otherwise it
   either flags every correctly-fixed site or accepts any `box-shadow` at all and proves
   nothing. This is the single most likely way task 4.2's mutation check returns a
   meaningless green.

5. **Task 4.3 requires the guard to do arithmetic D5/4.4 says it cannot, and pins values
   that live in `theme.css` without a sync obligation.**
   Asserting `--app-accent-strong` is non-conforming "pinned to the computed Yellow
   figure (2.78 light)" requires evaluating `color-mix(in srgb, var(--app-accent) 76%,
   black)` — precisely what 4.4 makes the guard declare it cannot do. It is writable, but
   only by re-implementing the mix in TypeScript, which then silently drifts if
   `theme.css:222`'s `76%`/`black` ever changes. HEL-1046 hit exactly this class of
   defect and answered it by **re-parsing `theme.css`** (see the `SYNC OBLIGATION` comment
   at `appearance.ts:~310` and the guard's D1/D4 re-derivation tests). Required: either
   parse the mix percentage and base colour out of `theme.css` rather than hardcoding, or
   carry an explicit sync obligation, and reconcile 4.3 against 4.4's stated limitation so
   the guard's own comment is not false.

6. **D6 mis-numbers its exclusion and would mislead the implementer.**
   D6's final sentence reads "Site 11's `PanelDetailModal.binding.css:137` is *excluded*"
   — but site 11 in the design's own inventory table is `PipelineDetailPage.css:796`,
   which task 3.6 requires to be fixed. `PanelDetailModal.binding.css` appears nowhere in
   the table. As written, an implementer can reasonably read D6 as excluding
   `PipelineDetailPage.css:796`. Renumber or name the excluded file without a site index.

   **On D6's merits, I do not object** and am not asking for it to be dropped. The
   `:focus` → `:focus-visible` conversion is a one-token edit inside rules already being
   edited for colour, and for text inputs it is behaviour-neutral (UA heuristics match
   `:focus-visible` on pointer focus for elements that take keyboard input). The one place
   that would *not* have been behaviour-neutral was `.add-source-modal__cell-select` — a
   non-text control where pointer focus does not match `:focus-visible` — and per CR-2
   that rule has no markup at all, so the risk is moot once site 9 is ruled on. Fix the
   numbering and D6 stands.

### Non-blocking notes

- **Task 5.3's 64 measurements are not theatre, but they are aimed slightly wrong.** After
  the fix the indicator is one theme-independent value per preset, already proven ≥3:1
  against every theme surface by `deriveFocusRingColor` and HEL-1046's guard. Re-measuring
  contrast 64 times mostly re-proves arithmetic. The value the running app uniquely adds is
  (i) the token actually resolves and is *painted* at that element rather than the raw
  accent, and (ii) the element's real adjacent surface is one the derivation covers — which
  is where CR-1 lives. Consider re-shaping 5.3 to record the painted colour and the
  *measured* adjacent background per site, and to include at least one non-default panel
  appearance.
- Design.md's inventory row 10 cites `AccentPicker.css:36`; the `outline: none` is at
  `:19` and `:36` is the focus shadow. Harmless, but the table's other rows cite the
  suppression line.
- The spec delta's first two requirements are genuinely testable behaviour. The third
  ("Unfixed sites are named rather than omitted") is a process obligation rather than
  observable behaviour — acceptable as a mirror of AC-4, but it is the one requirement no
  automated check can hold.
- D7 (carrying the binding-surface rationale into `appearance.ts`) is sound and the
  existing `FOCUS_RING_SURFACES` comment block is the right neighbour for it.
