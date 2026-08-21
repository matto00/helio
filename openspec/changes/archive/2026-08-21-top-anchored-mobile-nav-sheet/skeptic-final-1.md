## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: `4386eb4b` on `feature/mobile-nav-sheet-top-anchored/HEL-773`.
Cold review. Every measurement below is from my own headless Chromium
(`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, launched by my own
scripts — the shared MCP Playwright session was never touched) against the running
dev servers on 6205/9112, or from my own gate runs. Nothing is carried over from
`evaluation-1.md`/`evaluation-2.md`; I read those as claims and re-derived each one.

---

### What I verified (with evidence)

**Environment.** `scripts/concertino/assert-phase.sh servers … 6205 9112 HEL-773` →
`PASS servers` (existing servers reused, idempotent).

**Fences — clean.** `git diff --name-only main...HEAD` contains none of
`SidebarBody.tsx`, `SidebarItemList.tsx`, `DashboardList.tsx`, `features/onboarding/`,
`useCreateDashboardAction.tsx`, `useAddSourceAction.tsx`, `useCreatePipelineAction.tsx`.
15 source files + change artifacts only. `git status --porcelain` shows only the
expected in-flight `workflow-state.md` / untracked `evaluation-2.md`. No
`test-results/` directory exists; my own probes wrote nothing into the worktree.

**Gates, re-run by me (not read off the evaluation).**

| Gate | My result |
| --- | --- |
| `npm run lint` (`eslint . --max-warnings=0`) | exit 0 |
| `npm test` | 247 suites / **2667** tests passed |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm run check:openspec` | `openspec/ is clean` |

**AC1 — top anchor, every mobile page.** Measured on all six reachable picker
sections at 430px; `|sheetRect.top − commandBarRect.bottom| < 0.5` in every case:

```
/         Dashboards     anchored=true  header="New dashboard"  rows=1   dragStrip=44
/sources  Data Sources   anchored=true  emptyCta="Add source"            dragStrip=44
/pipelines Data Pipelines anchored=true emptyCta="New pipeline"          dragStrip=44
/registry Data Types     anchored=true  emptyCta="New pipeline" (no header action)
/metrics  Metrics        anchored=true  no create action
/chat     Assistant      anchored=true  no create action
/settings  -> no mobile title trigger (pickerId "other"): sheet unreachable, as designed
```

Mid-entrance frame captured at ~120 ms (`dark-430-dash-midentrance.png`): the panel's
own title is visibly **clipped at the seam** and the command bar is fully painted and
undimmed — D3's clip wrapper works empirically, not just on paper.

**AC2 — safe-area offset, measured not assumed.** `--app-safe-top` forced on
`document.documentElement` only:

```
inset=0px  -> clipTop=56  sheetTop=56  barBottom=56  backdropTop=56  firstRowTop=163
inset=47px -> clipTop=103 sheetTop=103 barBottom=103 backdropTop=103 firstRowTop=210
inset=59px -> clipTop=115 sheetTop=115 barBottom=115 backdropTop=115 firstRowTop=222
distinct tops: 3  [56, 103, 115]
```

The three tops genuinely differ, so the probe cannot silently no-op; `firstRowTop`
is always well below `barBottom`, so no row is ever occluded.

**The 44px floor — `getComputedStyle`, scoped to `[role="dialog"]`, at 430 and 768.**
Never read off the CSS.

```
@430: rows 44/44/44 (computed height AND min-height = 44px), headerAction 44,
      dragStrip 44, empty-branch CTA 44
@768: rows 44/44/44, headerAction 44, dragStrip 44
```

I hit the documented trap deliberately: an **unscoped** `.ui-empty-state__cta` query
matches the desktop sidebar's `display:none` copy, which reports 28px. Scoping to
`[role="dialog"]` yields 44px for the sheet's own CTA on sources/pipelines/registry.
The CSS lock test (`MobileNavSheet.css.test.ts:184-219`) is substantive, not
decorative: it asserts `min-height: 44px` *and* that each selector is declared
exactly once inside its block — the HEL-535 shadowing class.

**D2 — command bar not overlapped, not dimmed.** `document.elementFromPoint()` at the
bar's and the trigger's centres (not `getBoundingClientRect`, which ignores
`clip-path`), sampled across the entrance:

```
frame~0ms   barCenterEl=app-command-bar__mobile-title       inBar=true  panelTop=-240  backdropTop=56
frame~60ms  barCenterEl=…mobile-title-chevron--open         inBar=true  panelTop=-94.7 backdropTop=56
frame~140ms barCenterEl=…mobile-title-chevron--open         inBar=true  panelTop=28.7  backdropTop=56
frame~400ms barCenterEl=app-command-bar__mobile-title       inBar=true  panelTop=56    backdropTop=56
```

`.app-command-bar` computed `opacity: 1` throughout; both
`.app-command-bar__inert-group` wrappers (`display: contents`) and
`.app-command-bar__right` carry `inert` while open and drop it on close;
`aria-expanded="true"`; the chevron carries `--open`.

**AC4 — dismissal and focus, all exercised live.**

```
initial focus  -> button.mobile-nav-sheet__item--active ("Untitled dashboard")  [D10 ✓]
Tab cycle      -> 5 rows then wraps to .mobile-nav-sheet__create-action (trap holds)
Escape         -> dialogs 0, focus restored to .app-command-bar__mobile-title
backdrop tap   -> dialogs 0, focus restored to .app-command-bar__mobile-title
trigger re-tap -> dialogs 0 (D2 toggle)
drag dy=-140   -> dialogs 0, focus restored  (upward dismiss)
drag dy=+150   -> dialogs 1                  (downward is a no-op, correctly clamped)
```

**AC5 — reduced motion genuinely disabled**, in a context launched with
`reducedMotion: "reduce"`: computed `animation-name: none` on panel, clip wrapper
**and** backdrop, and `panelTop === barBottom` on the very first frame — it appears
at rest, not shortened.

**D5 — bottom-nav clearance.** `panel max-height` computes to `764px` at a 900px
viewport (= 900 − 56 − 68 − 12); sheet bottom therefore never exceeds 820 while the
capsule's top is 832 — a `--space-3` gap by construction. Measured with a full list:
`dragStripBottom=351 < navTop=832`.

**Cycle-1 flash defect — genuinely gone on the running app.** I re-derived it with my
own `MutationObserver` trace (fire a create, dismiss any modal, then reopen), on all
three hook classes:

```
/          create="New dashboard"  modalOpened=0  reopen -> [{present:true}]  dialogsNow=1  aria-expanded=true
/sources   create="Add source"     modalOpened=1  reopen -> [{present:true}]  dialogsNow=1  aria-expanded=true
/pipelines create="New pipeline"   modalOpened=1  reopen -> [{present:true}]  dialogsNow=1  aria-expanded=true
```

Single `present:true` transition, no open-then-close pair. **Systematic-debugging law
satisfied independently:** I built a throwaway scratch tree outside the worktree,
swapped in `git show HEAD~1:…/MobileNavSheet.tsx` (pre-fix) against the *new* test file,
and got

```
● MobileNavSheet › does not call the reopened session's onClose after a create action
  fired in a prior session, even with a fresh onClose identity every render
  Expected number of calls: 0 / Received number of calls: 1
Tests: 1 failed, 27 passed, 28 total
```

Red against the old code for the right reason, green against the new. Scratch tree
deleted; the worktree was never modified.

**AC3/AC8/AC9 — create actions and empty branch.** Per-section affordances match
D6/D7 exactly (table above): exactly one affordance in every state, registry
empty-branch-only, metrics/chat none. D14's mount constraint **demonstrated, not
assumed** — tapping the sheet's create action opens a real modal from the section:

```
/sources   -> dialog[open] "Add data source"   (sheet dismissed on fire)
/pipelines -> dialog[open] "Create pipeline"   (sheet dismissed on fire)
/registry  -> dialog[open] "Create pipeline"   (shell-mounted, sheet dismissed on fire)
/          -> no modal; POST fires, sheet dismisses on success
```

**D9 failure/pending, exercised live** by fulfilling `POST /api/dashboards` with a 500,
in both themes: list branch keeps the sheet open and renders `.inline-error`
("Simulated backend failure creating dashboard") beside the header action; empty
branch renders the error-intent `EmptyState` ("Couldn't create dashboard" + the
message + the CTA retained); closing and reopening shows **0** stale error nodes.

**Token discipline.** Zero hex/rgb/hsl added anywhere in the diff. The only literal
dimensions added are `1px` hairlines (app-wide convention), the sanctioned `44px` tap
floors, the grabber's pre-existing `36px`/`4px` (moved verbatim from `main`), and
`font-size: 0.9em` — see CR1. `env(safe-area-inset-top)` appears nowhere in
`MobileNavSheet.css`; no bottom-nav token appears in a `top` declaration; the stale
`padding-bottom: env(safe-area-inset-bottom)` is gone.

**DESIGN.md read fresh, not recalled.** I read the current 373-line file, including
the HEL-774 bottom-nav opacity carve-out (§3 "Surfaces & the opacity invariant") and
the `::after` hit-expander clause (§3 "Control metrics"). Neither is cited by this
change, and this change claims no exception that the file does not contain.

**Console.** Zero errors across every section, every theme, every flow I ran
(dashboards/sources/pipelines/registry/metrics/chat/settings, both themes, 430 and 375).

**Visual sweep.** 20 screenshots at 430 and 375, both themes, list branch / empty
branch / no-action branch / mid-entrance / failure states, in
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/shots/`
(`{dark,light}-{430,375}-*.png`, `SK3-*.png`, `SK4-*.png`).

**Answers to the two soft spots routed to me:**

- *Undimmed-but-inert command bar.* It does **not** read as broken. The bar looks like
  a normal menu bar with an open menu — a familiar pattern — and leaving it lit is
  precisely what makes the sheet read as hanging off the title rather than floating
  over a dead screen. D2 is the right call. One honesty gap, noted below, but not a
  blocker.
- *Dark theme, panel lighter than bar.* It reads as **anchored**, not floating. The
  squared top corners + `border-top: none` + rounded bottom corners give the classic
  attached-dropdown silhouette, the seam is a clean full-width edge with no gap, and
  the `--app-shadow-soft` is clipped flat at the seam by the wrapper so nothing casts
  onto the bar. Same reading in light. AC1's headline criterion is met in both themes
  at both widths.

---

### Verdict: REFUTE

One blocking defect. It is cosmetic in nature but it is the ticket's own headline new
affordance, it is visible on first open of the most-scrutinized surface in the app, and
green tests certified it because nothing measures a glyph — the exact defect class this
session has been burned by repeatedly.

---

### Change Requests

**1. The sheet's header create action renders its `+` glyph at 24px next to a 14px
label — 2.1× the app's own shipped treatment of the identical icon, and 2.5× the CTA
the same component renders one state away.**

`frontend/src/shared/chrome/MobileNavSheet.css:161-165`:

```css
.mobile-nav-sheet__create-action-icon {
  display: flex;
  align-items: center;
  font-size: 0.9em;
}
```

Measured on the running app (dashboards sheet, 430px, dark and light):

| Element | Label font | Rendered `<Plus/>` |
| --- | --- | --- |
| `.mobile-nav-sheet__create-action` (new, this ticket) | 14px | **24 × 24 px** |
| `[role="dialog"] .ui-empty-state__cta` (same sheet, empty branch) | 12px | 9.59 × 9.59 px |
| desktop sidebar `EmptyState` CTA, same hook | 12px | 9.59 × 9.59 px |
| desktop main `EmptyState` CTA, same hook | 14px | 11.19 × 11.19 px |

Root cause: all three HEL-548 hooks pass a **lucide `ReactNode`** (`<Plus />`), which
carries literal `width="24" height="24"` attributes. `EmptyState.css:181-184` neutralises
that with `.ui-empty-state__cta-icon svg { display: block; width: 1em; height: 1em; }`;
`MobileNavSheet.css` has no equivalent rule, so the SVG keeps its intrinsic 24px and the
`font-size: 0.9em` above is **dead code for every real consumer** (it can only ever affect
the FontAwesome branch, which no hook exercises). A rule that reads right and computes
wrong — the class the brief flags.

Visual evidence — the two crops side by side make it unarguable:
`…/scratchpad/shots/SK3-header-action-dark.png` vs `…/scratchpad/shots/SK3-empty-cta-dark.png`.
The header action's plus overwhelms its label and reads as a separate element with a
different stroke weight; the empty-branch CTA's plus is correctly subordinate.

Required: size the icon the way the rest of the app does — add the `svg { display:
block; width: 1em; height: 1em; }` descendant rule mirroring `EmptyState.css:181-184`
(and align the wrapper's `font-size` with `.ui-empty-state__cta-icon`'s `0.8em` unless
there is a reason to diverge). Re-verify by **computed measurement**, not by reading the
CSS: the rendered `<svg>` box in `[role="dialog"] .mobile-nav-sheet__create-action`
must be ≈1em, not 24px.

**2. Correct the comment that claims a mirror it does not implement.**

`frontend/src/shared/chrome/MobileNavSheet.tsx:60-65` says
`renderCreateActionIcon` "mirrors `EmptyState.tsx`'s private `renderCtaIcon`". It
mirrors the *markup* half and omits the *sizing* half, which is what produced CR1. Once
CR1 lands the claim becomes true; if any deliberate divergence remains, say so
explicitly rather than asserting a mirror. (This session already spent a cycle on
HEL-774 shipping a comment that cited something that did not exist — same failure mode,
one layer down.)

---

### Non-blocking notes

- **No exit animation is acceptable to ship, but the spinoff must actually be filed.**
  Dismissal unmounts instantly and the panel does not track the finger during the drag
  (`animation: … both` pins `translateY(0)` over the inline transform). Both are
  pre-existing on `main`, both are explicitly out of scope (HEL-565), and the ticket's
  thesis — direction relative to the trigger — is carried by the entrance, which is
  correct and legible. `design.md`'s Planner Notes already commits to filing this;
  please file it rather than leaving it in prose.
- **Inert bar controls swallow taps with no feedback.** Before this change a tap
  anywhere outside the sheet — including on the command bar — dismissed it. Now a tap
  on the avatar / refine / new-chat controls does nothing at all (hit-testing passes
  through `inert` to the non-inert `<header>`). Consider routing bar taps to `onClose`,
  which would restore the old behaviour *and* remove the honesty gap without dimming
  anything. Worth a follow-up, not a blocker.
- **`MobileNavSheet.tsx` is 427 lines**, past `CONTRIBUTING.md`'s ~400-line "propose a
  split" threshold. Agreed with the evaluator that it should not block, but the proposal
  is still not recorded anywhere — put it in the PR body.
- `files-modified.md`'s cycle-2 note calls `App.tsx` "fenced". It is not; it was simply
  the wrong layer for the fix. Cosmetic.
- The list-branch inline error sits ~7px above the first row; slightly tight, but within
  the header's own `--space-2` rhythm. No action needed.
- Task 7.1 (stale capability Purpose) remains correctly deferred to the archive step by
  its own text; the three `design.md` Planner-Notes spinoffs are still unfiled.
