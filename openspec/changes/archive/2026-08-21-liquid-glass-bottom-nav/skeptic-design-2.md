## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I am a fresh agent. Every number below is either from a file I read in this worktree / on
`origin/main`, or from arithmetic and a rendered browser measurement I ran myself. Round 1's report
and the revised `design.md` narrative were read as claims to check, not as facts.

### What I verified (with evidence)

**Artifacts read:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/mobile-bottom-nav/spec.md`,
`skeptic-design-1.md`, `workflow-state.md`.

**Codebase / branch facts re-derived:**

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Branch base is `main` @ `d7815d15`, `git diff main...HEAD` empty, only the untracked change dir present | True | `git status --porcelain`, `git log --oneline -3` |
| HEL-535 / PR #408 status | **Changed since round 1 — now MERGED** | `gh pr view 408` → `"state":"MERGED"`; `origin/main` is 1 commit ahead (`2eaf1d26`) |
| `--bottom-nav-height` absent on this branch, present on `origin/main` | True | `grep -rn -- "--bottom-nav-height" frontend/src` → nothing here; `git show origin/main:frontend/src/theme/theme.css` → **line 90** (not 86 — see note) |
| The same expression is inlined **three** times | True | `origin/main`: `theme.css:90`, `BottomNav.css:27`, `App.css:424`; only consumer of the token is `toast.css:25` |
| `toast.css:25` = `bottom: calc(var(--bottom-nav-height) + var(--space-4))` | True | `git show origin/main:frontend/src/shared/ui/toast.css` |
| `BottomNav.css` current state (lines 21-23 comment, `:27` height, `:28` `padding-bottom: env()`, `--app-text-muted` inactive, `--app-accent` active on the whole tab, `min-width/min-height: 44px`, label `text-overflow: ellipsis`) | True | full file read |
| `PanelList.css:79-96` fixed zoom widget `z-index: 10`, hidden only below **430px** (`:167-171`) | True | file read |
| `DESIGN.md` §0.2 principle 2 + the overlay-scrim carve-out prose shape | True | `DESIGN.md:34-37`, `DESIGN.md:97-113` |
| Token values used in every calculation below | True | `theme.css:102/105/107/108/115` (dark), `:149/152/154/159/164` (light), `:101/148` (`--app-bg`), `:25` (`--text-micro` 10px), `:48-50` (`--space-2/3/4`), `:61` (`--control-lg`), `:67` (`--app-radius-pill`) |
| Longest short labels are "Pipelines"/"Assistant" (9 chars) | True | `sections.ts:67-91` shortLabels Home/Sources/Pipelines/Types + labels Metrics/Assistant |
| Default dashboard background is `"transparent"` → the real backdrop is `--app-bg` | True | `appearance.ts:5,10,185`, `App.css:9` (`--dashboard-background-override, transparent`) |
| `openspec validate liquid-glass-bottom-nav --strict` | Passes | `Change 'liquid-glass-bottom-nav' is valid` |

**D2/D3 reproduced independently.** I re-implemented the composite model (sRGB relative luminance,
`a·tint + (1−a)·backdrop`, worst case over {white, black, all 8 accent presets, per-theme CSS default
accent} × {dark, light}) and got D2's table to two decimals at every row: 0.55 → 3.44/1.31,
0.60 → 4.04/1.54, **0.65 → 4.78/1.83**, 0.70 → 5.69/2.18, 0.80 → 8.17/3.12; binding case dark-over-white
in every row; bisected minimum alpha for `--app-text` at 4.5:1 = **0.6322** (dark) / 0.5252 (light).
**D2 and D3 stand.** So do CR3's four newly-specified values (tint `--app-surface`, blur 12px/10-16,
inset `--space-3`, capsule padding `--space-2`) and D4's fit arithmetic (375 − 2×12 = 351 outer,
− 2×8 = **335 inner**, ÷6 = 55.8px/tab vs a 44px floor; 6×44 = 264 ≤ 335).

**Rendered measurement (my own headless Chromium — not the shared MCP session).** I built the planned
material for real (`backdrop-filter: blur(12px)` + a `::before` tint of `--app-surface` at opacity .65 +
a lozenge of `color-mix(in srgb, var(--app-surface-strong) 92%, transparent)`), screenshotted it, and
sampled composited pixels through a canvas. Rendered pixels match my model within 1/255 everywhere, and
confirm `color-mix(... 92%, transparent)` resolves to alpha 0.92.

---

### Round 1's CR1-CR7 as a checklist

| CR | Status | Basis |
| --- | --- | --- |
| **CR1** floor contradicted by the active-tab treatment | **Resolved as stated — but the remedy it chose is itself broken (new CR1 below)** | D1's floor is now scoped to "rendered against the translucent material" and is passable by measurement (4.78:1 at alpha 0.65 with labels present). D6 moves the active label to `--app-text` and accent to the icon only. Task 2.4 forces DESIGN.md to say what the floor does *not* promise. That is honest, **conditional on the lozenge actually being the active indicator** — which it is not (CR1 below). One factual claim inside D6 is also false (CR2 below). |
| **CR2** safe-area arithmetic / `padding-bottom` never retired | **Resolved** | D5 and task 3.2 both state `bottom: calc(var(--bottom-nav-inset) + env(safe-area-inset-bottom))`; task 3.3 removes `BottomNav.css:28`; task 5.3 re-runs the geometry assertions under a non-zero simulated inset. Token identity checks out: capsule top = inset + env + 56 = `--bottom-nav-height`; `toast.css` unedited still lands 16px above the capsule. |
| **CR3** four unspecified values | **Resolved** | Tint token named in D3 + task 3.4; blur 12px with a stated range and reasoning; `--bottom-nav-inset` = `--space-3`; capsule padding `--space-2` with D4's math redone from the 335px inner width; lozenge fill named. Arithmetic re-checked above. |
| **CR4** HEL-535 preflight ordering | **Resolved** | Task 1.1 merges `origin/main` then re-checks; 1.2 is the escalation; D5/task 3.1 say "replace in place, never a second declaration". Now moot in the happy path: #408 has merged and `origin/main` carries the token. (Stale line number — note below.) |
| **CR5** hardcoded `9999px` | **Resolved** — and it exposed a verification defect | Task 3.2 uses `--app-radius-pill`. But the paired assertion ("radius equals half its height", spec + task 5.2) is now unsatisfiable — see CR3 below. |
| **CR6** `-webkit-` prefix / no-`backdrop-filter` fallback | **Resolved (prefix), vacuous (fallback)** | D9 + task 3.4 emit both properties. The `@supports` fallback is a no-op as specified — note below. |
| **CR7** `.panel-list__zoom-widget` | **Resolved** | D10 + task 3.14 + a spec scenario; matches `PanelList.css:79-96`/`:167-171` exactly. |

Round 1's non-blocking notes were all folded in and are all correct as restated (D8's `transition: none`
vs the `theme.css:244-251` global; D2's bounded-by-white/black photo argument; task 5.4's synthesised
photo; task 5.7's ±10% dropped-frame threshold).

---

### Verdict: REFUTE

The plan is materially better than round 1's. The contrast model is real and reproduces exactly, the
token seam is now correctly and completely specified, the geometry contradiction is gone, and the
labels call is argued.

It fails on the mechanism round 1's CR1 pushed it toward. The plan promoted the lozenge from decoration
to **the** active-state indicator — the spec now says "the active tab remains identifiable from its
material lozenge alone" and "accent is never the sole indicator" — and then specified a lozenge fill
that, measured on rendered pixels, is **invisible against the capsule in the default configuration and
over every theme-matched dashboard preset**. Nothing in tasks 4.x/5.x would catch it, because every
contrast task measures glyph-vs-composite and none measures lozenge-vs-capsule.

---

### Change Requests

**1. The specified lozenge fill produces no visible active indicator in the common case. Measured, not
eyeballed — and by construction, not by accident.**

`color-mix(in srgb, var(--app-surface-strong) 92%, transparent)` over a capsule that is
`--app-surface` at 0.65. Both are neighbouring rungs of the same neutral ramp
(`theme.css:102/105`: `#1a1816` vs `#262320`, 12/255 apart; `theme.css:149/152`: `#fdfcfa` vs
`#ffffff`, **2/255 apart**), so once the capsule is composited over a theme-matched backdrop the two
converge. Algebraically: `lozenge − capsule = 0.92·(S_strong − C)` where `C = 0.65·S + 0.35·B`, which is
**exactly zero** in dark theme at `B = (S_strong − 0.65·S)/0.35 = rgb(60,55,51)` — a perfectly ordinary
dark-neutral dashboard background — and asymptotically zero in light theme for any light `B`.

Rendered pixels (my own headless Chromium, blur applied, sampled from the screenshot):

| case | capsule | lozenge | contrast |
| --- | --- | --- | --- |
| **light / default `--app-bg` `#f4f2ed` (no dashboard bg set)** | rgb(250,249,246) | rgb(255,255,255) | **1.053:1** |
| light / pure white (a mandated AC background) | rgb(254,253,252) | rgb(255,255,255) | **1.016:1** |
| light / preset "Mist" resolved | rgb(245,245,247) | rgb(255,255,255) | **1.089:1** |
| **dark / default `--app-bg` `#121110`** | rgb(23,21,19) | rgb(36,33,30) | **1.137:1** |
| dark / preset "Twilight" resolved | rgb(25,24,29) | rgb(36,33,31) | **1.103:1** |
| dark / pure white | rgb(106,105,103) | rgb(43,40,37) | 2.672:1 |
| light / pure black | rgb(165,164,163) | rgb(248,248,248) | 2.343:1 |

Modelled across all 12 shipped `DASHBOARD_APPEARANCE_PRESETS` (`theme.ts:46-58`, resolved through
`appearance.ts`'s 0.55 blend): **dark theme over the 8 dark presets = 1.116-1.145:1; light theme over
the 4 light presets = 1.070-1.074:1.** The only cases that clear even 2:1 are theme-*mismatched*
extremes (dark theme over a white dashboard, light theme over a black one). The default state — and
every non-dashboard route (`/sources`, `/pipelines`, `/registry`, `/metrics`, `/chat`), where the
backdrop is always `--app-bg`, i.e. **five of the six destinations** — sits at 1.05-1.14:1. That is not
"subtle"; a 5/255 delta on a blurred, moving backdrop is not perceivable.

Two consequences the plan does not survive:

- The spec scenario *"the active tab remains identifiable from its material lozenge alone"*
  (`specs/mobile-bottom-nav/spec.md:25-28`) is false at design time, and D6's "**the lozenge, not
  colour, is the active indicator**" is false with it. What actually indicates the active tab is the
  accent icon — the one thing D6 declares out of scope precisely because it measures 1.80-3.55:1 in
  light theme.
- **The active affordance ends up weaker than what ships today.** Today the active tab differs from its
  neighbours in *both* icon and label colour (accent `#ea580c` vs muted `#6c655c`) — two elements, a
  clear hue break. After this change every label is identical `--app-text`, the lozenge is invisible,
  and only a ~20px icon changes hue. AC 4 ("the active item renders as an inner lozenge") would fail on
  a screenshot even though the CSS is present.

Required, at design time (this is a design decision, not an executor judgement call):

1. Specify a lozenge treatment whose separation is **stated as a floor against the composited capsule
   material, not against a token** — the same discipline D1/D2 applied to the glyphs. Any of these is
   acceptable; pick one and record the measurement: (a) a fill defined as a delta from the capsule
   (e.g. a `--app-text` wash at a stated alpha) *plus* a hairline border, with the **border** carrying
   the stated ratio (this is what WCAG 1.4.11 actually lets you measure, and 3:1 on a fill alone is
   unreachable in light theme without a mid-grey slab that abandons the reference); (b) an accent wash
   — `--app-accent-dim`/`--app-accent-surface` — which `DESIGN.md` §0.2 principle 3 already sanctions
   for selection/checked states and which separates by hue rather than luminance; (c) keep the accent
   on the active label as well, and change D1/D6/the spec to say plainly that accent is a co-indicator
   with its real measured range. What is not acceptable is leaving the current fill with the spec
   claiming the lozenge alone identifies the active tab.
2. Verify it: add a task that samples **rendered** pixels of the lozenge and of the adjacent capsule
   material and asserts the stated floor, over at least the default `--app-bg` backdrop and one
   theme-matched preset, in both themes. Every existing contrast task (5.4) measures glyph-vs-composite
   and would pass with an entirely invisible lozenge.
3. Re-word `specs/mobile-bottom-nav/spec.md:25-28` and D6 to match whatever is decided, and re-check
   ticket AC 4 against it.

**2. D6's justification for putting the accent icon outside the floor contains a measurably false
claim. The decision can stand; the stated reason cannot.**

`design.md:152-156` says the active accent icon "is exactly the accent-on-surface condition already
shipped ... **unchanged, not worsened, by this ticket**". It is worsened in dark theme: the icon's
backdrop moves from `--app-surface` (`#1a1816`) to the lozenge, which is ~`--app-surface-strong`
(`#262320`) plus 2.8% of the user's backdrop. Measured (worst case over white/black/accent backdrops):

| preset | dark today | dark planned | delta |
| --- | --- | --- | --- |
| Red `#ef4444` | 4.70:1 | **3.87:1** | −0.83 |
| Pink `#ec4899` | 5.02:1 | **4.12:1** | −0.90 |
| Blue `#3b82f6` | 4.81:1 | **3.95:1** | −0.86 |
| Purple `#a855f7` | 4.47:1 | **3.68:1** | −0.79 |
| Yellow `#eab308` | 9.23:1 | 7.58:1 | −1.65 |

Three presets that clear 4.5:1 today drop below it; all stay above 3:1. Light theme *is* effectively
unchanged (−0.07 to −0.14) and remains 1.80-3.55:1, below 3:1 for four presets — genuinely
pre-existing. Required: restate D6 with the measured truth (dark-theme accent-icon contrast drops by up
to 1.65 but stays above the 3:1 non-text threshold; light theme is unchanged and already below it), and
make sure task 2.4's `DESIGN.md` wording asserts only that. This repo has a documented habit of
confidently-false design documentation; `DESIGN.md` is binding, and a carve-out justified by "we didn't
make it worse" must be true. Note this interlocks with CR1: the carve-out is honest only if the lozenge
really carries the active state.

**3. "Its border radius equals half its height" cannot be asserted the way tasks 5.2 and the spec
scenario require.**

`getComputedStyle` returns border-radius's *computed* value, not the used (clamped) value. Verified in
my own headless Chromium: an element with `height: 56px` and `border-radius: var(--app-radius-pill)`
reports `borderRadius: "9999px"`; a control with `border-radius: 28px` reports `"28px"`. So task 5.2's
"assert via `getComputedStyle` ... its radius equals half its height" and
`specs/mobile-bottom-nav/spec.md:41-43` are unsatisfiable as written — with the (correct, CR5-driven)
switch to `--app-radius-pill` the executor will read `9999px` and either fail a correct implementation
or quietly reinterpret the acceptance signal. Required: restate both as something checkable — e.g. the
resolved radius is ≥ half the rendered height (semicircular ends guaranteed), or assert the corner from
sampled rendered pixels.

**4. `prefers-reduced-motion` is verified only by reading CSS — the exact defect class D7 forbids.**

Task 3.10 specifies `transition: none` (correct, and D8's reasoning about `theme.css:244-251` is right),
but the only check is task 4.1, a stylesheet-parsing assertion that the declaration exists. That is
defeated by exactly the failure D7 cites: a reduced-motion block placed above the rule that sets the
transition loses at equal specificity, and the source test still passes — HEL-535's inert-44px-floor bug
with a different property. The ticket AC and the run brief both demand the preference "genuinely
disable added motion, not merely shorten it". Required: add a verification task that renders under
emulated `prefers-reduced-motion: reduce` (the headless Chromium already stood up for 5.1-5.7 can do
this) and asserts the rendered `transition-property`/`transition-duration` on the active tab, alongside
the source assertion.

---

### Non-blocking notes

- **Stale line number.** D5 and task 3.1 say "the existing declaration at `theme.css:86`". On
  `origin/main` — which task 1.1 now merges in — it is **line 90**. Say "the existing
  `--bottom-nav-height` declaration" rather than a line number that the merge in task 1.1 invalidates.
- **The `@supports not (backdrop-filter: blur(1px))` fallback (D9 / task 3.5) is a no-op as
  specified.** The tint is an unconditional `::before` at alpha 0.65, so a browser without
  `backdrop-filter` already renders exactly the described fallback. Either drop task 3.5 (and the
  matching assertion in 4.1, which would otherwise pin dead CSS) or give the block something to do.
  The `-webkit-` prefix decision is the part of D9 that carries weight, and it is right.
- **Spec wording tension.** `specs/mobile-bottom-nav/spec.md:6-10` says ink "SHALL be full-contrast
  `--app-text` for both active and inactive tabs" and then that `--app-accent` applies to "the active
  tab's icon only". Two readings; D6 and task 3.9 disambiguate, but the spec is the artifact that
  outlives them.
- **Paint order for the tint layer.** An absolutely-positioned `::before` paints above non-positioned
  in-flow content, so the tabs will need `position: relative` (or the `::before` needs `z-index: -1`,
  which works here because `backdrop-filter` makes `.bottom-nav` a stacking context). "Composited
  between the blur and the glyphs" states the intent; worth one sentence so it is not discovered by
  seeing the glyphs disappear.
- **Transmissivity remains the final gate's call, and the default case is the interesting one.** Round 1
  flagged the dark-over-white composite; I reproduce it exactly as rgb(106,105,103) — a heavy grey slab.
  More striking in my renders: over a *theme-matched* backdrop the capsule composite is almost the page
  colour itself (dark: backdrop rgb(18,17,16) → capsule rgb(23,21,19); light: rgb(244,242,237) →
  rgb(250,249,246)). Figure-ground separation for the whole capsule will rest entirely on task 3.6's
  shadow and hairline. That is legitimate and matches how iOS bars read over flat backgrounds — but it
  means the shadow/border is load-bearing, not decoration, and the final gate should judge the capsule's
  edge as carefully as its contrast.
- **Recognisability has no evidence task.** AC 3 ("content behind the bar remains recognisable") is a
  visual judgement the Risks section commits to escalating on, but no task produces the artefact for it.
  Task 5.4 already injects a background image; asking it to retain those screenshots would give the
  final gate something to judge instead of re-deriving it.
- Credit where due: `openspec validate --strict` passes, the delta retires the contradicted scenarios
  rather than stacking them, the three-copy consolidation in D5 is correctly diagnosed against
  `origin/main` and is genuinely safe (both inlined copies are inside this ticket's fence, both are
  being rewritten anyway, and `toast.css` stays correct unedited), and D4's fit arithmetic is now
  honest about its ~5px headroom with a rendered `scrollWidth`/`clientWidth` check behind it.
