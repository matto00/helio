## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `e75472af` on `feature/liquid-glass-bottom-nav/hel-774`.
Base `origin/main` = `09a7a65c`; the branch's merge-base **equals** the main tip, so
`git diff origin/main HEAD` is exactly this run's own work (12 code files + the change's
own openspec artifacts). **The gates below therefore ran against the fully integrated
tree**, including HEL-772 (`98862321`) and HEL-548 (`09a7a65c`), which landed mid-run.

Every gate result and every UI measurement below was re-derived by the evaluator. No
executor-reported output was taken on trust, including the `git commit -n` disclosure
(cycle 1's disclosure on this run was false, so it is re-derived every cycle by running
each pre-commit hook individually). UI verification ran in an evaluator-owned headless
Chromium (`/home/matt/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, driven
via `playwright-core` 1.55.1), never the shared MCP session. PNG decoding was done in
Node (hand-rolled `zlib`-based decoder) so no browser-side canvas round-trip could
launder the sampled pixels.

### Phase 1: Spec Review — PASS

Cycle 1's two change requests are both discharged, and nothing in the merge regressed a
previously-passing criterion.

**Cycle-1 change requests:**

| CR | Verdict | Evidence |
| --- | --- | --- |
| CR1 — `DESIGN.md` broke the root `format:check` gate | **RESOLVED** | `d2353d62` applied exactly the two whitespace edits identified (blank line removed before the nested list at old `:130`; blank line inserted before the `- The dot-grid texture …` bullet). Root `npm run format:check` under the repo's pinned Prettier **3.8.1** now reports "All matched files use Prettier code style!" — re-run by me, exit 0. |
| CR2 — `-3px` focus offset deviated from a `[mechanical]` rule and the code comment cited a `DESIGN.md` exception that did not exist | **RESOLVED** | The exception now exists at `DESIGN.md:164-172`, inside the HEL-774 carve-out under the `### Surfaces & the opacity invariant` heading (`DESIGN.md:104`). `BottomNav.css:147-153` cites *"DESIGN.md's HEL-774 carve-out ("Surfaces & the opacity invariant" § "Focus-ring exception")"* — that section heading and that sub-bullet both resolve to real text. The value was correctly left at `-3px`. The cycle-1 non-blocking suggestion about comment placement was also taken (`BottomNav.css:80-82` now sits immediately above `border-radius`). |

**CR2 follow-through — does the written exception actually describe the shipped
behaviour?** Existing is not the same as correct, so each clause was tested against
rendered pixels rather than read:

| DESIGN.md clause | Verdict | Measured |
| --- | --- | --- |
| "the bottom nav's pill-shaped tabs" | TRUE | `.bottom-nav__tab` computed `border-radius: 9999px` on the rendered element. |
| "§8's default focus rule … sanctions exactly `2px`, or `-2px` 'only where the ring would clip (flush list items)'" | TRUE, verbatim | `DESIGN.md:362-365` reads exactly that, and is `[mechanical]`. |
| "§8's `-2px` flush-list-item recipe still overhangs the curve as a hard rectangle" | TRUE | §8's recipe prescribes offsets only, no radius. Applied as written (radius 0, offset `-2px`): **53 accent ring pixels outside the capsule's pill at tab#0, 45 at tab#5**. The app-wide default `+2px` overhangs by 58/53. |
| "`-3px` clears both the curve and the capsule's own hairline" | TRUE | Shipped `-3px`: **0 ring pixels outside the pill**, nearest ring pixel **2.50px inside** the capsule boundary (the capsule's own border is the outer 1px band). At `-2px` the nearest ring pixel is 1.50px inside — contained, but only 0.5px clear of the hairline. |
| "Verified from rendered pixels: 0 ring pixels fall outside the capsule's rounded shape at the first and last tabs, in both themes" | TRUE | Reproduced independently: first and last tabs, dark and light, `:focus-visible` genuinely matched (reached by real `Tab` presses, not `.focus()`), `outline: rgb(249,115,22) solid 2px`, `outline-offset: -3px`, **0 pixels outside** in all four cases. Containment tested against the pill equation, not a bounding box. |

Acceptance criteria, re-checked on the integrated tree:

| AC | Verdict | Evidence |
| --- | --- | --- |
| 1. `DESIGN.md` carve-out + floor; `BottomNav.css` comment matches | PASS | Carve-out at `DESIGN.md:122-176`; `[mechanical]` clause amended at `:106-112`; §0.2 principle amended at `:34-44`. `BottomNav.css`'s comments cite the carve-out (and now the focus-ring exception), not the retired invariant. |
| 2. Inset floating capsule, semicircular ends, clear of three edges | PASS | Rendered: `351×56` at `x=12`, insets **12/12/12** at 320/375/390/430/768, both themes. `border-radius` computed `9999px`; pill ends confirmed from pixels in cycle 1 and unchanged (same geometry values). |
| 3. Content recognisable through the material | PASS (mechanically) | Against an un-occluded control strip of the same backdrop: per-channel SD retention **0.52 / 0.57 / 0.57** (R/G/B) and per-column correlation **0.64 / 0.71 / 0.78**, i.e. the backdrop's colour structure survives the material rather than being flattened. Aesthetic judgment deferred to the skeptic. |
| 4. Active item is an inner lozenge | PASS | `48×32` bordered lozenge nested in the capsule; `--app-surface`@0.95 fill + opaque `--app-text` hairline; not an accent block, not an underline. |
| 5. Icon contrast over photo/white/black/accent, both themes, measured | PASS | Worst governed cell **3.43:1** (dark theme over pure white); **0 of 50 cells below 3.0**. Full matrix in Phase 3. |
| 6. Labels decision recorded | PASS | `design.md` D4 + `proposal.md`, with the 4.5:1-vs-3:1 basis, the transmissivity cost, and HEL-554 as the accepted-risk mitigation. |
| 7. Safe area + ≥44px targets + content scrolls clear | PASS | With CDP `Emulation.setSafeAreaInsetsOverride` top=47/bottom=34: `env(safe-area-inset-bottom)` reads 34, capsule height stays **56** (uncrushed), gap below capsule **46** = 12 + 34, tabs stay **54** tall, `.app-content` padding-bottom becomes **102px** = 56 + 12 + 34. At inset 0: padding 68px, and on all six routes scrolled to the end, **0 leaf elements overlap the capsule**. |
| 8. Reduced motion + scroll performance | PASS | Under emulated `prefers-reduced-motion: reduce` the rendered `.bottom-nav__lozenge` reports `transition-property: none` (baseline: `background, border-color` @ 0.16s). 4× CPU-throttled 150-step scroll: **0/145 long frames, p95 16.7ms** — byte-identical to the same scroll with the bar forced opaque (0/145, p95 16.7ms). |
| 9. Verified at 430 and 375, both themes | PASS | Geometry at 320/375/390/430/768/769/1100/1440; contrast matrix at 375 in both themes; focus/glyph/AX checks in both themes. |
| 10. `npm run lint` / `npm test` pass with zero new warnings | PASS | Both clean — see Phase 2. Unlike cycle 1, the repo's `format:check` gate is now clean too. |

Other Phase 1 checks:

- No AC silently reinterpreted. The two deliberate re-scopes (icon-only; the active icon
  excluded from the glyph floor because it sits on a near-opaque lozenge) remain stated
  up front in `design.md` D1/D4/D6 and reflected in the spec delta.
- All **46/46** task items marked done, and the spot-checked ones match what shipped —
  including the negative ones: no `@supports` block, no `background-clip` anywhere,
  `z-index: 5` unchanged, lozenge styling on the `<span>` carrier not the `<svg>`.
- Scope: the diff is exactly the 12 code files plus this change's own openspec artifacts.
  The only reaches beyond the bar remain `sections.ts`'s `BookOpen → Shapes` (D11 — confirmed
  live: the desktop sidebar's Data Types link renders `lucide-shapes`) and `PanelList.css`'s
  zoom-widget clearance (D10 — confirmed: widget `rect.bottom` 732 vs capsule top 744 at
  both 500px and 768px).
- Planning artifacts (`proposal.md`, `design.md`, `tasks.md`, spec delta) reflect the final
  implemented behaviour.

### Phase 2: Code Review — PASS

**Every pre-commit hook re-run individually by me, in `WORKTREE_PATH`, at `e75472af`**
(`CLEAN_WORKTREE` was not set, so gates ran in the delivery worktree as normal):

| Hook (`.husky/pre-commit` order) | Exit | Result |
| --- | --- | --- |
| `npm run lint` (root, `eslint . --max-warnings=0`) | 0 | PASS |
| `npm run format:check` (**root**, `prettier . --check`, Prettier 3.8.1) | 0 | **PASS** — "All matched files use Prettier code style!" (was FAIL on `DESIGN.md` in cycle 1) |
| `npm run check:schemas` | 0 | PASS — 66 checked across 47 protocol files; 7 panel-type enum surfaces in sync |
| `npm run check:openspec` | 1 | **FAIL — exactly one issue**: `change "liquid-glass-bottom-nav" is complete (46/46) but not archived`. This is the pre-approved HEL-657 false positive and nothing else appears in the output. |
| `npm run check:scala-quality` | 0 | PASS — "clean (128 soft warning(s))", all pre-existing file-size soft warnings on backend test files |
| `npm test` (root → `jest --passWithNoTests && npm --prefix frontend test`) | 0 | PASS — **246 suites / 2625 tests**, 0 failures |

Additional gates for the changed-file globs:

| Gate | Exit | Result |
| --- | --- | --- |
| `npm run lint` (frontend) | 0 | PASS |
| `npm run format:check` (frontend) | 0 | PASS |
| `npm --prefix frontend run build` | 0 | PASS (tsc + vite; only the pre-existing >500 kB chunk advisory) |
| `backend/**` / `sbt test` | — | **N/A** — the diff contains zero backend files |

**Bypass disclosure — re-derived, and now ACCURATE.** `e75472af`'s message states
*"`git commit -n` skips only `check:openspec` (HEL-657, pre-approved). No other gate
skipped."* My independent run of all six hooks confirms exactly that: five pass, one
fails, and the one that fails is the "complete but not archived" false positive. Cycle
1's equivalent claim was false (root `format:check` was also failing); this cycle's is
not. `d2353d62`'s disclosure is likewise consistent with the state at that commit.

**Integrated-tree checks (the reason the merge happened before evaluation).** Four files
overlapped with the intervening merges; each verified independently:

- **`--bottom-nav-height` is declared exactly once.** `grep -rn -- "--bottom-nav-height\s*:" frontend/src`
  returns a single hit: `theme.css:103`, the multi-line `calc(capsule + inset + env())`.
  No stale inlined copy survived the merge from `origin/main`. All consumers route through
  the token family and nothing restates the expression: `App.css:510`
  (`padding-bottom: var(--bottom-nav-height)`), `PanelList.css:191`
  (`calc(var(--bottom-nav-height) + var(--space-3))`), `toast.css:25`
  (`calc(var(--bottom-nav-height) + var(--space-4))`), and `BottomNav.css:17/18/23/27`
  reading the two primitives directly. `grep` finds no second declaration of
  `--bottom-nav-capsule-height` or `--bottom-nav-inset` either.
- **HEL-772's top-chrome tokens did not interleave.** In the merged `theme.css`, HEL-774's
  three bottom-nav tokens sit at `:87-106` and HEL-772's `--app-safe-top` /
  `--app-command-bar-height` / `--app-top-chrome-height` at `:118-133`, separated by the
  pre-existing `--app-swatch-ring` block; HEL-772's `@media (max-width: 768px) { :root { … } }`
  follows the `:root` close, exactly as it does on `origin/main`. Neither side's cascade
  changed: diffing this branch's `theme.css` against `origin/main` shows only HEL-774's
  hunk, and diffing `2eaf1d26..09a7a65c` shows only HEL-772's. HEL-772's stated
  independence from `--bottom-nav-height` holds — its `--app-command-bar-height` override
  is computed locally from `--control-lg`/`--space-4` and references no BottomNav token.
- **Mobile chrome co-exists.** At every phone width, both themes: command bar anchored at
  `y=0` with `height=56`, capsule top at `y=744` — a 688px gap, no overlap.
  `.app-content` starts at exactly `y=56` (clears the top bar) and reserves `68px` at the
  bottom (clears the 56px capsule + 12px inset). Under a non-zero safe area (47/34) the
  top bar grows to 103 and `.app-content` starts at 103 while its bottom padding grows to
  102 — both chromes track their own inset independently, with no double-count and no
  collision.
- **HEL-548's new empty-state CTAs are unaffected.** Reached through the real application
  path at 375px (well-formed empty API responses): every `.ui-empty-state__cta` measures
  **44px tall** — "New dashboard" 157.4×44, "Add source" 128.8×44, "New pipeline" 139×44
  (pipelines *and* registry), "New metric" 131.5×44 — and **none is occluded by the
  capsule** (0 intersections on every route).

**Fences, verified independently:** `frontend/src/shared/ui/toast.css` and
`toast.css.test.ts` are byte-identical to `origin/main` (empty diff) and
`toast.css.test.ts` passes inside the 246-suite run; the `App.css` diff contains **zero**
`.app-shell` / `.app-command-bar` hunks; `index.html` is untouched. The toast viewport
reaches the new geometry through the token alone — computed `bottom: 84px` at inset 0,
putting its lower edge 16px above the capsule.

Code-quality review against `CONTRIBUTING.md` and `DESIGN.md`:

- **Canonical code-quality compliance.** No inline FQNs (`check:scala-quality` clean; the
  diff is frontend-only anyway). File-size soft budgets: `BottomNav.css` 168,
  `BottomNav.css.test.ts` 226, `BottomNav.tsx` 45, `sections.ts` 189, `theme.css` 350 —
  all within or at the informational budget. `App.css` is 523 lines, but it was already
  514 on `origin/main` and this change adds one declaration plus a five-line comment to a
  single existing rule; demanding a split here would be scope creep, not compliance.
- **Design-standard `[mechanical]` rules.** Tokens throughout — the two translucent values
  are `color-mix()` over `--app-surface`, not raw `rgba`; spacing from `--space-*` except
  the documented ≤4px optical `padding: 0 2px` and the two documented literals (`1px`
  hairlines, the pre-existing `44px` tap floor); canonical `768px` breakpoint in both
  `BottomNav.css` and the new `PanelList.css` block; no new `font-size`/`font-weight`
  literals; no hand-rolled component duplicating a `shared/ui` primitive. **The one live
  deviation — `outline-offset: -3px` — is now a documented exception in the standard
  itself, so `[mechanical]` compliance is restored.**
- **DRY / single seam.** Genuinely consolidated:
  `grep -rn "control-lg) + var(--space-4)"` finds the expression only in the primitive's own
  definition (`theme.css:91`) and in HEL-772's independently-derived command-bar override —
  no consumer restates bottom-nav geometry.
- **Readable.** Naming is clear; every non-obvious value carries a *why* comment that names
  the rejected alternative and its measurement (`NOT --app-surface-strong`, `NOT
  --app-border-subtle`, `NOT a color-mix`, `NOT transition-duration`).
- **Modular / no over-engineering.** Two new primitives, each with real consumers; a single
  `<span>` carrier whose necessity is documented (Lucide's presentation attributes +
  global `border-box`); no premature abstraction.
- **Type safety.** `shortLabel` removed from the interface (`navDestinations.ts`) and the
  registry (`sections.ts`) with no `any`, no casts, no `@ts-ignore`; `tsc` passes via the
  build. `grep` over the whole diff finds no `any`/`@ts-ignore`/`eslint-disable`.
- **Security / error handling.** N/A for this change; separately verified that forcing every
  `/api/**` response to 500 leaves the bar rendered and every page showing a real error
  state (Phase 3).
- **Tests meaningful.** `BottomNav.css.test.ts` pins exactly the decisions a future edit
  could silently undo (tint token + alpha, `-webkit-` prefix, opaque-not-`color-mix`
  border, always-present transparent border, absence of `background-clip` and `@supports`,
  the reduced-motion override's source-order position, the single unshadowed 44px
  declaration, and the `-3px` pill offset). The comment-stripping step before negative
  matching is necessary and correct, and `findRuleBody`/`findMediaBlock` brace-match rather
  than scanning to the first `}`. `BottomNav.test.tsx`'s replacement assertion is stronger
  than what it replaced (accessible name per destination via `getByRole`).
- **No dead code.** No unused imports, no TODO/FIXME. `shortLabel` and
  `.bottom-nav__label` have zero surviving references anywhere in `frontend/src`, `docs`,
  or `notes`; the remaining `BookOpen` mentions are all in comments/tests that describe the
  *replaced* icon by name, which is accurate.
- **Behaviour-preserving where expected.** The merge commit `c042c9fc` is a clean merge with
  no textual conflicts and introduces no drive-by behaviour change of its own; `e75472af`
  touches only `workflow-state.md`.

Issues: none.

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`). Servers started with the canonical script
(`start-servers.sh` reused already-healthy servers on 6206/9113;
`assert-phase.sh servers` → `PASS servers`). All measurements are from rendered pixels,
`getComputedStyle`/`getBoundingClientRect` on laid-out boxes, or the computed
accessibility tree — never from CSS source.

**Contrast, measured from composited pixels (floor 3:1, WCAG 1.4.11).** 375px, both
themes, five backdrops applied to the real content region behind the capsule. Glyph ink
sampled two ways: the extreme pixel in the ink direction, and a robust "5th-from-extreme"
rank that a single antialiasing outlier cannot carry. Material sampled adjacent to the
glyph inside the same tab.

| backdrop | dark theme (inactive icons) | light theme (inactive icons) |
| --- | --- | --- |
| theme `--app-bg` | 16.00 | 15.66 – 15.83 |
| pure white | **3.43** (worst cell overall) | 16.48 – 16.66 |
| pure black | 16.92 | **4.86** – 4.91 |
| accent | 6.89 | 10.27 – 10.38 |
| synthesised photo | 4.45 – 13.50 | 6.42 – 14.02 |

Worst governed cell **3.43:1** by *both* metrics (extreme and robust are identical at
3.43), **0 of 50 cells below 3.0**. This reproduces cycle 1's 3.43 / 4.86 figures on the
merged tree — the merge changed nothing here.

**Active lozenge boundary vs adjacent capsule material** (sampled on the straight top
edge, inside the pill's rounded ends — never the curve apex):

| case | strict single row | best row per column |
| --- | --- | --- |
| dark / white (theme-mismatched) | **4.26** | 4.26 |
| light / black (theme-mismatched) | **4.86** | 4.86 |
| dark / accent | 6.89 | 6.89 |
| light / accent | 10.27 | 10.27 |
| dark / photo | 10.44 | 10.44 |
| light / photo | 7.92 | 7.92 |
| dark / `--app-bg` | 16.00 | 16.00 |
| light / `--app-bg` | 15.66 | 15.66 |

Worst **4.26:1** — clears 3:1 with headroom, matrix including the theme-mismatched
extremes as the design requires.

**`backdrop-filter`-unsupported fallback** (spec scenario "Legibility survives without
backdrop-filter support"): with `backdrop-filter: none` forced on the rendered element,
the whole matrix is unchanged — worst inactive icon still **3.43**, worst lozenge border
still **4.26**, 0 cells below 3.0. The unconditional tint carries it, exactly as the
"no `@supports` block" decision claims.

**The active icon actually renders** (the defect class an earlier draft shipped): in all
10 theme×backdrop combinations the active tab's `<svg>` measures **22×22** inside the
48×32 lozenge and **186–191 glyph pixels** are present inside the lozenge in the
screenshot. Exactly one tab is active per route on all six routes.

**Accessible names, from the computed accessibility tree** (CDP
`Accessibility.getFullAXTree`, tied to the six `.bottom-nav__tab` elements by
`backendNodeId` via `DOM.querySelectorAll` + `DOM.describeNode` — not read from markup):

```
role=link name="Dashboards"     ignored=false sources=[attribute(aria-label)="Dashboards"]
role=link name="Data Sources"   ignored=false sources=[attribute(aria-label)="Data Sources"]
role=link name="Data Pipelines" ignored=false sources=[attribute(aria-label)="Data Pipelines"]
role=link name="Data Types"     ignored=false sources=[attribute(aria-label)="Data Types"]
role=link name="Metrics"        ignored=false sources=[attribute(aria-label)="Metrics"]
role=link name="Assistant"      ignored=false sources=[attribute(aria-label)="Assistant"]
```

0 link/button nodes anywhere in the tree resolve to an empty accessible name.

**Touch targets, from `getComputedStyle` + rects on rendered elements:**

| viewport | nav | computed min-w/min-h | smallest tab dimension | ≥44×44 | h-overflow |
| --- | --- | --- | --- | --- | --- |
| 320 | 296×56, insets 12/12/12 | 44px/44px | 46.33 | yes | none |
| 375 | 351×56, insets 12/12/12 | 44px/44px | 54 | yes | none |
| 390 | 366×56, insets 12/12/12 | 44px/44px | 54 | yes | none |
| 430 | 406×56, insets 12/12/12 | 44px/44px | 54 | yes | none |
| 768 | 744×56, insets 12/12/12 | 44px/44px | 54 | yes | none |
| 769 / 1100 / 1440 | `display: none` | — | — | — | none |

The 44px floor is not shadowed: `.bottom-nav__tab {` occurs exactly once in the
stylesheet (pinned by the new test) and the computed values confirm it survives to the
rendered element at every width.

**Safe area, re-run with non-zero simulated insets (top 47 / bottom 34):**
`env(safe-area-inset-bottom)` reads 34; capsule offset resolves to `calc(inset + env())`
— gap below the capsule 46 = 12 + 34; capsule height stays 56 and tabs stay 54 (the
removed `padding-bottom: env(...)` genuinely did not survive to crush the content box);
`.app-content` padding-bottom becomes 102px. HEL-772's top bar independently grows
56 → 103 and `.app-content`'s top tracks it.

**prefers-reduced-motion**, asserted on the rendered element under context-level
emulation: `transition-property: none` (baseline without emulation reports
`background, border-color` at 0.16s), so the transition is removed rather than shortened.

**Flows:**

- Happy path: tapping each of the six tabs navigates to the right route with exactly one
  active tab, from two different entry points (`/` and `/metrics`) — 12/12 correct.
  (`Data Types` lands on `/registry` and the registry then auto-selects a type, landing on
  `/registry/<id>` — pre-existing routing behaviour, unrelated to this change; the active
  tab stays correct.)
- Keyboard: the bar is reachable by `Tab` (8 presses from load, after the skip-link and
  header), all six tabs are in DOM order at presses 8–13, and `Enter` on Assistant
  navigates to `/chat` and updates the active state.
- Empty states: with well-formed empty API responses, all six sections render the shared
  `EmptyState` primitive with a working 44px CTA ("New dashboard", "Add source",
  "New pipeline" ×2, "New metric") — no blank screens, no bare `<p>`, 0 console errors.
- Unhappy paths: with every non-auth `/api/**` request forced to 500, the bar still
  renders at full `351×56` with the correct active tab on every route; pages show real
  error states ("Couldn't load sources / pipelines / types" + Retry, `role="alert"`
  announcements, "Failed to load dashboards."); no blank screens; **0 uncaught page
  errors** beyond the deliberate network failures.
- Console: **0 errors** across all normal flows (six routes × two themes, eight
  breakpoints, the keyboard flow, the tap flow, the scroll-to-end flow).
- Breakpoints 1440 / 1100 / 768 / 320 (and 769 / 430 / 390 / 375): no horizontal overflow
  anywhere (`scrollWidth == innerWidth` at every width), bar correctly hidden ≥769 and
  present ≤768, no console errors.
- Loading states: skeletons render ahead of data (22 skeleton elements observed on the
  dashboard route pre-resolution), so no flash of empty content precedes a load.

### Overall: PASS

Both cycle-1 change requests are discharged, and the discharge was verified by
re-derivation rather than by reading the executor's report: the root `format:check` gate
now passes under the pinned Prettier, the `DESIGN.md` focus-ring exception exists, is
cited correctly from `BottomNav.css`, and — clause by clause — describes what the code
actually does when measured. The bypass disclosure on this cycle's HEAD is accurate; the
only failing hook is the pre-approved HEL-657 false positive.

The merge of `origin/main` introduced no regression: `--bottom-nav-height` survives as a
single declaration with this ticket's capsule+inset+env semantics and all four consumers
route through it, HEL-772's top-chrome tokens neither interleave with nor depend on the
bottom-nav family, the two mobile chromes co-exist without overlap under both zero and
non-zero safe-area insets, and HEL-548's new empty-state CTAs still meet the 44px floor
unoccluded. Every load-bearing measurement from cycle 1 reproduces on the integrated
tree.

### Change Requests

None.

### Non-blocking Suggestions

- `DESIGN.md:167-169` — precision, not correctness. "§8's `-2px` flush-list-item recipe
  still overhangs the curve as a hard rectangle" is true as written (§8 prescribes an
  offset and no radius; measured 53/45 stray pixels), but a reader could take it to mean
  `-2px` overhangs *on the shipped pill-radiused tab*, which it does not — at `-2px` the
  ring is also fully contained, and the operative difference is hairline clearance (1.50px
  vs 2.50px inside the capsule boundary). One clause naming that measured gap would make
  the exception unambiguous and pre-empt a future reader "simplifying" it back to `-2px`.
  Given this repo's history with confidently-false documentation, worth the sentence.
- `DESIGN.md` §8's `[mechanical]` focus rule (`:362-365`) still reads as absolute. A
  four-word back-pointer ("see the bottom-nav carve-out") would mean a reader who reaches
  §8 first finds the exception, rather than only a reader who reaches §3's carve-out first.
  Cycle 1 explicitly sanctioned either location, so this is not a re-opened request.
- `tasks.md` 3.18 and `design.md` D12 cite `DESIGN.md:291-293` for the flush-list-item
  recipe; on the merged tree it lives at `:362-365`. Artifact-only line drift — the shipped
  `BottomNav.css` comment cites the section by name, not a line number, so nothing in the
  code is stale.
- `App.css:504-509` now attributes `--bottom-nav-height` to HEL-774; the token was
  introduced by HEL-535 and only *redefined* here. `theme.css:88-89` states this correctly
  — worth matching the wording. (Carried over unaddressed from cycle 1; still non-blocking.)
- `DESIGN.md` §5's `[mechanical]` guidance calls pairing `title` with `aria-label` "the
  default expectation" for icon-only interactive elements. The bar now qualifies and
  carries `aria-label` alone (the hard requirement is met). Defensible for a touch-only
  phone-width surface where a native tooltip never fires — but since the bar is
  deliberately built as a promotable shared component, a one-line note recording *why*
  `title` is omitted would close the loop. (Carried over from cycle 1.)
- Spinoff candidate (pre-existing, confirmed against `origin/main`, **not** this change's
  to fix): the spec's "Hidden at desktop widths — WHEN the viewport is 768px or wider"
  scenario contradicts `@media (max-width: 768px)`, which includes exactly 768px. Verified
  live again this cycle: the bar renders at 768 and is hidden at 769.
- Task 5.5's retained screenshots live at
  `openspec/changes/liquid-glass-bottom-nav/evidence/screenshots/` but are unversioned
  (`.gitignore:42` ignores `*.png` repo-wide), so they will not survive Phase-4 worktree
  teardown. Repo policy, not an executor oversight — flagging only so the final-gate
  skeptic reads them from the worktree before cleanup.
