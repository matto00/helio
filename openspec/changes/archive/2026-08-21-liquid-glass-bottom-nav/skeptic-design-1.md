## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Every claim below is derived from files I read in this worktree (base = `main` @ `d7815d15`,
`git diff main...HEAD` empty, only the untracked change dir present), or from arithmetic I ran
myself. Nothing is taken from the planner's narrative.

**Artifacts read:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mobile-bottom-nav/spec.md`, `workflow-state.md`.

**Codebase claims checked against the real files:**

| design.md claim | Verdict | Evidence |
| --- | --- | --- |
| `BottomNav.css` is a full-width opaque strip, `left/right/bottom: 0`, `--app-surface`, `--app-border-subtle` top hairline, `height: calc(--control-lg + --space-4 + env(...))`, six labelled tabs, `min-width/min-height: 44px`, inactive `--app-text-muted`, active `--app-accent`, lines 21-23 cite §0.2 | **True** | `BottomNav.css:5-73` read in full |
| `App.css:424` reserves an identical ledge | **True** | `App.css:421-425`: `padding-bottom: calc(var(--control-lg) + var(--space-4) + env(safe-area-inset-bottom))` |
| `DESIGN.md` §0.2 principle 2 + the `[mechanical]` clause say what the ticket quotes | **True** | `DESIGN.md:34-37`, `DESIGN.md:99-112` |
| `DESIGN.md` already has an overlay-scrim carve-out to model the prose on | **True** | `DESIGN.md:102-112` |
| HEL-535 introduces `--bottom-nav-height` and is **not** on this branch's base | **True** | `grep -- "--bottom-nav-height" frontend/src` returns nothing in this worktree; present at `theme.css:86` on `feature/toast-notification-consistency-pass/hel-535` (read via `git show`, no worktree touched) |
| `toast.css` consumes it as `calc(var(--bottom-nav-height) + var(--space-4))` | **True** | HEL-535 branch `toast.css:23-27`, inside `@media (max-width: 768px)` |
| Only `toast.css` + `App.css:424` consume the ledge geometry | **True** | `grep -rn "control-lg) + var(--space-4)"` → exactly `App.css:424` and `BottomNav.css:27`; `safe-area-inset-bottom` consumers are those two plus `MobileNavSheet.css:41` |
| D5's redefinition leaves `toast.css` correct unedited | **True** | new token = 56 + inset + env = capsule top; toast = token + 16 → 16px above the capsule |
| **D2's contrast table** | **True, reproduced exactly** | See below |

**D2 re-derived independently.** I recomputed worst-case composite contrast from the real token
values (`theme.css:102/107/108/115` dark, `:149/154/159/164` light) using WCAG sRGB relative
luminance, compositing `a·tint + (1-a)·background` in gamma space, worst case over
{white, black, accent} × {dark, light}. My numbers match the planner's table to two decimals at
every row (0.55 → 3.44/1.31, 0.60 → 4.04/1.54, 0.65 → **4.78**/1.83, 0.70 → 5.69/2.18,
0.80 → 8.17/3.12). Cross-checked with a second, independently written implementation in Node
(different linearisation threshold constant) — identical to 2 dp. The binding case is
**dark theme over a pure-white backdrop** in every row. My own bisection puts the minimum alpha
for `--app-text` to clear 4.5:1 at **0.6322** (dark) / 0.5252 (light), so D3's choice of 0.65 as
"the most transmissive value the floor permits" is right. **D2 and D3 are sound** — but only
under an assumption the plan never writes down (CR3).

**Spec delta:** `openspec validate liquid-glass-bottom-nav --strict` → `Change
'liquid-glass-bottom-nav' is valid` (exit 0). The MODIFIED requirements replace the old
opaque-surface and content-not-occluded requirements wholesale, so the contradictory scenarios are
retired rather than accumulated. No AC is left uncovered by a task; the ticket's coordination
fences (no `toast.css`/`toast.css.test.ts`, no `.app-shell`/`.app-command-bar`) are respected by
the task list.

**Other ground truth gathered:** `theme.css:192-194` (`* { box-sizing: border-box }`);
`theme.css:244-251` (global `transition-duration: 0.01ms !important`); `theme.css:67`
(`--app-radius-pill: 9999px`); `appearance.ts:323` (`--app-accent` written as the picked hex
verbatim, no per-theme derivation); `theme.ts:22-31` (the 8 `ACCENT_PRESETS`);
`App.tsx:134-154` + `App.css:2-11` (dashboard background is a **colour** on `.app-shell`, and
`BottomNav` is a descendant of it via `MobileShell`, so the backdrop is real and no ancestor
establishes a backdrop root); `Modal.css:64` (the repo's only `backdrop-filter`, unprefixed);
`PanelList.css:79-96,167-171` (zoom widget).

---

### Verdict: REFUTE

The plan is strong in the places that usually fail — the contrast model is real arithmetic that I
reproduced exactly, the token seam is correctly identified, the labels call is argued rather than
asserted, and the verification tasks are rendered-geometry-based. It fails on one load-bearing
contradiction (CR1) that would put a rule into binding `DESIGN.md` that the shipped bar violates —
the exact failure this ticket exists to remove — plus a safe-area/geometry contradiction in the
task list (CR2) and four unstated values that the visual result and the contrast model both depend
on (CR3).

---

### Change Requests

**1. The stated contrast floor (D1) is contradicted by the plan's own active-tab treatment (D6).
It is unachievable as written and the plan's remedy cannot fix it.**

D1 binds "the **least-contrasting** icon or label in the bar" to 4.5:1. D4 keeps labels, and
`BottomNav.css:67-69` colours the whole active tab — icon *and* its `--text-micro` label — with
`--app-accent`. D6 says the near-opaque lozenge collapses the active case to accent-on-surface,
"a condition already shipped and accepted everywhere else in the app". Shipped, yes. Clearing
4.5:1, no. Measured accent-on-`--app-surface` (opaque lozenge, the best case D6 argues for):

| preset | light `#fdfcfa` | dark `#1a1816` |
| --- | --- | --- |
| Orange `#f97316` | **2.73:1** | 6.32:1 |
| Red `#ef4444` | **3.67:1** | 4.70:1 |
| Pink `#ec4899` | **3.44:1** | 5.02:1 |
| Purple `#a855f7` | **3.86:1** | **4.47:1** |
| Blue `#3b82f6` | **3.59:1** | 4.81:1 |
| Cyan `#06b6d4` | **2.37:1** | 7.29:1 |
| Green `#22c55e` | **2.22:1** | 7.77:1 |
| Yellow `#eab308` | **1.87:1** | 9.23:1 |

Plus the light theme's CSS-default accent `#ea580c` → **3.47:1**. `appearance.ts:323` writes the
picked hex verbatim into both themes (no per-theme darkening), and `theme.ts:22-31` is the shipped
preset list — so **every** accent choice fails the floor in light theme, and Purple fails in dark.
Several fail even a 3:1 non-text floor. Raising the tint alpha (task 5.3's only lever) does
nothing here, because D6 has already collapsed this case to an opaque surface.

Consequences if this ships as planned: task 2.3 writes a floor into binding `DESIGN.md` that the
shipped bar violates (ticket AC 1 fails), task 5.3's measurement fails on the active tab with no
in-scope remedy, and the likeliest outcome is that the executor measures only the inactive ink
that D2 analyses and reports the AC met — a false pass on the carve-out's central safety claim.

Required: resolve this at design time, in `design.md`, `DESIGN.md`'s wording (task 2.3), the spec
delta's *Legible over hostile user dashboard backgrounds* scenario (`specs/mobile-bottom-nav/spec.md:16-20`),
and task 5.3's remedy sentence. Two coherent routes, either acceptable — pick one and record why:
(a) scope the floor to the foregrounds it can actually govern ("every non-accent glyph and label")
and state the accent indicator's rule separately as the pre-existing, app-wide accent-on-surface
condition this ticket does not change; or (b) keep the active **label** at full-contrast ink and
let the lozenge (material) be the active indicator with accent on the icon only — which is closer
to the reference, where active state is expressed as material rather than colour, and which D6's
own opening sentence already argues for. Whichever route, the floor's wording must be one an
executor can pass by measurement, not one that guarantees a failed AC.

**2. The safe-area arithmetic contradicts itself between D5 and task 3.2, and the existing
`padding-bottom: env(...)` is never retired.**

D5 defines `--bottom-nav-height` = capsule-height + inset + `env(safe-area-inset-bottom)` and calls
it "the distance from the viewport's bottom edge to the top of the capsule". That identity only
holds if the capsule's offset is `bottom: calc(var(--bottom-nav-inset) + env(safe-area-inset-bottom))`.
Task 3.2 instead says "`left/right/bottom` at `--bottom-nav-inset`" — which puts the capsule inside
the home-indicator zone on iOS, breaks the token identity, over-reserves the content clearance, and
fails the ticket AC "`env(safe-area-inset-bottom)` handling ... preserved" and the spec scenario
"the capsule floats above `env(safe-area-inset-bottom)`".

Separately, `BottomNav.css:28`'s `padding-bottom: env(safe-area-inset-bottom)` is not mentioned by
any task. Left in place alongside task 3.2's flat `height: var(--bottom-nav-capsule-height)` (56px)
and `theme.css:192-194`'s global `box-sizing: border-box`, the capsule's content box drops to ~22px
on a 34px-inset iPhone while `.bottom-nav__tab` still declares `min-height: 44px` — tabs overflow
the pill. That is the sixth entry in this repo's touch-target regression series, from the plan
itself rather than from a media-query ordering accident.

Required: state the capsule's offset explicitly as `inset + env(safe-area-inset-bottom)` in both
D5 and task 3.2, and add an explicit task to remove `padding-bottom: env(...)` from the capsule
rule (the inset now carries the home indicator). Add a rendered assertion for it to task 5.2
(capsule bottom edge ≥ inset + inset value, measured with a non-zero simulated safe-area).

**3. Four values the visual result and the contrast model both depend on are unspecified.**

- **The tint colour is never named** — not in `design.md`, `tasks.md`, `proposal.md`, or the spec
  delta (`grep -n "tint"` across all four; D1 only says the floor is stated against the composite
  "not against `--app-surface`"). D2's entire table, and therefore the choice of alpha 0.65 and the
  claim that the carve-out is safe, is only valid for **tint = the theme's `--app-surface`** — that
  is the assumption under which I reproduced the table exactly. An executor who reaches for
  `--app-surface-strong` (`#262320` / `#ffffff`) or a white tint invalidates the model silently.
  Name the tint token in D3 and task 3.3.
- **The blur radius is a literal placeholder** — task 3.3 says `backdrop-filter: blur(...)`. "Small"
  is the only guidance, and the repo's only precedent (`Modal.css:64`) is `blur(2px)`. The
  difference between 2px and 20px is the difference between a flat translucent tint and something
  that reads as the reference material, and no task checks it. Give a value or a tight range, with
  the reasoning.
- **`--bottom-nav-inset` has no value.** D4's fit arithmetic silently assumes 12px
  (`375 - 2*12 = 351`) but no task states the value or the `--space-*` token it comes from
  (`--space-3` is 12px). DESIGN.md's spacing clause is `[mechanical]`.
- **The capsule's horizontal padding is omitted from D4's fit math.** D4 calls `351px` the "capsule
  *inner* width"; it is the outer width. A pill needs horizontal padding or the first/last tabs' hit
  areas run into the semicircular ends. At `--space-4` padding the budget drops to ~53px/tab, and
  "Pipelines" at `--text-micro` medium is right at that edge — today the label survives only because
  `BottomNav.css:55-57` ellipsises it, which the new spec scenario ("no label clipped") forbids.
  State the padding and redo D4's arithmetic from the real inner width.
- **The lozenge's fill is only "a more-opaque nested rounded surface"** (task 3.6). D6 leans on it
  being "near-opaque" for its contrast argument; name the token/alpha so that argument is checkable.

**4. The HEL-535 preflight gate is real but under-specified on ordering.**

I confirmed the dependency is genuine: `--bottom-nav-height` is absent from this branch's base and
present at `theme.css:86` on `feature/toast-notification-consistency-pass/hel-535`. Task 1.1
correctly says STOP-and-escalate. But it checks "the branch base", and HEL-535 merging to `main`
does **not** put the token on this branch — so the honest executor either escalates unnecessarily
after the dependency has landed, or improvises. Task 1.1 must say what to do in that case: bring
`main` into this branch first, then re-check. It must also say the redefinition **replaces the
existing declaration in place** at `theme.css:86` — a second `--bottom-nav-height` declared
elsewhere in `theme.css` would win by source order and silently defeat the whole single-seam
argument.

**5. Task 3.2 instructs a hardcoded `border-radius: 9999px` where the sanctioned token exists.**

`--app-radius-pill: 9999px` is defined at `theme.css:67` and is the radius vocabulary named in
`DESIGN.md:156-157`; `PanelList.css:93` already uses it. Change task 3.2 to `--app-radius-pill`.
(The spec scenario "its border radius equals half its height" is still satisfiable and still
verifiable via `getComputedStyle`, which resolves the clamp.)

**6. No decision recorded on `-webkit-backdrop-filter` / an unsupported-`backdrop-filter` fallback,
and the planned verification structurally cannot detect the gap.**

The ticket's premise is the installed **iOS** PWA. Safari only dropped the `-webkit-` prefix
requirement for `backdrop-filter` recently; the repo's single existing usage (`Modal.css:64`) is
unprefixed and desktop-facing, so it is not a precedent for this. Every verification task (5.1-5.6)
runs in headless Chromium, which will never surface a Safari-only miss — the feature could ship
absent on exactly the device that motivated the ticket. Add the prefix decision to `design.md` and
a task, and state what the `@supports not (backdrop-filter: blur(1px))` fallback is (the contrast
model survives without blur, since blur does not move a uniform backdrop's mean — say so).

**7. `.panel-list__zoom-widget` lands on top of the new floating capsule between 431px and 768px.
Decide and record.**

`PanelList.css:79-96` pins it `position: fixed; bottom: var(--space-5); right: var(--space-5);
z-index: 10`, and `PanelList.css:167-171` only hides it below **430px** — while `BottomNav` renders
up to 768px. Today it rests on an opaque full-width strip; after this change it will sit directly on
the glass capsule (z-index 10 > 5), over the Assistant tab, at a width task 5.1 explicitly renders.
The plan's impact analysis lists every consumer of the bar's geometry except this one. Either
retarget it off `--bottom-nav-height` the way the toast viewport is, or declare it out of scope with
a spinoff — but record the call, since "the token is the single seam" is a claim this widget
currently falsifies.

---

### Non-blocking notes

- **D8 is right for a non-obvious reason worth recording.** `theme.css:244-251` already forces
  `transition-duration: 0.01ms !important` globally. `transition: none` still works because it
  clears `transition-property`, which the global rule does not touch — precisely the mechanism
  `Skeleton.css:53-61` documents for `animation-name`, and which `DESIGN.md:166-169` already calls
  out. A longhand `transition-duration: 0s` would be silently overridden. Cite this in D8 so the
  executor cannot pick the losing form. Also, D8 says "the lozenge still moves"; if the lozenge is a
  background on the active tab it does not move at all — harmless, but the spec scenario should not
  imply motion that never existed.
- **D2's photo argument is loosely stated but its conclusion holds.** "A photo averages toward
  mid-tone under blur, which only helps" is not why it is safe. It is safe because the composite's
  luminance is bounded by the white- and black-backdrop composites, and in both themes the text
  luminance lies outside that interval (dark: text 0.88 vs max composite 0.14; light: text 0.014 vs
  min composite 0.37) — so white/black genuinely bound every photo. Restate it that way; the current
  wording is the kind of claim that gets copied into `DESIGN.md`.
- **There is no photo-background feature to test against.** `DashboardAppearance.background` is a
  colour string (`dashboard.ts:8`) applied as `background-color` on `.app-shell`
  (`App.tsx:139`, `App.css:9`). Task 5.3's "photo" case must be synthesised (injected background
  image, or scrolling a dense panel grid beneath the bar, which is the real-world analogue). Say
  how, or the measurement is unrepeatable.
- **Task 5.6 has no pass/fail signal.** "Check `backdrop-filter` cost under CPU throttling" with no
  threshold invites an eyeballed "smooth". State one (e.g. a frame-budget or dropped-frame ratio
  against the same scroll with the bar opaque).
- **Fidelity watch-item for the final gate, not a blocker.** At tint = `--app-surface`, alpha 0.65,
  the dark-theme composite over a white backdrop is `rgb(106,105,104)` — a fairly heavy grey slab,
  noticeably less transmissive than the reference's material. D3 already picks the most transmissive
  alpha the floor allows and the Risks section commits to escalating rather than shipping a bar that
  stops reading as glass. That is the right posture; I am flagging it so the final gate judges
  transmissivity on the rendered result and not on the fact that 0.65 was derived correctly.
- Credit where due: `openspec validate --strict` passes, the delta retires the contradictory
  scenarios instead of stacking them, D4 is a genuine decision with reasoning rather than a deferral,
  and D7 correctly refuses source-reading for touch targets.
