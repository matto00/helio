## Skeptic Report — design gate (round 5, skeptic-design-5.md)

I am a fresh agent. Rounds 1-4, the run brief, and the artifacts' own narrative were read as **claims to
check**, never as facts. Every number below comes from a file I read in this worktree / on `origin/main`,
or from pixels I rendered in **my own headless Chromium**
(`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, driven by the repo's `playwright`). The
shared MCP Playwright session was not touched. I modified no file except this report.

My harness, screenshots and raw measurements:
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/hel774-r5/`
(`harness.js` transcribes tasks 3.2/3.4/3.5/3.6/3.7/3.9/3.17 literally; `measure.js`, `edge.js`,
`matched.js`, `results.json`, `bar-*.png`, `matched-*.png`, `focus-*.png`, `w768-*.png`).

---

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mobile-bottom-nav/spec.md`, `workflow-state.md`, `skeptic-design-4.md`.
**Ground truth read:** `BottomNav.tsx`, `BottomNav.css`, `BottomNav.test.tsx`, `theme/theme.css`,
`sections.ts`, `navDestinations.ts`, `sections.test.ts`, `navDestinations.test.ts`, `App.css`,
`PanelList.css`, `MobileNavSheet.css`, `RefinementChatDrawer.css`, `toast.css`, `DESIGN.md` §0.2/§4/§8,
`openspec/specs/mobile-bottom-nav/spec.md`, `lucide-react@1.14.0`'s `Icon.mjs` + `shapes.mjs`, and
`origin/main`'s `theme.css`/`toast.css`.

| Claim in the plan | Verdict | Evidence |
| --- | --- | --- |
| `origin/main` = `2eaf1d26`, token at `theme.css:90`, **sole** consumer `toast.css:25` (pinned by `toast.css.test.ts:105-107`) | True | `git grep bottom-nav-height origin/main -- frontend` |
| Geometry still inlined at `BottomNav.css:27` and `App.css:424` | True | files read |
| `* { box-sizing: border-box }` at `theme.css:191-193`; global reduced-motion `transition-duration: 0.01ms !important` at `theme.css:244-251`; global focus ring `outline-offset: 2px` | True | file read |
| Lucide emits `width`/`height` as **SVG presentation attributes** (D6's carrier rationale) | True | `dist/esm/Icon.mjs` |
| `Shapes` exists in the installed `lucide-react@1.14.0`; no test pins Data Types' icon identity (only distinctness) | True | `shapes.mjs`; `navDestinations.test.ts:39-41` |
| `BottomNav.test.tsx:24-26` asserts `link.textContent` = short label (task 4.1's premise) | True | file read |
| `DESIGN.md:101-113` overlay-scrim carve-out precedent; `:289-293` focus recipe scoped to "flush list items"; canonical breakpoints 1440/1100/768/430 | True | file read |
| `PanelList.css:79-96` fixed `z-index: 10`, hidden only below 430px (D10) | True | file read |
| No other bottom-anchored fixed chrome is at risk | True | every `position: fixed` + `bottom:` rule: zoom widget (D10), `MobileNavSheet`/`RefinementChatDrawer` (`--z-popover` 99/100), toast (`--z-toast` 1000), all above the nav's `z-index: 5` |
| `openspec validate liquid-glass-bottom-nav --strict` | Passes | `Change 'liquid-glass-bottom-nav' is valid` |
| Delta's three MODIFIED requirement headers match the live spec's, and the retired "Opaque over user dashboard backgrounds" scenario + the "icon **and a label**" requirement text are genuinely replaced, not accumulated | True | diffed against `openspec/specs/mobile-bottom-nav/spec.md` |
| All ten ticket ACs trace to at least one task | True | walked each AC → task(s); see below |

#### The four round-4 blockers, checked against the files and then against pixels

**CR1 — lozenge carrier. RESOLVED (one stale number left).** `design.md:163-170` now has a dedicated
**Carrier** paragraph naming `<span class="bottom-nav__lozenge">`, forbidding the `<svg>`, and requiring a
`1px solid transparent` border on every tab; task 3.8 adds the wrapper in `BottomNav.tsx`, task 3.9 styles
it, task 5.7 asserts the active icon renders, and `spec.md:82-86` adds the scenario. I built exactly that
and measured (375px, DPR 3, both themes):

- active icon `getBoundingClientRect()` = **22 x 22**, `getComputedStyle` = `22px x 22px` — **not** the
  26 x 22 empty ring round 4 rendered from the old wording;
- lozenge = **48 x 32** inside a 55.5 x 54 tab;
- tab 2's icon rect is **byte-identical when active and when inactive** (`148.75, 761, 22, 22` both ways) —
  the always-present transparent border does prevent the shift it was added to prevent.

Still stale: `design.md:173-175` predicts "~30x46px … ~5px clearance … ~13px", which round 4 asked to be
corrected to the rendered 48x32 / ~3.75px / ~11px. See CR-A below — cosmetic, does not change what is built.

**CR2 — `background-clip`. RESOLVED.** `design.md:190-196` now says no declaration is needed or should be
written, explains that an opaque border makes it a no-op (10 cells pixel-identical), and records why it
becomes load-bearing again if the border is weakened to a `color-mix`. Task 3.9 says "do NOT declare" and
task 4.3 says "Do NOT assert". Consistent in all three places.

**CR3 — stale alpha. RESOLVED.** `design.md:72`'s D3 heading now reads **0.55**; D6's convergence algebra is
now stated generically (`C = a*S + (1-a)*B`) with the `rgb(60,55,51)` figure explicitly labelled as measured
at the then-current 0.65. `grep -n "0\.65"` across the four artifacts returns only legitimate uses: the
labels-kept row of D4's table, that labelled historical aside, the proposal's `0.65/35% vs 0.55/45%`
comparison, and the ticket's `(0.65 -> 0.55)` transition note.

**CR4 — focus ring. RESOLVED, and I verified it in pixels since it was prescribed but never rendered.**
D12 (`design.md:308-319`) + task 3.17 + task 5.8 + `spec.md:88-91`. I rendered both recipes and counted
accent-coloured device pixels falling outside the capsule's rounded-rect, at the **first and last** tabs,
both themes:

| recipe | tab 0 | tab 5 |
| --- | --- | --- |
| **planned** (`border-radius: pill` + `outline-offset: -3px`) | **0 px outside** | **0 px outside** |
| shipped (`BottomNav.css:71-74`, square + `-2px`) | 380 px outside, **5.02px** overhang | 358 px outside, **4.82px** overhang |

Identical in dark and light. The control proves the probe is sensitive, and `focus-old-dark-tab0.png`
reproduces round 4's hard orange square breaking out of the pill; `focus-new-dark-tab0.png` shows the
planned ring contained and following the capsule's curve.

#### The load-bearing arithmetic, re-measured independently (rendered, not modelled)

Sampled composited pixels through a canvas, capsule material vs. the strongest ink pixel in an inactive
icon's box, and the lozenge's border on its **straight top edge**:

| theme | backdrop | capsule composite | inactive ink : capsule | lozenge border : capsule | lozenge fill : capsule |
| --- | --- | --- | --- | --- | --- |
| dark | theme `--app-bg` | `rgb(22,21,19)` | 15.90 | 15.90 | 1.02 |
| dark | **white** | `rgb(129,128,127)` | **3.43** | **3.43** | 4.26 |
| dark | black | `rgb(14,13,12)` | 16.92 | 16.92 | 1.09 |
| dark | accent | `rgb(126,65,22)` | 6.89 | 6.89 | 2.18 |
| dark | photo | `rgb(120,111,102)` | 4.29 | 4.29 | 3.44 |
| light | theme `--app-bg` | `rgb(249,247,244)` | 15.66 | 15.66 | 1.04 |
| light | white | `rgb(254,253,252)` | 16.48 | 16.48 | 1.01 |
| light | **black** | `rgb(139,138,137)` | **4.86** | **4.86** | 3.19 |
| light | accent | `rgb(245,178,142)` | 9.28 | 9.28 | 1.71 |
| light | photo | `rgb(245,236,227)` | 14.34 | 14.34 | 1.13 |

- Worst case **3.43:1** against the 3:1 floor, vs. the plan's published 3.44 — reproduces to 0.01. Every
  cell clears the floor. The claimed identity "one number governs the border and the inactive icon" holds
  exactly in rendered pixels (columns 4 and 5 are equal in all ten cells), for the stated reason.
- The fill/border complementarity the widened matrix in task 5.6 exists to catch is real: fill converges to
  1.01-1.09 exactly where the border is 15.7-16.9, and carries 3.19-4.26 exactly where the border is weakest.
- `design.md`'s claim that the theme-matched capsule sits within ~5/255 of the page (`rgb(18,17,16)` →
  `rgb(23,21,19)`) reproduces: I measured page `rgb(17,16,15)` → capsule `rgb(22,21,19)`.
- Capsule **edge** vs page at `--app-border-strong`: **1.63 dark / 1.51 light** (Risks says ~1.42 — the plan
  is slightly conservative, which is the harmless direction). Identical at 375 / 430 / 768px.
- Geometry: capsule 351 x 56 inset 12px on all three edges, `border-radius` computed `9999px`,
  `backdrop-filter: blur(12px)`, tabs 55.5 x 54 (>= 44 both axes) at 375px; 406-wide at 430px; 744-wide with
  121px tabs at 768px.

#### UI / design judgment — my own renders, DPR 3, 375x812, both themes

- **Over a photo it genuinely reads as the reference** (`bar-dark-photo.png`, `bar-light-photo.png`). The
  copper, green, white and black of the synthesised image all transmit and stay recognisable; glyphs are
  solid; the pill floats. AC 3 is achievable as specified, and the tint — not the blur — is visibly what
  carries the glyphs.
- **Over the theme-matched default** — the case five of six destinations actually have
  (`matched-dark.png`, `matched-light.png`) — it reads as a clean, quiet floating pill. This is the case I
  was most prepared to fail it on, because the material is within 5/255 of the page; the hairline and the
  layered shadow do carry it. I judge it correct, not under-drawn, and consistent with how iOS bars read
  over flat backgrounds.
- **The active lozenge is a real, recorded divergence from Instagram and I agree with round 4 that it is
  acceptable.** A full-strength ink hairline reads as an *outlined chip* rather than the reference's soft
  borderless patch, and in light theme that black ring is the heaviest mark in the bar (its 4.86-15.66:1
  dwarfs the capsule's own 1.51:1 edge). D6 states this divergence plainly and my own numbers confirm its
  premise — a borderless neutral fill converges to 1.01-1.09:1 over theme-matched backdrops and cannot be
  made to carry the state. Shipping it is the right call; it is the thing I would look hardest at in the
  final gate.
- **Icons at 22px:** `LayoutDashboard`, `Database`, `ChartNoAxesColumn`, `MessageCircle` read conventionally;
  `Workflow` is abstract but conventional for a pipeline graph; `Shapes` (triangle + square + circle) reads
  as "kinds of things" and is a clear improvement on `BookOpen`, which at 22px is unmistakably a book and a
  dead end without a label. D11's diagnosis is correct and its scope-widening argument (the registry is the
  single source of truth; splitting it would breach exactly the guarantee `navDestinations.ts` enforces) is
  right.
- **Product-owner checklist**, item by item: carve-out replaces the invariant with a *stated* floor
  (tasks 2.1-2.3) with everything else explicitly opaque (task 2.6) ✓; capsule inset from three edges, fully
  rounded, small blur, high transmissivity, tint between blur and glyphs, inner lozenge ✓; tint recorded as
  load-bearing (D3, spec "Translucent, not frosted") ✓; contrast measured over photo/white/black/accent with
  escalation-not-ship if any fails (task 5.5, D3's "measurement wins", Risks) ✓; the labels basis recorded as
  the real 4.5:1-vs-3:1 floor and the alpha it buys, with the earlier circular claim named as circular
  (D4:98-111) ✓; safe-area + 44px verified by `getComputedStyle` with a non-zero simulated inset and a
  base/`@media` ordering review (tasks 3.14, 5.2, 5.3) ✓; `backdrop-filter` cost under 4x CPU throttle
  against a stated threshold (task 5.11) ✓; reduced motion disabled via `transition: none` because
  `transition-duration` is globally overridden, asserted on the rendered element (D8, tasks 3.13, 5.9) ✓;
  accessible names from the computed AX tree via CDP, not markup (task 5.4) ✓; discoverability accepted with
  HEL-554 named (D4) ✓.

---

### Verdict: CONFIRM

All four of round 4's blockers are structurally fixed, and I verified the two that had never been rendered —
the lozenge carrier and the focus ring — in my own pixels, with a control proving each probe is sensitive.
Every published contrast figure reproduces in an independent render to within 0.01. The plan is
implementable as written: I built the exact CSS the tasks specify and it produces a correct, legible,
good-looking bar in both themes over all five backdrops.

What remains are five stale sentences and a few judgment calls that belong to the built artifact, not to the
plan. None of them changes a line of the code that will be written, and every one is inside the executor's
own change directory. Under the stopping rule I was given, these are category (b): **nothing here needs the
product owner, and nothing here justifies stopping the run.** They are written as numbered change requests
anyway so the executor can discharge them in-flight and the final gate can check them off.

### Change Requests (NON-BLOCKING — fix during execution, verified at the final gate)

1. **`design.md:34` Non-Goals says "Changing the six destinations or `sections.ts`" — which D11
   (`:291-306`), task 3.12 and `proposal.md:63`'s Impact all contradict.** `proposal.md:72` has the same
   stale clause ("or the `sections.ts` registry") against its own Impact line. Reword both to what is
   actually meant: the six *destinations* don't change; `sections.ts` gains one corrected icon. (Left
   as-is, this is the one line in the record that could make an executor skip task 3.12 or stop to
   escalate.)
2. **`design.md:177-178` still says "The active **label** therefore sits on plain capsule material like
   every other label"** — a leftover from the labels-kept draft, contradicting D4, task 3.10 ("there is no
   active-label treatment because there are no labels") and task 3.11. Delete the sentence.
3. **`design.md:173-175`'s lozenge box figures were not corrected** (round 4's CR1 item 2). Measured:
   the box is **48 x 32** (not ~30x46), leaving **~3.75px** to the tab's edges and **~11-12px** to the
   capsule's inner top/bottom (not ~5px/~13px). The conclusion — it fits, it reads as an inner lozenge, a
   tab-sized lozenge would not — is unchanged and correct; only the numbers are wrong.
4. **Decide `shortLabel`'s fate, either way.** After task 3.11 it has zero consumers, and both
   `sections.ts:37-39` and `navDestinations.ts:15-18` carry doc comments explaining it as existing for
   "`BottomNav`'s six 72px phone tabs" — a surface that will no longer exist. Removing it is cheap (no test
   pins it); keeping it for future labelled surfaces is equally defensible. What is not acceptable is
   leaving a comment that describes a removed feature.
5. **The ADDED reduced-motion requirement presumes a transition that task 3.13 tells the executor not to
   invent.** `spec.md:144-153` asserts "the active lozenge's transition between tabs" exists and is removed
   under `prefers-reduced-motion`. If the executor adds a fade, everything is consistent; if they correctly
   decline to invent motion, reword the requirement/scenario conditionally ("any motion the bar introduces
   SHALL be…") so the archived spec doesn't describe behaviour that was never built.

### Non-blocking notes (for the final gate)

1. **The two things I would judge hardest on the built article**, both already recorded as risks: the
   capsule's edge over a theme-matched backdrop (measured 1.63 dark / 1.51 light — present but quiet, and
   the only thing separating bar from page), and the active lozenge's ink ring now being the strongest mark
   in the bar by ~3x over the capsule's own hairline. Both are legitimate as designed; both are judgement
   calls best made from the screenshots task 5.5 retains.
2. **At 768px the capsule is 744px wide with 121px tabs** and reads stretched — six small glyphs marooned in
   a very long pill (`w768-light.png`). Not a regression (today's bar is full-bleed there too) and in no AC,
   but a `max-width` + `margin-inline: auto` would cost one declaration.
3. **`Shapes` has its own residual ambiguity** worth one sentence in D11, since the PO asked for ambiguity to
   be named rather than papered over: it is also the canonical *drawing-tools* glyph in design software.
   Still clearly better than `BookOpen`; I would ship it.
4. **Below ~330px viewport width the 48px lozenge exceeds its tab** ((V-42)/6 < 48). 375px is the narrowest
   width in the ticket, the spec matrix and `DESIGN.md` §4, so this is out of scope — worth one glance at
   the final gate only if the support floor ever moves.
5. **Tabs measure 54px tall, not 56** (capsule minus its 1px borders under `align-items: stretch`).
   Comfortably over the 44px floor; mentioned so a 54 in the executor's own assertion output isn't mistaken
   for a defect.
6. **`.bottom-nav__tab`'s `flex-direction: column; gap: 2px`** (`BottomNav.css:34-38`) becomes vestigial with
   one child; tidy it while task 3.11 is in the file.
7. **The "legibility survives without `backdrop-filter`" scenario is covered by construction**, not by a
   dedicated task: blur cannot move a uniform backdrop's mean, so task 5.5/5.6's white / black / accent cells
   *are* the no-blur numbers. No extra task needed — recorded so the final gate doesn't read it as a gap.
8. **`workflow-state.md:16`** still reads `REFUTE (design round 3; rounds 1-3 used of 5)`; orchestrator
   bookkeeping, not a design artifact.
9. Credit where due: I set out to break this plan's arithmetic and could not. Three independent parties have
   now derived the same worst case (3.43-3.44:1) two different ways, the carrier and focus fixes hold up in
   pixels, the PO's decision is recorded with its real basis rather than a flattering one, and the
   verification matrices are the ones that actually cover the failure modes. Building it is the right next
   step.
