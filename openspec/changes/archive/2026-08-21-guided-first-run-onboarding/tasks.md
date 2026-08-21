## 1. Frontend — onboarding state and derivation

- [x] 1.1 Create `frontend/src/features/onboarding/` (`state/`, `ui/`, `hooks/`) following the other features' layout
- [x] 1.2 Add `onboardingSlice` holding BOTH `active` and `dismissed` — `dismissed` must have a single owner (D7); register the slice in `store.ts` AND `frontend/src/test/renderWithStore.tsx:159-171`, whose reducer map is maintained separately and which every touched test routes through
- [x] 1.3 `active` is set by auto-activation or explicit re-open and cleared ONLY by explicit dismiss; creating a resource must never clear it, and neither must reaching all-four-complete (D2)
- [x] 1.4 Persistence: key `helio-onboarding-dismissed-<userId>`, hydrated once per user id by the host hook into the slice, and written by exactly ONE effect watching the slice value — never written from a second component (D7)
- [x] 1.5 Wrap every `localStorage` read AND write in try/catch, per `App.tsx:39-45`/`:67-73` — NOT per `ThemeProvider`, whose writes are unguarded (D7)
- [x] 1.6 Add the host hook, called UNCONDITIONALLY from `PanelList` (always mounted on `/`) and never from the checklist component, which does not exist in the state the trigger detects (D3)
- [x] 1.7 `autoActivate = dashboards.status === "succeeded" && dashboards.items.length === 0 && !dismissed` — gated on dashboards ONLY; do not add a sources condition, which would paint the empty state for a round trip first (D3)
- [x] 1.8 `visible = active || autoActivate`, derived so the checklist renders on the SAME frame the superseded empty state would otherwise have appeared on; an effect then sets `active`, so visibility survives `autoActivate` going false when the user creates a dashboard (D2)
- [x] 1.9 The host hook dispatches `fetchSources()` and `fetchPipelines()` whenever `visible`, each guarded on its own `status === "idle"` (the `SourcesPage.tsx:29-37` pattern) so the re-open path fetches and nothing is fetched twice (D3)
- [x] 1.10 Step derivation returns `complete | incomplete | indeterminate | failed`: `indeterminate` for `"idle"`/`"loading"`, `failed` for `"failed"` — a failed collection must NEVER fall through to `incomplete` (D10)
- [x] 1.11 Never read `panels.status === "idle"` as a signal — it is re-entrant post-delete; step 4 reads `panels.items` for the selected dashboard only (HEL-548 `staleDashboardId`)
- [x] 1.12 When all four steps read complete, persist `dismissed` so it does not auto-activate next load, but leave `active` set so the completion is seen and the re-open affordance is never inert (D2)

## 2. Frontend — the onboarding surface

- [x] 2.1 Build the checklist component plus its own CSS file, rendering the four steps: data source, pipeline, dashboard, panel
- [x] 2.2 Write the copy per design D8 verbatim, including the completed-state copy; the pipeline step MUST state a type is a pipeline's output and is never created directly; no generic encouragement anywhere
- [x] 2.3 Step 4 copy reads "Bind a panel to that type to see your data." (not "to see it", ambiguous); do not "fix" the lede's four steps into five — the type is deliberately not a step because it has no create path (D8)
- [x] 2.4 When all four steps are complete, keep the same ticked chain on screen with the title "That's the whole chain", the lede "Source, pipeline, type, panel — every dashboard you build follows it." and a Done button that dismisses (D8) — do NOT build a separate completion screen
- [x] 2.5 Each step's glyph is imported from `shared/chrome/sections.ts` (`Database`, `Workflow`, `LayoutDashboard`), never re-picked; step 4 reuses `LayoutGrid` as panels have no nav section (D8)
- [x] 2.6 Step 2 renders `Shapes` (the `/registry` glyph) INLINE beside the word "Type" in its sentence — not as a pill or chip, which would collide with §6's "StatusChip is the one pill recipe" (D8)
- [x] 2.7 A `failed` step renders an inline error affordance with a Retry that re-dispatches that collection's fetch, per §7 "never swallow a failed fetch" and the HEL-539 ladder; it must not read as unchecked (D10)
- [x] 2.8 Title uses `--font-display` (Fraunces), sanctioned by `DESIGN.md:224-225`; body copy stays `--font-sans`
- [x] 2.9 Zero hardcoded colour/spacing/type — every value from `--app-*` / `--space-*` / `--text-*` / `--weight-*` (§3)
- [x] 2.10 Exactly one entrance animation on the surface (fade + 4–10px rise, `--transition-slow`) — no per-step stagger (§3); respect `prefers-reduced-motion`
- [x] 2.11 Every incomplete, indeterminate or failed step carries an action; the EMPHASISED one is the first step that is not `complete`, keeping emphasis on step 1 while sources resolves (D6)
- [x] 2.12 The emphasised action uses Primary in the superseding placement and Secondary above the grid; other steps' actions use Ghost; a completed step renders a check and no button. No code comment may claim §5 "one primary per view/section" compliance here — `.panel-list__add` (`PanelList.css:48-62`) is already a persistent Primary (D6)
- [x] 2.13 Derive the Primary-vs-Secondary switch from the SAME value task 4.2 computes for suppression, with a one-line comment, so the varying recipe does not read as drift
- [x] 2.14 An indeterminate step renders its status indicator as a `Skeleton`, never as an empty unchecked box, and keeps its action available (D10, §7)
- [x] 2.15 Each step exposes an accessible name and completion state to assistive tech; the list is keyboard operable with a §8 focus ring (`outline: 2px solid var(--app-accent)`, offset `2px`) unless it clips; the dismiss control uses `IconButton` with a required `aria-label` (§5), never hand-rolled
- [x] 2.16 Render `useCreateDashboardAction().error` with the same announced error treatment the empty state uses
- [x] 2.17 Interactive controls carry a 44px min tap target at the 430/768 breakpoints (§3 control metrics)

## 3. Frontend — step actions via the HEL-548 seam

- [x] 3.1 Consume the four hooks; do NOT modify any of them or `EmptyState` — HEL-773 consumes them concurrently
- [x] 3.2 Pipeline step calls its hook directly (shell-mounted modal); dashboard step likewise (thunk, no modal); panel step likewise — its modal is mounted by `PanelList`, the host surface — honouring the hook's existing `disabled` when no dashboard is selected
- [x] 3.3 Data-source step NAVIGATES to `/sources` and sets no flag; `SourcesPage`'s own empty-state CTA opens the modal. Do NOT dispatch `setAddSourceModalOpen` from the checklist in any form (D4)
- [x] 3.4 Add the missing unmount cleanup for `addSourceModalOpen` to `SourcesPage.tsx`, mirroring `PanelList.tsx:193-197` — required by the shipped `workspace-create-actions` spec, and safe only because 3.4 leaves the flag `false` at mount (D4)
- [x] 3.5 Verify under StrictMode on the running dev server that arriving at `/sources` from step 1 and clicking the page's CTA opens the modal and it STAYS open — `main.tsx:57` double-invokes the new cleanup at mount
- [x] 3.6 Verify the unmount path: open the modal on `/sources`, navigate away with it open, return, confirm it does NOT re-open; prove this guard red against the pre-cleanup build first. Do NOT write a probe for "interrupted navigation" — no route blocker exists, so it can never go red

## 4. Frontend — host surface and re-open affordance

- [x] 4.1 Render the surface at the top of `PanelList`'s content area OUTSIDE line 400's `!(showPanelGridSkeleton || showBootstrapSkeleton)` block, so it does not blink out during the `fetchPanels` round trip after step 3 auto-selects the new dashboard (D1)
- [x] 4.2 Suppress the zero-dashboard and zero-panel `EmptyState`s off the SAME `visible` value the surface renders on; do NOT suppress `PanelList.tsx:437-441`'s CTA-less "Select a dashboard", which is not a first-run state (D5)
- [x] 4.3 Do not widen `PanelList`'s skeleton gates or alter `showBootstrapSkeleton` / `showPanelGridSkeleton` (HEL-528 task 2.4b, HEL-548 D11)
- [x] 4.4 Add a "Getting started" item to `UserMenu.tsx` reusing `.user-menu__item` (already carries the 44px floor at ≤768, `UserMenu.css:138-140`) that DISPATCHES to clear `dismissed` and set `active`, then navigates to `/` — it must NEVER write `localStorage` itself (D7)
- [x] 4.5 Wire it with `useAppDispatch` + `useNavigate` inside `UserMenu` — do NOT add a prop, which would require editing `CommandBar.tsx`, whose line 160 is HEL-773's sheet-opening control (D9)
- [x] 4.6 Move `UserMenu.test.tsx` to `renderWithStore`, which already supplies Router and store (D9)
- [x] 4.7 Do not touch `MobileNavSheet.tsx` / `MobileNavSheet.css` or the control that opens the sheet — owned by HEL-773; escalate if the work appears to need them

## 5. Verification on the running app

- [x] 5.1 Reach the state through the real path — an actually-empty account — not by forcing props; confirm the checklist appears
- [x] 5.2 Confirm the "No dashboards yet" hero never paints first (the checklist is what appears when the dashboard fetch resolves, no intermediate frame), and that a user with a dashboard is not auto-activated
- [x] 5.3 Walk all four steps end to end; confirm each checks off from real state, the surface stays visible across the step-3→4 transition, and each action opens the real flow
- [x] 5.4 Confirm the completed state renders in place with every step ticked, and that re-opening as a user with all four resources shows the same ticked chain rather than nothing
- [x] 5.5 Dismiss, re-open from "Getting started" WITHOUT leaving `/`, dismiss again, reload — confirm the dismissal persisted (the single-owner defect this guards)
- [x] 5.6 Force `fetchSources` to fail and confirm step 1 shows an error with a working Retry, and never reads as unchecked
- [x] 5.7 Measure every interactive control with `getComputedStyle` at 430 and 768 for the ≥44px floor, including the new `UserMenu` item — never read it off the CSS (regressed six times here)
- [x] 5.8 Confirm the surface fits and scrolls cleanly at 430px above HEL-774's floating bottom-nav capsule, in both light and dark themes
- [x] 5.9 Confirm `prefers-reduced-motion` actually disables the entrance on the running app (§3 warns the global rule alone is not sufficient)

## 6. Tests

- [x] 6.1 Auto-activation: `idle`/`loading` dashboards do not activate; `succeeded` + empty does; an existing dashboard or a stored dismissal suppresses it; a user with sources but no dashboards IS activated (D3)
- [x] 6.2 Stickiness: with the checklist visible, adding a source or creating a dashboard leaves it visible — the round-1 defect
- [x] 6.3 No-flash: on the frame the dashboard fetch resolves empty, the checklist renders and the superseded empty state does not — assert both in one render
- [x] 6.4 Re-open path fetches: from a state with dashboards present and sources/pipelines `idle`, re-opening dispatches both fetches and both steps leave `indeterminate`; an already-loaded collection is not fetched twice
- [x] 6.5 Dismiss → re-open via the affordance → dismiss again → the stored dismissal is present (the round-3 single-owner defect); prove it red against a `useState`-owned variant first
- [x] 6.6 A `failed` collection renders the step as failed with a retry, never as incomplete; retry re-dispatches
- [x] 6.7 All-four-complete keeps the surface on screen with every step ticked AND writes the dismissal
- [x] 6.8 Step derivation: each step checks off from its slice, an unresolved slice renders indeterminate with its action still available; dismissal round-trips per user id, a second user id is unaffected, and a throwing `localStorage` still renders
- [x] 6.9 Supersede: with the surface visible neither zero-content empty state renders, including the post-delete state; with it not visible they render unchanged
- [x] 6.10 Fix existing `PanelList.test.tsx` fixtures by preloading a stored dismissal — NEVER by flipping their assertions to the checklist, which would silently delete shipped `frontend-panel-empty-state` guarantees
- [x] 6.11 Prove each new guard goes red against a deliberately broken variant before trusting it green — a test that cannot fail is worse than no test
- [x] 6.12 `npm run lint`, `npm test`, `npm run format:check` clean with zero new warnings
