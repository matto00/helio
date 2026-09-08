## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold spawn. Every figure below recomputed by my own script from the tree
(sRGB → relative luminance → WCAG ratio), parsing surfaces out of
`frontend/src/theme/theme.css` theme blocks and the default accents out of
`frontend/src/theme/theme.ts`. Nothing taken from design.md's prose.

### What I verified (with evidence)

**Round-2 CR1 is fixed, and the fix propagated to EVERY artifact.**
`grep -rn "0\.1830|0\.3000|0\.1170|0\.1833|0\.2005|121110|ffffff"` across the whole change dir:
every surviving hit is either (a) an explicit retraction (`design.md:23,42`, `ticket.md:17`),
(b) an explicit *warning not to derive that way* (`tasks.md:9,47`), (c) the true statement that
light `--app-surface-raised` == `--app-surface-strong` == `#ffffff` and those are the EASIEST surfaces
(`ticket.md:60`, `tasks.md:49`, `design.md:49`, `workflow-state.md:46`), or (d) a prior skeptic report.
Zero unretracted assertions remain. `ticket.md:17-24` now carries the corrected binding surfaces
(`#efece6` L=0.8405 / `#262320` L=0.0172), the window `[0.1516, 0.2468]` width **0.0953**, the 4.5:1 gap
**0.1044**, and the "why it mattered" record (Orange 4% / Cyan 11% / Green 14% / Yellow 21% → 2.58–2.99).

**The spec deltas are clean.** `specs/accessible-focus-indicator/spec.md` and
`specs/theme-token-contract/spec.md` contain **no hex values, no luminance figures and no window numbers
at all** — they are stated purely behaviourally ("derived by the smallest adjustment that satisfies the
floor", "no more adjustment than necessary", "declared value must be the value that renders"). They were
therefore never carriers of the refuted arithmetic and cannot outlive it. This closes the specific
"corrections fail to propagate six times" risk for the archived artifacts.

**Round-2 CR2 is fixed and the value is arithmetically right.** Confirmed
`frontend/src/theme/theme.ts:12-15` declares `DefaultAccentColorByTheme: Record<Theme, string>` =
`{dark:"#f97316", light:"#ea580c"}`, and `grep -rn "DefaultAccentColor\b" frontend/src` returns exactly
one hit — the stale *comment* at `theme.css:162`, which task 3.2 already owns. No scalar symbol exists.
Recomputed the minimum integer-% darkening clearing 3:1 against the minimum over all ten declared surfaces:
- `#f97316` (dark default) → **12% → `#db6513`**, min light **3.028**, min dark **4.378**. Matches D6/4b.1's
  "light 3.03, dark 4.38" exactly.
- `#ea580c` (light default) → **0%**, min light **3.019**, min dark **4.391**. Matches D6's "3.02 / 4.39".
So D6's claim that either default is *safe* and this is a flash-duration choice, not an accessibility one,
is true as written. **Judgment on the dark-default choice: correct.** `getInitialTheme` falls back to
`"dark"` on a cold load, so the dark-derived value is what a genuinely-first paint wants; and because
`#db6513` clears the floor in both themes, choosing wrong costs nothing accessibility-wise. The anti-drift
test now has a well-defined RHS (`derivation(DefaultAccentColorByTheme.dark)`) and 4b.1 explicitly requires
running the mutation on it.

**The margin ruling and its condition are recorded where an implementer meets them.** `ticket.md:36`,
`design.md:144` (D6) and `workflow-state.md` all carry "bare minimum, no padding; holds ONLY while the
darkening stays out of CSS `color-mix`; guard threshold stays exactly `>= 3.0`". `design.md:67` separately
rejects a fixed `color-mix` ratio, and `tasks.md:1.1` locates the derivation in `appearance.ts` (TS), not CSS.

**Deferral is real (evidence rule 4).** HEL-1048 verified live via Linear: open, status **Todo**, priority
High, project "Helio v0.7", title matches. Task 7.6 requires re-verifying it before the PR.

**Nothing newly broken by the round-3 edits.** Diffed `444eed98` against `cc250f82`: the changes are
confined to `ticket.md`'s premise table + a margin paragraph, design.md D6's symbol/value/margin text,
tasks.md 4b.1's symbol note (4 files, +159/-12; workflow-state.md's D6 record is uncommitted working-tree state, which I read directly). Tasks 1.1's per-preset table (Red/Purple/Blue 0%,
Pink 1%, Orange 12%, Cyan 18%, Green 21%, Yellow 28%) is untouched and I re-derived it as still correct
under my own surface parse. No task/design/proposal contradiction introduced.

### Verdict: CONFIRM

Both round-2 items are genuinely closed in every artifact, the two numbers I was asked to check
independently (`#db6513`, 3.03/4.38) reproduce exactly, and I found no new blocking defect.

### Non-blocking notes

- **`tasks.md` never states the "no CSS `color-mix`" condition itself.** It is in ticket.md, design.md D2/D6
  and workflow-state.md, and task 1.1 implies it by placing the derivation in `appearance.ts` — but the
  tasks file is what an implementer works from line by line. One clause in 1.1 ("compute in TS; do NOT
  implement the darkening as CSS `color-mix` — the margin argument depends on an exact 8-bit hex") would
  remove the last inference step. Not blocking: the design is unambiguous if read.
- **HEL-1048's description still claims task 3's work** ("Correcting or removing them, and making the
  `theme.css:161-162` comment true, belongs here") while tasks 3.1/3.2 do it in *this* ticket. Round 1
  raised this; it is still open. Trim HEL-1048 at PR time (task 7.6 is the natural place) so the
  dead-declaration cleanup is not attempted twice.
- **Decision ordering:** D6 still precedes D5 in design.md (round-2 nit, unaddressed). Cosmetic.
- **Yellow cohesion (`#a88106`, olive/dark-gold) is a final-gate owner call**, carried by tasks 5.4/5.6.
  Not ruled on here.
- I did **not** drive the browser: no implementation exists on this branch yet, so any rendered reading
  would be evidence about pre-change styling. The UI-cohesion gate applies at the final gate, where the
  28% Yellow shift must be judged against the running app in both themes.

### Two axes

- **What no source text carries:** *perceptibility*, unchanged from round 2. Every artifact still reasons in
  hexes and ratios. A ring clipped by `overflow: hidden`, occluded by an overlapping element, or pushed by
  `outline-offset` onto a surface other than the one measured, is indistinguishable from a correct one in
  all of it. Task 4.3 admits this for the guard; it is equally true of the design.
- **What path the gates did not exercise:** the pre-settle/fallback render. 4b now *specifies* the static
  value and gives its drift test a failable RHS, but the verification is still a Jest equality between two
  constants — no gate exercises the actual window in which `ThemeProvider`'s `useEffect` has not yet run.
  Tasks 5.1-5.4 measure the settled state by construction (5.2 mandates waiting for settle). The first-paint
  window remains unmeasured; the mitigation is that `#db6513` clears the floor in both themes, so the
  unmeasured window is safe by construction rather than by observation.
