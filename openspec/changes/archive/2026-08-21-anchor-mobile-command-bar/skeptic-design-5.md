## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Cold review of `openspec/changes/anchor-mobile-command-bar/` against the real files in this worktree
(HEAD `d7815d15`) and against my own headless-Chromium harness, launched by me
(`playwright@1.55.1` required from the main checkout's `node_modules` — this worktree has none; the
shared MCP Playwright session was never touched, `cleanup.sh` was never invoked, and nothing was
written anywhere except this report).

I read `skeptic-design-1..4.md` and treated all 26 prior change requests as **claims to re-verify**.
I re-derived every load-bearing number myself rather than accepting round 4's; where my numbers agree
with round 4's, that is independent reproduction, not citation.

**Harness.** A build script string-transforms this worktree's real `theme.css` / `App.css` /
`UserMenu.css` into the planned build by applying exactly the edits tasks 1.1-1.4, 2.1-2.3, 3.1-3.5,
4.1-4.7 prescribe — 8 replacements, each guarded to match **exactly once** (the guard fired clean) —
plus a deliberately broken variant (`gap8`: task 4.7 omitted) and an untouched `main` baseline. It
links the real `IconButton.css` / `Popover.css` / `SaveStateIndicator.css` and renders a DOM mirroring
`App.tsx:145-175` + `CommandBar.tsx:116-261` in three real states (dashboard, `/chat`,
dashboard-with-unsaved-changes). 36 measurement cases (3 variants x 2 widths x 3 states x 2 insets)
were run **twice in separate browser instances: byte-identical output, zero diffs**, so nothing below
rests on a single anomalous reading.

---

### What I verified (with evidence)

**(a) Task 7.11 discriminates — decisively — and 7.7's new filter is correct, including the dirty
state that broke the old one.** Both of this round's rewritten checks were the point of the review, so
I implemented each three different ways and ran them on the correct and the broken build:

```
elementFromPoint hit extent, horizontal (containment: hit===el || el.contains(hit))
                             0.25px step   1px step   binary search to 1e-3
planned  Refine / Assistant       43.75         43            43.999
planned  Account menu             44.50         43            44.984
gap8     Refine / Assistant       35.75         35            35.999     <- goes red, as required
gap8     Account menu             44.50         43            44.984
```

Identical at 430x932 and 375x812, dashboard and dirty states, both runs. So: **7.11 does go red with
the gap forced back to `var(--space-2)`** (a ~8px margin — this is a strong, not a marginal,
discriminator), and it is measuring the right quantity. See non-blocking note 1 for the one
calibration detail: the literal `>= 44` threshold, not the method.

Task 7.7's filter, measured in the exact state that broke the old one (`state=dirty`, i.e. the
`SaveStateIndicator` rendering its "Save now" button):

```
430, dirty:  querySelectorAll("a, button") -> 9
             old filter (display !== "none") -> 7   (includes "Save now" 0x0 and the appearance-editor button 0x0)
             new filter (getClientRects().length > 0) -> 5   (both 0x0 buttons correctly dropped)
430/375, clean: all 8 -> old 6 -> new 5
```

`.app-command-bar .save-state-indicator` and `.dashboard-appearance-editor` are the `display: none`
ancestors (`App.css:406-410`); their descendant buttons still compute `display: inline-flex`, which is
why the old filter kept them. `getClientRects().length > 0` drops both at 430 and 375, inset 0 and 47.
**Round 4's CR 2 is genuinely fixed, not papered over.**

**(b) 7.7 / 7.8 / 7.9 / 7.10 are a consistent set — the `max(border-box, sized ::after)` rule removes
the contradiction rather than hiding it.** Measured on the planned build, every enumerated control:

```
430 dashboard, inset 0        border-box     ::after    7.8 max()   7.10 painted box
  Helio home (a)              63.25 x 44      none      63.25 x 44   n/a (unpainted)
  Switch dashboards (button) 161.16 x 44      none     161.16 x 44   n/a (unpainted)
  Refine with AI                 28 x 28    44 x 44        44 x 44   28 x 28  OK
  Open assistant                 28 x 28    44 x 44        44 x 44   28 x 28  OK
  Account menu                   28 x 28    44 x 44        44 x 44   28 x 28  OK
/chat: New chat (size="xs")       28 x 28    44 x 44        44 x 44   28 x 28  OK
```

7.8 is satisfied by the `::after` for painted controls and by the box for unpainted ones; 7.10's "still
28px" is a statement about a *different* quantity and is simultaneously true. There is no reading under
which one falsifies the other — the contradiction round 4 found in the old 7.9/7.10 pair is gone.
`.app-command-bar__mobile-new-chat` measures 28x28, exactly as Decision 8c now says.

**(c) Task 6.10's gap lock can fail, and the geometry it protects is exactly as Decision 8b now
states.** I built `gap8` precisely as "task 4.7 omitted" and measured the right-hand hit regions:

```
planned @430  294.00..338.00 | 338.00..382.00 | 382.00..426.00   abut exactly, 0 overlap, 4px inside the viewport
planned @375  239.00..283.00 | 283.00..327.00 | 327.00..371.00
gap8    @430  310.00..354.00 | 346.00..390.00 | 382.00..426.00   8px region-vs-region overlap
```

In `gap8`, region 1 ends at 354.00 and painted box 2 *starts* at 354.00 — they touch but never overlap,
which is why neighbour-painted-box sampling cannot see the defect. **Decision 8b's corrected mechanism
sentence ("the expanders overlap each other, never a neighbour's painted box") is exactly right.**
`gap: var(--space-4)` is a literal string in the `<=768px` block, so a `findMediaBlock` +
`findRuleBody(".app-command-bar__right")` lock fails loudly when the declaration is removed or the
value changes; `.app-command-bar__right` occurs exactly once inside that block, so the first-match
hazard does not bite here. It is a real, failable guard.

**(d) Decision 8b's corrected width arithmetic, re-derived independently:**

```
                        main    planned    gap8
.app-command-bar__right  132       116      100
mobile title text @375  99.47    113.84   128.22
bar border-box / content  64/63    56/55    56/55
```

The right group **narrows 132 -> 116** and the title's usable text width at 375 goes **99 -> 114**,
exactly as design.md now says (and the sign is now the right way round). Visible in the screenshots:
`main` truncates to "Helio News …", `planned` to "Helio News Ov…".

**(e) The seam, the border-box arithmetic and the padding longhands all behave as designed.**

```
planned @430, --app-safe-top overridden on :root
  inset 0:   rect.top 0   border-box 56    padding-top 0px    content box 55
  inset 47:  rect.top 0   border-box 103   padding-top 47px   content box 55   (= 56 + 47)
  every control: top 52.5 >= 47, bottom 96.5 <= 102 (content edge)
  --app-top-chrome-height recomputed to calc(calc(40px + 1rem) + 47px) when --app-safe-top was
  overridden ON :root -> Decision 4's "the override must sit on :root" is mechanically confirmed
```

Content box 55px = 56 - the 1px `border-bottom`, giving **exactly 5.5px** clearance per side over the
44px floor (measured control top 5.5 / bottom 49.5 in a 0..55 box) — Decision 5's corrected number, to
the pixel. Tokens resolve: `--control-lg: 40px` + `--space-4: 1rem` = 56px (`theme.css:50,61`);
`--space-9: 48px`; `--space-10: 64px`; `--control-sm: 28px`.

**(f) Desktop is untouched, and the breakpoint edge is clean.**

```
@769 and @1280, main vs planned: bar 48 / content 47 / padding 0px,20px / icon buttons 28x28 /
  ::after content: none / right-group width 302.34 — identical in every field
@768: bar 56, ::after 44x44   @769: bar 48, no ::after
```

**(g) Scroll ownership, and the repro probe's discrimination.**

```
planned, no injection: docScrolls false, scrollHeight 932 == clientHeight, .app-content owns the
                       scroll, bar rect.top 0 at scrollTop 0/100/400/900/1500/max
planned, task 7.1 injection (.app-shell { height: calc(100dvh + 60px) }):
                       docScrolls true, scrollHeight 992, bar rect.top -60, min control top -54.5
viewport units in this Chromium: 100vh == 100dvh == 100svh == 100lvh == 932
```

So the plan's central honesty — "a naive before/after proves nothing in Chromium, the injection is the
probe" — is correct, and the injection really does detect.

**(h) Archive accuracy.** Both MODIFIED requirement headers and all three pre-existing scenario names
are byte-identical to `openspec/specs/command-bar-touch-target-framing/spec.md:6,12,17,21,28` (I
diffed the header lines with `cat -A`), so the CSS-lock scenario now modifies in place and nothing
stale survives the merge — round 4's CR 5 resolved. `openspec validate anchor-mobile-command-bar
--strict` -> "Change 'anchor-mobile-command-bar' is valid" (run by me). No `TODO`/`TBD`/placeholder in
any artifact. The delta's testable claims all hold on first measurement: content box 55px, desktop
47px, border-box = height + inset, painted box at `--control-sm`, and "no control's hit region overlaps
a neighbouring control's **painted box**" (true even in `gap8`, which is why that bullet is a weaker
companion to — not a substitute for — the "reachable across 44px as measured in the browser" bullet
that 7.11 now backs). One stale prose clause: non-blocking note 3.

**(i) The re-scoped legibility criterion, handled correctly in both directions.** Every `grep -rniE
"legib"` hit across `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both deltas and
`workflow-state.md` is a "retired / accepted-unverified / no role may claim it / do NOT attempt"
framing. **There is no legibility claim anywhere, and I make none.** My screenshots paint a synthetic
white-glyph strip over the inset purely to inspect *layout* under a claimed inset; that is not
evidence about iOS status-bar rendering and I draw no conclusion from it.

**(j) Enumeration completeness — I went looking for a sixth control and found none.** Reading
`CommandBar.tsx` for every render branch, the complete set of `a`/`button` descendants of the bar is:
logo link (always), mobile title (`pickerId !== "other"`), `__mobile-new-chat` (`pickerId === "chat"`),
"Save now" (dashboard view + dirty, `display:none` at mobile), undo + redo (dashboard view,
`display:none` at mobile), appearance-editor trigger (dashboard view, `display:none` at mobile),
"Refine with AI" (dashboard view + a selected dashboard), "Open assistant" (not on `/chat`), and the
`UserMenu` trigger (authenticated). The mutually exclusive route gates mean **at most 5 are visible at
once at <=768px** (logo, title, refine, assistant, avatar — which is what the DOM enumeration
returned). `UserMenu`'s panel is `createPortal`'d out of the bar, so an open menu cannot pollute the
enumeration; the appearance editor's scrim button is inside the bar's DOM but the whole editor is
`display:none` at mobile so it can never be opened there. The only structural blind spot left is that
`"a, button"` would miss a future `input`/`[role=button]` control — there is none today.

**(k) The `black-translucent` surface audit is complete.** I independently enumerated every
`position: fixed` rule in `frontend/src` (10 files) and classified each: `MobileNavSheet` sheet
(bottom-anchored, `max-height: 70dvh`), `toast.css`, `PanelList.css` FAB — bottom-anchored, exempt by
construction; `Popover.css` / `inputs.css` / `PipelineDetailPage.css` panels — portalled and
JS-positioned from a trigger that is itself below the inset, with only transparent `inset: 0` scrims;
`Modal.css` (task 5.5 demands an explicit verdict), `RefinementChatDrawer.css:28-33` (`top: 0`, in task
5.4), `App.css`'s `.app-skip-link` (in task 5.4), `PanelDetailModal.mobile.css` (task 5.3). **No
top-anchored surface is missing from tasks §5.**

**(l) Every line reference I checked resolves.** `App.css:5,40,44,49,61-67,111-116,296/300,336,383,384,
391,406-410,424,432`; `theme.css:47-61,192-194,196-200,204`; `IconButton.css:40-50,98-105`;
`UserMenu.css:5-6,137`; `CommandBar.tsx:120,181-190`; `Modal.css:11,111`; `auth.css:6,242`;
`PanelDetailModal.mobile.css:14`; `App.css.test.ts:92`. The two stale references I did find are task
numbers, not file lines — note 2.

**(m) Design judgment — mine, formed from screenshots, and I endorse the result.** 24 screenshots at
430 and 375, light and dark, insets 0 and 47, `main` vs planned, dashboard and `/chat`
(`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/r5/shots/`).
Today's mobile bar puts two heavy 44px bordered squares next to a 28px avatar in a 64px band — the
squares are the visually loudest objects in the whole chrome, on the one surface a phone user sees
first. The planned bar is an even 28-28-28 trio on a 16px rhythm inside a 56px band: the right group
reads as one deliberate cluster instead of "two big buttons and a straggler", the controls now match
the same primitives' desktop rendering (so the app is *more* consistent across breakpoints, not less),
and because the group is 16px narrower the title breathes rather than truncating early. It does not
read sparse or cramped: 13.5px of air above and below a 28px control in a 55px content box is the same
optical rhythm the rest of the chrome uses. Light and dark are structurally identical, hairline borders
survive in both. On `/chat`, the `size="xs"` "New chat" button floored to 28px sits correctly beside
the 28px avatar — mixing 24 and 28 there would have been worse. "Too small to look tappable" is the
fair worry and my answer is no: the affordance is the one this app already ships on every desktop
surface, and the hit area measures 44px. **No objection; no judgment note against the 28px call.**

---

### Verdict: CONFIRM

The design survived every probe I aimed at it, and — the specific thing this round was for — **both
rewritten checks now return the right answer**: 7.7's visibility filter is correct in the dirty state
that broke its predecessor, and 7.11 goes red (35.75) on the deliberately broken build while the
correct build measures 43.75-44.0. Round 4's five change requests are all genuinely applied, verified
by re-measurement rather than by reading the claims. Nothing in either delta archives a false claim;
the one stale sentence I found (note 3) is prose whose operative SHALL is correct and whose behaviour
is governed by a scenario that is accurate. The four remaining items are one-line edits with no design
impact, all of which fail *loudly* rather than silently, so none can ship a defect.

---

### Non-blocking notes

1. **Calibrate 7.11's threshold before running it — and do NOT "fix" a sub-44 reading in the CSS.**
   Because the hit regions *abut exactly* (that is the design), the last sample point that still
   belongs to a control is one sampling step short of its boundary, so a literal `>= 44` reads red on a
   **correct** build for any control that has a neighbour: 43.75 at a 0.25px step, 43.0 at 1px, 43.999
   under a binary search to 1e-3. The avatar (nothing competes to its right) reads 44.5/44.98, so
   expect a split result. Suggested: assert `>= 44 - samplingStep` (or `>= 43.5`) and record the
   expected pair — **~43.75 correct vs ~35.75 broken, an 8px separation**. The trap to avoid: widening
   the gap past `var(--space-4)` to push the number over 44 would break the exact tiling in Decision 8b
   and re-widen the right group. 16px is right; the threshold is what needs the epsilon.
2. **Two stale task cross-references in `design.md`, left by the renumbering.** Line 129 ends "the guard
   must bisect each control's real hit extent (tasks 7.12, 6.13)" — under the current numbering those
   are the scroll trace and a task that does not exist; it should read **7.11 and 6.10**. Line 106
   ("It is in the set task 7.11 asserts") most likely means **7.10**, the task that actually names
   `.app-command-bar__mobile-new-chat` (it happens to also be true of 7.11, so this one is harmless).
3. **One stale clause in the MODIFIED requirement body.** `specs/command-bar-touch-target-framing/
   spec.md:10-11` still ends "...only the rendered icon glyph size may be reduced" — a leftover from the
   glyph reduction Decision 10 *dropped*. What the change actually reduces is the painted box (44 -> 28),
   and it reduces no glyph at all; the requirement's own third scenario ("Reaching the floor never
   enlarges a painted control") is what governs. The operative SHALL before the semicolon is correct
   and is met, so this is prose cleanup, but it is the sentence a future reader would use to argue the
   28px box was out of spec. Suggest ending the sentence at "...below the 44px tap-target floor."
4. **The HEL-745 comment inside the mobile `.app-command-bar` rule (`App.css:377-382`) documents the
   declaration task 3.5 deletes** — it explains `--space-10 (64px)` and "10px clearance per side", both
   untrue after this change, and no task updates it. Two consequences: the file archives a false
   comment, and task 6.6's "declares no `height`" regex will match the literal text `height: 48px`
   *inside that comment* unless it is declaration-aware (a loud false red, not a false green). Rewrite
   the comment to explain the seam, or strip comments before the 6.6 assertion.
5. **`DESIGN.md`'s Control-metrics section names `min-height`/`min-width: 44px` as *the* phone tap-floor
   mechanism** (`DESIGN.md:128-131`). This change introduces a second, deliberately different mechanism
   (a sized `::after`) for painted command-bar controls. `design.md` 8a explains why and warns against
   "correcting" it, but `DESIGN.md` itself will not — a one-line addition there would close the loop.
   Judgment call on scope for a bug ticket; I would not block on it either way.
6. Observations, no action: the gap widening is a no-op on `/chat`, where the right group holds only the
   avatar; and the 44px expander is a fixed literal while the gap that makes it tile is `1rem`, so a
   non-default root font-size would shrink the gap below the expander's reach (today's `--space-2` has
   the same property, and 44px is DESIGN.md's sanctioned literal).
7. Environment (same as rounds 1-4): this worktree's `scripts/concertino/` predates
   `next-report-number.sh` and it has no `node_modules/playwright`. I ran the canonical
   `next-report-number.sh` from the main checkout against this change directory, and required
   `playwright` from the main checkout's `node_modules`. The MCP Playwright session was not used, no
   other worktree was read or written, and `cleanup.sh` was not invoked.
