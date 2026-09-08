## 1. Shell-mount the two unreachable creation surfaces (the actual deliverable)

- [x] 1.1 Mount `AddSourceModal` at the app shell in `frontend/src/app/App.tsx`, gated on
      `sources.addModalOpen` AND skipped on the EXACT route `/sources` only — `/sources/:id` is a sibling
      route (`AppRoutes.tsx:101-102`, `SourceDetailPage`), NOT a child, so it DOES get the shell mount and
      is the natural reach-test route (design.md D3, CR4). Follow the F-045 `CreatePipelineModal` precedent
      at `App.tsx:200-209` verbatim, including a comment recording WHY the route-skip exists. Verify:
      exactly one modal from a non-`/sources` route, and exactly one on `/sources`.
- [x] 1.2 Mount `OutputPicker` at the app shell, gated on `panels.panelCreationModalOpen` AND
      `selectedDashboardId !== null` (its `dashboardId` prop is required — mirror `RefinementChatDrawer`'s
      gate at `App.tsx:213`) AND skipped on the exact route `/`. Verify: exactly one instance in both cases.
- [x] 1.2a Supply `OutputPicker`'s SECOND required prop `currentDashboardPanels: Panel[]`
      (`OutputPicker.tsx:38`) correctly off-route — design.md Decision 3b. Off `/`, `state.panels.items` is
      `PanelList`-owned and may be empty or hold ANOTHER dashboard's panels. REUSE `PanelList`'s own
      staleness CONDITION — note it is NOT a reusable predicate but an inline clause of the compound
      `showPanelGridSkeleton` expression (`PanelList.tsx:105-108`), so either EXTRACT it to a shared
      selector/helper or mirror the same condition (round-2 CR3). Pass the store's panels only when they
      belong to `selectedDashboardId`, and otherwise dispatch the SAME fetch thunk before rendering. Do NOT
      pass `[]` and do NOT cite `PanelDetailModal.tsx:119` as precedent (swap-mode, different semantics).
      NOTE the shell mount will be STRICTER than `/`, not a mirror of it: `PanelList.tsx:314-320` passes
      `items` RAW, gated only on `panelCreationModalOpen && selectedDashboardId` — there is no existing
      loading path to mirror.
      Verify: open the picker from a non-`/` route with a DIFFERENT dashboard's panels in the store, and
      assert the "already on this board" marking matches the `/` flow's POST-FETCH RESULT for the same
      dashboard — parity with the result, not with `/`'s implementation, and not absence of a crash.
- [x] 1.3 Confirm BOTH unmount cleanups still behave with a shell instance present — `PanelList`'s
      (HEL-548 D5a, resets `panelCreationModalOpen`) AND `SourcesPage`'s (`SourcesPage.tsx:60-64`, HEL-554
      D4, resets `addModalOpen`; missed by the round-1 design, CR2). Verify with explicit tests for EACH:
      open the modal on its owning route, navigate away, and assert the shell instance does NOT inherit an
      open modal. Include browser Back, which D5a's own comment calls out as hitting the same path.
- [x] 1.3a Close the StrictMode/production-only defect and GUARD it — design.md Decision 3a. Shell-mounting
      `AddSourceModal` IS the fix (the flag finally has a reader on every route).
      **The guard mechanism is now SPECIFIED, not left to choice** (round-2 CR1: the earlier "red-first OR
      production build" offered two options and NEITHER is achievable — `frontend/vite.config.ts:59-66` has
      `server.proxy` but NO `preview` block, so `vite preview` cannot reach `/api` and login is impossible,
      and `playwright.config.ts` pins `baseURL` to `DEV_PORT`; while red-first in dev is impossible BY
      CONSTRUCTION, since StrictMode clearing the flag IS the finding).
      **Use a render-level guard that mounts the app tree WITHOUT `React.StrictMode`** (precedent:
      `renderWithStore.tsx:255` uses `MemoryRouter` with no StrictMode; `App.test.tsx:34`;
      `SourcesPage.test.tsx:20-28` has the `showModal` stub you will need). **Sequence, in this order — the
      dismissal step is REQUIRED and its omission makes the guard red POST-fix** (round-3 CR1): (1) set
      `addModalOpen` from a `/sources/:id` render; (2) assert the modal opens IN PLACE there — that is the
      fix working; (3) DISMISS it via its `onClose`, which is the real production path that clears the flag
      (nothing on `/sources/:id` clears it otherwise — there is no `setAddSourceModalOpen` writer in
      `SourceDetailPage.tsx`); (4) navigate to `/sources` — via a re-render at a new `initialPath`, the simplest mechanism with the cited
      infra — and assert NO dialog is present. Without step 3
      the flag is still `true`, `SourcesPage.tsx:154` renders the modal correctly, and the assertion fails
      even with the fix applied — so the guard would be testing the wrong thing. This asserts DOM
      PRESENCE ONLY — not focus, visibility, or computed style — so jsdom is legitimate here and evidence
      rule 3 is not engaged; say exactly that in-file. It IS failable by mutation: **delete the shell mount
      and it must go red — verify that by actually running the mutation, do not assert it.**
      State in-file what this guard proves (production behavior absent StrictMode) and what it cannot
      (nothing about focus or appearance).
- [x] 1.3b Document the same defect in `files-modified.md` for the PR body and the Linear comment, with the
      full mechanism: `SidebarBody.tsx:87` sets `addModalOpen` from `/sources/:id` with nothing mounted to
      read it; `main.tsx:58`'s StrictMode clears it at mount in dev; a production build has no StrictMode and
      the modal opens unbidden; and `SourcesPage.tsx:56-58` justifies its own safety with a premise
      `SidebarBody.tsx:87` falsifies. It must not close silently.
- [x] 1.4 Confirm no THIRD mount of `CreatePipelineModal` is introduced; it is already shell-mounted.
- [x] 1.5 Handle the NESTED-modal doubling path — design.md Decision 7 (CR6). `CreatePipelineModal.tsx:226`
      and `AddRootModal.tsx:124` render nested `AddSourceModal`s from LOCAL state, independent of
      `addModalOpen`; since `CreatePipelineModal` is shell-mounted on every non-`/pipelines` route, a user
      can have the nested modal open and run the palette's "Add source", yielding two. The route-skip does
      not catch this. Verify explicitly in a real browser, not by reasoning.

## 2. Create actions, consuming the HEL-548 seams

- [x] 2.1 Build the Create actions in a component that calls the seams at its top level. **Prefer the
      existing prior art over inventing a pattern**: `shared/chrome/usePickerSelection.ts:3-9,41-46` already
      calls these seams unconditionally at top level (its docstring cites Rules of Hooks) and imports
      `CreateActionResult` from `useCreateDashboardAction` — follow that shape and reuse where the palette's
      needs overlap. Calls all four seams
      (`useCreateDashboardAction`, `useAddSourceAction`, `useCreatePipelineAction`, `useCreatePanelAction`)
      and registers them via the existing `useCommandActions` path — mirroring `BuiltInCommandActions.tsx`.
      Seams are HOOKS and cannot be called inside `run()` (design.md Decision 4). Write NO creation logic.
      Verify: a test asserts running each action dispatches/flips exactly what the seam does, with no
      second creation path introduced.
- [x] 2.2 Group all four under a "Create" section using the existing `section` string mechanism
      (`builtInActions.ts:9-10` uses `"Navigation"`/`"General"`), so the palette's existing `.eyebrow`
      grouping renders it. Do NOT add a new grouping mechanism.
- [x] 2.3 Take the panel action's availability from the seam's own `disabled` (it already reports
      `selectedDashboardId === null`). Do NOT restate that rule in the palette — a second source of truth is
      exactly what the `workspace-create-actions` delta forbids. Verify: with no dashboard selected the
      action is unavailable and running it creates nothing.
- [x] 2.4 Use the seams' own `label`/`icon` (lucide `Plus`) rather than re-typing them. Note "New dashboard"
      creates an untitled dashboard immediately (design.md Decision 2) — the title must not imply a naming
      prompt that is not offered.

## 3. Palette handoff

- [x] 3.1 Running any create action closes the palette and moves focus into the opened surface (DESIGN.md
      §8). Verify in a REAL BROWSER — jsdom cannot establish focus (HEL-1005).

## 4. KeyCap in the palette (owner ruling, folded in from HEL-510)

- [x] 4.1 Add ONE optional shortcut-combo field to `CommandAction` (`model/types.ts`), typed as the
      `ShortcutCombo` already exported by `shared/chrome/shortcuts.ts`. Verify: `tsc --noEmit` clean and
      existing actions without it still compile.
- [x] 4.2 Render it in `CommandPalette.tsx` via `formatCombo` + the existing `shared/ui/KeyCap` — the SAME
      pipeline the help overlay uses. **Placement: INLINE AFTER THE TITLE, not right-aligned** (owner
      ruling, design.md Decision 5): the palette has no right-hand column and exactly one action carries a
      cap, so right-alignment would strand it in dead space and cut a gutter into a flush-left list. Same
      atom, different coordinate. Do NOT build a second cap component and do NOT re-declare cap styling —
      the HEL-680 hand-copied-recipe failure mode. **If `KeyCap` needs restyling to sit well inline, STOP
      and escalate**; a second cap style is the outcome this ticket exists to prevent. Verify: a render test
      asserts an action with a combo shows caps and one without shows none.
- [x] 4.3 For an action whose shortcut IS a declared global binding (the assistant's Cmd/Ctrl+J is the live
      case), read the combo from the shortcut declaration BY ID rather than re-typing a literal, so the
      displayed cap cannot drift from the binding that fires. Verify with **LITERAL expected tokens**
      (`["Ctrl","J"]` / `["⌘","J"]`) — NOT
      `expect(caps).toEqual(formatCombo(shortcuts.find(...).combo))`, which derives both sides from one
      source and therefore cannot fail (CR8). Editing the declaration must turn this red. Label what it
      proves per task 6.2.
- [x] 4.4 An action with no combo must render with no reserved empty space that would misalign it. Verify in
      a real browser, not jsdom.

## 5. Real-browser evidence (the central hazard — reach cannot be proven any other way)

- [x] 5.1 Extend/add a COMMITTED Playwright spec (`e2e/hel516-*.spec.ts`; follow
      `e2e/hel510-keyboard-shortcuts.spec.ts` and `e2e/hel1003-actions-menu-keyboard-reach.spec.ts`) proving
      EACH create action works **from a route where its host is NOT mounted**: source from a non-`/sources`
      route, panel from a non-`/` route, dashboard and pipeline from anywhere. **A test driven from the
      owning route proves NOTHING about reach and does not satisfy the AC.** Verify: paste `npm run e2e`
      output plus `npm run check:e2e-types`.
- [x] 5.2 Prove the "never twice" case in the real browser: run each action ON its owning route and assert
      exactly one instance of the surface exists in the DOM.
- [x] 5.3 Prove "never silently defers" — **but NOT in the dev-server form, which is vacuous** (round-2
      CR2). Running the source action from an unrelated route, navigating to `/sources`, and asserting no
      unrequested modal appears is GREEN TODAY, BEFORE ANY FIX, because `main.tsx:58`'s StrictMode fires
      `SourcesPage`'s cleanup at mount and clears the flag — remove the shell mount and it still passes, so
      it is structurally incapable of failing. **Task 1.3a owns the non-vacuous version of this assertion**
      (render-level, no StrictMode, mutation-verified). In THIS task assert only the POSITIVE reach
      direction, which IS failable in dev: the modal opens IN PLACE on `/sources/:id`. Cross-reference 1.3a
      in-file so section 5 cannot be read alone and reproduce the vacuous guard.
- [x] 5.4 VISUAL COHESION (owner-mandated, first-class; a token check does NOT substitute). Screenshot the
      palette with the Create section and the new KeyCaps, in BOTH light and dark, at rest AND with a row
      hovered AND focused (HEL-866: modal-hosted hover token collisions bite in light theme). Compare
      against the existing palette rows and the help overlay's caps — the caps must read identically in both
      surfaces. Also capture each shell-mounted modal opened from an unrelated route, to confirm it looks
      like it belongs on that page. **Screenshots go to `.concertino/runs/HEL-516/evidence/` — never
      `openspec/**`, never `git add -f`.** If cohesion needs an adjacent surface changed, STOP and escalate
      with screenshots; do not widen the diff or ship the incohesive version.

## 6. Gates and handoff

- [x] 6.1 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` **from `frontend/`** —
      root `npm test` is `jest --passWithNoTests && npm --prefix frontend test`, which in a worktree root
      turns silence into a pass. State which command you ran and what it scanned.
- [x] 6.2 For EACH new guard, state in-file what it actually proves AND what it cannot. A guard must be
      failable by mutation and labelled as such; if a check structurally cannot fail, say so and do not add
      it (HEL-510's best call was exactly this refusal).
- [x] 6.3 Run `openspec validate palette-quick-create-actions --type change` to exit zero.
- [x] 6.4 Re-check `origin/main` hasn't moved; if it has, rebase and RE-RUN the 5.4 visual comparison —
      stale screenshots do not establish cohesion against a moved baseline.
- [x] 6.4b Fix the STALE SHORTCUT STRING at `frontend/src/app/CommandBar.tsx:280`: it renders
      `title="Assistant (Ctrl/Cmd+K)"` but the quick-launcher binding is `{key:"j", mod:true}`
      (`shortcuts.ts:45-49`) — a live, user-visible, WRONG shortcut string, and exactly the drift
      design.md Decision 5 exists to prevent. This change already edits lines 283-290 of that same file, so
      fixing it here is in scope rather than a deferral (round-2 CR5). Derive the string from the shortcut
      declaration BY ID rather than re-typing a literal, consistent with task 4.3. Verify: the rendered
      title changes if the declaration changes. NOTE the derived title becomes PLATFORM-SPECIFIC via
      `formatCombo` (`shortcuts.ts:130-136`) rather than today's both-platforms `"Ctrl/Cmd"` string — that is
      the intended consequence of deriving from the declaration, not a regression; say so in-file.
- [x] 6.4a Correct `frontend/src/app/CommandBar.tsx:285-289`'s now-false comment (it claims `PanelCreationModal` is mounted
      by `PanelList` alone, which task 1.2 falsifies). **KEEP the `onDashboardView` route gate** — owner
      ruling, design.md Decision 6: the palette is global by definition, the kebab contextual by position;
      aligning them would erase a correct distinction. Comment fix only.
- [x] 6.5 Write `files-modified.md` (declare every path in FULL, bullet-prefixed — an abbreviated path fails
      the squash guard) and COMMIT. Staging without committing is an incomplete handoff.
