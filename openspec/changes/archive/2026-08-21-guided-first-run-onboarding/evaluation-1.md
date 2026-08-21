## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `b0c82eb6` (branch head; parent `82186dd7` = HEL-774).
Working tree carries only an unstaged `workflow-state.md` edit — no stray source changes.

Everything below marked "verified live" was measured on the running app (own headless
Chromium at `~/.cache/ms-playwright/chromium-1208`, dev `5986` / backend `8893`, `npm run dev`
StrictMode build), against **three real, freshly-registered empty accounts** reached through
`/login`, never by forcing props or preloading Redux.

### Phase 1: Spec Review — PASS

Issues: none blocking.

**Acceptance criteria, each verified live rather than read:**

| AC | Evidence |
| --- | --- |
| New user (no content) sees the checklist on first load | Fresh account → `/` renders `<section aria-label="Getting started">` with all four steps. |
| A user with existing content does not | Account with 1 dashboard + panel: checklist absent on load (`count = 0`); only the re-open affordance brings it back. |
| Steps reflect real completion | Created a source + pipeline server-side, reloaded: steps 1–2 flipped to `Complete` (check glyph, `— Complete` in the a11y text); emphasis (`aria-current="step"` + Primary recipe) moved to step 3, step 4 stayed Ghost. |
| Each CTA opens the correct flow | "New pipeline" → `Create pipeline` dialog (shell-mounted, opens from `/`); "Add panel" → `Choose panel type` dialog; "New dashboard" → dashboard created + auto-selected; "Go to Data Sources" → `/sources`, where the page's own CTA opens `Add data source` **and it stays open** (StrictMode double-invoke of the new cleanup does not close it). |
| Dismiss persists per user across reloads | `helio-onboarding-dismissed-<uuid>` flips `false → true` on dismiss; after reload the checklist does not render. |
| Getting-started affordance re-opens | `UserMenu` → "Getting started" re-renders the checklist on `/` without a reload. |
| No blocking of normal use | Not a modal; the grid/header/nav stay interactive beneath it. |
| Tests cover detection / derivation / persistence | `onboardingSlice.test.ts`, `onboardingSteps.test.ts`, `onboardingStorage.test.ts`, `useOnboardingHost.test.tsx`, `OnboardingChecklist.test.tsx`, `PanelList.onboarding.test.tsx`. |
| lint / test / format clean, zero new warnings | Re-run by me — see Phase 2. |

**Round-4 skeptic's nine execution findings — claim verified, not accepted:**

1. **Pre-hydration window — genuinely fixed, and the guard is a real one.**
   `onboardingSlice.ts:24` declares `dismissed: boolean | null`; `useOnboardingHost.ts:64`
   requires the strict `dismissed === false`, and the persist effect (`:56`) bails on `null` so
   an un-hydrated mount cannot clobber storage. **Verified live on the exact failing path**: a
   previously-dismissed user landing on `/sources` first and then navigating to `/` (client-side,
   `PanelList` mounting for the first time with `dashboards` already `succeeded` + empty) —
   a `MutationObserver` installed before app JS recorded a single main-region state
   (`checklist:false`) across the whole transition. No flash, no sticky session leak.
   The tests are the real ones the finding demanded: `PanelList.onboarding.test.tsx:127` and
   `useOnboardingHost.test.tsx:147` seed **actual `window.localStorage`** with `dashboards`
   preloaded `succeeded` + empty and leave `onboarding` at its production default
   (`dismissed: null`) — not `onboarding.dismissed = true` into the slice. Both go red under a
   naive `!dismissed` (first render activates, `active` sticks, hydration one tick later can no
   longer suppress).
2. **One `useCreateDashboardAction()` instance — confirmed.** `PanelList.tsx:47` holds the single
   instance and passes it as the `createDashboardAction` prop (`OnboardingChecklist.tsx:54`); the
   checklist calls `useCreatePipelineAction`/`useCreatePanelAction` itself (pure flag-flips,
   immune). Regression-locked by `PanelList.onboarding.test.tsx`'s "a failed dashboard create from
   the checklist's own button is reported on the checklist", which asserts the `role="alert"` is
   *inside* the checklist region.
3. **`InlineError` reused, not hand-rolled.** `OnboardingStep.tsx:94/97` renders
   `InlineError variant="banner" kind="error"` for both the failed collection and the shared
   create error — §6's "use these; do not hand-roll equivalents". Verified live: a forced
   `GET /api/data-sources` 500 renders `TriangleAlert`, sr-text `— Couldn't check`, `role="alert"`,
   the rejection's own message, and a working Retry that recovers to `Not started`. **No
   double-fire**: two clicks 30 ms apart produce exactly one `GET` (the first dispatch flips
   `sources.status` to `loading`, which swaps the failed branch out). At ≥80 ms the round trip has
   already completed and the second click is a legitimate second retry, not a duplicate.
4. **Glyphs derived, not asserted or re-picked.** `OnboardingChecklist.tsx:30-33` uses
   `sectionForPathname()` narrowed by the provided `isNavSection` guard with a documented
   `LayoutGrid` fallback — no non-null assertion. Live DOM confirms `lucide-database` /
   `lucide-workflow` / `lucide-layout-dashboard` / `lucide-layout-grid`.
9. **`clearAuth` reset present and effective.** `onboardingSlice.ts:80` resets the whole slice.
   Verified live: signed in as an empty user (checklist auto-active), signed out, signed in as a
   second user who has a dashboard — checklist count `0`. `active` does not leak.
   (Findings 5, 6, 7, 8 were preferences/renumbering; 5's honest step-1 label "Go to Data Sources"
   was adopted, 6's copy nit was not, which D8 permits.)

**Spec-level "must hold" list — all verified live:**

- Checklist appears for an empty account; never auto-activates for a user with a dashboard.
- The "No dashboards yet" hero **never paints first**: main-region paint order on a cold
  authenticated load was `bootstrap-skeleton → checklist`, with `mainHero` false throughout.
- Visibility is sticky: clicking "New dashboard" from the checklist ticked step 3 and the surface
  stayed mounted across the whole `fetchPanels` round trip (single recorded paint state).
- All-four-complete keeps the ticked chain on screen ("That's the whole chain" / "Source,
  pipeline, type, panel — every dashboard you build follows it." / four checks / `Done`) **and**
  records the dismissal (`localStorage` = `true` while the surface is still rendered), with the
  `Done` button on the Secondary recipe because it sits above a populated grid.
- Dismiss → re-open from "Getting started" **without leaving `/`** → dismiss again → reload:
  storage went `true → false → true`, and the reload did not render the checklist. The round-3
  single-owner defect is closed on the running app.
- A failed `fetchSources` renders the step failed with a working Retry, never as incomplete.
- Zero-dashboard and zero-panel empty states are suppressed **only** while the surface is visible:
  with the checklist up and a dashboard selected, "No panels yet" is absent; dismissing restores it
  along with its "Add panel" action. `PanelList.tsx`'s CTA-less "Select a dashboard" is not
  suppressed (its branch is now an independent `dashboards.length > 0` condition, logically
  identical to the old nested ternary; the shipped test at `PanelList.test.tsx:314` still passes).

**Scope fence — clean.** `git diff --name-only main...HEAD` contains no `CommandBar.tsx`, no
`MobileNavSheet.*`, no `EmptyState.*`, and none of the four HEL-548 create-action hooks.
`SourcesPage.tsx` gained exactly the sanctioned unmount cleanup. No backend/schema/dependency
changes. Tasks (63/63) match what shipped.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates re-run by me in `WORKTREE_PATH` (not taken from the executor's report):**

| Gate | Result |
| --- | --- |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm test` | 252 suites / **2706 tests** passed |
| `npm --prefix frontend run build` | built OK (only the pre-existing chunk-size advisory) |
| `npm run check:schemas` | in sync |
| `npm run check:scala-quality` | clean (128 pre-existing soft warnings, none new) |
| `npm run check:openspec` | **only** the known HEL-657 false positive: *change "guided-first-run-onboarding" is complete (63/63) but not archived*. Nothing else. The executor's `-n` bypass claim is therefore verified — `format:check` was **not** also failing. |

No backend files changed → `sbt test` not applicable.

**Canonical standards.** Read `CONTRIBUTING.md` (156 lines) and the current `DESIGN.md` (373 lines,
as HEL-774 left it) rather than recalling them. Every `§` the code and CSS comments cite resolves:
§3 control metrics at `:193-211` (incl. HEL-774's `::after` hit-expander clause), §3 motion at
`:236-246`, §5 recipes at `:264-267`, §6 shared primitives at `:320-333`, §7 at `:356-360`, §8
focus ring at `:367-369`. I found **no citation of a section, rule or exception that does not
exist** — including `OnboardingStep.tsx:34-39`'s claim that `fetchDashboards` has no
retry-from-failed path (true: `dashboardsSlice.ts:63` is `status === "idle"`) and
`onboardingSteps.ts`'s claim about `loadedDashboardId` (true: set at `fetchPanels.pending`,
untouched at `.rejected`).

**Design-standard [mechanical] rules — clean.**
- Zero hardcoded colors: every color is `--app-*`. Zero literal `font-size`/`font-weight`:
  `--text-xl/sm/xs`, `--weight-medium/semibold`. Fraunces via `--font-display` on the title only
  (§6's sanctioned "main empty-state title" moment); body copy inherits `--font-sans`.
- All margin/padding/gap use `--space-*`. The only literals are `margin-top: 2px` (§3's explicit
  "small optical tweaks ≤ 4px may be literal"), a 20px indicator box, and `border: 1px` — the same
  conventions `EmptyState.css`/`Modal.css` already use. `letter-spacing: -0.01em` and
  `line-height: 1.5/1.6` match the established pattern in eight existing stylesheets.
- Control metrics: `--control-sm` at desktop, literal `44px` min-height at ≤768 (§3's sanctioned
  mobile-only floor).
- Media queries use only the canonical 768 / 430 values (§4).
- Shared components reused rather than reinvented: `IconButton` (required `aria-label` supplied),
  `InlineError`, `Skeleton`. `StatusChip` correctly **not** used for the inline "type" glyph (§6's
  one-pill rule).
- One entrance animation, `--transition-slow`, 8px rise, `backwards`, no per-step stagger.

**44px floor — measured with `getComputedStyle` on the running app, never read off the CSS:**

| Control | 430 | 768 | 1440 |
| --- | --- | --- | --- |
| Dismiss `IconButton` | 44×44 | 44×44 | 28×28 |
| "Go to Data Sources" (Primary) | h 44 | h 44 | h 28 |
| "New pipeline" / "New dashboard" / "Add panel" (Ghost) | h 44 | h 44 | h 28 |
| `Done` (completed state) | h 44 | h 44 | h 28 |
| New `UserMenu` "Getting started" item | 44 | 44 | 31 |

`min-height: 44px` wins over `height: var(--control-sm)` in the cascade here — confirmed by the
computed `height: 44px`, not by reading source order. Both themes measured at 430 and 768.

**Other code-quality checks.** DRY: derivation lives in one shared module. Readable: no magic
values; every non-obvious decision carries a comment that I checked against source. Modular: five
small files, none over 200 lines. Type safety: no `any`, no `as any`, no `@ts-ignore`,
no `eslint-disable` anywhere in `features/onboarding/`; the discriminated-union narrowing uses the
registry's own guard. Security: no new boundary, no user-controlled markup. Error handling:
`localStorage` read *and* write both `try/catch`'d per `App.tsx`'s `helio.sidebarCollapsed` pattern;
every failed collection surfaces rather than being swallowed. Tests meaningful: the
`SourcesPage` cleanup tests include a positive sanity assertion (the preset flag really does open
the modal) before trusting the negative, and the derivation tests assert the real functions.
No dead code, no `TODO`/`FIXME`. Behavior-preserving where expected: the `PanelList` empty-state
refactor hoists the two conditions verbatim and the shipped `PanelList.test.tsx` is untouched and
still green.

**File-size budget.** `PanelList.tsx` is now 523 lines, past CONTRIBUTING's "~400 lines → propose a
split rather than adding to it". It was already ~460 before this change, and `files-modified.md`
proposes the split explicitly as a spinoff candidate — which is what the rule asks for. Not a
change request.

### Phase 3: UI Review — PASS

Issues: none blocking. (`scripts/concertino/assert-phase.sh servers … → PASS`.)

- **Happy path end-to-end** — walked all four steps on real accounts (see Phase 1 table).
- **Unhappy paths** — forced `GET /api/data-sources` → 500: the step renders failed + announced
  error + Retry, the rest of the surface stays live, no blank screen, no unhandled exception.
  Retry recovers. Panel step with no dashboard selected renders its action `disabled`, matching the
  underlying create action.
- **Loading / empty / error ladder** — an unresolved collection renders a `Skeleton` indicator (not
  an empty box) with its action still enabled; verified live during a deliberately slowed retry
  (sr-text `— Checking…`, `.ui-skeleton` present).
- **No console errors during any tested flow** — every authenticated flow (first load, dismiss,
  re-open, walkthrough, completion, retry, user switch, all four breakpoints, both themes) produced
  an empty console. The only messages seen anywhere were two/four `401`s on the **unauthenticated**
  `/login` route from the app's own `GET /api/auth/me` bootstrap — pre-existing, unrelated to this
  diff.
- **Entry points** — auto path (`/` for an empty account) and the `UserMenu` re-open path, from `/`
  and from another route, both reach the surface. It correctly does not render on non-`/` routes.
- **Accessible names + keyboard** — the surface is a `<section aria-label="Getting started">`
  containing a `<ul>`/`<li>` list; the emphasised step carries `aria-current="step"`; each step
  exposes its state to AT via a real `.sr-only` span (measured 1×1 px, so genuinely visually
  hidden) reading `— Complete` / `— Not started` / `— Checking…` / `— Couldn't check`. Every
  control is a real `<button>` with `tabIndex 0`; tabbing from the document top lands on the
  dismiss control with the §8 ring computed as `2px solid rgb(249, 115, 22)` at
  `outline-offset: 2px`; `Enter` on the step-1 action navigated to `/sources`.
- **`prefers-reduced-motion`** — measured on the running app, not assumed: with
  `reducedMotion: "reduce"` the checklist's computed `animation-duration` is `1e-05s` (vs `0.28s`
  without). The global rule genuinely covers this one-shot entrance, and no §3 violation is
  recorded (§3's "the global rule alone does not fully disable" caveat is about *looping*
  animations).
- **Breakpoints 1440 / 1100 / 768 / 430** — no overflow at any width
  (`scrollWidth === clientWidth` at all four); at 430 the card is 390×597 and clears HEL-774's
  floating bottom-nav capsule. Light and dark both rendered correctly at 430 and 768.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

1. **Flagged for the skeptic (visual [judgment], not a mechanical violation): the step action
   buttons stretch to their step's content width.** `.onboarding-checklist__step-body` is a column
   flex container, so each action gets `align-self: stretch` and inherits the width of that step's
   longest text line. Measured at 1440: "Go to Data Sources" 172px, **"New pipeline" 580px**,
   "New dashboard" 154px, "Add panel" 231px. At rest the Ghost variants are transparent so this is
   invisible, but on hover `--app-surface-raised` paints a band as wide as the button —
   a ~580px hover target for a 12-character label. `align-self: flex-start` on
   `.onboarding-checklist__action` / `__done` would make all four size to their own content.
2. **Also for the skeptic: at 430 the header stacks** (`flex-direction: column`,
   `OnboardingChecklist.css:227-230`), which moves the dismiss `X` out of the top-right corner to a
   left-aligned position *below* the lede. It is still 44×44 and reachable; it just no longer reads
   as a close affordance in the conventional position.
3. **The `retrying` local state is unobservable in practice.** `OnboardingChecklist.tsx:83-101`
   maintains a per-collection in-flight flag and passes it to `InlineError`, but the failed branch
   unmounts on the very first dispatch (`status` → `loading` → the step renders indeterminate), so
   `InlineError`'s "Retrying…"/disabled treatment can never be seen — confirmed live by sampling
   the DOM at 100/400/900 ms into a deliberately slowed retry. This exactly mirrors the pre-existing
   HEL-539 `isRetryingPanels` pattern in `PanelList.tsx`, so it is consistent rather than wrong;
   worth a one-line comment saying so, or dropping the state.
4. **The `Shapes` glyph is the one icon not derived from the registry.**
   `OnboardingChecklist.tsx:1` imports it straight from `lucide-react`, while the other four go
   through `navGlyph()`/`sectionForPathname()`. It currently matches `/registry`'s entry, but
   HEL-774 already re-picked that icon once (`BookOpen → Shapes`), so `navGlyph("/registry")` would
   give the type marker the same single-source-of-truth guarantee the steps have.
5. **Minor DRY**: the four-step status object is assembled in two places —
   `useOnboardingHost.ts:103-111` and `OnboardingChecklist.tsx:89-94`. A shared
   `useOnboardingStepStatuses()` (or a selector) would keep them from drifting.
6. **Two "red-before-green" tests assert against locally constructed values only** —
   `useOnboardingHost.test.tsx:173-189`'s naive-expression probe and `:326-343`'s
   stale-closure simulation. The latter has no assertion against production code at all, so it can
   never fail; it is documentation rather than a guard. The genuine guards for both defects exist
   separately (`:147`, `:304`) and are real, so this costs nothing but noise.
7. **Two test names overclaim slightly**: `PanelList.onboarding.test.tsx`'s "uses Secondary once the
   checklist sits above a populated grid" never asserts the Secondary class (it could —
   `.onboarding-checklist__done--secondary` is present in that state, as I confirmed live), and
   `UserMenu.test.tsx`'s "…navigates to '/'…" asserts the dispatch and the close but not the route.
8. **Task 6.10's bookkeeping**: no `PanelList.test.tsx` fixture actually needed a preloaded
   dismissal, because those fixtures leave `auth.currentUser` null so hydration never runs and
   `dismissed` stays `null`. The outcome is right (the file is untouched, assertions intact), but
   `files-modified.md` would be more accurate saying the fixtures needed no change and why, rather
   than leaving 6.10 ticked with no corresponding edit.
9. **Dev-DB side effect**: this evaluation registered three throwaway accounts
   (`eval554-*@helio.dev`, `eval554b-*`, `eval554c-*`) with a handful of sources/pipelines/panels in
   the shared dev database. Harmless and user-scoped, but noted so they are not mistaken for real
   fixtures.
