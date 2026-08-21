## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `b0c82eb6a1b5b438a8f4082bedc4cf0be36b7dc5`. Worktree carries only
`workflow-state.md` (modified) + untracked `evaluation-1.md` — no stray source changes.

All browser evidence below was gathered with my own headless Chromium
(`~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`, `playwright-core` driven from
scripts, **not** the shared MCP session) against dev `5986` / backend `8893`, on **three
freshly-registered real accounts** (`skeptic554-a/-b/-c@helio.dev`) created through the app's own
`/register` form. No props were forced and no Redux state was preloaded anywhere in this review.

**Screenshots referenced below** live at
`/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/`
(copied out of the ephemeral scratch dir so they survive worktree teardown).

### What I verified (with evidence)

**Ground truth read first.** `ticket.md`, `design.md` (D1–D10), the two spec deltas, the full
`git diff main...HEAD` (35 files), and the current `DESIGN.md` as it stands after HEL-774 (373
lines, read start-to-finish — the carve-outs I rely on below are the §5 button recipes at
`DESIGN.md:264-267`, §3 control metrics at `:193-211`, §6 shared primitives at `:320-333`).

**Gates re-run by me, output read (not inherited):**

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0, no diagnostics |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npx jest` | 252 suites / 2706 tests passed |

**Acceptance criteria, each traced to observed behaviour:**

| AC | Evidence |
| --- | --- |
| New user (no content) sees the checklist on first load | Registered `skeptic554-a`, landed on `/`: `.onboarding-checklist` present, `localStorage["helio-onboarding-dismissed-021b186c-…"] = "false"`. Same on `-b` and `-c`. |
| "No dashboards yet" hero never paints first | rAF sampler installed **before app JS** on a cold load with `/api/dashboards` delayed 700 ms recorded exactly three main-region states: `SKELETON` → `CHECKLIST\|SKELETON` → `CHECKLIST`. `HERO-NO-DASH` never appeared in any frame. |
| A user with a dashboard does not see it | Account `-a` after creating a dashboard: reload with `dismissed = "false"` still stored → checklist absent (`visible: false`). Auto-activation is correctly gated on dashboards, not on the stored flag alone. |
| Steps reflect real completion | Created a real source via `POST /api/data-sources` (201) → step 1 flips to `Complete` + check glyph + sr-text `— Complete`, `aria-current="step"` moves to step 2. Created a pipeline + panel (201/201) → all four `Complete`. |
| Each CTA opens the real flow | Step 1 → navigates to `/sources` and **does not** auto-open the modal (only open `<dialog>` on that page is the closed quick-launcher, confirmed by enumerating `dialog[open]`). Step 2 → `Create pipeline` dialog opens in place from `/`. Step 3 → dashboard created + auto-selected, checklist stayed mounted across the whole `fetchPanels` round trip. Step 4 → `Choose panel type` dialog. Step 4's button is correctly `disabled` with no dashboard selected. |
| Dismiss persists across reloads | `-b`: dismiss → storage `"true"`, checklist gone, zero-dashboard hero restored (region never blank); reload → still absent. |
| Re-open, incl. the without-leaving-`/` cycle | `Getting started` → storage `"false"`, checklist back on `/` without a reload; **second dismiss on the same mount** → storage `"true"`; reload → absent. The round-3 single-owner defect is genuinely closed on the running app. Re-open also works from `/sources` (navigates to `/` and presents) and at 430. |
| All-four-complete | Title "That's the whole chain", lede "Source, pipeline, type, panel — every dashboard you build follows it.", four checks, zero step buttons, one `Done` (Secondary, 64×28). Dismissal recorded (`"true"`) **while the chain is still on screen**. |
| Failed `fetchSources` → failed, not unchecked | Forced `GET /api/data-sources` → 500: step 1 renders `TriangleAlert`, indicator `rgb(240,117,97)`, sr-text `— Couldn't check`, `InlineError` banner with `role="alert"` carrying the real message and a Retry. Unblocked the route, clicked Retry → step returns to `Not started` with its `Go to Data Sources` action. |
| Indeterminate | With `/api/data-sources` + `/api/pipelines` delayed 4 s: steps 1–2 render a `Skeleton` circle indicator (`— Checking…`) with their actions still live; steps 3–4 unaffected. |
| Tokens / Fraunces / one entrance | Computed title font `Fraunces … / 20px / 500` via `--font-display`/`--text-xl`/`--weight-medium`. No hex/rgb literal anywhere in `OnboardingChecklist.css`. One `animation` on the card only; under `reducedMotion: "reduce"` computed `animation-duration` is `1e-05s`. |
| Light/dark parity | 1440/768/430 captured in both themes — opaque surface, hairline border, correct muted/accent tokens in both. No parity defect. |
| Keyboard + a11y | `<section aria-label="Getting started">` + `<ul>/<li>`; tab order = Dismiss → step 1 → step 2 → step 3 (disabled step 4 correctly skipped); focus ring computed `rgb(249,115,22) solid 2px` at `outline-offset: 2px` (§8). Status is carried by `.sr-only` text, not colour alone. Escape does not dismiss (correct — not a modal). |
| ≥44px touch floor — **measured, never read off CSS** | `getComputedStyle`/`getBoundingClientRect` at 430 and 768, both themes: dismiss 44×44; every step action h = 44; `Done` h = 44; new `UserMenu` "Getting started" row 44×200. At 1440 they correctly fall back to `--control-sm` (28). Floor holds. |
| No console errors | Zero `console.error`/`pageerror` across first load, walkthrough, dismiss, re-open, completion, retry, and all breakpoints. The only 401s observed were the pre-existing `GET /api/auth/me` bootstrap on the unauthenticated `/register` route. |

**Scope fence — clean.** `git diff --name-only main...HEAD` contains no `CommandBar.tsx`, no
`MobileNavSheet.*`, no `EmptyState.*`, and none of the four HEL-548 create-action hooks.
`SourcesPage.tsx` gained only the unmount cleanup.

**The `SourcesPage` cleanup verified in the running app, not just in Jest.** Opened `Add data
source` on `/sources`, client-side-navigated to `/pipelines` with it open, returned to `/sources`:
no `dialog[open]`. The accompanying Jest tests carry a real positive control (they first assert the
preset flag *does* open the dialog), so they are falsifiable rather than vacuous.

**Copy judgement (my own, from the rendered surface).** It is not patronising and not a generic
product tour. "Helio turns a data source into a dashboard in four steps — each one feeds the next"
plus "Types are only ever a pipeline's output — you never create one directly" is exactly the
model-specific lesson HEL-774 leaned on this ticket for, in four short lines. The four glyphs do
bind to the nav registry (`Database` / `Workflow` / `LayoutDashboard`, verified against the
rendered sidebar), and the inline `Shapes` mark beside "type" reads legibly when magnified. The
copy is a genuine deliverable, not decoration. **No finding here.**

### Verdict: REFUTE

Everything functional passes, and the copy is strong. I am refuting on the two visual-judgement
items the evaluator explicitly deferred to me — both reproduced on fresh accounts across
independent runs, both a divergence from a recipe this same file otherwise copies, and both a
one-line fix.

### Change Requests

1. **`frontend/src/features/onboarding/ui/OnboardingChecklist.css:141` — step action buttons
   stretch to the width of their step's longest text line, producing a full-bleed solid-accent
   slab in the ordinary flow.** `.onboarding-checklist__step-body` (`:97-102`) is a column flex
   container and `.onboarding-checklist__action` sets no `align-self`, so every action inherits
   `stretch`. Measured at 1440 on a fresh account: 177 / 585 / 158 / 236 px for four buttons whose
   labels are 9–18 characters.

   This is not only a hover-band nit. The emphasised action is the *first incomplete* step, so the
   moment a user does the very first thing the checklist asks — connect a source — the Primary
   moves to step 2 and renders as a **580×28 px solid `--app-accent` bar with its label jammed at
   the left edge** (reproduced twice: `/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/05-step2-emphasis.png`, and independently on account
   `skeptic554-c` in `/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/23-final-1440.png`; at 768 the same slab is 580×44,
   `/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/07-768-light.png`). A control whose width is set by the prose above it is none of §5's
   four recipes — `DESIGN.md:268` ("A new button style is a defect, not a variant"). At rest the
   Ghost siblings hide it, but hovering "New pipeline" paints a 585 px `--app-surface-raised` band
   for a 12-character label (`/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/03-hover-step2.png`), which reads as a full-width row
   highlight, not a button.

   Fix: add `align-self: flex-start` to `.onboarding-checklist__action` — the *sibling*
   `.onboarding-checklist__done` rule at `:199` already sets exactly that, so the omission is an
   oversight rather than a decision. I probed the fix at runtime (injected stylesheet, no repo
   edit): widths become 134 / 100 / 115 / 83 px, all four content-sized and consistent
   (`/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/21-probe-1440.png`).

2. **`frontend/src/features/onboarding/ui/OnboardingChecklist.css:227-230` — the 430 header stack
   strands the dismiss control mid-card.** `.onboarding-checklist__header` is the same recipe as
   `Modal.css:111-119` (`display:flex; align-items:flex-start; justify-content:space-between`), but
   this file adds a `flex-direction: column` override at 430 that no other surface in the app has —
   `Modal.css` has no 430 query at all and keeps its close button top-right at every width
   (its only mobile rule is the `.ui-modal-btn` 44 px floor at `:223-228`).

   Measured at 430 on a fresh account: `flex-direction: column`, header height 123 px, and the `X`
   sits **17 px from the card's left edge and 96 px below the card top** — i.e. in its own 44 px
   band between the lede and step 1, with vertical gaps on both sides
   (`/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/07-430-dark.png`, `/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/24-final-430.png`). It reads as an orphaned, unexplained glyph
   rather than a close affordance, and it spends ~60 px of the most constrained viewport doing so.
   This is the phone-facing surface HEL-774 named as its mitigation, so the phone rendering is
   load-bearing here.

   Fix: drop the `flex-direction: column` override (keep the `padding` change). The row layout fits
   without overflow — runtime probe at 430: intro 304 px wide, `X` back at the top-right corner,
   header height 71 px instead of 123, `scrollWidth === clientWidth`
   (`/home/matt/Development/helio/.concertino/runs/HEL-554/evidence/skeptic-final-1-shots/22-probe-430.png`).

### Non-blocking notes

- **No regression guard exists for the 44 px floor on this surface.** It holds today (I measured
  it), but there is no test that would go red if `OnboardingChecklist.css:215-220` were deleted —
  and this repo has regressed that floor six times. `UserMenu.css.test.ts` is the existing
  precedent for a cheap CSS-level guard if you want one.
- **The lede is capped at `max-width: 52ch` (`:55`) while the step descriptions are uncapped**, so
  at 1440 the lede wraps to two lines at 416 px while step 2's description runs 580 px unbroken.
  The ragged measure is visible in every wide screenshot. Consider capping the whole card (or the
  step descriptions) rather than only the lede.
- **The emphasised action is visually smaller than the CTA it supersedes**: `--control-sm` /
  `--space-3` / `--text-xs` here vs `EmptyState.css:102-116`'s `--control-md` / `--space-4` /
  `--text-sm`. Both are inside §5's sanctioned range, so this is not a violation — but the
  first-run Primary now carries less weight than the "New dashboard" CTA it replaced.
- **`cta.icon` is discarded.** The seam's CTAs supply `<Plus />` (e.g.
  `useCreatePipelineAction.tsx:27`), and the checklist renders `cta.label` only, so the checklist's
  "New pipeline" lacks the "+" its empty-state twin shows. Deliberate-looking and defensible; just
  noting the divergence.
- **In the `failed` state a step loses its navigation/create action entirely** (the `InlineError`
  replaces it, `OnboardingStep.tsx:96-113`), so a user whose sources fetch is failing cannot click
  through to Sources from the checklist. The nav rail still reaches it, and D6 treats Retry as that
  step's action, so this is defensible — but it is a dead end within the surface.
- `PanelList.tsx` is now 523 lines, past `CONTRIBUTING.md`'s ~400-line guidance. `files-modified.md`
  already proposes the split as a spinoff, which is what the rule asks for.
