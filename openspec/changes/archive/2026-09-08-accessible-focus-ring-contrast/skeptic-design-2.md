## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Every number below was recomputed from the tree by my own script
(`sRGB → relative luminance → WCAG ratio`, luminance fn anchored on `#ffffff`/`#000000` = 21.00),
parsing surfaces from `frontend/src/theme/theme.css:145-215` and presets from `frontend/src/theme/theme.ts:22-31`.
Nothing here is taken from design.md's prose.

### What I verified (with evidence)

**CR1's correction is arithmetically right.** Independently reproduced, character-for-character:
- binding surfaces: light `--app-surface-soft` `#efece6` L=0.84055, dark `--app-surface-strong` `#262320` L=0.01718
- 3:1 window `L ∈ [0.1516, 0.2468]`, width **0.0953**
- 4.5:1 `L ≤ 0.1479` vs `L ≥ 0.2523` → **empty, gap 0.1044**. The impossibility proof strengthens, as claimed.

**D2/D3's per-preset figures still hold against the rewritten D1.** Minimum integer-% darkening whose
derived hex clears 3:1 against the minimum over *all ten* declared surfaces:
Red/Purple/Blue **0%** (unchanged, min light 3.19/3.36/3.12), Pink **1%** (`#ea4797`), Orange **12%**
(`#db6513`), Cyan **18%** (`#0595ae`), Green **21%** (`#1b9c4a`), Yellow **28%** (`#a88106`).
Margins light **3.01–3.07**, dark **3.95–4.40**. Exact match to D2/D3 and to task 1.1.

**D1's "why the error mattered" figures are also exact.** Deriving against `#ffffff`/`#121110` alone gives
Orange 4% / Cyan 11% / Green 14% / Yellow 21% / Pink 0%, scoring **2.58 / 2.58 / 2.60 / 2.59 / 2.99**
against `--app-surface-soft`. The warning in D1 and task 1.1 is true as written.

**No artifact except `ticket.md` still reasons from the extremes** — `grep -n "0.1830|0.3000|0.1170|ffffff|121110"`
across the change dir: design.md's remaining hits are the explicit *retraction*; tasks.md's are the
explicit *warning*; `ticket.md:15,19,20,54` are unretracted assertions (CR1 below).

**Guard requirement (D4/4.2) is implementable as "binding surface is an output"**, and a hardcoding
implementation could not pass its own stated verification: 4.2 requires "change a surface in a scratch copy
and confirm it reacts", which a hardcoded pair cannot do. In-repo precedent for parsing `theme.css` in Jest
exists (`theme.css.test.ts`, `elevationTokenGuard.css.test.ts`, `motionTokenGuard.css.test.ts`,
`tokenAuditSweep.css.test.ts`). Accepted.

**D6/4b closes the first-paint and fallback gap in principle** — `buildAccentTokens` really does
`return {}` on an unparseable hex (`appearance.ts:305-308`), and `:root`-only is the right placement given
theme-independence. But the value it names does not exist and is theme-plural — CR2.

**Margin judgment (asked explicitly).** Recommendation: **keep the bare minimum; do not raise the target.**
The derived value is an exact 8-bit hex written as inline style, so `getComputedStyle` returns that same hex
and the ratio is exact — there is no rendering-rounding path from 3.01 to 2.99. This holds *only* because
D2 rejected CSS `color-mix`; if the executor implements the darkening in CSS instead, browser colour-space
mixing reintroduces the risk and this judgment must be revisited. Corollary: the guard's threshold must stay
exactly `>= 3.0`, never a padded 3.05 — a padded threshold is the loosenable knob a future editor reaches
for instead of fixing the derivation.

### Verdict: REFUTE

Two blocking items, both narrow. The corrected mathematics is sound and I found no defect in it.

### Change Requests

1. **`ticket.md`'s premise table was not corrected, so the ticket of record still carries the refuted proof.**
   Round 1's CR1 required both design.md's D1 *and* `ticket.md`'s premise table; only design.md was fixed.
   `ticket.md:15` still asserts "the worst light surface (`#ffffff`, L=1.0000) and the worst dark surface
   (`--app-bg` `#121110`, L=0.0057)"; `:19-20` still publish the window as `[0.1170, 0.3000]` width **0.1830**
   and the 4.5:1 bounds as `0.1833`/`0.2005`; `:54` still says "the worst light surface is shared by two
   tokens". All four are the exact claim design.md now records as wrong, and `:19-20` also now contradicts
   the correction the orchestrator posted on HEL-1048. `ticket.md` is the artifact the executor reads for
   acceptance criteria and the one an evaluator traces ACs against; leaving a disproved table in it is a
   live internal contradiction, not a stale copy.
   Required: correct lines 15, 19-20 and 54 to the binding surfaces / window `[0.1516, 0.2468]` width
   0.0953 / 4.5:1 gap 0.1044, with a one-line note that the correction came from the round-1 design gate so
   the divergence from Linear is legible. `ticket.md:30`'s "worst surface in both themes" and
   `proposal.md:11`'s identical phrase are then fine, since "worst" is defined correctly everywhere else.

2. **D6 and task 4b.1 name `DefaultAccentColor`, which does not exist — the real symbol is per-theme, and
   the two defaults derive to *different* ring colours, so the `:root`-only declaration and the anti-drift
   test are both ill-posed as written.**
   `frontend/src/theme/theme.ts:12-15` declares `DefaultAccentColorByTheme: Record<Theme, string>` =
   `{ dark: "#f97316", light: "#ea580c" }`; there is no scalar `DefaultAccentColor` anywhere in
   `frontend/src` (grep). Derived ring colours differ: `#f97316` → 12% → **`#db6513`**;
   `#ea580c` → **0%**, i.e. `#ea580c` itself (I measured it: min light **3.02**, min dark **3.91** — the
   light default *already clears the floor unaided*). One `:root` declaration cannot equal both, so task
   4b.1's verification — "a test asserting the static value equals the runtime-derived value for the
   default accent, so the two paths cannot drift" — has no well-defined right-hand side and would either be
   written against a silently-chosen theme or quietly softened until it cannot fail.
   Required, at design level: (a) name the real symbol; (b) decide *which* default the static value is
   derived from and say why — `DefaultAccentColorByTheme.dark` is the defensible choice, since
   `getInitialTheme()` returns `"dark"` when nothing is stored, so `#db6513` is what a genuinely-first paint
   would want; (c) state the drift test against that same named constant, so it is failable by editing
   either side; and (d) reconcile with task 3.1 — 3.1 removes `theme.css`'s dead per-theme `--app-accent`
   defaults, but `DefaultAccentColorByTheme` is the *live* TS twin of exactly that per-theme split, and the
   design currently says nothing about whether it stays, which leaves 3.1's "make the `theme.css:161-162`
   comment true" (the comment explicitly says "Defaults below match DefaultAccentColor") untraceable.
   Note (c)/(d) do **not** require touching HEL-1048's identity call — only saying which default the ring's
   static value follows.

### Non-blocking notes

- **Define the surface *set* explicitly in the guard.** 4.2 says "every declared surface in both theme
  blocks" but not what counts as one. A naive prefix match on `--app-bg*` would sweep in
  `--app-bg-accent` / `--app-bg-secondary`, which are `color-mix(... transparent)` and not parseable as
  hexes. The guard should enumerate by an in-file-justified rule (`--app-bg` plus `--app-surface*`,
  hex-valued only) and **assert the expected count**, so a newly added surface token fails the guard rather
  than being silently skipped — otherwise "re-derives which surfaces bind" is only true of today's set.
- **The guard is partly tautological w.r.t. the derivation** (it recomputes the ring with the same function
  it is checking). That is acceptable here because its *other* input — the surfaces — comes independently
  from `theme.css`, and 4b.2 makes the static declaration a genuinely independent value. Worth stating
  in-file under 4.3's "what it cannot prove".
- **Decision ordering nit:** D6 is placed before D5 in design.md. Harmless, but renumber or reorder.
- **Round 1's HEL-1048 note still stands** — HEL-1048's description claims task 3's work; it should be
  trimmed so the dead-declaration cleanup is not attempted twice. Not a blocker.
- **Yellow cohesion (`#a88106`, an olive/dark-gold) remains a final-gate owner call**, carried by task 5.4/5.6,
  not by the contrast table. I am not ruling on it at the design gate.
- I did **not** drive the browser this round: no code exists yet, so there is nothing rendered to judge, and
  a reading of `main`'s styling would be evidence about the wrong tree. The UI-cohesion gate applies at the
  final gate.

### Two axes

- **What no source text carries:** *perceptibility*. Every artifact reasons in hexes and ratios. A ring that
  clears 3.01 against the surface it is measured on, and a ring clipped by `overflow: hidden`, drawn under an
  overlapping element, or pushed by `outline-offset` onto a *different* surface than the one measured, are
  indistinguishable in all of it. 4.3 admits this for the guard; it is equally true of the design.
- **What path the gates did not exercise:** the pre-settle / fallback render. D6 and 4b now *specify* it,
  which is progress, but the verification is still a Jest equality between two constants — no gate exercises
  the actual window in which `ThemeProvider`'s `useEffect` has not run and `theme.css`'s static declaration
  is what paints. Only task 5's real-browser work can touch that, and 5.1-5.4 currently measure the settled
  state.
