## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Commit under review: `fcbde96088f72f220b73baf8be1ae62c7184709f`. Round 1 reviewed `b0c82eb6`; the
round-2 code delta is exactly three CSS lines plus one new test file
(`git diff --stat b0c82eb6 fcbde960` → `OnboardingChecklist.css | 7 +-`,
`OnboardingChecklist.css.test.ts | 83 +`, rest is change-dir markdown). Worktree carries only
`workflow-state.md` (modified) — `git status --porcelain` after every gate run showed nothing else.

I am a fresh cold spawn. Every number below is my own measurement on the running app
(dev `5986` / backend `8893`) with my own headless Chromium
(`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, driven by `playwright-core` from
scripts — **not** the shared MCP session), on **two accounts registered through the app's own
`/register` form this round** (`skeptic554r2a@helio.dev`, `skeptic554r2b@helio.dev`). No props were
forced and no Redux state was preloaded. Screenshots:
`/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-2-shots/`.

### What I verified (with evidence)

#### 1. CR1 — `align-self: flex-start`, measured in the exact state round 1 flagged

Reached the state through the real path: registered `skeptic554r2a`, created **one** data source via
`POST /api/data-sources` (`201`, real session cookie + `X-Helio-Requested-With` CSRF header),
confirmed `GET /api/dashboards` → `count: 0`, reloaded. Step 1 flipped to `— Complete`,
`aria-current="step"` moved to **Build a pipeline**, and its action became the emphasised Primary
(`background: rgb(249,115,22)` = `--app-accent`, `color: rgb(24,21,17)` = `--app-accent-ink`):

| Viewport | "New pipeline" (the Primary) | round 1's finding |
| --- | --- | --- |
| 1440 | **99.58 × 28**, `align-self: flex-start` | was 580 × 28 accent slab |
| 768 | **99.58 × 44** (`min-height: 44px`) | was 580 × 44 |
| 430 | **99.58 × 44** | — |

All four actions are content-sized at 1440: 134.41 / 99.58 / 115.30 / 83.25 px (labels 9–18 chars),
every one `align-self: flex-start`, all left-aligned at the same `x` — measured on four independent
browser launches (`r2-01`, `r2-02`, `r2-03`, `r2-04`) and reproduced on the second account
(`r2-15`/`s13`). The 585 px Ghost hover band is gone too: hovering "New pipeline" now paints a
**99.6 × 28** `--app-surface-raised` band, not a full-width row highlight
(`r2-15-ghost-hover.png`). Screenshots `r2-03-step2primary-{1440,768,430}.png`.

#### 2. CR2 — the 430 header stack, both themes

| Measure | dark @430 | light @430 | round 1 |
| --- | --- | --- | --- |
| `header` `flex-direction` | `row` | `row` | `column` |
| header height | **71 px** | **71 px** | 123 px |
| dismiss `X` from card **left** | 329 px | 329 px | 17 px (stranded) |
| dismiss `X` from card **right** / **top** | 17 / 17 px | 17 / 17 px | — / 96 px |
| card `scrollWidth` === `clientWidth` | 388 === 388 | 388 === 388 | — |
| `document` scroll/client width | 430 / 430 | 430 / 430 | — |

Reproduced on the second account in a fresh browser (`s13`: `headerDir: "row"`, `headerH: 71`,
`xFromRight: 17`, `388 === 388`). Also checked **360 px** (below the 430 breakpoint, covers
iPhone SE/13 mini): still one row, `scrollWidth 318 === clientWidth 318`, document `360/360`, no
overflow (`r2-16-360.png`). Card padding correctly drops to `16px` (`--space-4`) at 430 and stays
`20px 24px` above it — the part of the 430 block the executor kept. Screenshots
`r2-04-dark-430.png`, `r2-04-light-430.png`.

#### 3. The ≥44 px touch floor — re-measured after the narrowing (highest-risk item)

`getComputedStyle` + `getBoundingClientRect` on the running app, **never read off CSS**, in both
themes, across five independent browser launches:

| Control | @430 | @768 | @1440 (must NOT inflate) |
| --- | --- | --- | --- |
| Dismiss `IconButton` | 44 × 44, `min-height/min-width: 44px` | 44 × 44, `44px/44px` | 28 × 28, `auto` |
| Step action — Primary | 99.58 × **44**, `min-height: 44px` | 99.58 × **44** | 28 |
| Step action — Ghost ×2 | 115.30 × **44**, 83.25 × **44** | same | 28 |
| Step action — disabled Ghost | 83.25 × **44** | 83.25 × **44** | 28 |
| `Done` (completed chain) | 63.89 × **44**, `min-height: 44px` | 63.89 × **44** | 28 |
| `UserMenu` "Getting started" row | 200 × **44**, `min-height: 44px` | 200 × **44** | — |

Narrowing the buttons to content width did **not** drop anything below the floor: `min-height`
governs the height and `min-width` was never the mechanism here (labels are 63–135 px wide, all
comfortably past 44). The desktop fallback to `--control-sm` (28) is intact, as §3 requires
("it does not apply at desktop widths"). Reproduced at 360 px as well (all actions h = 44).

#### 4. The new guard `OnboardingChecklist.css.test.ts` **can** fail — spot-check passed

I did not take the executor's word for the red-first claim, and I did not modify the repo. I copied
the test file **byte-identically** (`diff -q` clean) plus a copy of the CSS into a scratch dir and
ran the real file under jest with a minimal config, mutating only the *copy* of the CSS:

| CSS copy | Result |
| --- | --- |
| pristine | 3 passed |
| `min-height: 44px` → `40px` | ✕ assertion 1 fails, other two pass |
| `.onboarding-checklist__done` dropped from the `<=768px` selector list | ✕ assertion 2 fails |
| `align-self: flex-start` removed from the base action rule | ✕ assertion 3 fails |
| whole `<=768px` block deleted | ✕ assertions 1 **and** 2 fail |
| restored pristine | 3 passed again |

Each mutation fails exactly the assertion it should and no others — the guard is falsifiable and
correctly targeted. Repo file untouched throughout (`git status --porcelain` unchanged;
`md5sum` of the real CSS constant). See the non-blocking note on what this class of guard *cannot*
catch.

#### 5. `max-width: 52ch` on `.onboarding-checklist__step-description`

Computed `max-width` resolves to **381.469 px** on the descriptions (52ch at `--text-xs`/12px) and
**445.047 px** on the lede (52ch at `--text-sm`/14px) — the same *character* measure rather than the
same pixel width, which is the right reading of "consistent measure". In practice the right edges
land within ~31 px of each other at 1440 (lede 24→469 from the card edge, descriptions 57→438), so
the ragged edge round 1 saw (416 vs 580 px) is resolved. Line counts are stable and nothing wraps
badly: 1/2/1/1 lines at 1440, 1100, 768 **and** 430 (at 430 the card, not the cap, is the
constraint: 324 px). `scrollWidth === clientWidth` at 1440 (1150), 1100 (810), 768 (726), 430 (388)
and 360 (318). No overflow anywhere.

#### 6. Gates, re-run by me, output read

| Gate | Command | Result |
| --- | --- | --- |
| lint | `npm run lint` (`eslint . --max-warnings=0`) | `LINT_EXIT=0` |
| format | `npm run format:check` | `FORMAT_EXIT=0` — "All matched files use Prettier code style!" |
| test | `npm test` | `TEST_EXIT=0` — **Test Suites: 253 passed, 253 total; Tests: 2709 passed, 2709 total** |
| build | `npm --prefix frontend run build` | `BUILD_EXIT=0` |

253/2709 vs round 1's 252/2706 — exactly the one new suite and its three tests. No backend files in
the diff, so `backend-test` does not apply.

#### 7. Acceptance criteria — each traced to observed behaviour (nothing round 1 passed has regressed)

| AC | Evidence this round |
| --- | --- |
| New user with no content sees it on first load | `skeptic554r2a` and `-r2b`, both registered through `/register`: `.onboarding-checklist` present, `localStorage["helio-onboarding-dismissed-<userId>"] = "false"` |
| No flash of the "No dashboards yet" hero | rAF sampler installed **before app JS** on a cold load with `/api/dashboards` delayed 800–900 ms. Whole-page distinct frames: `BLANK` → `SKELETON` → `CHECKLIST\|SKELETON` → `CHECKLIST`. Main-region-scoped sampler: `(none)` → `Add panel` → `CL::… Build your first dashboard`. The hero never appears in the main region in any frame |
| A user with content does not see it | Account A after source+pipeline+dashboard+panel: reload with `dismissed = "false"` → checklist **absent**. Account B with a dashboard: same. Suppression is gated on real content, not on the stored flag |
| Steps reflect real completion | 1 source → step 1 `Complete`, `aria-current` moves to step 2. Dashboard created → step 3 `Complete` while 1/2/4 stay `Not started`. All four resources → all four `Complete` + title changes to "That's the whole chain" |
| Each CTA opens the real flow | Step 1 → navigates to `/sources`, **no** `dialog[open]` (D4: navigates, never sets the flag). Step 2 → `Create pipeline` dialog opens in place on `/`. Step 3 → dashboard created + auto-selected, **checklist stayed mounted** across the `fetchPanels` round trip. Step 4 → `disabled` with no dashboard; with one, opens `Choose panel type` |
| Dismiss persists across reloads | Dismiss → storage `"true"`, checklist gone, the zero-dashboard hero takes the region back (never blank: "No dashboards yet / Create your first dashboard… / New dashboard"). Reload → still absent |
| Re-open incl. the without-leaving-`/` cycle | `Getting started` → storage `"false"`, checklist back on `/` with no reload; **second dismiss on the same mount** → `"true"`; reload → absent. Round 3's single-owner defect stays closed |
| Completed chain | All four `Complete`, zero step buttons, one `Done`; clicking it records `"true"` while the chain is still on screen. Renders above a real panel at 430 without pushing it off-screen (`r2-11-complete-430.png`) |
| Failed fetch → `failed`, not unchecked | Forced `GET /api/data-sources` → 500: `TriangleAlert` indicator computed `rgb(240,117,97)`, sr-text `— Couldn't check`, `InlineError` banner with `role="alert"` carrying the **real** message, and a Retry. Unblocked the route, clicked Retry → step returned to `Complete`. Banner is content-sized, not full-bleed |
| Tokens / Fraunces / one entrance | Title computed `Fraunces, "Iowan Old Style", Georgia, serif` / `20px` / `500`. **Zero** color literals in the file (`grep -nE '#[0-9a-f]{3,8}\|rgba?\('` → no matches). Surface opaque in both themes (`rgb(26,24,22)` / `rgb(253,252,250)`), no `backdrop-filter` (§3 opacity invariant). One `animation` on the card only, zero animated descendants; under `reducedMotion: "reduce"` computed `animation-duration: 1e-05s` |
| Light/dark parity | 1440/1100/768/430 in both themes: identical geometry (card 1152/812/728/390, header 71 everywhere), tokens swap correctly (`--app-text-muted` `rgb(155,148,138)` ↔ `rgb(108,101,92)`; border `rgba(242,239,233,0.09)` ↔ `rgba(33,29,25,0.11)`). No parity defect |
| Keyboard + a11y (§8) | `<section aria-label="Getting started">` + `<ul>` with 4 `<li>`. Tab order **Dismiss → New pipeline → New dashboard** then out of the card (step 1 complete = no button, step 4 disabled = correctly skipped). Focus ring computed `rgb(249,115,22) solid 2px` at `outline-offset: 2px` on every control — exactly §8's global rule. Status carried by `.sr-only` text (`— Complete` / `— Not started` / `— Couldn't check`), never colour alone. Escape does **not** dismiss (correct — not a modal) |
| No console errors | Zero `console.error`/`pageerror` across nine scripted runs covering first load, walkthrough, dismiss, re-open, completion, retry, hover, and every breakpoint. The only observed failures were my own injected 500s and the pre-existing `/api/auth/me` bootstrap 401 on the unauthenticated `/register` route; a full `response` listener on the authenticated flow logged **zero** ≥400 responses |

#### 8. Scope fence — clean

`git diff --name-only main...HEAD | grep -Ei 'CommandBar|MobileNavSheet|EmptyState|useAddSourceAction|useCreatePipelineAction|useCreateDashboardAction|useCreatePanelAction'` → **no matches**.
`SourcesPage.tsx` carries only the sanctioned unmount cleanup (one `useEffect` dispatching
`setAddSourceModalOpen(false)`), and `UserMenu.tsx` adds a menu item reusing the existing
`.user-menu__item` recipe rather than editing `CommandBar.tsx`.

#### 9. Design judgement — my own view of the rendered surface

**Copy: no finding, and I agree it is the strongest part of the change.** "Helio turns a data source
into a dashboard in four steps — each one feeds the next" followed by "Shape that source into a
⬡ type. **Types are only ever a pipeline's output — you never create one directly**" is the exact
Type-Registry lesson the ticket demands, in one sentence, with the inline `Shapes` glyph binding the
word to the nav item. Step CTAs match the nav labels verbatim ("Go to Data Sources"), the chain
reference in step 4 ("Bind a panel to **that** type") keeps the four steps reading as one sequence,
and the completion line "Source, pipeline, type, panel — every dashboard you build follows it"
teaches rather than congratulates. No emoji, no "You're all set!", no generic encouragement. This
reads as Helio-specific instruction, not a product tour. Step 3's "A canvas for your panels." is the
one merely-serviceable line, and it is four words long, so it costs nothing.

**Visual: the two round-1 divergences are genuinely resolved**, and the surface now matches its
siblings — one Fraunces headline, tokenised muted lede, 20 px status indicators, `--space-4` step
rhythm, content-sized §5 recipes, opaque card with a hairline and `--app-shadow-card`. Light/dark
are indistinguishable in structure. I found one further recipe divergence and two smaller optical
nits; all three are recorded below as **non-blocking**, with the reasoning for that classification.

### Verdict: CONFIRM

Both round-1 change requests are fixed, verified by measurement in the specific state each was
raised about, and reproduced on a second account in a separate browser. The 44 px floor holds
everywhere it must and correctly does not apply at desktop widths. The new guard demonstrably goes
red. Every acceptance criterion traces to observed behaviour on real accounts, all four gates are
green, and the scope fence is clean. Nothing I found rises to "should not ship".

### Non-blocking notes

Per the round-2 budget instruction, each is explicitly categorised. **None of these blocks
delivery**; #1 is the one I would actually spend a follow-up on.

1. **[follow-up candidate — real defect, cosmetic impact] The `Done` button never renders the
   Secondary hairline it is coded for — a source-order override.**
   `frontend/src/features/onboarding/ui/OnboardingChecklist.css:176-181` sets
   `border-color: var(--app-border-subtle)` on `.onboarding-checklist__done--secondary`, but
   `.onboarding-checklist__done` at `:200-213` re-declares `border: 1px solid transparent` **later
   in the file at equal specificity (0,1,0)**, so the shorthand wins. Measured on the running app in
   both themes: at rest `border-top-color: rgba(0, 0, 0, 0)` where §5's Secondary recipe requires
   `rgba(242,239,233,0.09)` (dark) / `rgba(33,29,25,0.11)` (light). On **hover** the border appears
   (`:183-188` is `(0,2,0)` and does win), so the control has no border at rest and grows one on
   hover.
   Root cause confirmed two ways, not inferred: a CSSOM walk lists the three matching rules in
   source order with `.onboarding-checklist__done { border: 1px solid transparent }` last, and a
   runtime probe appending one identical later declaration flips the computed value from
   `rgba(0,0,0,0)` to `rgba(242,239,233,0.09)` (`r2-12-done-{dark,light}-{rest,hover}.png`,
   `r2-13-done-probe-fixed.png`).
   Note the reach: `emphasisVariant` is `"secondary"` whenever the checklist does not supersede an
   `EmptyState`, and the completed-chain state necessarily has a panel on the selected dashboard —
   so in practice **`Done` is always Secondary and therefore always borderless**. Fix is one line
   (move the `.onboarding-checklist__done` block above the variant rules, or drop `border` from the
   shorthand in favour of `border-width`/`border-style`). Not blocking: the button is legible,
   correctly labelled, 44 px on mobile, keyboard-reachable, hover-affordant, and reads as the
   card's other Ghost controls do — this is a 1 px hairline on one control in one state.
2. **[follow-up candidate — guard coverage] The new CSS guard is text-matching, so it cannot see
   the class of bug in note 1.** `OnboardingChecklist.css.test.ts` asserts declarations *exist*; it
   cannot tell whether a later rule kills them. That is precisely the failure mode the ticket's own
   verification standard calls out ("a CSS source-order bug that made the 44px floor dead code
   while a text-matching assertion passed") — and note 1 is a live instance of it sitting in the
   same file the guard covers. The guard is still worth having (it goes red on all four mutations I
   tried, including deleting the whole media block); it just isn't a substitute for the computed
   measurement, which is why I re-measured rather than trusting it.
3. **[polish] Ghost action labels hang 12 px right of the prose above them.** The actions'
   `padding: 0 var(--space-3)` is invisible on the Primary (its background draws the box) but on the
   Ghost variants the label starts 12 px right of the step description's left edge, so
   "New dashboard" / "Add panel" read as slightly indented rather than aligned to the step column
   (`r2-04-light-1440.png`, `r2-04-dark-430.png`). A negative inline margin on the Ghost variant is
   the usual optical fix. Purely cosmetic.
4. **[polish] At ≥1100 the card is full-bleed while its content occupies only the left ~470 px.**
   Card 1152 px at 1440 vs a 445 px lede and 381 px descriptions, leaving ~680 px empty. It reads as
   a notice bar above the grid, which is defensible (and matches the grid's own width once panels
   exist), but a capped card or a two-column step layout at wide widths would balance it. Judgment
   call, not a rule violation.
5. **[carried from round 1, still true]** In the `failed` state the step's navigation/create action
   is replaced entirely by the `InlineError` (`OnboardingStep.tsx`), so that step is a dead end
   within the surface until Retry succeeds; the nav rail still reaches it. And `PanelList.tsx` is
   now 523 lines, past `CONTRIBUTING.md`'s ~400-line guidance — `files-modified.md` already proposes
   the split as a spinoff, which is what the rule asks for.
