## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Commit reviewed: `47e2e4ff` on `feature/mobile-nav-sheet-top-anchored/HEL-773`.
Cold review. Every number below comes from my own headless Chromium
(`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, launched by my own
node scripts in the session scratchpad — the shared MCP Playwright session was never
touched), or from gates I ran myself. `evaluation-1.md`, `evaluation-2.md`,
`files-modified.md` and `skeptic-final-1.md` were read as *claims* and every one I
relied on was re-derived. There is no cycle-3 evaluation report — commit `47e2e4ff`
came straight here — so all gates below are mine, not a re-read of anyone's PASS.

---

### 1. CR1 (the reason round 1 refuted) — fixed, by computed measurement

`[role="dialog"] .mobile-nav-sheet__create-action svg`, `getBoundingClientRect`,
430px, both themes:

| Element | Label font | Rendered `<Plus/>` |
| --- | --- | --- |
| `.mobile-nav-sheet__create-action` (dark) | 14px | **11.19 × 11.19** |
| `.mobile-nav-sheet__create-action` (light) | 14px | **11.19 × 11.19** |
| `[role="dialog"] .ui-empty-state__cta` (same sheet, empty branch) | 12px | 9.59 |
| desktop sidebar `EmptyState` CTA, same hook | 12px | 9.59 |
| desktop main `EmptyState` CTA, same hook | 14px | 11.19 |

It now sits exactly in its comparator family: same 14px label → same 11.19px glyph as
the desktop main CTA. The SVG still carries its literal `width="24" height="24"`
attributes (`svgAttrs.width === "24"`), and computed `width` is `11.1875px` — the CSS
is genuinely overriding the intrinsic size, not coincidentally matching it. Also
measured on `/sources` and `/pipelines` list branches: header glyph 11.19 there too.

**Root cause proven load-bearing by ablation, not by reading the CSS.** In the running
app I deleted exactly the one new rule (`.mobile-nav-sheet__create-action-icon svg`)
from the live CSSOM and re-measured the same element:

```
with fix:    {"w":11.19,"h":11.19,"cssW":"11.1875px"}
rules removed: 1
without fix: {"w":24,"h":24,"cssW":"24px"}
```

The defect returns iff that rule is absent — the fix is at the right layer and nothing
else is masking it. The wrapper losing `display: flex; align-items: center` costs
nothing: button box top 111 h 44 (centre 133.0), icon box top 127.41 h 11.19
(centre 133.0) — still optically centred. `EmptyState.css:169-184` and the new
`MobileNavSheet.css:158-181` block are now byte-equivalent in effect
(`font-size: 0.8em` + `svg { display:block; width:1em; height:1em }`), so **CR2's
corrected docblock claim is now true** — I compared both rules rather than taking the
comment's word for it.

### 2. Gates — all re-run by me on `47e2e4ff`

| Gate | My result |
| --- | --- |
| `npm run lint` (`eslint src --max-warnings=0`) | exit 0 |
| `npm test` | 247 suites / **2667** tests passed |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm run check:openspec` | `openspec/ is clean` |
| `npm --prefix frontend run build` | success (only the pre-existing >500 kB chunk advisory) |
| `npx playwright test e2e/hel773-…spec.ts` | **11/11 passed** (incl. the new icon-size case) |

### 3. Round 1's other findings — re-derived, none regressed

**AC1 / direction, every mobile page.** All six picker sections at 430 **and** 375, in
**both** themes (24 openings): `|panelTop − commandBarBottom| < 0.5` in every one;
backdropTop === barBottom in every one; `/settings` (`pickerId: "other"`) has no title
trigger at all, as designed. Zero console errors in every run.

**AC2 / safe area, forced on `document.documentElement` only.**

```
inset=0px  -> clipTop=56  sheetTop=56  barBottom=56  backdropTop=56  firstRowTop=163
inset=47px -> clipTop=103 sheetTop=103 barBottom=103 backdropTop=103 firstRowTop=210
inset=59px -> clipTop=115 sheetTop=115 barBottom=115 backdropTop=115 firstRowTop=222
distinct sheetTops: [56, 103, 115]
```

Three genuinely different tops, so the probe cannot silently no-op; no row is ever in
the status-bar band.

**44px floor — `getComputedStyle`, scoped to `[role="dialog"]`, at 430 and 768.**
Rows 44/44 (computed `height` *and* `min-height`), header action 44, drag strip 44,
empty-branch CTA 44 — identical at both widths, and still 44 for the two-line registry
rows carrying a provenance subtitle. I reproduced the documented trap deliberately: the
**unscoped** `.ui-empty-state__cta` query returns `["28px","44px","44px"]` (the desktop
sidebar's `display:none` copy first). Scoping is what makes the reading honest.

**Command bar never overlapped or dimmed** — `elementFromPoint` (not
`getBoundingClientRect`, which ignores `clip-path`), sampled across the entrance:
`panelTop` sweeps −152 → −49.9 → 27.8 → 47.7 → 55.2 → 56 while `backdropTop` stays 56,
`.app-command-bar` computes `opacity: 1` / `filter: none` at every frame, and the point
at the bar's centre resolves inside the bar at every frame. `inert` is on both
`__inert-group` wrappers and `__right` while open and **removed** on close;
`aria-expanded` flips `true`/`false`.

**AC5 / reduced motion** (context launched `reducedMotion: "reduce"`): computed
`animation-name: none` on panel, clip wrapper and backdrop; `transform: none`;
`panelTop === barBottom === 56` on the first frame — at rest, not shortened.

**AC4 / dismissal + focus.** Initial focus lands on the active row (never the create
action); Tab cycles rows → create action → wraps (trap holds, the backdrop button is
never reachable); Escape, backdrop tap, trigger re-tap and an upward drag (−140) all
close and restore focus to `.app-command-bar__mobile-title`; a downward drag (+150) is
correctly a no-op (sheet still open).

**Cycle-1 flash — still gone**, re-derived with my own `MutationObserver` on all three
hook classes (fire create → dismiss modal → reopen): a single `present:true`
transition each, `dialogsNow: 1`, `aria-expanded="true"`. No open/close pair.

### 4. Acceptance criteria — traced to evidence

- **AC1** — table in §3; all six sections, both themes, 430 + 375.
- **AC2** — 0/47/59 measurements above.
- **AC3** — live: `/` header "New dashboard" (quick-create: row count 1 → 2,
  "Untitled dashboard" appears, sheet dismisses on success); `/sources` → real
  "Add data source" modal; `/pipelines` → real "Create pipeline" modal;
  `/registry` → "Create pipeline" modal from its empty CTA. All 44px, glyph 11.19.
  Pending state: label becomes `"Creating..."`, `disabled === false`, still 44px.
- **AC4** — §3.
- **AC5** — §3.
- **AC6** — 430 and 375, dark and light, screenshots read (not just measured).
- **AC7** — §2.
- **AC8** — every empty branch renders `.ui-empty-state.ui-empty-state--sidebar` (the
  only `<p>`s left are `EmptyState`'s own `__title`/`__description`); sources/pipelines/
  registry carry a CTA, metrics/chat are message-only with **zero** buttons in the
  dialog.
- **AC9** — demonstrated, not assumed: the CTA opens a real section-mounted modal on
  sources/pipelines/registry (§AC3). No new hook, no new modal mount in the diff.
- **Copy parity** — desktop sidebar `/sources` empty state renders "Connect a data
  source" / "Pull in data from PostgreSQL, MySQL, CSV, or static input.", byte-identical
  to what the phone sheet renders.

### 5. Design judgement (my domain)

I read the **current** `DESIGN.md` (373 lines) in this worktree, including the HEL-774
bottom-nav carve-out in §3 "Surfaces & the opacity invariant" and the sanctioned
`::after` hit-expander clause in §3 "Control metrics". This change cites no exception,
and `git diff main...HEAD` does not touch `DESIGN.md` — nothing here claims a rule that
does not exist.

- **The direction change reads correctly.** In both themes the panel's squared top
  corners + `border-top: none` + rounded bottom corners give the attached-dropdown
  silhouette; the seam is a clean full-width edge; the chevron flips; the scrim starts
  at the seam so the bar stays lit. It reads as hanging off the title, not floating.
- **The header action now reads as a subordinate action**, which is exactly what round 1
  said it did not. `+` is optically secondary to its label and matches the stroke weight
  of every other `+` in the app (`dark-430-header-action.png`,
  `light-430-header-action.png`).
- **Token discipline.** Zero hex/rgb/hsl added anywhere in the diff. The only literals
  are the sanctioned `44px` tap floors, `1px` hairlines, the grabber's pre-existing
  `36px`/`4px` (moved verbatim from `main`), and `0.8em` — a *relative* size copied
  verbatim from the shipped `.ui-empty-state__cta-icon`, not the px/rem literal §3
  Typography prohibits. Recipes: the header action is §5 **Secondary** exactly
  (transparent bg, `--app-border-subtle`, muted text; hover measured live →
  `--app-border-strong` + `--app-surface-raised` + full text). Radius `--app-radius-sm`,
  weight/type tokens throughout, `--transition-slow` for the single entrance.
- **Consistency across sections** (the stated premise) holds under a populated check,
  not just an empty one: `/pipelines` populated → rows + "New pipeline" header action;
  `/registry` populated → rows with "Pipeline: …" subtitles and **no** header action
  (D7, matching desktop); `/sources` populated → rows + "Add source"; metrics/chat →
  neither. Every section's sheet opens, anchors, traps focus and dismisses identically.
- **A11y.** Accessibility tree for the open sheet:
  `dialog "Dashboards" (modal) → heading "Dashboards" → button "New dashboard" →
  button "SK2 A11y Current" (pressed)`. The lucide glyph is `aria-hidden="true"`, so it
  adds nothing to the name. Keyboard focus ring on the create action computes
  `2px solid rgb(249,115,22)` at `outline-offset: 2px` — §8's rule — and is not clipped
  by the clip wrapper.
  *Measurement-discipline note:* my first focus-ring probe read "no outline" and
  contradicted the rest of the picture, so I re-ran it before drawing any conclusion —
  the first probe was wrong (it held a **live** `CSSStyleDeclaration` and read it after
  focus had already moved on). The corrected keyboard-only probe is what is reported
  above. A single anomalous reading was not a verdict.
- **States.** Error path exercised live in both themes by fulfilling
  `POST /api/dashboards` with 500: list branch keeps the sheet open and renders
  `.inline-error` in error intent beside the header action; empty branch swaps to
  `ui-empty-state--error` ("Couldn't create dashboard" + message, CTA retained);
  reopening shows **0** stale errors. Long list (14 rows): panel clamps to `max-height:
  764px`, bottom 820 vs bottom-nav top 832 (a `--space-3` gap), list scrolls, drag strip
  stays pinned and visible.
- **Console:** zero errors *and* zero warnings across every section, theme, width and
  flow I ran.

### 6. Fences and hygiene

`git diff --name-only main...HEAD` contains none of `SidebarBody.tsx`,
`SidebarItemList.tsx`, `DashboardList.tsx`, `features/onboarding/`,
`useCreateDashboardAction`, `useAddSourceAction`, `useCreatePipelineAction` — 15 source
files + change artifacts only. `git status --porcelain` shows only the expected
in-flight `workflow-state.md`. My own e2e run created `test-results/.last-run.json`
(gitignored); I removed it — the worktree is clean. All my probe scripts and 30-odd
screenshots live in the session scratchpad, never in the worktree. I did not run
`cleanup.sh` or `concertino sync`.

---

### Verdict: CONFIRM

The one blocking defect from round 1 is fixed, verified by computed measurement in both
themes and proven load-bearing by ablation; nothing round 1 passed has regressed under
independent re-measurement; and my own sweep of the seven picker sections, both themes,
both widths, and the loading/empty/error/pending/failure states found nothing an
experienced eye would reject. It ships.

### Non-blocking notes

- **The icon-size lock lives only in the on-demand e2e suite.**
  `MobileNavSheet.css.test.ts` locks ten-odd other invariants (top anchor, scrim start,
  reduced-motion source order, the 44px floors, declared-exactly-once) but not this
  rule, and jsdom cannot measure a glyph. My ablation shows deleting exactly
  `.mobile-nav-sheet__create-action-icon svg` reinstates the 24px defect with every
  pre-commit gate still green. A two-line static lock in that file (assert the rule
  exists and declares `width: 1em`) would put this defect class inside the gates that
  actually run on commit. Cheap; worth doing in the PR or as a follow-up.
- **No exit animation, and the panel does not track the finger during a drag**
  (re-confirmed: mid-drag computed `transform` stayed `matrix(1,0,0,1,0,0)`). Both are
  pre-existing on `main` and out of scope (HEL-565); the thesis is carried by the
  entrance. Please make sure the spinoff is actually filed rather than left in
  `design.md`'s Planner Notes.
- **Inert bar controls swallow taps with no feedback** — a tap on the avatar/refine/
  new-chat controls now does nothing where it used to dismiss. Follow-up as already
  agreed.
- `MobileNavSheet.tsx` is 427 lines, past `CONTRIBUTING.md`'s ~400-line "propose a
  split" threshold — record the proposal in the PR body as planned.
- Within the sheet, the header action's label is `--text-sm` (14px) while the
  empty-branch CTA is `--text-xs` (12px). They can never render simultaneously and each
  matches its own shipped recipe, so this is not drift — noting it only so a future
  reader does not "fix" one into the other.
- Task 7.1 (stale capability Purpose) remains correctly deferred to the archive step by
  its own text.
