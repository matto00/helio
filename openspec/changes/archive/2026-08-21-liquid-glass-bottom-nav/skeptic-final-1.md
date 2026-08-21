## Skeptic Report — final gate (round 1, skeptic-final-1.md)

I am a fresh agent. `evaluation-2.md`, `skeptic-design-5.md` and the run brief were read as **claims to
check**, never as facts. Every number below comes from a gate I ran myself in this worktree, a file I
read here, or pixels I rendered in **my own headless Chromium**
(`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, driven by `playwright-core` 1.55.1 from
the repo-root `node_modules` — the worktree's `frontend/node_modules` has no `playwright-core`). The
shared MCP Playwright session was **not** touched. PNG decoding is a hand-rolled `zlib` decoder
(`png.js`, self-tested: white-on-black round-trips to exactly 21.00), so no browser-side canvas could
launder a sampled pixel. I modified no file except this report.

Harness, raw measurements and ~60 renders:
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/hel774-final/`
(`png.js`, `matrix.js`/`matrix.json`, `checks.js`, `checks2.js`, `checks3.js`, `focusprobe.js`,
`presets.js`, `chat2.js`/`chat3.js`, `empty2.js`, `toast.js`, `shots/*.png`).

Servers: `start-servers.sh` reused healthy servers on 6206/9113; `assert-phase.sh servers` → `PASS servers`.

Tree verified: `HEAD e75472af`, `origin/main 09a7a65c`, `git merge-base origin/main HEAD == 09a7a65c`
(merge-base equals the main tip, so `git diff origin/main HEAD` is exactly this run's work). Diff is
**12 code files** + this change's own openspec artifacts — no more.

---

### What I verified (with evidence)

#### 1. Gates — all re-run by me, exit codes read

| Gate | Where | Exit | Result |
| --- | --- | --- | --- |
| `npm run lint` | worktree root | 0 | PASS (`eslint . --max-warnings=0`) |
| `npm run format:check` | worktree root | 0 | PASS — "All matched files use Prettier code style!" |
| `npm test` | worktree `frontend/` | 0 | **246 suites / 2625 tests, 0 failures** |
| `npm run build` | worktree `frontend/` | 0 | PASS (tsc + vite; only the pre-existing >500 kB chunk advisory) |
| `npm run check:openspec` | worktree root | 1 | **exactly one issue**: `change "liquid-glass-bottom-nav" is complete (46/46) but not archived` — the pre-approved HEL-657 false positive, and nothing else in the output |
| `openspec validate liquid-glass-bottom-nav --strict` | worktree | 0 | `Change 'liquid-glass-bottom-nav' is valid` |
| `jest --testPathPatterns="toast.css.test\|BottomNav\|sections\|navDestinations"` | worktree `frontend/` | 0 | 5 suites / 55 tests pass — `toast.css.test.ts` (the token consumer) genuinely runs and passes |

`e75472af`'s bypass disclosure ("`git commit -n` skips only `check:openspec`") matches what I measured.
`tasks.md` is 46/46 with zero unchecked items.

#### 2. Contrast, from rendered pixels (my own decoder, 10 theme × backdrop cells at 375px, DPR 3)

Backdrops applied through the real app path (`--dashboard-background-override` on `.app-shell`); the
"photo" case is a synthesised 375×812 image placed so a copper disc, a red stripe, a saturated green
block, a pure-white patch and a dark slate band all fall directly under the capsule.

**Inactive-icon ink vs the adjacent composited material** — the governed floor. Both the extreme pixel
and a rank-4 robust sample; they agree to 0.00 in every cell.

| backdrop | dark | light |
| --- | --- | --- |
| theme `--app-bg` | 15.90 | 15.66 – 15.83 |
| pure white | **3.43** (worst overall) | 16.48 – 16.66 |
| pure black | 16.92 | **4.86** – 4.91 |
| accent | 6.89 | 10.27 – 10.39 |
| synthesised photo | 6.47 – 10.68 | 7.81 – 11.07 |

**0 of 50 governed cells below 3.0.** Worst 3.43:1 — reproduces the published 3.43/3.44 to 0.01.

**Active-lozenge BORDER vs the adjacent capsule material**, sampled on the straight top edge at the
lozenge's horizontal midpoint (`x = 146` css), never at a curve apex. I dumped the raw pixel column
across the edge rather than trusting an aggregate — the 1px border resolves to **exactly `--app-text`
with zero antialiasing** at DPR 3 (dark `rgb(242,239,233)`, light `rgb(33,29,25)`), with capsule
material immediately above and lozenge fill immediately below:

| case | border : capsule | fill : capsule |
| --- | --- | --- |
| dark / white (theme-mismatched) | **3.43** | 4.26 |
| light / black (theme-mismatched) | **4.86** | 3.19 |
| dark / accent | 6.89 | 2.18 |
| light / accent | 10.27 | 1.56 |
| dark / photo | 8.75 | 1.73 |
| light / photo | 8.97 | 1.77 |
| dark / `--app-bg` | 16.00 | 1.03 |
| light / `--app-bg` | 15.66 | 1.04 |

Worst boundary **3.43:1**, clearing the 3:1 floor, matrix including both theme-mismatched extremes.
The design's premise is confirmed in my own pixels: the fill converges to 1.01–1.09:1 exactly over the
theme-matched backdrops that five of six destinations have, and carries 3.19–4.26 exactly where the
border is weakest — the two are complementary, and only the border can carry the state everywhere.

> **Correction to `evaluation-2.md`** (does not change the verdict): its "Active lozenge boundary"
> table gives the dark/white worst case as **4.26**. 4.26 is the *fill*-vs-capsule figure; the
> *border* measures **3.43** there. The floor still holds (3.43 > 3.0, and it matches `design.md`'s own
> modelled 3.44), so AC 5's second floor is met — but the evaluation report's figure is mislabeled and
> 0.83 optimistic. Recorded so nobody later "verifies" against 4.26.

**Active icon actually renders.** In all 10 cells the active tab's `<svg>` measures **22 × 22** inside
a **48 × 32** lozenge with **1792–1799** non-fill glyph pixels present — not the 26 × 22 empty ring an
earlier draft produced. Icon rect is byte-identical active vs inactive (the always-present transparent
border does its job).

**Accent-on-lozenge across all 8 presets**, computed from the fills I measured (dark `rgb(25,23,21)`
glass vs `rgb(26,24,22)` with the bar forced opaque; light `rgb(253,252,250)` identical either way):
dark minimum **4.52** (Purple), and the change *raises* it by +0.04…+0.09 rather than dropping it;
light 1.87–3.86 with a delta of **0.00**, i.e. the light shortfall is provably pre-existing and
untouched. `DESIGN.md`'s claim ("at most −0.49 in dark, nothing below 4.24; light moves at most 0.18")
is conservative in the safe direction, not false.

#### 3. Transmissivity — AC 3

Bar-visible vs bar-hidden control screenshot of the same backdrop, sampled across the capsule interior
above the icon row: per-channel SD retention **0.435 / 0.514 / 0.479** (dark) and **0.465 / 0.459 /
0.462** (light), with per-channel correlation to the un-occluded backdrop of **0.885–0.946**. The
backdrop's colour structure survives; it is attenuated, not flattened. Confirmed by eye — see §5.

#### 4. Iron Laws / mechanical claims, each re-derived

- **Accessible names from the computed AX tree** (CDP `Accessibility.getFullAXTree`, tied to the six
  `.bottom-nav__tab` elements by `backendNodeId` via `DOM.querySelectorAll` + `DOM.describeNode` — not
  markup): all six resolve `role=link`, `ignored=false`, name = full destination label, each with
  `sources=[attribute(aria-label)]`. **0** link/button nodes anywhere in the tree have an empty name.
- **Touch targets from `getComputedStyle` + rects on rendered elements**, both themes, at 320 / 375 /
  390 / 430 / 768 / 769 / 1100 / 1440: computed `min-width`/`min-height` = `44px` at every rendered
  width (not shadowed by any later equal-specificity `@media` — `.bottom-nav__tab {` occurs once in the
  stylesheet and the new test pins that); smallest rendered tab **46.33 × 54** at 320px, 55.5 × 54 at
  375, 64.66 × 54 at 430, 121 × 54 at 768. `display: none` at 769/1100/1440. **0** horizontal overflow
  at every width. Capsule 351 × 56 at 375px with insets **12 / 12 / 12** on all three edges at every
  phone width.
- **Safe area with a non-zero simulated inset** (CDP `Emulation.setSafeAreaInsetsOverride`, top 47 /
  bottom 34), both themes: `env(safe-area-inset-bottom)` reads **34**; capsule height stays **56**
  (uncrushed — the removed `padding-bottom: env(...)` genuinely did not survive); tabs stay **54**; gap
  below the capsule **46 = 12 + 34**; `.app-content` padding-bottom **68 → 102 = 56 + 12 + 34**. The
  HEL-772 command bar independently grows **56 → 103** and `.app-content`'s top tracks it to 103.
  **Overlap between the two chromes: 0px** in both configurations.
- **`prefers-reduced-motion`**, asserted on the rendered `.bottom-nav__lozenge` under context-level
  emulation: `transition-property: none` (baseline without emulation: `background, border-color` @
  0.16s). Removed, not shortened.
- **Focus ring, from pixels, `:focus-visible` reached by real `Tab` presses** (verified
  `el.matches(":focus-visible") === true`, not `.focus()`): `outline: rgb(249,115,22) solid 2px`,
  `outline-offset: -3px`, and **0 accent pixels outside the capsule's pill** at the first and last tabs
  in both themes; nearest ring pixel **2.00px inside** the boundary. Controls prove the probe is
  sensitive: §8's recipe applied literally (radius 0, `-2px`) leaves **455 / 433** pixels outside with a
  **5.02px** overhang, and the app-wide `+2px` default leaves **2764 / 2712** outside.
- **`backdrop-filter` cost**, 4× CPU throttle, 150-step scroll of a dense route: glass **p95 17.2ms,
  0/149 long frames**; the same scroll with the bar forced opaque **p95 17.1ms, 0/149**. No measurable
  blur cost.

#### 5. UI / design judgment — my own renders, 375 × 812 @ DPR 3, both themes

This is what the gate is for, so I looked at the pixels rather than the numbers.

- **Over a photo it genuinely reads as the reference.** (`shots/crop-dark-photo.png`,
  `crop-light-photo.png`.) The copper disc, the red stripe, the green block and the white patch all
  transmit and stay unmistakably recognisable through the material; the glyphs sit solid on top; the
  capsule floats with a soft edge. The tint — not the blur — is visibly what carries the glyphs, exactly
  as D3 claims. **AC 3 is met by eye as well as by number.**
- **Over the theme-matched default** — the case five of six destinations actually have
  (`crop-dark-app-bg.png`, `crop-light-app-bg.png`) — it reads as a clean, quiet floating pill. This is
  the case the design gate flagged as the one most likely to fail, because the capsule composite sits
  within ~5/255 of the page. I measured page `rgb(18,17,16)` → capsule `rgb(22,20,19)` in dark, and the
  `--app-border-strong` hairline plus `--app-shadow-soft` do carry the figure-ground on their own.
  **Not under-drawn.** It reads the way an iOS bar reads over a flat background.
- **The outlined-chip active state: acceptable, and I judge it the right call.** It is a real,
  knowingly-recorded divergence from Instagram's soft borderless patch, and the ink hairline is the
  strongest mark in the bar (3–10× the capsule's own edge). I looked hard at whether it reads as a
  *stray ring*. It does not: its radius matches the capsule's, it sits concentrically inside it, its box
  (48 × 32 in a 55.5 × 54 tab, ~3.75px to the tab edges and ~11px to the capsule's inner top/bottom)
  reads as nested rather than colliding, and it is identical in both themes and across all five
  backdrops. It reads as a selected segment. Its premise is verified in my own pixels: a borderless
  neutral fill measures **1.01–1.09:1** against the capsule over theme-matched backdrops, so it cannot
  be made to carry the state where most of the app lives. Against a hostile backdrop (dark/white,
  light/black) the chip is the clearest thing in the bar.
- **Icons at 22px.** `LayoutDashboard`, `Database`, `Workflow`, `ChartNoAxesColumn`, `MessageCircle` all
  read conventionally unlabelled. `Shapes` (triangle + square + circle) reads as "kinds of things" and
  is a clear improvement over `BookOpen`, which at 22px is unambiguously a book. D11's diagnosis and its
  registry-wide scope argument are right.
- **Light/dark parity**: verified across all six routes and all five backdrops. Both themes are
  internally consistent; no cell where one theme works and the other doesn't.
- **Design-language consistency**: the material uses `color-mix()` over `--app-surface` (never raw
  `rgba`), the edge is `--app-border-strong`, the depth is `--app-shadow-soft` (§3's sanctioned
  overlay shadow), radii are `--app-radius-pill`, spacing is `--space-*`. No hardcoded value where a
  token exists, apart from the two documented literals (the pre-existing 44px tap floor and the 1px
  hairlines). No shared primitive is reinvented — the bar is `NavLink`s, not a hand-rolled `IconButton`
  clone.

#### 6. Integration with HEL-772 / HEL-548, and the fences

- **`--bottom-nav-height` is declared exactly once**: `theme.css:103`. `--bottom-nav-capsule-height`
  (`:91`) and `--bottom-nav-inset` (`:95`) likewise once each. Consumers, all via the token family:
  `App.css:510`, `PanelList.css:191`, `toast.css:25`, and `BottomNav.css:17/18/23/27`. The only
  surviving `control-lg) + var(--space-4)` hits are HEL-772's independently-derived
  `--app-command-bar-height` and one comment — no consumer restates bottom-nav geometry.
- **Both chromes coexist**: command bar at `y=0 h=56` (→ 103 under insets), capsule top at `y=744`
  (→ 710), overlap **0** at every phone width in both themes and both inset configurations;
  `.app-content` clears both.
- **HEL-548's CTAs**, re-derived by me with well-formed empty responses on the real application path at
  375px, both themes: "New dashboard" 157.4 × 44, "Add source" 128.8 × 44, "New pipeline" 139 × 44
  (pipelines *and* registry), "New metric" 131.5 × 44 — every one **44px tall and 0 occluded**, with
  **0 console errors**.
- **Toast viewport** reaches the new geometry through the unedited token alone: computed
  `bottom: 84px`, lower edge **16px above** the capsule.
- **Zoom widget** (D10): `bottom: 80px` computed, widget bottom 732 vs capsule top 744 — clear at both
  500px and 768px.
- **Fences, checked not assumed**: `frontend/src/shared/ui/toast.css` and `toast.css.test.ts` are
  **byte-identical to `origin/main`** (`git diff` returns 0 lines) and the test passes;
  `frontend/index.html` diff is **0 lines**; the `App.css` diff contains **zero** `.app-shell` /
  `.app-command-bar` hunks — one declaration and one comment on `.app-content`, nothing else.

#### 7. Acceptance criteria, each traced to evidence

| AC | Verdict | Evidence I derived |
| --- | --- | --- |
| 1. `DESIGN.md` carve-out with a stated floor; no contradiction; `BottomNav.css` comment updated | **MET** | §0.2 principle 2 amended (`DESIGN.md:34-44`); `[mechanical]` clause amended (`:106-112`); carve-out with both floors, the `--app-text`-as-border justification and the focus-ring exception (`:122-176`). `BottomNav.css:35-37` now cites the carve-out; the old "Opaque per DESIGN.md §0.2 … No blur/translucent material" comment is gone (`grep`ed). |
| 2. Inset floating capsule, semicircular ends, clear of three edges | **MET** | Rendered 351 × 56 at `x=12`, insets 12/12/12 at 320/375/390/430/768, both themes; computed `border-radius: 9999px`; pill ends confirmed by the focus-containment probe, which tests against the pill equation and finds the corner outside it. |
| 3. Content recognisable through the material | **MET** | SD retention 0.435–0.514, correlation 0.885–0.946, and the photo is plainly readable through the bar in `crop-{dark,light}-photo.png`. |
| 4. Active item is an inner lozenge, not an accent block or underline | **MET** | 48 × 32 bordered material lozenge nested in the capsule, `--app-surface`@0.95 fill + opaque `--app-text` hairline; the accent colours only the glyph. |
| 5. Icon contrast over photo / white / black / accent, both themes, **measured** | **MET** | 50 governed cells, worst **3.43:1**, 0 below 3.0; plus the lozenge-boundary floor at worst **3.43:1** including both theme-mismatched extremes. All from rendered pixels. |
| 6. Labels decision recorded with its reasoning | **MET** | `design.md` D4 and `ticket.md`'s "Decisions taken during planning" both record the **real** basis — 10px labels are WCAG small text binding 4.5:1, icon-only is governed by 1.4.11's 3:1, which sets tint alpha 0.65→0.55 and transmissivity 35%→45% — and D4 explicitly names the earlier "labels cost nothing" draft as circular. Discoverability risk accepted with HEL-554 named. Not justified by "the reference is icon-only". |
| 7. Safe-area + ≥44px preserved; content scrolls fully clear | **MET** | Non-zero-inset measurements above; and scrolled to the end on all six routes × both themes, **0 leaf elements overlap the capsule**. (See non-blocking finding 1 for a pre-existing chat-page nuance that does not violate this AC.) |
| 8. Reduced motion disables added motion; scrolling stays smooth | **MET** | `transition-property: none` on the rendered element under emulation; 4× throttled scroll identical to the forced-opaque control. |
| 9. Verified at 430 and 375, both themes | **MET** | Full matrix at 375; geometry/renders at 320/375/390/430/768/769/1100/1440; every check run in both themes. |
| 10. `npm run lint` / `npm test` pass, zero new warnings | **MET** | Both exit 0; `format:check` and `build` clean too. |

#### 8. Design-gate round-5 change requests — all five discharged

`design.md:34` and `proposal.md:72` now say "Changing which six destinations the bar shows
(`sections.ts` *is* edited — one icon)"; the stale "The active **label** …" sentence is gone
(`grep`: no hits); D6's lozenge figures are corrected to 48 × 32 / ~3.75px / ~11px and my rendered
measurements match exactly; `shortLabel` is removed from both files with **zero** surviving references
anywhere in `frontend/src`, as is `.bottom-nav__label`; the ADDED reduced-motion requirement is now
worded conditionally ("may be satisfied vacuously") — though in fact a transition *is* declared, so it
is satisfied non-vacuously.

---

### Verdict: CONFIRM

Ships. I set out to refute this on fidelity and could not. Every published contrast figure reproduces
in an independent render to within 0.01, the two floors hold with the headroom the design predicted,
the load-bearing mechanical claims (AX tree, 44px, non-zero safe area, reduced motion, focus
containment) all reproduce with sensitive controls, the fences are intact, and — the part that
actually needed a cold eye — the built bar reads as the Liquid Glass reference over a photo, holds
together as a floating object over the theme-matched default that five of six destinations have, and
carries its active state legibly in both themes and over every hostile backdrop. The outlined-chip
divergence is knowing, documented, forced by a premise I verified myself, and reads as a nested
selected segment rather than a stray ring. The one substantive defect I found reproduces on
`origin/main` under a controlled A/B and is outside this ticket's fence.

---

### Non-blocking notes

1. **`/chat`: the Assistant composer's "Send" button rests 18.2px under the capsule at the chat's
   auto-scroll position after load — pre-existing, deepened by 12px, and worth a spinoff.**
   Measured at 375px: Send is 67.8 × 44 at `y 718.2–762.2`; the capsule top is `y 744`.
   `document.elementFromPoint` at the button's bottom-centre returns the nav, not the button, so that
   band is not tappable. **I proved it is pre-existing** by re-running the identical probe with
   `origin/main`'s bar geometry simulated exactly (flush full-width strip, `bottom: 0`, height
   `control-lg + space-4 + env`, `.app-content` padding-bottom on the old expression): the same
   occlusion is there at **6.2px**, `elementFromPoint` returns the *Metrics* tab, and `scrollTop` at
   load is **3272 in both configurations** — the chat's scroll-to-bottom lands at the same absolute
   offset regardless of the container's bottom padding, so no clearance-token value can fix it. Scrolled
   to the true end, overlap is **0** in both. Nothing is permanently trapped, so AC 7 and the spec's
   "Content scrolls clear of the floating bar" scenario both pass and this is not a change request.
   What HEL-774 *does* newly add is visual: the orange button now bleeds through the glass as a smudge
   behind the Metrics/Assistant tabs (`shots/chatload-shipped-atload.png` vs
   `shots/chatload-mainsim-atload.png`) where the opaque bar used to cut it cleanly. Recommend a spinoff
   against the chat page's auto-scroll (target `scrollHeight`, not the last message) — its fix belongs
   to `features/chat`, not to this ticket's fence.
2. **`evaluation-2.md`'s lozenge-boundary table is mislabeled** (4.26 is fill-vs-capsule; the border is
   3.43 at dark/white). Detail and raw pixel column in §2 above. Floor still met; flagged for
   evidence hygiene, since a future reader "confirming 4.26" would be confirming the wrong quantity.
3. **No CI test pins the `.bottom-nav__lozenge` `<span>` carrier.** `BottomNav.test.tsx` asserts
   accessible names and active-class only; `BottomNav.css.test.ts`'s negative guard catches only
   `padding`/`border` landing on `.bottom-nav__icon`. Moving the lozenge class onto the `<Icon>` would
   reproduce the 26 × 22 empty-ring defect with every Jest suite still green, and the contrast matrix
   deliberately excludes the active icon. One line —
   `expect(link.querySelector(".bottom-nav__lozenge > svg")).toBeInTheDocument()` — would close it.
   The shipped code is correct (1792–1799 glyph pixels measured); this is coverage, not a bug.
4. **`DESIGN.md` §5's `[mechanical]` icon-only rule now applies to this bar for the first time.** Its
   hard requirement ("a visible tooltip *or* an accessible name is required") is met by `aria-label`;
   its softer "pairing both is the default expectation" is not, and no exception is recorded. Defensible
   on a touch-only surface where `title` never fires — but this change is what brought the bar into
   scope, so the one-line "why no `title`" note is owed. (Carried over unaddressed from both evaluation
   cycles.)
5. **The `DESIGN.md` focus-ring exception is true but readable two ways.** I reproduced the numbers:
   §8's recipe applied literally (offset only, no radius) overhangs by 5.02px / 455 stray pixels, so the
   sentence is accurate; but on the *shipped* pill-radiused tab, `-2px` is also fully contained (nearest
   ring pixel 1.00px inside vs 2.00px at `-3px`). The operative gain of `-3px` is hairline clearance,
   not curve containment. One clause naming that measured gap would stop a future reader "simplifying"
   it back to `-2px`.
6. **Comment line-number drift in shipped code**: `theme.css:97-101` cites "App.css:424" and
   "BottomNav.css:27"; on the merged tree the consumer is `App.css:510`. `App.css:504-509` also
   attributes `--bottom-nav-height` to HEL-774 when HEL-535 introduced it and this change only
   redefined it (`theme.css:86-89` states this correctly).
7. **768px reads stretched**: a 744px capsule with 121px tabs, six small glyphs marooned in a long pill
   (`shots/w-768-light.png`). Not a regression (today's bar is full-bleed there too) and in no AC, but
   `max-width` + `margin-inline: auto` would be one declaration.
8. **320px is tight**: the 48px lozenge slightly exceeds its 46.33px tab, so the active chip crowds its
   neighbours (`shots/w-320-dark.png`). No overlap of glyphs, no overflow, targets still ≥44, and 320 is
   below the ratified 430 phone breakpoint — worth one glance only if the support floor ever moves.
9. **Vestigial `flex-direction: column`** on `.bottom-nav__tab` now that it has a single child
   (`gap: 2px` was correctly removed). Harmless; tidy on next touch.
10. **Pre-existing spec/CSS off-by-one**, confirmed against `origin/main` and not this change's to fix:
    the spec's "Hidden at desktop widths — WHEN the viewport is 768px or wider" contradicts
    `@media (max-width: 768px)`, which includes exactly 768px. Verified live again: the bar renders at
    768 and is hidden at 769.
