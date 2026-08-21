## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold review of `openspec/changes/anchor-mobile-command-bar/` against the real files in this worktree
(HEAD `d7815d15`) and against six headless-Chromium probe passes I launched myself (own instance,
`playwright@1.55.1` required from the main checkout's `node_modules` — this worktree has none; the
shared MCP session was never touched). I read `skeptic-design-1/2/3.md` and treated **all 21 prior
change requests as claims to re-verify**, not as settled facts.

My harness string-transforms the worktree's real `theme.css` / `App.css` / `UserMenu.css` into the
planned build (every one of the 8 replacements guarded to match **exactly once** — the guard fired
clean), links the real `IconButton.css` / `Popover.css` / `SaveStateIndicator.css`, and renders a DOM
mirroring `App.tsx:146-176` + `CommandBar.tsx:116-260` in three real app states (dashboard view, chat
view, dashboard-with-unsaved-changes). Nothing was written into this or any other worktree except
this report.

---

### What I verified (with evidence)

**(a) The painted/unpainted split holds when rendered, and the scoped override is NOT an inert
cascade.** Measured on the planned build, `@430x932` and `@375x812`, insets 0 and 47, light and dark:

```
.app-command-bar__logo          A        63.25 x 44     (min-height, unpainted)
.app-command-bar__mobile-title  BUTTON  161.16 x 44     (min-height, unpainted)
.ui-icon-btn--sm  x2            BUTTON      28 x 28     ::after 44px x 44px
.user-menu__trigger             BUTTON      28 x 28     ::after 44px x 44px
bar: rect.top 0, border-box 103 (= 56 + 47), padding-top 47px, CONTENT BOX 55
```

The `IconButton`s really do come back to 28px painted inside the bar while `.ui-icon-btn`'s global
floor is untouched elsewhere. I attacked the cascade specifically: `.app-command-bar .ui-icon-btn`
(0,2,0) beats `IconButton.css:98-105`'s `.ui-icon-btn` (0,1,0) **in both stylesheet orders** — with
`IconButton.css` loaded before *and* after `App.css`, the buttons measure `28x28` identically. This
is specificity-decided, not order-decided, so it is not HEL-535's shape. Desktop is byte-identical to
today: at 769 and 1280 the planned build and `main` both give bar 48/47, `.app-command-bar__right`
width 266.34, every icon button 28x28, **no `::after` at all** (`content: none`).

**(b) The 8px-overlap analysis is real, `--space-4` is the right number — but see CR 1 for how it is
checked.** With the planned `gap: var(--space-4)` the hit regions **exactly tile**: at 430 the three
right-hand expanders occupy `294..338 | 338..382 | 382..426`, i.e. they abut with zero overlap and
stay 4px inside the viewport. Grid-sampling every painted box with `elementFromPoint` (81 points
each): **0 stolen, at 430 and 375, light and dark, dashboard and chat**. Adjacent-hit-region-vs-
neighbour-painted-box overlaps: **0**. So 16px is exactly right — 8px per side per control, no more,
no less; nothing to change in Decision 8b's *value*.

**(c) Nothing else in the bar regresses when the icon buttons shrink 44 -> 28.** Measured against
`main`: bar 64 -> 56 with `rect.top` 0 throughout; every control's box and 44px hit region sits
inside the content box and at/below the inset (`hit y 53..97` in a `47..102` content box, at both 430
and 375); vertical centring intact (`align-items: center`, boxes at y 61..89); the right group gets
**narrower**, not wider (132 -> 116 — see CR 3), so the mobile title gains room rather than losing it
(`max-width: 45vw` ellipsis at 375: usable text width 99 -> 114); no wrapping, no viewport overflow
on either side; scroll trace `barTop` identical (0) at scrollTop 0/100/400/900/1500/max with
`document.scrollingElement` never scrolling and `.app-content` owning the scroll. Focus rings grow
with the boxes (logo/title outlines now bound a 44px row rather than an 18-19px one) — correct, and
worth knowing, not a defect.

**(d) Design judgment — I endorse the PO's 28px call; the bar reads better than today, not sparser.**
Screenshots at 430 and 375, light and dark, insets 0 and 47, against a `main` baseline
(`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/hel772/shot-*.png`).
Today's bar puts two 44px bordered squares next to a 28px avatar — three controls, two weights, and
the squares are the heaviest thing in the chrome. The planned bar is a single, even 28-28-28 trio on
a 16px rhythm: the right group reads as one deliberate cluster rather than two big buttons plus a
straggler, the wordmark/title/controls balance, and the controls now match the *same primitives'
desktop rendering*, so the app is more consistent across breakpoints, not less. It does not read
sparse — the 16px gaps are visually the same rhythm as `--space-4` elsewhere in the chrome, and the
group is narrower overall, so the bar reads tighter, not emptier. "Too small to look tappable" is the
fair worry, and my answer is no: a 28px bordered square with a 16px glyph is already the affordance
this app ships on every desktop surface, the hit area measures 44px, and the alternative the PO
rejected (44px painted boxes) demonstrably out-weighs everything else in a bar this ticket exists to
lighten. Light/dark are structurally identical. **No objection, and no judgment note against it.**

**(e) The `black-translucent` audit list, the seam, the geometry and the scroll ownership —
spot-checked, all hold.** Every cited line resolves to what design.md says it does: `theme.css:59`
(`--control-sm: 28px`), `:192-194`, `:196-200`, `:204`; `App.css:5,17-36,39-51,61-67,111-116,296,
336-349,375-426,424,432`; `IconButton.css:40-50,46-50,98-105`; `UserMenu.css:1-15,137-140`;
`CommandBar.tsx:120`; `Modal.css:11,111`; `PanelDetailModal.mobile.css:10-20`; `auth.css:6,242`;
`RefinementChatDrawer.css:28-33`; `App.css.test.ts:92`. Tasks 7.2/7.3's repro recipe is discriminating
(`height: calc(100dvh + 60px)` -> `docScrolls true`, bar `rect.top -60`, min control top `-7`; without
it, `barTop 0`, `docScrolls false`). `openspec validate anchor-mobile-command-bar --strict` passes.
No `TODO`/`TBD`/placeholder anywhere. **No unfounded legibility claim in any artifact** — every hit of
`grep -rniE "legib"` is a "retired / accepted / unverified / no role may claim it / do NOT attempt"
framing, and the re-scoped AC is handled correctly in **both** directions.

**(f) Round 3's four change requests: all genuinely applied.** The delta's two MODIFIED headers are
byte-identical to `openspec/specs/command-bar-touch-target-framing/spec.md:6` and `:21` (I diffed with
`cat -A`); `.app-command-bar__logo` is covered by 4.2/6.10 and measures 44px with the wordmark
unmoved; 7.9 now enumerates from the DOM; `proposal.md`'s Impact list matches the task list.

---

### Verdict: REFUTE

**The design is right and I am not asking for any rework of it.** Decisions 1-10 survived every probe
I could aim at them, including the two that are new this round (the painted/unpainted split and the
gap widening), and the PO's 28px call is, in my independent judgment, the better-looking bar. What
fails is narrower and specific: **the two browser checks that guard the newest tap-target mechanism
both return the wrong answer** — 7.12 is green on a build whose controls measure 35.75px, and 7.9
fails on a *correct* build. That matters more than usual here, because the delta archives
"every interactive control SHALL be reachable across at least 44px in its tap dimension **as measured
in the browser**", and as written nothing in the plan measures that. Three smaller archive-accuracy
items follow. All five are edits to `tasks.md` (3), `design.md` (2 sentences) and the delta (1
scenario name); none touches the approach, and I would expect to CONFIRM round 5 on them.

> ### ⚠ FOURTH CONSECUTIVE ROUND OF THE SAME *CLASS* (no individual defect has survived two fixes)
> R1 CR 6: tasks 6.6/6.7 could not detect the border-box collapse. R2 CR 2: task 7.10 was green on the
> 42px build. R3 CR 2: task 7.9 left the mobile title's new floor unmeasured. R4 (below): task 7.12 is
> green on a 35.75px build and task 7.9 red on a correct one. Every time, the *mechanism* was fixed
> correctly and the *check written to guard it* was not discriminating. Every prior defect is fixed —
> this is a recurring blind spot in section 7, not a regression. Please close it by making each check
> **fail on a deliberately broken variant before trusting it green**, which is cheap: I did it for
> both of the checks below in one probe pass each.

---

### Change Requests

1. **Task 7.12 cannot detect the defect Decision 8b exists to prevent, and nothing else guards task
   4.7 either.** I built the planned CSS with the gap left at `var(--space-2)` (8px) — i.e. task 4.7
   omitted, or its equal-specificity rule gone inert, which is exactly the HEL-535 shape the Risks
   section warns about for the sibling rules. Measured at 430 **and** 375, reproduced on a second
   clean run:

   ```
                                     7.12 as written   region-vs-region   icon-btn measured hit width
   gap 8px  (task 4.7 missing)  @430        0 viol.          4 viol.       35.75  35.75   <- below 44
   gap 8px                      @375        0 viol.          4 viol.       35.75  35.75
   gap var(--space-4) (planned) @430        0 viol.          0 viol.       43.75  43.75
   gap var(--space-4)           @375        0 viol.          0 viol.       43.75  43.75
   ```

   On the broken build `getComputedStyle(el,"::after").width` still reads **44px** (7.10 passes),
   grid-sampling every painted box reports **0 stolen** (7.12's prescribed method passes), and yet
   "Refine with AI" and "Open assistant" have a real horizontal tap extent of **35.75px** by
   `elementFromPoint` bisection. The reason 7.12 misses it is a wording slip: with an 8px gap and an
   8px-per-side expander, no hit region ever reaches a *neighbour's painted box* — it reaches the
   neighbour's *expander*, and in that band the later sibling (painted last) wins, truncating the
   earlier control's own hit area. Section 6 has no lock for the gap either, so task 4.7 currently has
   **no discriminating guard, static or dynamic**.
   **Required:** (i) re-specify 7.12 to assert what actually breaks — hit region vs **neighbouring hit
   region** non-overlap, or (better, because it is direct) that each painted control's `elementFromPoint`-
   bisected hit extent is `>= 44` on **both** axes; keep the painted-box sampling as an extra if you
   like, but it cannot be the assertion. (ii) Add a CSS-lock in section 6 that the `<=768px` block
   declares `gap: var(--space-4)` for `.app-command-bar__right`. (iii) Also fix Decision 8b's
   *mechanism* sentence — the expanders overlap **each other**, they never overlap a neighbour's
   painted box; "steal each other's taps" is true but describes the region-vs-region case, and it is
   what produced the wrong assertion.

2. **Task 7.9 returns the wrong answer on a CORRECT build, under both available readings of it — and
   one of those failures is intermittent.** I ran 7.9 verbatim (`bar.querySelectorAll("a, button")`
   filtered only by `getComputedStyle(el).display !== "none"`) on the planned build:

   ```
   430 / 375 / 768, dashboard view:
     Helio home                       63.25x44   by-rect pass   union pass
     Switch dashboards ...           161.16x44   by-rect pass   union pass
     Customize dashboard appearance    0.00x0.00 by-rect FAIL   union pass (accidentally)
     Refine this dashboard with AI    28.00x28    by-rect FAIL   union pass
     Open assistant                   28.00x28    by-rect FAIL   union pass
     Account menu                     28.00x28    by-rect FAIL   union pass
   430, dashboard view WITH UNSAVED CHANGES — one extra row:
     Save now                          0.00x0.00 by-rect FAIL   union FAIL
   ```

   Two independent problems. (a) **The visibility filter is wrong.** `.dashboard-appearance-editor`
   and `.app-command-bar .save-state-indicator` are the `display: none` elements at `<=768px`; their
   *descendant* buttons compute `display: inline-flex` and so survive the filter with a 0x0 rect. The
   appearance-editor button passes only by accident (the scoped `::after` gives an invisible button a
   44px pseudo); "Save now" fails outright, and only when the dashboard happens to be dirty — a check
   that is green in a clean run and red in a real one is worse than no check. (b) **"a >=44px tap
   dimension" is undefined for the four expander-based controls**, and on the by-rect reading — which
   is the wording round 3's CR 2 actually asked for — it **directly contradicts task 7.11**, which
   requires those same controls to measure 28px.
   **Required:** in 7.9, (i) filter on rendered visibility, not `display` — `el.getClientRects().length > 0`
   (or `el.checkVisibility()`), which excludes both 0x0 buttons at every width I tested; and (ii) state
   the measurement rule: per axis, `max(border-box, sized ::after)`, with painted controls' `::after`
   half owned by 7.10 and their box half by 7.11, so 7.9/7.10/7.11 cannot be read as contradicting each
   other. Keep the DOM enumeration — it is the right mechanism and it is what surfaced CR 4 below.

3. **`design.md:114-116` states the sign backwards, in the one artifact reviewers check the blast
   radius against.** It says the gap widening "widens the right-hand group by 16px total; the mobile
   title ... absorbs the difference at 375px". Measured, `main` vs planned, at both widths:
   `.app-command-bar__right` goes **132px -> 116px** (two boxes shrink 44->28 = -32; two gaps grow
   8->16 = +16), and the title therefore **gains** room — its usable text width at 375 goes 99px ->
   114px, so it ellipses *less*. (For completeness: the group's *hit* footprint is unchanged at 132px;
   no reading of the geometry gives "+16".) The conclusion ("the title absorbs it") is safe a fortiori,
   but the number and its direction are wrong, and this file archives. Round 1 CR 10 and round 2 CR 1
   were both this same species of arithmetic-in-an-archived-artifact.
   **Required:** restate as measured — the right group narrows by 16px and the mobile title gains that
   space; the gap change alone accounts for +16px of it.

4. **The DOM contains a fifth interactive control whose size Decision 8 does not name, and task 4.5
   silently changes it.** `.app-command-bar__mobile-new-chat` (`CommandBar.tsx:182-189`) is an
   `IconButton` with `size="xs"` — 24x24 by `IconButton.css:40-44`, which DESIGN.md's Control-metrics
   section explicitly sanctions ("Inline mini icon-buttons inside dense rows may be 24px"). Task 4.5's
   blanket `min-width/min-height: var(--control-sm)` renders it at **28x28** (measured, `/chat` at 430
   and 375), not at its own size recipe. Nothing is broken — it shrinks 44 -> 28 like everything else,
   so Decision 8's binding rule ("nothing grows visually") holds, and 28px arguably reads *better*
   beside its 28px siblings — but Decision 8 enumerates the bar's painted controls as
   "`.user-menu__trigger` and the bar's `IconButton`s (`--sm`)", and task 7.11 asserts "the PAINTED box
   is still 28px" for "the same controls" without saying whether this one is in the set. That is the
   same one-control-short-of-the-rendered-DOM pattern round 3 flagged for the logo.
   **Required:** one sentence in Decision 8 naming `.app-command-bar__mobile-new-chat` and stating that
   the `--xs` instance is deliberately floored to `--control-sm` on mobile (or scoping 4.5 per size),
   and include it in 7.11's control set. Not a redesign — a decision that is currently implicit.

5. **The MODIFIED CSS-lock requirement's *existing scenario* is not addressed, and openspec's merge
   rule preserves it.** `openspec/specs/command-bar-touch-target-framing/spec.md:28-31` carries
   "#### Scenario: Mobile command-bar height **rule** removed", whose body pins
   `height: var(--space-10)` — the exact rule task 3.5 deletes and 6.3 un-pins. The delta's replacement
   is named "Mobile command-bar height **override** removed", so it does not match; and
   `/usr/lib/node_modules/@fission-ai/openspec/dist/core/templates/workflows/sync-specs.js:52` instructs
   the merger to *"Preserve scenarios/content not mentioned in the delta"*. `openspec validate --strict`
   passes, so nothing mechanical catches it. This is round 3's CR 3 one level down: the permanent spec
   can end up requiring a CSS-lock on a rule this change deliberately removes.
   **Required:** name the delta's scenario exactly "Mobile command-bar height rule removed" (so it
   modifies in place), or add a `## RENAMED`-style explicit note to the archiver. The requirement's two
   *other* new scenarios are additions and are fine as-is.

---

### Status of every prior-round change request

| Round | # | Change request | Status |
|---|---|---|---|
| 1 | 1 | border-box collapse of the content box | **RESOLVED** — re-measured: content box 55 at insets 0/47, 430/375; border-box = token + inset |
| 1 | 2 | base `padding-top` zeroed by the mobile shorthand | **RESOLVED** — measured `padding-top` = inset at 430/375/768; longhands everywhere |
| 1 | 3 | two sources of truth for the mobile height | **RESOLVED** — `--app-top-chrome-height` is the only input; mobile block declares no height |
| 1 | 4 | `html, body, #root { min-height: 100% }` unanalysed | **RESOLVED** — Decision 2; measured doc never scrolls, `.app-content` owns it |
| 1 | 5 | pre-fix repro unachievable / non-discriminating | **RESOLVED** — 7.2/7.3 injection detects (barTop -60), absent it barTop 0 |
| 1 | 6 | 6.6/6.7 cannot detect the collapse | **RESOLVED** — 7.6/7.7/7.8 re-verified discriminating |
| 1 | 7 | two sub-44px controls | **RESOLVED** for the floor (all three named controls measure 44px) — but the enumeration is again one control short: see CR 4 |
| 1 | 8 | `black-translucent` global audit | **RESOLVED** — spot-checked; every cited surface exists; no seventh found |
| 1 | 9 | glyph reduction under-specified | **RESOLVED BY REMOVAL** — Decision 10 drops it; measured desktop identical to `main` at 769/1280; no `.tsx` touched |
| 1 | 10 | numbers that archive into the spec | **RESOLVED** for all round-1 numbers — but a **new** sign error entered in 8b: CR 3 |
| 2 | 1 | `inset: -8px` yields 42px | **RESOLVED** — 44x44 declared, 44.5 bisected, at every viewport/inset/theme |
| 2 | 2 | 7.10 green on broken and fixed | **RESOLVED for 7.10** (42 vs 44 confirmed) — the class recurs at 7.12 and 7.9: CR 1, CR 2 |
| 2 | 3 | task 4.5 leaks to desktop | **RESOLVED/MOOT** — the glyph rule is gone; desktop measured byte-identical |
| 2 | 4 | 7.4 contradicts Decision 1 | **RESOLVED** — reworded to last-declared / `vh`-alone, and the fallback is explicitly mandated |
| 2 | 5 | `.app-skip-link` + `Modal.css` 90vh omitted | **RESOLVED** — 5.4a/5.4b present; skip-link treatment verified correct |
| 2 | 6 | task 5.3 selector unnamed | **RESOLVED** — compound pair named, out-specificity required |
| 2 | 7 | no static locks for the 44px mechanisms | **PARTIAL** — 6.10/6.11/6.12 lock the min-heights, the scoping and the pseudo; **nothing locks task 4.7's gap**, which is also the one no browser check catches: CR 1 |
| 3 | 1 | `.app-command-bar__logo` a third sub-44px control | **RESOLVED** — measured 63.25x44, wordmark and separator unmoved, bar still 56px |
| 3 | 2 | 7.9 scoped too narrowly | **PARTIAL** — DOM enumeration adopted (right call), but the filter and the measurement rule are both wrong: CR 2 |
| 3 | 3 | silently renamed MODIFIED header | **RESOLVED** — both headers byte-identical to the live spec; scenario-level analogue open: CR 5 |
| 3 | 4 | stale `proposal.md` Impact list | **RESOLVED** — matches the task list (note: `Modal.css` may join it depending on 5.4b's verdict) |

---

### Non-blocking notes

- **`design.md` at 172 lines.** You asked me to name specific cuts if I want it under 150. I do not —
  the advisory limit is not worth losing substance over, and `openspec validate --strict` passes. If
  you want the number down anyway, the only fat I can find is **Decision 9's inline surface list**
  (lines 118-127): it duplicates tasks 5.3/5.4/5.4a/5.4b almost item for item, and could be two
  sentences plus "the per-surface list and its verdicts live in tasks.md §5" for about -6 lines. Keep
  the `28+8+8` post-mortem (8a) and the border-box arithmetic (Decision 5) — those are the two
  paragraphs that stop a future reader re-breaking this.
- **Task numbering has holes** — section 4 skips `4.6`, section 6 skips `6.5`. Both are the dropped
  `CommandBar.tsx` glyph tasks. Harmless, but an executor reading `4.5 -> 4.7` may go looking for a
  task that was lost in a merge. Renumber or leave a one-word marker.
- **First-match hazard in task 6.10, same species as the one you flagged for 6.12.**
  `findRuleBody(mobileBlock, ".app-command-bar__mobile-title")` (`App.css.test.ts:35-47`) returns the
  **first** matching rule in the block, which today is `.app-command-bar__mobile-title { display:
  inline-flex }` at `App.css:391`. It fails loudly rather than silently, so it is a time-waster, not a
  false green — but the cheap answer is to add `min-height: 44px` to that existing rule, or to put the
  new grouped rule before it.
- The `44px` expander is a fixed literal while the gap that makes it tile is `1rem`. At the default
  root font-size they are exactly complementary (8 + 8 = 16); a user with a smaller browser default
  would shrink the gap below the expander's reach. Today's `--space-2` has the same property, and the
  floor is a sanctioned literal per DESIGN.md, so this is an observation rather than a request.
- The right group's *hit* footprint is unchanged at 132px while its *painted* footprint drops to
  116px — i.e. the outermost hit region still starts where the old painted group started. Nothing to
  do; worth knowing when someone later wonders why the group "feels" wider than it looks.
- Environment note (same as all three prior rounds): this worktree's `scripts/concertino/` predates
  `next-report-number.sh`, and it has no `node_modules/playwright`. I ran the canonical
  `next-report-number.sh` from the main checkout against this change directory (a pure scan of the
  directory passed to it) and required `playwright` from the main checkout's `node_modules`. The MCP
  Playwright session was not used. `cleanup.sh` was not invoked. No file outside this report was
  written in any worktree.
