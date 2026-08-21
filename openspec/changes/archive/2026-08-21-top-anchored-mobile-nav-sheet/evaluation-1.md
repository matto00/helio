## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `eb3bc693` on `feature/mobile-nav-sheet-top-anchored/HEL-773`.
All gate runs and all browser measurements below are my own fresh runs, not the
executor's report (`verification-before-completion`).

### Phase 1: Spec Review — PASS

Issues: none blocking.

Verified against the ticket, `design.md` D1–D14, and `specs/mobile-dashboard-sheet/spec.md`:

- **AC1 (top anchor, every mobile page)** — measured on the running app:
  `sheetRect.top === commandBarRect.bottom` on `/`, `/sources`, `/pipelines`,
  `/registry`, `/metrics`, `/chat`, at 430/375/320px. One shared component +
  `usePickerSelection`, so no per-page divergence is possible.
- **AC2 (safe-area)** — re-ran the executor's probe: `--app-safe-top` forced on
  `document.documentElement` at 0/47/59px produces three *distinct* measured tops
  (`new Set(tops).size === 3`, so the probe cannot silently no-op) and the seam
  coincides at each. No `env(safe-area-inset-top)` anywhere in
  `MobileNavSheet.css` (D1 lock holds).
- **AC3 / AC8 / AC9** — measured per section: sources → "Add source",
  pipelines → "New pipeline", registry → "New pipeline" (empty branch only, no
  header action, D7), metrics/chat → `EmptyState` with no CTA, dashboards →
  "New dashboard" header action. Labels/glyphs come from the hooks, not local
  strings. D14 mount constraint demonstrated live: the registry empty CTA opens a
  real `dialog[open]` (`CreatePipelineModal`) and the sources CTA opens
  `AddSourceModal`.
- **AC4** — backdrop tap, Escape, trigger-toggle, and upward drag all dismiss;
  downward drag (150px) correctly does nothing; focus is trapped (Tab cycles only
  the 4 sheet controls) and restored to `.app-command-bar__mobile-title` on every
  dismissal path.
- **AC5** — computed `animation-name: none` on panel, clip wrapper and backdrop
  under emulated `prefers-reduced-motion: reduce` (genuine disable, not a
  shortened entrance).
- **AC6/AC7** — 430/375 both themes verified; lint/test clean (below).
- **D1/D3 double-anchor trap** — the panel carries no `top` of its own; the only
  two `top:` declarations in the file are the clip wrapper and the backdrop, both
  `var(--app-top-chrome-height)`, and a CSS lock asserts exactly that (`.css.test.ts`
  "every `top:` declaration … nothing else").
- **D5** — `max-height` consumes the aggregate `--bottom-nav-height`; no
  re-inlined `--bottom-nav-capsule-height`/`--bottom-nav-inset`/`env(safe-area-inset-bottom)`.
- **D6** — exactly one create affordance in every state measured (list branch:
  header 1 / empty CTA 0; empty branch: header 0 / empty CTA 1).
- **D9** — the create lifecycle is entirely consumer-side; **no hook file was
  edited** (see fences below). *But see CR1 — the consumer-side implementation
  has a defect.*
- **D10** — initial focus lands on `.mobile-nav-sheet__item--active` (or the first
  item, or the panel when empty); never the create action.
- Fences confirmed independently via `git diff --name-only main...HEAD`: none of
  `useCreateDashboardAction` / `useAddSourceAction` / `useCreatePipelineAction` /
  the fourth HEL-548 hook, `SidebarBody.tsx`, `SidebarItemList.tsx`,
  `DashboardList.tsx`, or `features/onboarding/` appear in the diff.
  `pickerEmptyState.test.tsx` imports `SidebarBody` read-only, which is fine.
- Tasks 1.1–6.8 are marked done and match what shipped. 7.1 is the deliberately
  deferred archive-step item, as its own text says — not an omission.
- No scope creep except CR2 below.

### Phase 2: Code Review — FAIL

Gates, run by me in `WORKTREE_PATH` (no `CLEAN_WORKTREE`):

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, zero warnings) |
| `npm run format:check` | PASS |
| `npm test` | PASS — 247 suites / 2666 tests |
| `npm --prefix frontend run build` | PASS |
| `npm run check:openspec` | PASS (`openspec/ is clean`) |
| `npm run check:schemas` | PASS |
| `npx playwright test e2e/hel773-…spec.ts` | 9/9 passed — the executor's 9/9 claim is independently confirmed |

Backend: no `backend/**` file changed, `sbt test` not applicable.

Positives worth recording: the CSS regression locks are genuinely load-bearing
(the "exactly one `top:` token in the file" and the "declared exactly once inside
the mobile block" ordering locks are precisely the HEL-535 defect class); the
`jest.setup.ts` `PointerEvent` polyfill is correctly scoped and justified; token
discipline is clean (no new hex/rgb, all spacing/type/radius/motion from tokens;
the `44px` literals are the DESIGN.md-sanctioned floor; `font-size: 0.9em` on the
create-action icon mirrors the shipped `.ui-empty-state__cta-icon { font-size:
0.8em }` recipe and is not a px/rem literal); the header create action matches
DESIGN.md §5's Secondary recipe exactly; `display: contents` for the `inert`
wrappers verified non-disturbing at 1440/1100/769 (logo and breadcrumb keep
identical geometry, no horizontal overflow).

Issues:

1. **CR1 — a stale `attemptFired` closes the sheet on the next open** (see Phase 3
   for the live measurement). `MobileNavSheet.tsx:162-168`'s dismissal effect is
   not gated on `open`, and `attemptFired` (set at `:138`, reset only *on open* at
   `:140-145`) survives the close. Because `App.tsx:199` passes a fresh
   `onClose={() => setIsMobileNavSheetOpen(false)}` closure on every `AppShell`
   render, the effect's dep list changes on the reopen render, so the effect
   re-runs while `attemptFired` is still `true` (the reset's `setAttemptFired(false)`
   only lands on the following render) and calls `onClose()` immediately.
2. **CR1 test gap.** Every `MobileNavSheet.test.tsx` case passes a stable
   `jest.fn()` as `onClose` (`:37`, `:93`), which is exactly what hides this — the
   dep list never changes in the tests, so the effect never re-runs. The
   "does not resurface a stale failure when the sheet is reopened" case (`:341`)
   does close+reopen but asserts only on error text, never on `onClose` being
   called a second time. This is the "green tests certify a defect as fixed"
   pattern the session brief warns about.
3. **CR2 — dead code.** `IconButton.tsx:41,73,97` adds a new public `inert`
   passthrough prop with **zero call sites** (`grep -rn "inert" frontend/src`
   finds no consumer) and no test. `files-modified.md` claims it is "used by the
   phone 'New chat' trigger while the sheet is open", but `CommandBar.tsx:191`
   wraps that `IconButton` in the `display: contents` inert group instead and does
   not pass the prop — so both the code and the handoff note are wrong.

### Phase 3: UI Review — FAIL

Environment: existing dev servers on 6205/9112 reused (both healthy). All browser
work used my **own** headless Chromium via the repo's `playwright` package — the
shared MCP session was not touched.

Objective checks that PASS (measured, not read off source):

- 44px floors, `getComputedStyle`, **scoped to `[role="dialog"]`** (the unscoped
  `.ui-empty-state__cta` trap the executor documented is real — I reproduced the
  correct scoping): at **430px** rows `44/44`, header action `44` (rect 44 too),
  drag strip `44`, empty-branch CTA `44`; at **768px** rows `44/44/44`, header
  action `44`, drag strip `44`; sources/pipelines/registry empty CTAs all `44px`.
- Command bar never dimmed or overlapped: `document.elementFromPoint()` at the
  bar's centre and at the trigger's centre resolves inside the bar/trigger at both
  the opening frame (0 ms) and settled (400 ms) — the `clip-path`-aware probe, not
  `getBoundingClientRect`.
- Bottom-nav clearance at 430px with 8 dashboards: drag-strip bottom ≤ bottom-nav
  top. At 320px: sheet top 56 = bar bottom 56, sheet bottom 352 < nav top 632.
- Inert semantics: both `.app-command-bar__inert-group` wrappers and
  `.app-command-bar__right` carry `inert` while open, and drop it when closed
  (React 19 omits `inert={false}`).
- Chevron gets `--open` while the sheet is open; `aria-expanded` tracks state.
- Accessible names on every dialog control; Enter on the trigger opens the sheet;
  Tab is trapped in a 4-element cycle including the create action.
- No console errors during any sheet flow, on any of the six sections. (Two
  `401 /api/auth/me` console entries occur on the pre-login `/login` page only —
  pre-existing, unrelated to this change; confirmed by phase-tagging the network
  log.)
- Breakpoints 1440 / 1100 / 769 / 430 / 375 / 320: no layout breakage, no
  horizontal overflow, command-bar geometry identical to before at desktop widths.

Issue:

4. **The sheet cannot be reopened on the first tap after any create action is
   fired from it.** Reproduced on both hook classes, with a `MutationObserver`
   recording dialog presence:

   - Control (open → backdrop close → reopen, no create fired): reopen works,
     transitions `[{present:true}]`.
   - Dashboards, after tapping "New dashboard": reopen #1 → transitions
     `[{present:true,t:3920},{present:false,t:3934}]`, `aria-expanded=false`,
     dialog count 0. Reopen #2 → works.
   - `/sources`, after tapping "Add source" (and dismissing the modal): reopen #1
     → `[{present:true,t:2961},{present:false,t:2975}]`, `aria-expanded=false`.
     Reopen #2 → works.

   User-visible effect: after creating anything from the sheet, the next tap on
   the command-bar title appears to do nothing (a ~14 ms flash); a second tap is
   required. This is a regression introduced by this change (the create action is
   new), and it contradicts the spec requirement "Tappable command-bar title on
   phone — the control SHALL open the top-anchored navigation sheet". Root cause
   in CR1.

### Overall: FAIL

### Change Requests

1. **`frontend/src/shared/chrome/MobileNavSheet.tsx:162-168` — stop a stale
   `attemptFired` from dismissing the next open.** The dismissal effect must not
   be able to fire for an open session in which no create was fired. Gate it on
   the sheet actually being open, e.g. change the guard at `:163` to
   `if (!open || !attemptFired || activeCreateAction === null) return;` **and**
   clear the flag on close rather than only on open — i.e. make the effect at
   `:140-145` `setAttemptFired(false)` whenever `open` changes (drop the
   `if (open)`), so the flag can never outlive its session even for one render.
   Note the dep list at `:168` includes `onClose`, which `App.tsx:199` recreates
   on every `AppShell` render — do not rely on dep-identity stability for
   correctness here. Do **not** fix this by editing `App.tsx`'s callback into a
   `useCallback`: that would leave the same latent trap for the next caller and
   is not what D9 specifies ("entirely consumer-side" means the sheet owns its own
   session flag correctly).

2. **Add a regression test that can actually fail.** In
   `MobileNavSheet.test.tsx`, add a case that fires a create action, rerenders
   with `open: false`, then rerenders with `open: true` **passing a new `onClose`
   function identity on each rerender** (mirroring `App.tsx:199`), and asserts
   `onClose` is *not* called again after the reopen. Prove it red against the
   current code before trusting it green (task 5.10's own discipline). The
   existing stable-`jest.fn()` harness at `:37`/`:93` cannot observe this.

3. **`frontend/src/shared/ui/IconButton.tsx:41,73,97` — remove the unused `inert`
   prop** (no call site, no test), or wire it to the control D2 actually needs it
   for. Either way, correct the `files-modified.md` line that claims it is "used
   by the phone 'New chat' trigger" — `CommandBar.tsx:191` uses the
   `display: contents` inert group for that control instead.

### Non-blocking Suggestions

- `MobileNavSheet.tsx` is 411 lines, past CONTRIBUTING.md's ~400-line "propose a
  split" threshold. The file is cohesive and the split isn't obviously free (the
  drag gesture, focus trap and D9 session flag all read the same local state), so
  I would not block on it — but CONTRIBUTING asks for the split to be *proposed in
  the PR description*, so please do that (or file a spinoff) rather than leaving it
  silent. `CommandBar.tsx` (287) and `usePickerSelection.ts` (255) are within the
  informational soft budget; no action needed.
- The three `design.md` "Planner Notes" spinoffs (phone rename gap; metrics/chat
  create-action gap; HEL-565's missing exit animation) still need filing.
- `pickerEmptyState.tsx` is named `.tsx` and holds JSX icons — correct as-is, but
  the `pickerEmptyState.test.tsx` docblock refers to it as `pickerEmptyState.ts`
  (and `MobileNavSheet.tsx:38` says "see `pickerEmptyState.ts`"). Trivial comment
  drift.
