## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I am a fresh agent. Rounds 1 and 2, the run brief, and the revised `design.md` narrative were read as
**claims to check**, never as facts. Every number below comes from a file I read in this worktree /
on `origin/main`, from arithmetic I implemented myself, or from pixels I rendered in my own headless
Chromium (`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome` — the shared MCP Playwright
session was not touched). Every rendered measurement was run twice and reproduced byte-identically.

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mobile-bottom-nav/spec.md`, `skeptic-design-1.md`, `skeptic-design-2.md`.
**Ground truth read:** `frontend/src/theme/theme.css` (this branch and `origin/main`),
`BottomNav.css`, `BottomNav.tsx`, `DESIGN.md` §0.2 / §3, `theme.ts`.

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Branch base `d7815d15`, only the untracked change dir present | True | `git status --porcelain`, `git log --oneline -3` |
| HEL-535 merged; `origin/main` = `2eaf1d26`; `--bottom-nav-height` at `theme.css:90` | True | `git log --oneline -1 origin/main`; `git show origin/main:frontend/src/theme/theme.css \| sed -n '84,96p'` |
| Token values used in every calculation | True | `theme.css:101/102/105/107/108/115` (dark), `:148/149/152/154/159/164` (light), `:25`, `:48-50`, `:61`, `:67`, `:137-138/184-185` |
| `theme.css:244-251` global `transition-duration: 0.01ms !important` (D8's reasoning) | True | read directly |
| `openspec validate liquid-glass-bottom-nav --strict` | Passes | `Change 'liquid-glass-bottom-nav' is valid` |
| D2/D3 table, min alpha 0.6322 (dark) / 0.5252 (light) for 4.5:1 | **True, reproduced** | own bisection over {white, black, 8 presets, per-theme default accent} × {dark, light} |
| D6's accent-icon claim (**round 2's CR2**): −0.18 to −0.38 dark, min 4.29:1, no dark preset under 3:1; light −0.07..−0.14, stays 1.80–3.5:1 | **True, reproduced exactly** | dark Red 4.70→4.51, Purple 4.47→4.29, Yellow 9.23→8.85; worst backdrop is white in dark, black in light |
| D6's "1.02–1.15:1 fill-vs-capsule over theme-matched backdrops" (why an absolute fill token fails) | **True, reproduced in rendered pixels** | 1.02:1 in both themes over `--app-bg` |
| D6's active-label figures 14.8:1 (dark) / 15.7:1 (light) on the lozenge | True | recomputed |
| D6's **border-vs-capsule 3.24:1 (dark) / 3.79:1 (light)** — the load-bearing new claim | **Reproducible only under a paint model the plan never specifies and CSS does not default to** | see CR1; rendered 3.26 / 3.82 with `background-clip: padding-box`, **2.51 / 2.58 with the CSS default** |

**Rendered evidence.** I built the specified material for real — capsule `left/right/bottom: 12px`,
`height: 56px`, `border-radius: 9999px`, `padding: 0 8px`, `backdrop-filter: blur(12px)`, a `::before`
tint of `--app-surface` at `opacity: .65`, `--app-shadow-soft` + `--app-border-subtle`; lozenge
`background: color-mix(in srgb, <surface> 95%, transparent)` and
`border: 1px solid color-mix(in srgb, <text> 70%, transparent)` — and sampled composited pixels through
a canvas at DPR 1 and screenshotted a six-tab mock at DPR 2 in both themes over four backdrops.
`getComputedStyle` confirms `color-mix(... 70%, transparent)` resolves to `color(srgb … / 0.7)` and the
fill to `/ 0.95`, so the tokens behave as the plan assumes. Screenshots retained at
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/*.png`.

---

### Round 2's CR1–CR4 and notes, as a checklist

| Item | Status |
| --- | --- |
| **CR1** invisible lozenge | **Partially resolved — the diagnosis is right, the remedy's arithmetic is not.** The redefinition (fill for depth, *relative* border for visibility) is the correct move and D6's explanation of why an absolute fill token converges is exactly right and reproduces. But the border's stated ratios are computed as if the border composited directly onto the capsule; the specified CSS composites it onto the lozenge's own 0.95 fill first, which costs 0.7–1.2 of contrast and drops both worst cases below the plan's own 3:1 floor. And task 5.5's backdrop matrix excludes, by construction, the only backdrops where the border converges. → **CR1 below.** |
| **CR2** false "unchanged, not worsened" accent claim | **Resolved.** D6:175-181 and task 2.4 now carry measured numbers, and I reproduce every one of them (−0.18..−0.38 dark, min 4.29:1, four light presets below 3:1 pre-existing). Task 2.4 constrains `DESIGN.md` to claim exactly that. One residual overclaim in the word "unchanged" for light theme — non-blocking note 2. |
| **CR3** border-radius not assertable via `getComputedStyle` | **Resolved** (task 5.2 + spec:47-51 now sample rendered pixels). The chosen probe is weaker than the word "semicircular" — non-blocking note 3. |
| **CR4** reduced motion verified only by parsing CSS | **Resolved.** New task 5.7 renders under emulated `prefers-reduced-motion`; task 3.10 requires the block be placed after the rule it overrides; 4.1 keeps the source assertion as a second net. D8's `transition: none` reasoning re-verified against `theme.css:244-251`. |
| Note: stale `theme.css:86` | **Partially missed.** Removed from task 3.1, **still present at `design.md:121`**, which now contradicts `design.md:236` ("token at `theme.css:90`") in the same document. |
| Note: `@supports` fallback is a no-op | Resolved (task 3.4 "write no `@supports` block"; D9 explains; 4.1 no longer pins it). |
| Note: spec ink wording ambiguous | Resolved (`spec.md:6-9` now separates labels / inactive icons / active icon unambiguously). |
| Note: paint order | Resolved (task 3.5). |
| Note: AC 3 has no evidence artefact | Resolved (task 5.4 retains screenshots). |
| Note: capsule edge is load-bearing | **Recorded but not acted on.** The Risks entry is now there; the edge itself is still unspecified and unmeasured. → **CR3 below.** |

Round 1's CR1–CR7 spot-checked: all still resolved (floor scoped to the translucent material; safe-area
offset `inset + env` in D5/task 3.2 with `padding-bottom` retired in 3.3 and a non-zero-inset re-run in
5.3; tint token/blur/inset/capsule padding all named; preflight merges `origin/main`;
`--app-radius-pill`; `-webkit-` prefix; zoom widget). Task coverage traces to all ten ticket ACs.

---

### Verdict: REFUTE

Three rounds in, the plan's structure is genuinely good: the contrast model is real and reproduces to
two decimals, the token seam is complete and correct, the geometry contradictions are gone, the
accent-icon claim is now measurably true, and D6's diagnosis of *why* a neutral-ramp fill cannot carry
the active state is exactly right.

It fails again on the same failure shape, one layer further in: **the number that carries the remedy is
derived from a model of the CSS rather than from the CSS**, and **the verification task written to catch
it excludes the failing case by construction** — the identical structural blind spot round 2 found
(every glyph task passed with an invisible lozenge; now the lozenge task passes with an invisible
border). Two further gaps are specification holes on exactly the two elements the plan itself calls
load-bearing: the lozenge's box and the capsule's edge.

**These are convergent.** Nothing here questions the premise. The carve-out is sound, the tint-carries-
legibility mechanism is proven, and CR1 is a one-declaration fix plus two extra rows in a measurement
matrix. I do **not** think this needs to go back to the product owner — with one exception, flagged in
CR4, which is a decision the PO may want to weigh with true numbers rather than a design defect.

---

### Change Requests

**1. [Highest] The lozenge border's 3.24:1 / 3.79:1 is the value for a paint model the plan never
specifies. Under the CSS the plan *does* specify, it is 2.51:1 / 2.58:1 — below the floor this change
writes into binding `DESIGN.md` — and task 5.5 cannot detect that, because its backdrop matrix excludes
the only backdrops where it happens.**

Task 3.8 specifies `background: color-mix(… 95%, transparent)` + `border: 1px solid color-mix(in srgb,
var(--app-text) 70%, transparent)` and nothing else. CSS defaults to `background-clip: border-box`, so
the element's own 0.95 fill paints **under** its border: the rendered border pixel is
`0.7·text over (0.95·surface over capsule)`, not `0.7·text over capsule`. Rendered, DPR 1, sampled on
the lozenge's straight top edge, reproduced identically on two runs:

| case | capsule px | border px (as specified) | border-vs-capsule | with `background-clip: padding-box` |
| --- | --- | --- | --- | --- |
| dark theme / **white** dashboard bg | rgb(106,105,103) | rgb(178,175,171) | **2.51:1** | rgb(202,199,195) → **3.26:1** |
| light theme / **black** dashboard bg | rgb(165,164,163) | rgb(98,94,92) | **2.58:1** | rgb(72,69,67) → **3.82:1** |
| dark theme / theme-matched `--app-bg` | rgb(23,21,19) | rgb(177,174,170) | 8.24:1 | 8.24:1 |
| light theme / theme-matched `--app-bg` | rgb(250,249,246) | rgb(99,95,93) | 6.00:1 | 6.00:1 |

The padding-box column reproduces D6's 3.24 / 3.79 to within rounding — that is the model the planner
used. My independent closed-form model agrees with both columns to 0.03. In the light/black case the
**fill** gives only 2.33:1, so *no* part of the lozenge clears 3:1 there.

Why the verification cannot save it: task 5.5 measures "over at least the theme-matched `--app-bg` and
one theme-matched dashboard preset". Those are precisely the backdrops where the border scores 6–8:1.
The border's convergence region is the exact complement of the fill's — theme-**mismatched** extremes,
i.e. the white and black dashboard backgrounds the ticket's AC 5 mandates. As written, an executor
implements 3.8 verbatim, runs 5.5, reads 7.3:1, and ships a bar that violates the floor 2.4 and the spec
requirement (`spec.md:12`, stated unconditionally) just put into binding `DESIGN.md`.

Required:

1. State the paint model in D6 and in task 3.8 — `background-clip: padding-box`, or an `outline`, or an
   opaque border colour mixed against the surface rather than against `transparent`. Whichever is
   chosen, re-derive D6's two numbers from what that CSS actually renders and say which model they
   assume.
2. Extend task 5.5's matrix to include the theme-**mismatched** extremes (dark-over-white,
   light-over-black) and at least one accent-coloured backdrop — the ticket's own AC 5 list. Keep the
   theme-matched cases; they cover the fill's failure mode. Mirror the widened matrix into the spec
   scenario at `spec.md:31-35`, which today is scoped to theme-matched backdrops only while the
   requirement it supports (`spec.md:12`) is unconditional.
3. State how the border pixel is sampled. On a pill the left/right extremes are the curve apex, where
   antialiasing dilutes a 1px border: sampling there instead of on the straight top edge moved my
   padding-box dark/white reading from 3.26 to 3.08. With a 3:1 floor and ~0.1–0.3 of headroom, the
   sampling rule is part of the acceptance signal, not an executor detail.

**2. [High] The lozenge's box is entirely unspecified — and the natural reading of the current tasks
produces a full-tab-height ring that arguably fails ticket AC 4.**

Task 3.8 specifies the lozenge's fill and border and nothing about its geometry: no height, no inset
within the capsule, no width relative to the tab, no radius. Task 3.2 sets the capsule to **no vertical
padding**, and the tab is `flex: 1` (≈55.8px wide at 375px) at the full 56px height — so the obvious
implementation (`.bottom-nav__tab--active { background; border; border-radius }`) yields a lozenge
55.8×56 whose radius clamps to 28: a circle-ish ring that touches the capsule's top and bottom edges and
sits edge-to-edge with its neighbours. I rendered it (`dark-default-planned.png`): its border collides
with the capsule's own inner edge and it reads as a stray ring, not as "an inner lozenge **within** the
capsule" (AC 4) or the reference's inset rounded rect.

Required: specify the lozenge's box in D6 and task 3.8 — vertical inset from the capsule (i.e. its
height), horizontal extent relative to the tab, and radius — in `--space-*` tokens, with the resulting
dimensions at 375px stated the way D4 states the tab fit. This is the same class of gap round 1's CR3
closed for the capsule; the lozenge is now the more load-bearing of the two and was left open.

**3. [High] The capsule's own edge is declared load-bearing in Risks, then left unspecified and
unmeasured — the same asymmetry that produced CR1 in round 2.**

`design.md:239-242` states that over a theme-matched backdrop the capsule composite sits within ~5/255
of the page colour, so "figure-ground separation for the whole bar rests on the shadow and hairline of
task 3.6". Task 3.6 says "a layered shadow (`--app-shadow-soft` family) and a hairline border" — it does
not say which border token. `--app-border-subtle` and `--app-border-strong` differ by 2× in alpha
(`theme.css:110-111` / `:161-162`), and in my light-theme render at `--app-border-subtle` the capsule's
edge against the page measures ≈1.16:1 and is very nearly invisible (`light-default-planned.png`); at
`--app-border-strong` it is ≈1.42:1. Nothing in tasks 5.x looks at the capsule edge at all.

Required: (a) name the border token (and, if a non-token value is intended, say so and justify it against
`DESIGN.md`'s two-token border vocabulary); (b) add the capsule-edge-vs-page case to the retained
screenshot evidence of task 5.4 over a theme-matched backdrop in both themes, so the final gate judges
it from an artefact rather than re-deriving it. A numeric floor is not required here — a stated token
plus evidence is.

**4. [Medium] D4's "It costs nothing under D2" is false, and it is the one sentence in the plan the
product owner explicitly asked to be recorded truthfully.**

D1 states the floor is 4.5:1 rather than 3:1 **because** the labels are 10px text: "small text is the
binding element". D4 then justifies keeping the labels partly on "It costs nothing under D2. The floor
is met by full-contrast ink at alpha 0.65 *with* labels present." That is circular — the 4.5:1 floor
exists because of the labels. The cost is measurable, and it is paid in exactly the property the ticket
calls the reference's defining quality:

| governed floor | min tint alpha (dark / light) | backdrop transmitted |
| --- | --- | --- |
| 4.5:1 — labels present (as planned) | 0.6322 / 0.5252 → ships **0.65** | **35%** |
| 3:1 — icons only, WCAG 1.4.11 | 0.5062 / 0.4122 → could ship ~0.51 | **≈49%** |

Keeping labels therefore costs ~14 points of transmissivity — a ~40% relative reduction in how much of
the user's background reads through the bar — on the axis the ticket describes as "the blur radius is
small and the surface is highly transmissive". (What it does *not* cost is the inactive-ink change:
`--app-text-muted` needs alpha ≈0.79 even for 3:1, so D2's ink conclusion holds either way. Worth saying
so, since it is the natural counter-question.)

Required: restate D4's third bullet with the real trade — the alpha the icon-only floor would permit,
the transmissivity difference, and why discoverability still wins — or revisit the decision. I am not
asking for the labels to be dropped; I am asking that the recorded reasoning be true, because
`design.md` is the artefact the ticket's "record the reasoning" AC is satisfied by and because this is
the one item on which the product owner may reasonably want to weigh in with correct numbers. While
there: D2's ink change also flattens the bar's active/inactive hierarchy (all six tabs become
full-contrast; today five are muted), which is a real visual consequence recorded nowhere.

---

### Non-blocking notes

1. **`design.md:121` still says `theme.css:86`** while `design.md:236` says `theme.css:90`. The
   executable instruction (task 3.1) is already line-number-free and correct; fix the prose so the
   document stops contradicting itself.
2. **"Light theme is effectively unchanged" is a small overclaim** for a sentence headed into binding
   `DESIGN.md`. Measured, light theme moves −0.07 to −0.14 (e.g. Purple 3.86→3.71). Task 2.4 says
   "unchanged". Say "changes by at most 0.14, within a pre-existing 1.80–3.71:1 shortfall this ticket
   neither introduces nor materially moves".
3. **Task 5.2's semicircular probe is weaker than the word it verifies.** "Corner pixel is backdrop,
   left-edge/vertical-centre is capsule" also passes for `border-radius: 8px`. A probe that actually
   distinguishes a pill: the pixel at `(left + height/4, top)` must still be backdrop.
4. **Task 5.7 should say how it reads the lozenge.** If the lozenge lands on a pseudo-element, the
   assertion needs `getComputedStyle(el, '::before')`; a bare `getComputedStyle(el)` will report the
   tab's own (pre-existing) `transition: color`, which is not the added motion.
5. **The added motion may not exist.** The spec's ADDED requirement and task 3.10 both speak of "the
   lozenge's transition between tabs", but with a per-tab lozenge nothing moves — at most a
   background/border fade. Round 1 raised this; it is harmless (the requirement is satisfied vacuously),
   but the executor should not invent motion to have something to disable.
6. **Task 3.8's aside is imprecise.** `--app-surface-strong` is not "visually identical to the capsule"
   in general — it converges only over theme-matched backdrops, which is what D6 correctly explains.
7. **A `color-mix(--app-text 70%)` hairline is outside `DESIGN.md`'s border vocabulary** (§3 lists
   exactly `--app-border-subtle` / `--app-border-strong`, and it is 3.5–7× stronger than either). It is
   not a `[mechanical]` violation — it is token-derived, not a hardcoded hex — but this change is
   *editing* `DESIGN.md`, so a one-off border recipe stronger than any documented one deserves an
   explicit sentence (or its own token) rather than arriving silently.
8. **Fidelity, for the final gate, from my renders.** Over theme-matched backdrops the bar reads as a
   clean floating pill (edge carried by shadow + hairline — see CR3). Over a photo, colour genuinely
   bleeds through but muted; "recognisable" is defensible, not generous. The element I would watch
   hardest is the active indicator: as specified it reads as a thin outlined ring rather than the
   reference's lighter filled patch, and its 70%-ink hairline is the strongest edge anywhere in the bar
   — stronger than the capsule's own. That is a legitimate design choice, but it is a *different*
   mechanism from the reference, and CR2's geometry decision is what determines whether it reads as a
   lozenge at all.
9. Credit where due: `openspec validate --strict` passes; the delta retires contradicted scenarios
   rather than stacking them; D6's convergence analysis is correct and non-obvious; the accent numbers
   are now honest and reproduce exactly; and every round-2 verification-shape complaint (rendered
   pixels for radius, emulated reduced motion, retained screenshots) was folded in properly.
