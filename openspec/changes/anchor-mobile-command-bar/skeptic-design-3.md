## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review of `openspec/changes/anchor-mobile-command-bar/` against the real files in this worktree
(HEAD `d7815d15`) and against five headless-Chromium probe passes I launched myself (own instance via
the main checkout's `node_modules/playwright` — this worktree has no `playwright` module; never the
shared MCP session). I read `skeptic-design-1.md` and `skeptic-design-2.md` and treated all seventeen
prior change requests as **claims to re-verify**, not as settled facts.

My probe builds the plan's CSS by **string-transforming the worktree's real `theme.css` / `App.css` /
`UserMenu.css`** (each edit guarded to match exactly once), links the real `IconButton.css` /
`Popover.css`, and renders a DOM mirroring `App.tsx:151-176` + `CommandBar.tsx:116-260`. Four builds:
`fixed` (the settled `sized-pseudo`), `broken8` (`inset: -8px`), `prefix` (today's `main`, unmodified),
and an injected-excess-height variant. Nothing was written into any worktree except this report.

---

### What I verified (with evidence)

**(a) The settled `sized-pseudo` mechanism is CORRECT — measured, not read.**

```
fixed @430x932 inset 47 light  getComputedStyle(trigger,'::after') = 44px x 44px
fixed @430x932 inset 47 dark                                       = 44px x 44px
fixed @430x932 inset 59 light                                      = 44px x 44px
fixed @430x932 inset  0 light                                      = 44px x 44px
fixed @375x812 inset 47 light                                      = 44px x 44px
fixed @768x1024 inset 47 / inset 0                                 = 44px x 44px
fixed @769x1024 / @1280x900   content:none, position:static, trigger rect 28x28  (desktop untouched)
```

Not just "44px on paper" — I bisected the **real hit region** with `document.elementFromPoint` in
0.25px steps outward from the trigger centre, counting a hit only when the returned node is the
trigger or inside it:

```
fixed   @430 inset 47: hit extent 44.5 x 44.5   (y 51.75..96.25, x 381.25..425.75)  centre hits
broken8 @430 inset 47: hit extent 42.5 x 42.5   (y 52.75..95.25, x 382.25..424.75)
```

Stacking / clipping / overflow all survive:
`getComputedStyle(trigger).overflow` is `visible` (no clip despite `border-radius: 50%`); the pseudo
box `382..426 x 52.5..96.5` sits **inside** the bar (`0..103`) and inside the viewport (430); it
**touches but does not overlap** the neighbouring `IconButton` (whose right edge is exactly 382) —
I sampled the neighbour's own box on a 5x5 grid and **0 of 25 points were stolen**. `position: relative`
on the trigger does not disturb the portalled `Popover` (`position: fixed`, `Popover.css:28`).
**Round-1 CR 7 is genuinely resolved for `.user-menu__trigger`.**

**(b) Task 7.10's assertion IS discriminating — the round-1/round-2 flaw does NOT recur.**
`parseFloat(getComputedStyle(trigger, "::after").width) >= 44` reads **42** on the `inset: -8px` build
(FAIL) and **44** on the settled build (PASS). It also fails safe if the rule is omitted entirely
(`width: "auto"` -> `NaN >= 44` is false). By contrast the rejected corner probe is **not**
discriminating — on `broken8` it returned `{tl:true, tr:false, bl:false, br:false}`, i.e. a partially
green reading off a broken build; task 7.10a's warning is well-founded.

**(c) Design judgment — 56px, the 14px glyphs, and the 28px avatar: no objection.** Screenshots at
430 and 375, light and dark, at insets 0 and 47, plus a `prefix` (64px) comparison. The 44px bordered
squares breathe in the 55px content box; the wordmark / mobile title / controls all fit at 375 with the
title ellipsing as designed; light and dark are structurally identical. The 28px avatar's visual
weight relative to its neighbours is **exactly what ships on `main` today** — growing it to a 44px
bordered circle would make it the heaviest element in a bar this ticket exists to lighten. I
independently reach the same conclusion as both prior skeptics and I have no disagreement with the
escalated decision.

**(d) Spot-checks of what round 2 confirmed — all re-derived independently, all hold.**

- *Decision 4 (`:root`-only)*: overriding `--app-command-bar-height: 999px` on `.app-shell` **and** on
  `.app-command-bar` itself both leave the bar at **56px**. Task 1.5's "MUST target `:root`" is a real
  constraint, not superstition.
- *Decision 5 (55px content box)*: `contentBox 55` at insets 0/47/59 at 430 and at 375; border-box
  `56/103/115` = token + inset; `rect.top` 0 in every case; desktop `48/47` at 769 and 1280.
- *Decision 2 / scroll ownership*: shell height == viewport (932/900) in every case; bar + content sum
  exactly to it; `.app-content` scrolls (`scrollTop` 1200 accepted, `contentScrolls: true`) while
  `document.scrollingElement` does not and the bar's `rect.top` stays 0 across the trace.
- *Tasks 7.1-7.3*: confirmed the naive probe proves nothing (`prefix` and `fixed` are both
  `docScrolls: false`, bar top constant) **and** that the prescribed injection detects:
  `.app-shell { height: calc(100dvh + 60px) }` -> `docScrolls true`, bar `rect.top -60`, control top
  `-54.5` (crosses y=0). Recipe is sound.
- *Task 5.4a (`.app-skip-link`)*: with the transition settled after a real `Tab`, `prefix` focuses to
  `top: 12` (**under** a 47px inset) and the treated build to `top: 59` (= 47 + 12). Correct and
  discriminating.
- *Task 5.4b (`Modal.css:11`)*: a 90vh dialog at 430x932 measures `top: 46.59` — design.md's "~46.6px,
  i.e. right at a 47px inset" is exact. An explicit verdict is genuinely owed.
- *Round-2 CR 3 (desktop glyph leak)*: with task 4.5 scoped inside the media block, bar `IconButton`
  font-size is **14px at <=768** and **16px at 769/1280**. Fixed.

**(e) The `black-translucent` audit list — I tried to disprove completeness and could not.** I
enumerated every `position: fixed`, every `100vh/100dvh/100svh/100lvh/90vh`, every `top: 0` / `inset: 0`
/ `position: sticky` in `frontend/src/**/*.css`, and every `createPortal` consumer. Everything
top-anchored or full-viewport is already on the list (`.app-skip-link`, `.refinement-drawer`
`RefinementChatDrawer.css:28-33`, `PanelDetailModal.mobile.css:10-20`, `auth.css:6/:242`,
`App.css:432`, `Modal.css:11`). The remaining fixed surfaces are bottom-anchored and exempt by
construction (`toast.css:5-8` bottom-right, `PanelList.css:79-88` bottom-right,
`MobileNavSheet.css:25-31` bottom sheet, `BottomNav.css` — HEL-774's), or JS-positioned popovers
(`Popover.css`, `inputs.css:115`) that open from their anchor. `.ui-modal--full` is a **width** preset
only (`Modal.css:58-60`), not a full-viewport height. **No seventh surface found.**

**(f) No unfounded legibility claim, and no placeholders.** `grep -rniE "legib"` across all artifacts
returns only "retired / accepted / unverified / no role may claim it / do NOT attempt" framings
(`ticket.md:58,82,111-120`, `design.md:29,126-134,157`, `proposal.md:48`, `tasks.md:79`). No
`TODO`/`TBD`/"figure out later" anywhere. The re-scoped AC is handled correctly in **both** directions.

**(g) Token discipline — the argument is sound.** `DESIGN.md`'s "Control metrics" section states
verbatim: *"interactive controls reachable on phone ... get a literal `44px` min-height/min-width
tap-target floor (HEL-308/314/319) — this is intentional, not drift"*, and `inputs.css:165-171` is
in-repo precedent for preferring the literal over a `--control` token here. The `44px` **value** in
`UserMenu.css` is therefore sanctioned, not drift. The **mechanism** (`width`/`height` on a pseudo
rather than `min-height`/`min-width` on the control) is the deviation, and Decision 8 already records
it with a reason — correct handling.

**Every source citation I checked is accurate**, re-derived from the files: `App.css:5,17-36,39-51,61-67,
70-77,111-115,296,336-349,375-426,424,432`; `theme.css:192-194,196-200,204` and the token values
(`--control-lg` 40 + `--space-4` 16 = 56; `--space-9` 48; `--space-10` 64; `--control-sm` 28);
`IconButton.css:40-50,98-105`; `UserMenu.css:1-15,137-140`; `CommandBar.tsx:168,183,229-251`;
`BottomNav.css:27-28`; `App.css.test.ts:92`; `PanelDetailModal.mobile.css:10-20,32`. `openspec validate
anchor-mobile-command-bar --strict` passes.

---

### Verdict: REFUTE

The escalated mechanism is right, and I could not break it. Every one of round 2's seven change
requests is genuinely applied, and the two that were tooling-sensitive (the pseudo's real size, 7.10's
discriminating power) I reproduced from scratch rather than trusting. This plan is close.

It fails on one thing: **the tap-target enumeration is still incomplete, for the third round running**,
and the plan's own browser-measurement step is scoped so narrowly that it could not have found it.
`.app-command-bar__logo` — a real `<a>` home link, visible at every mobile width — measures
**59.25 x 16px**, and the `command-bar-touch-target-framing` delta archives a universally-quantified
SHALL that this falsifies on first measurement. Plus a spec-archive hazard nothing mechanical catches.
All four items below are edits to `design.md` / `tasks.md` / the delta; none changes the approach.

> ### ⚠ PATTERN, NOT A SINGLE DEFECT — THIRD ROUND RUNNING
> Round 1 (CR 7) found two command-bar controls under the 44px floor. Round 2 found the fix for one of
> them measured 42px. Round 3 finds a **third control neither prior round enumerated**. The word
> "logo", "wordmark" or "brand" appears **nowhere** in `ticket.md`, `proposal.md`, `design.md`,
> `tasks.md` or either delta. design.md Decision 8's opening — *"The two sub-44px controls are fixed
> here"* — is a wrong count, and it is wrong because it was derived by reading CSS instead of measuring
> the rendered bar. **Nothing has survived two fix attempts** (round-1 CR 7's `sized-pseudo` fix is
> verified good), but the *class* of defect has now recurred three times. Please close it by
> **enumerating from a measurement of every interactive node in the bar**, not by patching one more
> named control.

---

### Status of every prior-round change request

| Round | # | Change request | Status |
|---|---|---|---|
| 1 | 1 | border-box collapse of the content box | **RESOLVED** — re-measured: contentBox 55 at insets 0/47/59, 430 + 375 |
| 1 | 2 | base `padding-top` zeroed by the mobile shorthand | **RESOLVED** — longhands everywhere; measured `paddingTop` = inset at every width |
| 1 | 3 | two sources of truth for the mobile height | **RESOLVED** — `:root`-only; I re-derived that this is technically required |
| 1 | 4 | `html, body, #root { min-height: 100% }` unanalysed | **RESOLVED** — Decision 2; re-measured layout-identical, content still owns scroll |
| 1 | 5 | pre-fix repro unachievable / non-discriminating probe | **RESOLVED** — 7.4 reworded; 7.2/7.3 recipe verified to detect |
| 1 | 6 | 6.6/6.7 cannot detect the collapse | **RESOLVED** — 7.6/7.7/7.8 re-verified discriminating |
| 1 | 7 | two sub-44px controls | **PARTIALLY RESOLVED** — both *named* controls now clear 44px (measured). But the enumeration was incomplete: `.app-command-bar__logo` is a third. See CR 1 |
| 1 | 8 | `black-translucent` is global; audit every surface | **RESOLVED** — I could not find a surface the list omits |
| 1 | 9 | glyph reduction under-specified | **RESOLVED** — measured 14px at <=768, 16px at 769/1280 |
| 1 | 10 | numbers that archive into the spec | **RESOLVED** — 55px / 5.5px / border-box = value + inset all match my measurements |
| 2 | 1 | `inset: -8px` yields 42px | **RESOLVED** — `sized-pseudo` measures 44x44 and hit-tests 44.5 across every viewport/inset/theme |
| 2 | 2 | 7.10 green on broken and fixed | **RESOLVED for the trigger** — 42 vs 44 proven. But 7.9's new scoping opened a different hole: see CR 2 |
| 2 | 3 | task 4.5 leaks to desktop | **RESOLVED** — measured |
| 2 | 4 | 7.4 contradicts Decision 1 | **RESOLVED** — reworded to last-declared/`vh`-alone |
| 2 | 5 | `.app-skip-link` + `Modal.css` 90vh omitted | **RESOLVED** — 5.4a measured correct (12 -> 59); 5.4b's verdict is scheduled; 90vh top measured 46.59 |
| 2 | 6 | task 5.3 selector unnamed | **RESOLVED** — 5.3a names the compound pair and the out-specificity requirement |
| 2 | 7 | no static locks for either 44px mechanism | **RESOLVED** — 6.10 + 6.11 added (one implementation hazard, non-blocking note 2) |

---

### Change Requests

1. **`.app-command-bar__logo` is a third sub-44px interactive control, and the delta archives a SHALL
   that it falsifies.** `CommandBar.tsx:120` renders `<Link to="/" className="app-command-bar__logo"
   aria-label="Helio home">` — a real navigation control (`App.css:61-67`, F-185: *"the wordmark is a
   real link home, not inert chrome"*). It is **not** hidden at `<=768px` by any rule in any
   stylesheet (I grepped all of `frontend/src`), and the ticket's own defect narrative proves it renders
   on the phone bar (*"`He5:56ews Overview`"* is this wordmark plus the mobile title). Measured, twice,
   identical, on both the `prefix` and the planned build at 430x932:

   ```
   .app-command-bar__logo          A       59.25 x 16     <-- 28px under the floor
   .app-command-bar__mobile-title  BUTTON 122.89 x 44
   .ui-icon-btn (x2)               BUTTON     44 x 44
   .user-menu__trigger             BUTTON     28 x 28     (44px via the pseudo — CR resolved)
   ```

   `specs/command-bar-touch-target-framing/spec.md:18-24` archives: *"**every** interactive control
   within `.app-command-bar` SHALL be reachable across at least 44px in its tap dimension **as measured
   in the browser**"*. That is false at 16px. `ticket.md`'s AC ("every interactive control still >=44px
   in its tap dimension") is likewise unmet, and `design.md:83` ("The **two** sub-44px controls are
   fixed here") is a wrong count.
   **Required — pick one and say which in `design.md`:**
   (a) **Fix it.** Add `.app-command-bar__logo { min-height: 44px }` inside the existing `<=768px` block
   (DESIGN.md:130's named mechanism, same one-liner as task 4.1), plus a static lock alongside 6.10 and
   coverage in 7.9. **I measured this as visually free**: with the rule applied, the wordmark stays at
   the identical position (`top 18.5, left 34`), the separator is unmoved (`top 18.5, left 83.25`) and
   the bar stays 56px — the left group's tallest child is already the 44px mobile title, so nothing
   reflows. Only the link's own hit box grows 16 -> 44.
   (b) **Narrow the scenario** to the control classes `DESIGN.md`'s Control-metrics section actually
   names ("buttons, select triggers/options, CTAs") and record the wordmark link as an explicit
   **stated exemption** in Decision 8 with its reason.
   Silence is not an option: as written this archives a permanent, measurably false SHALL.

2. **Task 7.9's scoping leaves `.app-command-bar__mobile-title`'s new 44px floor unmeasured — verified
   only by reading source text, which this ticket explicitly forbids.** 7.9 covers "every `IconButton`
   control"; 7.10 covers `.user-menu__trigger`; 7.8 checks positions, not sizes. The mobile title is
   neither an `IconButton` nor the trigger, so task 4.1's `min-height: 44px` is guarded **only** by the
   static lock 6.10. `ticket.md`'s binding UI/UX emphasis §2 says the opposite in as many words:
   *"Verify the floor with `getComputedStyle`/`getBoundingClientRect` at 430 and 768, **not by reading
   the CSS** — that is exactly how HEL-535's inert-cascade bug hid"*, and `design.md:141` cites that
   same bug in its own Risks. A rect measurement would discriminate cleanly — `prefix` renders the
   title at **122.89 x 19**, the planned build at **122.89 x 44**.
   **Required:** widen 7.9 to *"every interactive control inside `.app-command-bar` (`bar.querySelectorAll("a, button")`,
   excluding `display:none`) measures >=44px by rect at 430, 375 and 768 — except `.user-menu__trigger`,
   whose expanded region 7.10 owns"*. Enumerating from the DOM rather than from a hand-written list is
   what stops CR 1 recurring a fourth time. If CR 1 is resolved by exemption (b), name that exemption
   here too rather than dropping the enumeration.

3. **The MODIFIED requirement is silently renamed, with no `RENAMED` block — the archive can leave the
   old, now-false requirement in the permanent spec.** Current spec header
   (`openspec/specs/command-bar-touch-target-framing/spec.md:21`): *"### Requirement: CSS-lock **test
   guards** the mobile command-bar height rule"*. The delta's header
   (`specs/command-bar-touch-target-framing/spec.md:30`): *"### Requirement: CSS-lock **tests guard**
   the mobile command-bar height rule"*. OpenSpec's own merge semantics (`dist/core/templates/workflows/
   sync-specs.js`) say MODIFIED means *"Find the requirement in main spec ... Preserve scenarios/content
   not mentioned in the delta"*, and it provides a **separate** `## RENAMED Requirements` section with
   `FROM:`/`TO:` for exactly this. Renamed, it matches nothing — so the old requirement, whose body
   SHALLs *"the `max-width: 768px` media block in `App.css` keeps the `height: var(--space-10)` rule"*
   (the very rule task 3.5 deletes), can survive into `openspec/specs/` beside its replacement, leaving
   the permanent spec self-contradictory. `openspec validate --strict` passes (I ran it), so nothing
   mechanical catches this. The first requirement's header matches exactly and is fine.
   **Required:** either restore the original header verbatim, or add a `## RENAMED Requirements` block
   with `FROM: ### Requirement: CSS-lock test guards the mobile command-bar height rule` /
   `TO: ### Requirement: CSS-lock tests guard the mobile command-bar height rule`.

4. **(Minor — bundle with the above.) `proposal.md`'s Impact list is stale after scope grew twice.** It
   names only `App.css`, `theme.css`, `index.html`, `App.css.test.ts`. The plan also edits
   `UserMenu.css` (task 4.2), `PanelDetailModal.mobile.css` (5.3), `CommandBar.tsx` (4.6), and adds
   `theme.css.test.ts` (6.1) and `UserMenu.css.test.ts` (6.11) — `design.md:146-148` already knows this.
   With HEL-774 and HEL-548 fenced off by file, the proposal's blast-radius statement is the artifact a
   reviewer checks the fence against, so it needs to be accurate.
   **Required:** update the Impact bullet to the real file list.

---

### Non-blocking notes

- **`design.md` at 168 lines.** The "Maximum 150 lines" rule is real (it is in `openspec instructions
  design`'s `<rules>`), but it is advisory — `openspec validate --strict` passes. The disclosure was
  the right call and I am **not** asking you to delete anything a reviewer required. If you want to
  land under 150 without losing substance, cut the **process history**, which is duplicated verbatim in
  the two skeptic reports and has no value to a future reader of the archived design: lines 160-163
  ("Skeptic round 1 raised ten change requests...") and the whole `## Open Questions` section
  (165-168, whose content is "None"). That is ~10 lines. Trimming Decision 8's round-2 measurement
  recap (the `28+8+8` post-mortem, lines 87-90) to one sentence gets you the rest — though I would
  personally **keep** it, because it is the single most useful sentence in the file for the next person
  tempted by `inset: -8px`.
- **Task 6.11 has a first-match hazard the plan flags for `App.css` but not for `UserMenu.css`.**
  `UserMenu.css:137-140` **already** contains a `@media (max-width: 768px)` block (for
  `.user-menu__item`). A `findMediaBlock(css, "max-width: 768px")` helper copied from
  `App.css.test.ts:9-31` takes the **first** match and would return that block, not the new one. It
  fails loudly rather than silently (`findRuleBody` throws on a missing selector), so this is a
  time-waster rather than a false green — but the cheapest fix is to put the trigger rules **inside the
  existing `<=768px` block** rather than adding a second one, and say so in task 4.2.
- `design.md:84` calls `.app-command-bar__mobile-title` "~21px"; measured it is **19px** at 430. The
  "~" makes it honest and the number does not archive into the delta — no action needed.
- Task 4.2 and Decision 8 say "`UserMenu.css`" without a path; it is
  `frontend/src/features/auth/ui/UserMenu.css` and the basename is unique in the repo, so there is no
  real ambiguity.
- Task 7.10's assertion also **fails safe** when the rule is omitted entirely (`width` computes to
  `"auto"`, `parseFloat` gives `NaN`, `NaN >= 44` is false). Worth knowing; no change needed.
- Environment note (not a blocker, same as both prior rounds): this worktree's `scripts/concertino/`
  predates `next-report-number.sh` (branch point `d7815d15`), and it has no `node_modules/playwright`
  either. I ran the canonical `next-report-number.sh` from the main checkout against this change
  directory (a pure scan of the directory passed to it) and required `playwright` from the main
  checkout's `node_modules`. Nothing was written into this or any other worktree except this report.
