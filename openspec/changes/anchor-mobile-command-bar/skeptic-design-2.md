## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review of `openspec/changes/anchor-mobile-command-bar/` against the real files in this
worktree (HEAD `d7815d15`) and against four headless-Chromium probes I launched myself
(own instance via `node_modules/playwright`, never the shared MCP session). I read
`skeptic-design-1.md` and treated its ten change requests as claims to re-verify, not as
settled facts. Round 1's explicitly-confirmed items (structural non-scrolling, the 56px
height, the D3 64px correction, the MODIFIED spec blocks being complete copies, the
legibility handling) were spot-checked, not relitigated.

### What I verified (with evidence)

**Every source citation in design.md / tasks.md is accurate.** Re-derived from the files, not
from round 1: `App.css:5` (`height: 100vh`), `:39-51` (base bar, `height: 48px`,
`padding: 0 var(--space-5)`, `border-bottom: 1px`), `:296` (`.app-content { overflow-y: auto }`),
`:336-349` (mobile title, no `min-height`), `:375-426` (the only `@media` in the file, after the
base rule, `.app-command-bar` first inside it at `:376`, `height: var(--space-10)` `:383`,
`padding: 0 var(--space-3)` `:384`), `:424` (HEL-774's fence), `:432`;
`theme.css:192-194` (`* { box-sizing: border-box }`), `:196-200`, `:204`;
`IconButton.css:98-105` (44px floor, after the base rule); `App.css.test.ts:92`;
`UserMenu.css:1-15` (`--control-sm` 28px, `border: 1px`); `CommandBar.tsx:168` (`ChevronDown
size={16}`) and `:183/230/245` (FontAwesome inside `IconButton`); `BottomNav.css:27-28` (the
mirror idiom Decision 5 copies — cited correctly). Token arithmetic re-checked:
`--control-lg` 40px + `--space-4` 16px = 56px; `--space-9` 48px; `--space-2` 8px.

**No unfounded legibility claim anywhere.** `grep -rni "legib"` across ticket/proposal/design/
tasks/specs returns only "accepted / unverified / no role may claim it / do NOT attempt"
framings (`proposal.md:48`, `design.md:27,104,110-112`, `tasks.md:72`, `ticket.md:58,82,111-120`).
Handled correctly in both directions. No `TODO`/`TBD`/placeholder in any artifact. Every AC
traces to at least one task.

**(a) Decision 4's custom-property reasoning is CORRECT — probed.** I built the exact seam and
tested overriding `--app-command-bar-height` *below* `:root`:

```
#anc { --app-command-bar-height: 999px }   #child { height: var(--app-top-chrome-height) }
  -> child offsetHeight = 48   (NOT 999+)         [1280x900]
```

The derived token does not recompute when its input is overridden below the declaring element,
exactly as Decision 4 states. Task 1.5's "MUST target `:root`" is well-founded, not superstition.

**(b) Decision 5's geometry is CORRECT — probed at three insets, twice.** Real declarations
(`height: var(--app-top-chrome-height)`, `padding-top: var(--app-safe-top)`, longhand
left/right/bottom) under the repo's real `* { box-sizing: border-box }`:

```
430x932 inset 0px : offsetHeight 56  clientHeight 55  paddingTop 0  contentBox 55  barTop 0
430x932 inset 47px: offsetHeight 103 clientHeight 102 paddingTop 47 contentBox 55  barTop 0
430x932 inset 59px: offsetHeight 115 clientHeight 114 paddingTop 59 contentBox 55  barTop 0
375x812 inset 47px: contentBox 55                      1280x900   : contentBox 47, offsetHeight 48
every control (mobile-title, 2x IconButton): rect.top = inset+5.5, rect.bottom = inset+49.5
```

Content box is 55px at every inset; clearance is exactly 5.5px per side; no control renders above
the inset's lower edge; desktop is untouched at 47px/48px. The round-1 collapse (contentBox 8,
control at top 29) is gone. design.md's numbers and the spec delta's numbers match the
measurement exactly.

**(d) Decision 2's ancestor-chain migration is SAFE — probed before/after.** `html, body, #root
{ min-height: 100% }` + `body { min-height: 100vh }` vs. the proposed `min-height: 100vh;
min-height: 100dvh` pair, at 1280x900 and 430x932, with short (100px) and tall (1400px) content:

```
every measure identical (docScrollHeight, docClientHeight, scrolls, html/body/#root rect height,
.auth-page top and height). Tall content still scrolls the document in BOTH (scrolls: true).
Only difference: getComputedStyle(#root).minHeight reports "900px" instead of "100%".
```

No desktop regression, no loss of full-page scrolling for auth / not-found / long pages. I have
no objection to Decision 2.

**(g, partial) Tasks 7.6/7.7/7.8 DO discriminate — round 1's central flaw is fixed there.**
Against the round-1 broken variant (`height: 56px` + `padding-top: 47px`), 7.6 reads contentBox
8 vs. the required 55; 7.7 reads border-box 56 vs. the required 103; 7.8 reads control
`rect.top` 29 vs. the required `>= 47`. All three fail on the broken build and pass on the fixed
one. The `--app-safe-top`-on-`:root` inset simulation (7.5) works — I used it for every
measurement above.

**Design judgment — the 56px bar does NOT read cramped.** I rendered a faithful mock that
`<link>`s this worktree's real `theme.css`/`App.css`/`IconButton.css`/`UserMenu.css` (mock kept
in scratchpad; nothing was written into the worktree) and screenshotted the bar at 430 and 375,
light and dark, at both glyph sizes. The 44px bordered squares have visible breathing room in
the 55px content box, the wordmark/mobile-title/controls all fit, and light and dark read
identically in structure. I independently agree with round 1: no objection to 56px. I also
agree with Decision 8's *visual* call to keep the 28px avatar rather than grow it to a 44px
circle — a 44px bordered circle would out-weigh the two icon buttons beside it. The defect below
is in the mechanism's arithmetic, not in that judgment.

**(e) Extending scope to `PanelDetailModal` is the right call, not a spinoff.** The meta flip is
global and immediate; shipping `black-translucent` without treating the one full-viewport phone
surface reachable by tapping any panel would ship a visible defect in the same commit that
causes it. Fold-in is correct. The audit list is *nearly* complete — one gap, CR 5 below.

**(h) Token discipline.** `--app-command-bar-height: var(--space-9)` fixes round 1's non-blocking
note. The only unsanctioned literal introduced is the `-8px` in Decision 8 — which CR 1 requires
changing anyway.

---

### Verdict: REFUTE

The revision fixes the substance of most of round 1. But the newest mechanism — Decision 8's hit
expander, introduced *by* round 1's CR 7 — **provably misses the 44px floor by 2px**, and the
verification task written to guard it cannot detect that. That is the sixth instance of the
regression this repo has hit five times, and it would archive into the spec as a SHALL that is
false on first measurement. Three smaller defects (an unscoped desktop change, an internal
contradiction, an audit gap) accompany it. None of these changes the approach; all are edits to
design.md / tasks.md / the delta.

### Status of round 1's ten change requests

| # | Round-1 CR | Status |
|---|---|---|
| 1 | border-box collapse of the content box | **RESOLVED** — probed: contentBox 55 at insets 0/47/59 |
| 2 | base-rule `padding-top` zeroed by the mobile shorthand | **RESOLVED** — longhands everywhere (Decision 6, tasks 3.3/3.4) + lock 6.6 |
| 3 | two sources of truth for the mobile height | **RESOLVED** — `:root`-only; probed that this is technically *required*, not stylistic |
| 4 | `html, body, #root { min-height: 100% }` unanalyzed | **RESOLVED** — Decision 2; probed layout-identical at desktop and mobile |
| 5 | pre-fix repro unachievable / non-discriminating probe | **PARTIALLY RESOLVED** — recipe is right; task 7.4's wording self-contradicts Decision 1 (see CR 4) |
| 6 | 6.6/6.7 cannot detect the collapse | **RESOLVED** — 7.6/7.7/7.8 verified discriminating against the broken variant |
| 7 | two sub-44px controls | **⚠ UNRESOLVED for `.user-menu__trigger`** — see CR 1. The mobile-title half IS resolved (probed 44px) |
| 8 | `black-translucent` is global; audit every surface | **PARTIALLY RESOLVED** — list omits `.app-skip-link` (CR 5); task 5.3 unscoped (CR 6) |
| 9 | glyph reduction under-specified | **PARTIALLY RESOLVED** — now fully specified, but the specified selector also changes desktop (CR 3) |
| 10 | numbers that archive into the spec | **RESOLVED** — 55px / 5.5px / border-box = value + inset all match my measurements |

> **⚠ ESCALATION-RELEVANT: round-1 CR 7 is NOT resolved for `.user-menu__trigger`.** The plan now
> addresses it explicitly and in good faith, but the mechanism it prescribes measurably produces
> a 42px tap area, so the requirement CR 7 raised ("raise both controls to the 44px floor") is
> still unmet. This is a wrong-arithmetic defect with a one-line fix, not a disagreement about
> approach.

### Change Requests

1. **`::after { inset: -8px }` yields a 42×42px tap area, not 44×44px — the 44px floor is missed
   by 2px.** design.md Decision 8 (line 84) asserts "28 + 8 + 8 = 44px". That arithmetic ignores
   that an absolutely-positioned pseudo-element resolves `inset` against its containing block's
   **padding box**, and `.user-menu__trigger` (`UserMenu.css:1-15`) carries `border: 1px solid
   var(--app-border-subtle)`. The real sum is **26 + 8 + 8 = 42**. Reproduced twice, identical:

   ```
   a: border:1px + inset:-8px   getComputedStyle(el,'::after') = 42px x 42px   measured hit 42.75  meets44: FALSE
   b: border:1px + inset:-9px                                  = 44px x 44px   measured hit 44.75  meets44: true
   c: border:1px + top/left:50%; width/height:44px; translate(-50%,-50%)
                                                               = 44px x 44px   measured hit 44.75  meets44: true
   d: border:none + inset:-8px                                 = 44px x 44px   measured hit 44.75  meets44: true
   ```

   (`d` isolates the cause: the same idiom on a *borderless* control does give 44px.) I also
   measured it in the full-bar harness: hit bounding box `x 374.5..416.5`, `y 6..48` = 42×42
   against a trigger rect of 28×28 at `382..410 / 13.5..41.5`.
   **Required:** change task 4.2 and design.md Decision 8 to a declaration that actually yields
   44px, and fix the "28 + 8 + 8 = 44px" sentence. Prefer variant `c` — explicitly sizing the
   pseudo to `44px` (the DESIGN.md §3-sanctioned literal) and centring it — over variant `b`
   (`inset: -9px`), because `c` stays correct if the trigger's border or `--control-sm` ever
   changes, whereas `-9px` silently re-breaks. `-9px` is also not a spacing token, so `c` is the
   cleaner token story too.

2. **Task 7.10 cannot detect CR 1 — it is green on both the broken and the fixed build.** It
   reads "assert `.user-menu__trigger`'s tap area via `elementFromPoint` at the expanded 44px
   box's corners". An executor deriving those corners from the design's own `-8px` constant
   probes the 42px box's own corners, which pass trivially; an executor deriving them from a true
   44px box gets 3 of 4 corners missing (I measured exactly that: only `tl` resolved to the
   trigger; `tr`/`bl`/`br` returned `.app-command-bar` / `.app-command-bar__right`). Either
   reading fails to establish "≥44px". This is round 1's central finding recurring in the one
   assertion added since.
   **Required:** re-specify 7.10 to assert the **measured extent**, independent of the constant
   under test — e.g. `parseFloat(getComputedStyle(trigger, "::after").width) >= 44` and the same
   for `height`, or an `elementFromPoint` scan/bisection that reports the hit box's actual span —
   and assert `>= 44`, not "at the assumed corners". Also reconcile task 7.9 ("every icon
   control measures >=44px **by rect**") with Decision 8, which deliberately keeps this control's
   rect at 28px: 7.9 must be scoped to the `IconButton` controls, with 7.10 owning the trigger.

3. **Task 4.5's selector is unscoped and measurably changes the DESKTOP command bar.**
   `.app-command-bar .ui-icon-btn { font-size: var(--text-sm) }` is written as a base rule at all
   widths. Measured at 1280x900 with the rule applied verbatim: the bar's icon glyphs render
   **14px instead of today's 16px** (`.ui-icon-btn--sm { font-size: var(--text-base) }`,
   `IconButton.css:46-50`). The ticket scopes the reduction to the *mobile* bar ("its icons are
   larger than necessary … on a phone"), and the delta's own framing is "Desktop command-bar
   height SHALL be unaffected". Two further problems: (i) it makes the command bar's
   `IconButton size="sm"` glyphs 2px smaller than the identical primitive everywhere else on
   desktop — `Sidebar.tsx`, `Modal.tsx`, `RefinementChatDrawer.tsx`, `TableRenderer.tsx`,
   `DashboardAppearanceEditor.tsx`, `CreatePipelineModal.tsx`, `PipelineScheduleDialog.tsx`,
   `ShapePickerModal.tsx`, `MessageComposer.tsx`; (ii) it overrides a shared primitive's `size`
   recipe from a parent selector, which DESIGN.md §5 ("a new button style is a defect, not a
   variant") and §6 ("reuse, don't reinvent") push back on.
   **Required:** scope the rule inside the existing `@media (max-width: 768px)` block in `App.css`
   (specificity 0,2,0 beats `.ui-icon-btn--sm`'s 0,1,0 regardless of order, so this is safe), and
   state in design.md Decision 10 that desktop glyph size is deliberately unchanged. Note for the
   record: `.app-command-bar__mobile-new-chat` uses `size="xs"`, which is *already*
   `--text-sm`/14px — say so, so the executor does not expect a change there.
   *(Design judgment, since I own it: 14px vs 16px at 430px is a subtle, defensible reduction —
   it does not read timid in the mock, and I am not asking you to drop it. Only to stop it
   leaking to desktop.)*

4. **Task 7.4 contradicts Decision 1 and tasks 2.1/2.2.** 7.4 says "assert no `vh` remains in the
   shell chain", but Decision 1 (design.md:31) and tasks 2.1/2.2 *mandate* a `100vh`
   first-declaration fallback (`height: 100vh; height: 100dvh;`). As written the assertion fails
   by construction against source text, and is unmeasurable against computed style (which
   resolves to px). This wording was inherited verbatim from round 1's CR 5 and is round 1's
   error, not yours — but it must not ship into the task list.
   **Required:** reword 7.4 to what is actually checkable, e.g. "assert that in `.app-shell`,
   `html`, `body` and `#root` the **last-declared** height/min-height in each rule uses `dvh`, and
   that no rule in the chain declares `vh` **alone**".

5. **The Decision 9 audit list omits `.app-skip-link` — a top-anchored fixed control in the very
   file this ticket owns.** `App.css:17-30` is `position: fixed; top: -100%; z-index: 10`, and
   `App.css:32-36`'s `:focus-visible` moves it to `top: var(--space-3)` (12px). Under
   `black-translucent` with any inset ≥ 12px, the focused skip link renders under the status-bar
   glyphs, above the command bar (`z-index: 2`). It is an accessibility affordance, and Decision 9
   claims "*every* full-viewport mobile surface is audited … each is treated with the seam or
   recorded exempt with a reason".
   **Required:** add `.app-skip-link` to task 5.4's audit list with a treat-or-exempt decision
   (`top: calc(var(--app-safe-top) + var(--space-3))` is the obvious seam consumption). While
   there, record a verdict on `Modal.css:11`'s `.ui-modal { max-height: 90vh }` — a 90vh modal
   centred in a 932px viewport has ~46.6px above it, i.e. its top edge lands right at a 47px
   inset. Exempt-with-a-reason is a perfectly acceptable answer for it; silence is not.

6. **Task 5.3 does not name a selector, and the obvious naive reading breaks every other modal.**
   "`PanelDetailModal.mobile.css` `<=430px`: give the modal header `padding-top:
   var(--app-safe-top)`" — but the header class is the *shared* `.ui-modal__header`
   (`Modal.css:111`). A bare `.ui-modal__header { padding-top: var(--app-safe-top) }` inside that
   file's `@media (max-width: 430px)` block is global CSS and would add the inset to every modal
   at that width, including the centred ones that never touch the top. That file's own header
   comment (`PanelDetailModal.mobile.css:5-9`) already warns about exactly this class of
   single-class-selector mistake.
   **Required:** name the compound selector in the task, e.g.
   `.ui-modal.panel-detail-modal .ui-modal__header, .ui-modal.panel-detail-modal--view
   .ui-modal__header`, matching the existing `:11-12` selector pair. Also confirm in the task that
   `Modal.css:111`'s `padding` shorthand is out-specificity'd rather than relying on order — the
   same hazard Decision 6 correctly structuralises for the command bar.

7. **Neither new 44px mechanism gets a static lock, although one of them is now an archived
   SHALL.** Tasks 6.1-6.9 lock the height seam, the padding longhands, the media-block order and
   the `dvh` chain — but nothing locks task 4.1's `.app-command-bar__mobile-title { min-height:
   44px }` or task 4.2's hit expander, and there is no `UserMenu.css.test.ts` at all. The delta
   now archives "a control whose tap area is provided by an expanded hit region … SHALL resolve to
   that control when the browser is asked what lies at the expanded region's corners" with no
   regression guard behind it. `IconButton.css.test.ts` is the standing precedent for exactly this,
   and design.md's own Risks section leans on "this repo has regressed the floor five times".
   **Required:** add two locks to section 6 — one asserting the mobile block declares
   `min-height: 44px` for `.app-command-bar__mobile-title`, and a new `UserMenu.css.test.ts`
   asserting the `<=768px` block gives `.user-menu__trigger` `position: relative` and an `::after`
   whose resolved size is 44px (per CR 1's chosen declaration).

### Non-blocking notes

- Decision 5 cites `BottomNav.css:27-28` as "the idiom this repo already proved for the
  mirror-image problem" — I checked, and the citation is exact
  (`height: calc(var(--control-lg) + var(--space-4) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom)`). Good precedent, correctly invoked.
- There is **no existing `::after` hit-expander anywhere in `frontend/src`** — every prior 44px
  fix (`IconButton.css:98-105`, `Modal.css:223-227`, `PanelDetailModal.mobile.css:41-59`,
  `UserMenu.css:137-140`) uses `min-height`/`min-width` on the control itself, which is also the
  mechanism DESIGN.md:130 names. Decision 8 is therefore introducing a new pattern for one
  control. I think the *reason* is sound (a 44px bordered circle would visually dominate a bar
  this change exists to lighten) — but say so in Decision 8, so the next reader doesn't "fix" it
  back to `min-height` and silently shrink the avatar's neighbours' rhythm.
- Task 6.7 ("mobile block declares no `height`") will need a regex that does not also match
  `min-height:` — the same block gains `min-height: 44px` from task 4.1.
- AC 6 says "430px and 375px, in both themes"; task 7.9 says "at 430 and 768". Task 7.12 covers
  375 and both themes for screenshots, so the AC is traced — but 7.9's viewport list reads like a
  typo for the AC's.
- `--app-safe-top`'s computed value keeps `1rem` unresolved inside the `calc()`, so a user's
  browser font-size scales the bar. That is correct and matches today's `--space-10` behaviour;
  no action, just don't be surprised by it in a probe.
- Environment note (not a blocker): this worktree's `scripts/concertino/` predates
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh` (branch point `d7815d15`). As
  in round 1, I ran the canonical `next-report-number.sh` from the main checkout against this
  change directory; it is a pure scan of the directory passed to it. Nothing was written into the
  worktree except this report.
