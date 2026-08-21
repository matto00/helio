## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold review of `openspec/changes/anchor-mobile-command-bar/` (ticket.md, proposal.md, design.md,
tasks.md, both spec deltas) against the real files in this worktree (HEAD `d7815d15`) and against
two reproduced headless-Chromium probes I launched myself (never the shared MCP session).

### What I verified (with evidence)

**Ground truth the plan cites — all confirmed accurate.**

- `App.css:5` `.app-shell { height: 100vh }`; `App.css:39-51` base `.app-command-bar` with
  `height: 48px`, `position: relative`, `flex-shrink: 0`, `border-bottom: 1px`,
  `padding: 0 var(--space-5)`.
- `App.css:375-426` is the **only** `@media` block in `App.css`, it is **after** the base rule, and
  `.app-command-bar` (l.376, `height: var(--space-10)`, `padding: 0 var(--space-3)`) is the **first**
  `.app-command-bar*` selector inside it. design.md's `findMediaBlock`/`findRuleBody` first-match
  risk note is factually correct.
- `App.css.test.ts:89-95` pins `height:\s*var\(--space-10\)` exactly as claimed.
- `grep -rn "env(safe-area" frontend/src frontend/index.html` → only `-bottom` (BottomNav.css:27,28;
  MobileNavSheet.css:41; App.css:424). No `-top` anywhere. Claim confirmed.
- `index.html:14` is `apple-mobile-web-app-status-bar-style: default`; `index.html:5` has
  `viewport-fit=cover`. Confirmed.
- Token arithmetic: `--control-lg: 40px` (theme.css:61) + `--space-4: 1rem` (theme.css:50) = **56px**.
  D1's number is right. `--space-10: 4rem` = 64px, so the 64px→56px framing (D3) is right and the
  ticket's original 48px premise was indeed wrong.
- `IconButton.css:98-105` mobile 44px floor sits **after** the base rule. Untouched by this plan. ✔

**(a) Root cause — correct, second cause confirmed, third-ancestor question still open.**

- `theme.css:204` `body { min-height: 100vh }` verified. Your second cause is real and correctly
  diagnosed; the plan covers it (task 2.2).
- `grep -rn "100vh" frontend/src` returns exactly three hits: `theme.css:204`, `App.css:5`, and
  `PipelineDetailPage.css:211` (an unrelated popover `max-height`). No fourth `100vh` in the shell
  chain. No `overflow: hidden` on `html`/`body` anywhere.
- Remaining unanalyzed ancestor: `theme.css:196-200` `html, body, #root { min-height: 100% }` — see
  Change Request 4.

**(b) Decision 2 (structural non-scrolling) — sound.** Verified against the real DOM/CSS chain:
`App.tsx:154` `.app-shell` (flex column) → `CommandBar` (`flex-shrink: 0`) + `App.tsx:165`
`.app-body` (`App.css:164-170`: `flex: 1; min-height: 0`) → `App.tsx:172` `.app-content`
(`App.css:296-300`: `flex: 1; min-height: 0; overflow-y: auto`). Once the shell is bounded by the
visible viewport, the bar cannot translate, and `position: sticky; top: 0` in a non-scrolling
container would indeed be a no-op. `shellStyle` (App.tsx:134-144) only sets a CSS var — it does not
touch height. No objection.

**(c) Height — 56px is fine; the stated clearance is off by the border.** 56px border-box − 1px
`border-bottom` = 55px content box → **5.5px** per side over the 44px floor, not the 6px design.md
claims. That is still 3.7× HEL-745's rejected 1.5px/side and matches the bottom-chrome rhythm
(`App.css:424` reserves the identical `calc(--control-lg + --space-4)`), so I do **not** object to
the height. I do object to the arithmetic being stated wrongly in an artifact that archives into a
spec (CR 10).

**(d) MODIFIED spec blocks — complete.** Diffed both blocks against
`openspec/specs/command-bar-touch-target-framing/spec.md`: requirement bodies are full copies, both
original scenarios ("Mobile command bar height clears the 44px icon floor with margin", "Desktop
command bar height is unchanged", "Mobile command-bar height rule removed") are carried over with
only intended edits, plus two added scenarios. No silent detail loss. ✔

**(e) Token discipline** — no hardcoded colours/spacing/type in the plan; the one `48px` literal is
a non-blocking note below. **No unfounded legibility claim anywhere** — `grep -rni "legib"` across
all artifacts returns only "accepted / unverified / do NOT attempt" framings (proposal.md:48,
design.md:83-94, tasks.md:47). Correctly handled in both directions.

**Probe 1 — the prescribed CSS, measured (headless Chromium, own instance, 430×932, run twice,
identical output both times):**

```
bar A  (tasks 3.1/3.2/3.3 literally: height: calc(--control-lg + --space-4); padding-top: 47px)
  boxHeight 56   computedHeight "56px"   paddingTop "47px"   barTop 0
  content box top = 47, content box height = 8       ← 56 − 47 padding − 1 border
  44px control rect: top 29, bottom 73               ← 18px ABOVE the inset's lower edge (47)

bar B  (padding-top on the base rule, existing mobile `padding: 0 var(--space-3)` shorthand)
  paddingTop "0px"   barTop 56   contentTop 56       ← inset silently discarded at ≤768px
```

**Probe 2 — unit equivalence (same instance, run twice, identical):**

```
viewport 430×932: vh 932  dvh 932  svh 932  lvh 932  (also with iPhone UA + isMobile emulation)
```

### Verdict: REFUTE

The plan is well-researched and its structural reasoning is right, but as written it (i) re-creates
the headline defect on every notched iPhone, (ii) has a second, independent path to a silently inert
inset, and (iii) prescribes a verification strategy that cannot distinguish the fixed build from the
broken one for either failure mode. All ten items below are cheap edits to design.md / tasks.md /
the spec deltas — none of them changes the approach.

### Change Requests

1. **The `height` + `padding-top` pair collapses the bar's content box — the headline defect
   returns.** `theme.css:192-194` sets `* { box-sizing: border-box }` globally (no override anywhere
   in `frontend/src`), so tasks 3.2 + 3.3 as written make `56px` the **border-box** height and the
   inset padding eats it from the inside. Probe 1, bar A: with a 47px inset (iPhone 12/13; it is
   59px on 14 Pro/15/16, i.e. larger than the whole bar) the content box is **8px**, and the 44px
   control renders at `top: 29` — **18px above the inset's lower edge**, i.e. directly under the
   status-bar glyphs, and 17px below the bar's bottom edge into the content area. This violates
   `mobile-app-shell-anchoring`'s own scenario "no interactive control inside the command bar SHALL
   render above the inset's lower edge". design.md Decision 3's claim that "its **content box** keeps
   the 56px height" is false under border-box.
   **Required:** state the exact declaration set in design.md and tasks.md, using the idiom this repo
   already proved at `BottomNav.css:27-28` for the mirror-image problem —
   `height: calc(<bar height> + var(--app-safe-top)); padding-top: var(--app-safe-top);` (i.e.
   `height: var(--app-top-chrome-height)`) — or explicitly opt the bar into `box-sizing: content-box`
   and say why. Do not leave the choice to the executor.

2. **A base-rule `padding-top` is silently zeroed at exactly the breakpoint that needs it.** Task 3.3
   says "add `padding-top: var(--app-safe-top)`" without saying **where**. `App.css:384` already
   declares the shorthand `padding: 0 var(--space-3)` inside the `≤768px` block, which resets
   `padding-top` to `0`. Probe 1, bar B measures `paddingTop: "0px"` and `barTop: 56` at 430px — the
   bar never reaches the physical top and AC-2 fails, with no test in the plan that would notice.
   This is the same cascade-shape failure as HEL-535's cycle-1 defect.
   **Required:** task 3.3 must name the rule the inset padding lands in (mobile block, **after** the
   shorthand) or convert `App.css:384` to `padding-left`/`padding-right` longhands; and task 5.3's
   CSS-lock must assert against **that** rule (note `findRuleBodyInSource` would match the base rule
   at `App.css:39`, not the mobile one).

3. **Two sources of truth for the mobile bar height.** Task 1.2 puts a mobile override on
   `--app-command-bar-height` in `theme.css`; task 3.2 *also* writes `calc(var(--control-lg) +
   var(--space-4))` directly into `App.css`'s mobile block; and the `command-bar-touch-target-framing`
   delta hardens that literal expression into a SHALL for the CSS-lock. If any one of the three
   drifts, `--app-top-chrome-height` reports a height the bar does not have — the exact duplication
   design.md Decision 2 rejects for `position: fixed`.
   **Required:** pick one source of truth (recommended: the token, with `App.css`'s mobile rule
   reading `height: var(--app-top-chrome-height)`), update tasks 1.2/3.1/3.2 to match, and re-word
   the delta's CSS-lock requirement so it pins the rule's **presence and resolved value**, not a
   literal expression the seam may legitimately replace.

4. **`theme.css:196-200` `html, body, #root { min-height: 100% }` is never analyzed — decide it
   explicitly.** A percentage `min-height` on `html` resolves against the initial containing block,
   whose sizing under a dynamic toolbar is UA-dependent (on a UA that sizes the ICB to the *large*
   viewport this rule alone keeps the document taller than `100dvh`, reproducing defect 1 in milder
   form — and Helio ships to Android Chrome too, not only iOS). I could not settle the UA question in
   this environment (probe 2: headless Chromium collapses `vh`/`svh`/`lvh`/`dvh` to one value), which
   is exactly why the plan must not leave it implicit.
   **Required:** add a design.md decision and a task covering this rule — migrate it alongside
   `body` (or delete the now-redundant `html`/`#root` halves), or record the reasoned justification
   for leaving `min-height: 100%` in place.

5. **Task 6.1's "reproduce the defect on the pre-fix build" is not achievable as written, and 6.3/6.4
   have zero discriminating power.** Probe 2: at 430×932, headless Chromium resolves
   `100vh == 100dvh == 100svh == 100lvh == 932px`, with and without iPhone UA + `isMobile`
   emulation. The pre-fix build therefore does **not** scroll the document and the bar does **not**
   move there, so "bar `rect.top` constant across a scroll trace" (6.3) and
   "`scrollHeight <= clientHeight`" (6.4) pass identically **before and after** the fix. As written
   the plan will produce a green-on-both-sides probe and read it as proof.
   **Required:** state in design.md that the `vh`→`dvh` half is not directly reproducible in
   Chromium, and give the executor a concrete emulation recipe for 6.1 — e.g. inject
   `.app-shell { height: calc(100dvh + 60px) }` to model iOS's large-viewport excess, show the probe
   detects it (document scrolls; bar `rect.top` goes negative; controls cross y=0), then verify
   post-fix that no `vh` remains in the shell chain and the invariant holds. Anything that stays
   green in both states is not evidence.

6. **Tasks 6.6 and 6.7 cannot detect the CR-1 failure.** Probe 1, bar A: in the broken state
   `getComputedStyle(bar).height` still reads **"56px"** (Chrome resolves height per `box-sizing`)
   and `getBoundingClientRect().top` is still **0** — so 6.6 ("computed height is 56px") and 6.7
   ("padding-top tracks the inset and surface top is y=0") both **pass** while the controls overprint
   the status bar.
   **Required:** re-specify 6.6/6.7 to assert (i) the bar's **content box**
   (`clientHeight − paddingTop − paddingBottom`) equals the intended bar height, and (ii) for every
   control in the bar, `getBoundingClientRect().top >= <simulated inset>` and `.bottom <=` the bar's
   bottom edge. State the simulated inset values (test at least 47px and 59px) and that 6.7 runs at
   ≤768px (so it also catches CR 2).

7. **Task 6.5 / the delta's "every interactive control ≥44px" is already false on `main` — the plan
   must decide, not the executor mid-flight.** Two mobile-visible command-bar controls are below the
   floor today: `.app-command-bar__mobile-title` (`App.css:336-349`) has no `min-height` and renders
   at roughly text-line height (`--text-sm` 14px × 1.5 ≈ 21px) — and it is the *primary* phone
   navigation affordance; and `.user-menu__trigger` (`UserMenu.css:1-15`) is `--control-sm` (28px)
   at all widths, since `UserMenu.css:137-140`'s 44px floor covers `.user-menu__item` (the popover
   rows) only, not the trigger. The `command-bar-touch-target-framing` delta turns this into an
   archived SHALL that fails on first measurement.
   **Required:** either add tasks raising both controls to the 44px floor (in scope: they are
   command-bar tap targets and the ticket AC says "every interactive control still ≥44px"), or
   narrow the delta's scenario to the icon-button controls and file the two gaps as a spinoff. Say
   which, in design.md.

8. **`black-translucent` is a global switch but only the command bar is treated.** Once
   `index.html:14` flips, every full-viewport mobile surface renders under the status bar, not just
   the shell. `PanelDetailModal.mobile.css:10-20` gives `.ui-modal.panel-detail-modal`
   `height: 100dvh` at ≤430px (a `<dialog>`, so it starts at y=0) with `Modal.css:111-119`'s header
   at `padding: var(--space-4) …` — its title and close button land at y≈16-60px, under the glyphs,
   on the surface a phone user reaches by tapping any panel. (`.auth-page`, `auth.css:1-10`, is
   centred with `min-height: 100dvh`, so it is plausibly safe — but nobody has said so.)
   **Required:** add a task that audits every full-viewport/top-anchored mobile surface against the
   new meta and records the outcome per surface — treat with `--app-safe-top` (this is what the seam
   is for) or document why it is exempt. At minimum `PanelDetailModal` mobile must be resolved before
   this ships.

9. **Task 3.4's glyph reduction is under-specified and would land inconsistent icon sizes.** The bar
   mixes two icon systems: FontAwesome glyphs inside `IconButton` (`CommandBar.tsx:183/230/245`),
   which are `1em` and *do* follow a scoped `font-size`; and a Lucide `<ChevronDown size={16} />`
   (`CommandBar.tsx:168`) that renders literal `width`/`height` attributes and will **not** follow it.
   Stepping the FA glyphs to `--text-sm` (14px) while the chevron stays 16px is a visible mismatch in
   a 56px bar, and 14px glyphs in 44px tap boxes read timid next to the rest of the app's chrome.
   **Required:** name the exact selector and type token in tasks.md, state which glyphs it affects
   and what happens to the Lucide chevron — or drop the glyph reduction (the ticket's height
   reduction already delivers the reclaimed space) and say so explicitly.

10. **Fix the numbers that archive into the spec.** design.md Decision 3 ("its content box keeps the
    56px height") is false (CR 1); Decision 4's "6px clearance per side" is 5.5px once the 1px
    `border-bottom` is counted; and the delta's scenario "`.app-command-bar`'s rendered **content-box**
    height SHALL be 56px" is both wrong today (55px) and will be wrong differently once the inset is
    folded into the height per CR 1.
    **Required:** restate all three against one measurable box — e.g. "border-box height SHALL be
    56px plus the top safe-area inset; the content box SHALL be ≥44px + visible clearance on both
    sides" — so the final gate has an unambiguous, satisfiable assertion.

### Non-blocking notes

- **Design judgment on the height: no objection.** 56px matches `App.css:424`'s bottom-chrome
  reservation (`calc(--control-lg + --space-4)`), is the conventional phone app-bar height, and keeps
  the tap boxes untouched. 5.5px/side is tighter than today's 9.5px but does not read as cramped
  given the bar's only vertical content is the 44px tap boxes. The D1 "symmetry is
  intentional-at-this-moment, not an invariant" framing is well handled and correctly decoupled from
  `--bottom-nav-height`.
- `--app-command-bar-height: 48px` (task 1.2) hardcodes a value `--space-9` (48px) already provides;
  DESIGN.md §3 says "never hardcode a value a token exists for". `theme.css`'s own `--control-md:
  32px` is precedent for literals in `:root`, so this is defensible — but prefer `var(--space-9)`, or
  add a one-line comment saying why a literal.
- Task 6.2 measures numbers only. Add "capture screenshots at 430 and 375 in both themes" so the
  final gate has something to exercise visual judgment on — cramping and glyph-size mismatch (CR 9)
  will not show up in a rect trace.
- `ticket.md:58` (Scope) still reads "Verify the status-bar glyphs remain legible against the bar in
  both themes" — retired by D2/AC-5. Worth striking for the same reason D3 corrected the 48px
  premise: so the archived artifact does not preserve a requirement nobody is allowed to meet.
- Artifacts are otherwise clean: no TODO/TBD/placeholders, no scope drift, every AC traced to at
  least one task, no API/schema/contract surface touched, and the HEL-774 fence (`App.css:424`,
  `BottomNav.*`) is stated in all three of proposal/design/tasks.
- Environment note (not a blocker for this gate): this worktree's `scripts/concertino/` predates
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh` (branch point `d7815d15`; those
  scripts exist on `main`). I ran the canonical `next-report-number.sh` from the main checkout
  against this change directory; it is a pure scan of the directory passed to it.
