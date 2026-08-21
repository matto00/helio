## Skeptic Report — design gate (round 4, skeptic-design-4.md)

I am a fresh agent. Rounds 1-3, the run brief, and the revised `design.md` narrative were read as
**claims to check**, never as facts. Every number below comes from a file I read in this worktree /
on `origin/main`, from arithmetic I implemented myself in Node, or from pixels I rendered in **my own
headless Chromium** (`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, driven by the
repo's `playwright@1.55.1`). The shared MCP Playwright session was not touched. Every rendered
finding below was produced by two independent script runs.

Screenshots and raw data retained at
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/hel774/`.

---

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mobile-bottom-nav/spec.md`, `workflow-state.md`, `skeptic-design-1/2/3.md`.
**Ground truth read:** `frontend/src/theme/theme.css` (this branch + `origin/main`), `theme.ts`,
`BottomNav.css`, `BottomNav.tsx`, `BottomNav.test.tsx`, `sections.ts`, `navDestinations.ts`,
`navDestinations.test.ts`, `sections.test.ts`, `App.css`, `PanelList.css`, `MobileShell.tsx`,
`DESIGN.md` §0.2 / §3 / §8, `lucide-react@1.14.0`'s `Icon.mjs` / `createLucideIcon.mjs` / icon nodes.

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Branch base `d7815d15`; only the untracked change dir present | True | `git status --porcelain`, `git log --oneline -1` |
| `origin/main` = `2eaf1d26` (HEL-535 / PR #408 merged); `--bottom-nav-height` at `theme.css:90`; sole consumer `toast.css:25` | True | `git show origin/main:...` |
| The same 56px expression is still inlined at `BottomNav.css:27` and `App.css:424` (D5's three-copy claim) | True | files read |
| `PanelList.css:79-96` fixed `z-index: 10`, hidden only below 430px (`:167-171`) — D10 | True | file read |
| `Shapes` exists in the installed `lucide-react` 1.14.0 (as do the rejected `Boxes`/`Braces`/`Table2`/`Library`); `BookOpen` is referenced only by `sections.ts` | True | `node -e require('lucide-react')`, `grep -rn BookOpen` |
| No test pins Data Types' icon identity (task 4.2's conditional is correctly conditional) | True | `navDestinations.test.ts` asserts only *distinctness*; `sections.test.ts` has no icon assertion |
| **HEL-554** is real, **Backlog**, parent **HEL-349**, and its scope is literally teaching source->pipeline->type->panel | True | Linear `get_issue HEL-554` |
| No ancestor establishes a backdrop root / filter that would break `backdrop-filter` | True | `.app-shell` has only `position: relative; z-index: 1`; no `transform`/`filter` in `App.css` on the chain |
| `openspec validate liquid-glass-bottom-nav --strict` | Passes | `Change 'liquid-glass-bottom-nav' is valid` |
| Task coverage traces to all ten ticket ACs | True | walked each AC -> task(s) |

#### The load-bearing new arithmetic — re-derived independently, then re-measured in pixels

I re-implemented the composite model from scratch (sRGB gamma-space compositing `a*tint + (1-a)*backdrop`,
WCAG relative luminance), worst case over {theme-matched `--app-bg`, white, black, all 8 accent presets,
per-theme default accent} x {dark, light}, then **rendered the specified material** (capsule
`left/right/bottom: 12px`, `height: 56px`, `border-radius: 9999px`, `padding: 0 8px`, `blur(12px)`,
a `::before` tint of `--app-surface` at `opacity: .55` with `z-index: -1`, `--app-shadow-soft`,
`--app-border-strong`; lozenge fill `color-mix(--app-surface 95%, transparent)` + `1px solid var(--app-text)`)
with the **real** lucide icon nodes at 22px, and sampled composited pixels through a canvas.

| quantity | design.md claims | my model | my rendered pixels |
| --- | --- | --- | --- |
| inactive icon (`--app-text`) vs capsule, alpha 0.55 | 3.44 dark / 4.89 light | **3.44 / 4.89** | **3.43 / 4.91** |
| lozenge border (`var(--app-text)`, full strength) vs capsule | 3.44 / 4.89 | **3.44 / 4.89** | **3.43 / 4.86** |
| `--app-text-muted` vs capsule | 1.31 / 1.68 | **1.31 / 1.68** | — |
| both numbers at alpha 0.51 | 3.03 / 3.03 | **3.03 dark** (4.27 light) | — |
| a 70% `color-mix` border at alpha 0.55 | 2.50 | **2.50 dark** (3.11 light) | — |
| lozenge FILL vs capsule, theme-matched | ~1.01 | 1.03 dark / 1.01 light | **1.03 / 1.04** |
| accent icon on lozenge vs today's opaque `--app-surface` | dark drop <= 0.49, min 4.24; light move <= 0.18, min 1.78 | **max drop 0.49, min 4.24 / max move 0.18, min 1.78** | — |
| capsule edge vs page at `--app-border-strong`, theme-matched | ~1.42 (light) | — | **1.44 light / 1.64 dark** |
| min alpha for a 4.5:1 floor | 0.6322 / 0.5252 | **0.6322 / 0.5252** | — |
| min alpha for a 3:1 floor | ~0.51 | **0.5062 / 0.4122** | — |

**Every figure the planner published reproduces**, in closed form and again in rendered pixels, to
within 0.05. Specifically:

- **"One number governs both the border and the inactive icon" is TRUE, and for the stated reason.**
  A full-strength `var(--app-text)` border is fully opaque, so its rendered pixel is `--app-text`
  exactly — identical to the icon stroke, over the same composite. Rendered: 3.43 vs 3.43 (dark/white),
  4.86 vs 4.91 (light/black; the 0.05 is antialiasing on the 2px icon stroke, in the icon's favour).
- **0.55 genuinely has the claimed headroom.** Worst rendered case is 3.43:1 against a 3:1 floor —
  0.43 of headroom (design.md says ~0.44). Rendered-vs-modelled divergence at 0.55 measured **0.01**,
  not the 0.03 round 3 saw, so the margin argument for 0.55-over-0.51 holds with room to spare.
- **D4's transmissivity table is right** (0.65 -> 35%, 0.55 -> 45%), and D4 now records the *real*
  basis (WCAG 1.4.3 4.5:1 vs 1.4.11 3:1) and explicitly flags its own earlier claim as circular.
  Round 3's CR4 is properly discharged.
- Round 2's and round 3's convergence analyses reproduce: over theme-matched backdrops the fill is
  invisible (1.03-1.04:1) while the border reads 15.7-16.9:1; over theme-mismatched extremes the
  border is weakest (3.43/4.86) while the fill carries 3.19-4.26:1. The two really are complementary,
  and task 5.6's widened matrix is the right matrix.

#### Round 3's checklist

| Item | Status |
| --- | --- |
| **CR1** paint model / widened matrix / sampling rule | **Structurally resolved, rationale now false.** `background-clip: padding-box` is stated in D6 + task 3.8; task 5.6's matrix includes the theme-mismatched extremes + an accent backdrop; the straight-top-edge sampling rule is stated; `spec.md`'s scenario is widened to match. But with the border now full-strength opaque, padding-box makes **zero** measured difference (see CR2). |
| **CR2** lozenge box unspecified | **Half resolved.** Padding/radius/relative size are now specified and the rendered result does read as an inner lozenge (AC 4 satisfied — see screenshots). The **carrier element** is still unspecified, and the only element that exists today makes the specified box unrealisable. -> **CR1 below.** |
| **CR3** capsule hairline unspecified | **Resolved.** `--app-border-strong` named in task 3.6 + Risks; capsule-edge evidence added to task 5.5. My rendered light-theme figure (1.44:1) matches the recorded ~1.42:1. |
| **CR4** circular labels justification | **Resolved by the PO decision, and recorded truthfully.** D4 states the real basis and names the earlier claim as circular. |
| notes: stale `theme.css:86`; task 2.4 measured numbers; task 5.2 pill probe `(left + height/4, top)`; task 5.7 pseudo-element read; motion-may-not-exist; task 3.8's `--app-surface-strong` aside; task 2.5 border-vocabulary call-out | **All folded in and all correct as restated.** (`theme.css:86` is gone; `design.md` is now line-number-free except the accurate `theme.css:90` in Risks.) |

#### UI / design judgment (my own renders, DPR 3, 375x812, both themes)

I rendered the planned bar over five backdrops per theme and looked at every one.

- **Over a photo, both themes, it genuinely reads as the reference.** The copper, green, white and
  blue of the synthesised image transmit clearly through the capsule; glyphs stay solid; the pill
  floats. This is the case the ticket's AC 3 is about and the plan passes it convincingly.
- **Over theme-matched backdrops (the default, five of six destinations) it reads as a clean floating
  pill.** Figure-ground rests entirely on the hairline + shadow, as the Risks section says; at
  `--app-border-strong` the edge is present but quiet (1.44 light / 1.64 dark).
- **Over theme-mismatched extremes it degrades to a flat mid-grey slab** (dark/white composite
  `rgb(129,128,127)`). Not "glass" any more — but there is no content to lose behind a flat colour,
  and every AC still measures pass. I do not consider this a ship-blocker.
- **The active indicator is a real, recorded divergence from Instagram — and I judge it acceptable.**
  A full-strength ink hairline reads as an *outlined chip*, not as the reference's soft, borderless,
  lighter-than-bar patch; in dark-over-white it is an almost-black chip with a white ring, i.e. the
  inverse of the reference's direction. But I verified the plan's claim that no borderless neutral
  fill can clear 3:1 over hostile backdrops (measured: fill converges to 1.01-1.04:1 exactly where the
  border is strongest), D6 records the divergence explicitly rather than pretending otherwise, and the
  rendered result is crisp and consistent with Helio's warm-neutral / scarce-accent language. **This
  is not a REFUTE on fidelity grounds.** One honest consequence for the final gate: the lozenge ring
  (3.43:1 vs the capsule) is now the strongest edge anywhere in the bar, several times stronger than
  the capsule's own (1.44-1.64:1).
- **Icons.** `LayoutDashboard`, `Database`, `ChartNoAxesColumn`, `MessageCircle` read conventionally
  at 22px. D11's diagnosis of `BookOpen` is correct — rendered at 22px it is unmistakably a book, and
  it is a dead end without a label. `Shapes` is a real improvement for a type registry. `Workflow` is
  abstract but conventional enough. Residual ambiguities are noted below, not blocking.
- **The `sections.ts` scope widening is justified.** The icon reaches the desktop sidebar, which keeps
  its labels, so the change is cosmetic there and corrective here; splitting it would leave the two
  surfaces on different glyphs and breach exactly the single-source-of-truth guarantee
  `navDestinations.ts` exists to enforce. A spinoff would be worse. D11 argues this correctly.

---

### Verdict: REFUTE

This is the closest the plan has come. Every published number reproduces — twice, in two independent
models and again in rendered pixels — the PO's decision is recorded truthfully with the real basis,
the mitigation (HEL-554) is real, the widened verification matrices are the right ones, and the
rendered bar is good design. Nothing below questions the premise, the alpha, the floor, or the
icon-only call.

It fails on **one realisability hole** and **two false statements in the artifact that records the
reasoning** — plus one visual defect the reshape creates that no task mentions. All four are edits of
one to three lines each. **I am confident one more round converges. Nothing here needs the product
owner.**

---

### Change Requests

**1. [BLOCKING — the only structural one] The lozenge's carrier element is unspecified, and on the
only element that exists today the specified CSS deletes the active icon.**

Task 3.8 says "Add the active lozenge **around the active tab's icon only**: `padding: var(--space-1)
var(--space-3)` ... 1px solid `var(--app-text)` border". `BottomNav.tsx:29` renders the lucide SVG
directly, with no wrapper; `theme.css:192-194` applies `* { box-sizing: border-box }` globally; and
`lucide-react`'s `Icon.mjs` emits `width={size} height={size}` as **SVG presentation attributes**
(verified in `dist/esm/Icon.mjs`), which become the used CSS width/height. So the literal
implementation —

```css
.bottom-nav__tab--active .bottom-nav__icon { padding: var(--space-1) var(--space-3); border: 1px solid var(--app-text); ... }
```

— gives a border-box of width 22px with 24px of padding + 2px of border, clamping the **content box to
0px wide**. Measured: `getBoundingClientRect()` = **26x22**, `getComputedStyle().width` = `26px`.
Rendered (`lozvariant-svg.png`): **an empty ring with no glyph inside it.** Reproduced on two separate
script runs. With a wrapper element it renders correctly at **48x32** (`lozvariant-wrap.png`,
`shot-*-planned.png`).

No verification task catches this:

- Task 5.5 measures "every icon **governed by the floor**" — and D1 explicitly puts the active icon
  *outside* the floor ("its legibility does not depend on the translucent material"). The one icon
  that disappears is the one icon excluded from the only pixel-sampling icon task.
- Task 5.6 measures border-vs-capsule, which still reads **3.43:1 and passes** with the glyph gone.
- Task 5.2 measures tab boxes (unaffected); task 4.1 asserts accessible names, which survive because
  the name comes from the link's `aria-label`, not the glyph.

This is the same structural blind spot rounds 2 and 3 found, one layer further in. Required:

1. Name the carrier in D6 and task 3.8 — e.g. wrap the icon in a `<span class="bottom-nav__loz">`
   (which also needs saying in a **`BottomNav.tsx` task**: task 3.10 is the only `.tsx` task and it
   only removes the label span), or state `box-sizing: content-box` on the icon. Either is fine; pick
   one and say it.
2. Correct D6's "~30x46px": with the 1px border the rendered box is **48x32**, leaving ~3.75px to the
   tab's edges and ~11px to the capsule's inner top/bottom (not ~5px/~13px). The conclusion is
   unchanged; the numbers should match what ships.
3. Add one assertion that the **active** icon still renders at its intended size (e.g.
   `getBoundingClientRect()` of the active `.bottom-nav__icon` is 22x22) to task 5.2 or 5.6. Nothing
   currently looks at it.

**2. [BLOCKING — one paragraph] `background-clip: padding-box`'s justification is measurably false
now that the border is full strength, and a test is being written to pin it on that basis.**

`design.md:181-185` says "**Paint model: `background-clip: padding-box`.** This is load-bearing, not a
detail ... the rendered border pixel becomes `0.7*text over (0.95*surface over capsule)` ... that
drops the worst case from 3.26:1 to **2.51:1** (dark/white) and 3.82:1 to **2.58:1** (light/black)".
Task 3.8 repeats it: "without padding-box the fill paints under the border and the measured boundary
falls below the floor."

That is round 3's arithmetic for a **70% `color-mix` border at alpha 0.65** — a design that no longer
exists. A full-strength `var(--app-text)` border is **opaque**, so it occludes whatever the background
paints beneath it and `background-clip` cannot move the border pixel. Measured: I rendered the lozenge
with `background-clip: padding-box` and with the CSS default, across **10** theme x backdrop cells,
and the border-vs-capsule, fill-vs-capsule, inactive-ink and capsule-edge numbers are **identical in
every cell** (e.g. dark/white 3.43:1 both ways; light/black 4.86:1 both ways).

The declaration is harmless — keep it if you like, as insurance against the border ever being weakened
— but `design.md` is the durable artifact and task 4.3 is about to lock it into a regression test on a
false premise. Required: restate D6's paint-model bullet and task 3.8's aside truthfully (padding-box
is **defensive only**; with an opaque border it is a no-op, and the numbers that motivated it belonged
to the retired 70%-mix border at alpha 0.65), and either keep task 4.3's assertion with that reason
recorded or drop it.

**3. [BLOCKING — one word, but it is the single most misreadable line in the document] `design.md:72`'s
D3 heading still says alpha 0.65.**

> `### D3. Tint is --app-surface at alpha 0.65; blur is 12px`

The body of D3, task 3.4, D4's table, the proposal and the ticket all say **0.55**. Alpha is the exact
quantity the product owner's decision moved, and 0.65 vs 0.55 is 35% vs 45% transmissivity — the
property the ticket calls the reference's defining quality. An executor who skims headings ships the
wrong bar and every contrast task still passes. While there: `design.md:189`'s convergence algebra
still reads `C = 0.65*S + 0.35*B` (at 0.55 the dark zero-crossing is `B ~ rgb(53,48,44)`, not
`rgb(60,55,51)`) — the conclusion is unaffected, but it is the same stale-alpha edit.

**4. [BLOCKING-lite — the reshape breaks an existing rule and no task mentions it] The tab's
`:focus-visible` ring breaks straight out of the capsule's rounded ends.**

`BottomNav.css:71-73` is `outline: 2px solid var(--app-accent); outline-offset: -2px` on a
rectangular, full-height tab. Today that sits inside a rectangular full-width strip and is correct.
Inside a 56px pill it is not: the first tab spans x=21..76.5 while the capsule's left boundary at the
tab's top edge is at x~29.6, so the ring's corners render **outside the capsule, over the page**.
Rendered and confirmed (`focus-dark.png`): a hard orange square overhanging the pill's curved end on
three sides.

`DESIGN.md:291-293` is **[mechanical]** here and says the `-2px` inset is for "flush list items" —
"where the ring would clip". A floating capsule inset from every edge is no longer flush, so the
reshape removes the very condition that justified `-2px`. The plan's own instruction is to "preserve
everything already correct in `BottomNav.css`", and this stops being correct at the moment the shape
changes. Nothing in tasks 3.x specifies it and nothing in 5.x focuses a tab.

Required: decide the focus treatment in D6/D7 and give it a task (e.g. `border-radius:
var(--app-radius-pill)` on the tab so the outline follows the shape, or move the ring onto the
lozenge-shaped inner element, or restore the global `+2px` offset for the inner tabs) — and add a
rendered assertion/screenshot of a focused tab to task 5.2 or 5.5. This is cheap, but it is a visible
defect introduced by this change, on a `[mechanical]` DESIGN.md rule, in a change that is *editing*
`DESIGN.md`.

---

### Non-blocking notes

1. **`shortLabel` becomes dead code.** After task 3.10 it has zero consumers: `sections.ts:39,67,75,83,91`
   declares it, `navDestinations.ts:18,26` maps it, and both files' doc comments explicitly explain it
   as existing for "`BottomNav`'s six 72px phone tabs" (F-080) — a surface that will no longer exist.
   `sections.test.ts` does not pin it, so removal is cheap; keeping it is also defensible (future
   labelled surfaces). Either way, record the call, because "leave a stale comment describing a
   removed feature" is what happens if nobody decides.
2. **`Shapes` has its own residual ambiguity, worth naming rather than papering over** (the PO asked
   for exactly this). At 22px it reads cleanly as "kinds of things" — but `Shapes` is also the
   canonical *drawing-tools* glyph in design software, so "shape/draw" is a live misreading. It is
   still clearly better than `BookOpen` and I would ship it; D11 should just say so, the way it says
   so about the rejected alternatives. `Workflow` (two rounded rects + elbow) is abstract and could
   read as "sitemap"/"hierarchy"; acceptable, and there is no better lucide glyph.
3. **At 768px the capsule is 744px wide with 121px tabs** (measured) and reads noticeably stretched —
   six small glyphs marooned in a very long thin pill (`width-768-light.png`). Not a regression
   (today's bar is full-bleed there too) and not in any AC, but a `max-width` + `margin-inline: auto`
   would cost one declaration. Worth a sentence in D4 or a polish note for the final gate.
4. **Tabs measure 54px tall, not 56px** (capsule 56px minus its 1px borders, `align-items: stretch`).
   Comfortably over the 44px floor, but D4/task 5.2's mental model is 56 — harmless, mentioned so the
   executor is not surprised by a 54 in their own assertion output.
5. **The tab's `flex-direction: column; gap: 2px`** (`BottomNav.css:34-38`) becomes vestigial with one
   child. Harmless; tidy it while task 3.10 is in the file.
6. **The ADDED reduced-motion requirement is satisfied vacuously** and that is fine. Task 3.12 is
   right to say "do NOT invent motion in order to have something to disable"; the pre-existing
   `transition: color var(--app-transition)` on the tab is not motion this change adds. Task 5.7
   should be allowed to record "no added transition exists" as a pass.
7. **For the final gate, the two things I would judge hardest**, both already recorded as risks:
   the capsule's edge over a theme-matched backdrop (measured 1.44 light / 1.64 dark — present but
   quiet, and it is the *only* thing separating the bar from the page), and the fact that the active
   lozenge's ring is now the strongest edge in the bar by a factor of ~2.3 over the capsule's own.
   Both are legitimate as designed; both are judgement calls best made from the retained screenshots
   task 5.5 now produces.
8. Credit where due: this is a plan whose arithmetic I could not break. I re-derived every published
   figure two ways and re-measured the load-bearing ones in rendered pixels; they all hold, including
   the non-obvious "one number governs the border and the inactive icon" identity and the
   0.55-over-0.51 headroom argument. The PO's decision is recorded with its real basis rather than
   with a flattering one, the mitigation ticket is real and genuinely on-scope, and the widened
   verification matrices are the ones that actually cover the failure modes.
