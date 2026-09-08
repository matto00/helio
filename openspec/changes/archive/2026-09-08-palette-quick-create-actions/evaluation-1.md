## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `fc5ba585`, rebased onto `c317e244`.

### Gates I re-ran myself (not the executor's report)

All from `frontend/` (root `npm test` is `jest --passWithNoTests && npm --prefix frontend test`
and is not evidence in a worktree root):

- `npm run lint` — clean (`eslint src --max-warnings=0`)
- `npm run typecheck` — clean (`tsc --noEmit`)
- `npm run format:check` — clean
- `npm test` — 278 suites / 2814 tests passed (`jest --config jest.config.cjs`)
- `npx playwright test e2e/hel516-palette-quick-create.spec.ts` (DEV_PORT=5948/BACKEND_PORT=8855) —
  7/7 passed; 42/42 at `--workers=12 --repeat-each=6`

Note: an early e2e run failed 7/7 at `page.fill("#email")`. Root cause was a stale Vite HMR module
graph in the running dev server, caused by my own mutation edits (`hel510-keyboard-shortcuts.spec.ts`
failed identically at the same moment — i.e. not this branch). Restarting Vite via
`scripts/concertino/start-servers.sh` cleared it. Not a finding against this change.

### Phase 1: Spec Review — PASS

- All six planning-gate claims verified against the diff (details below).
- Tasks marked done match what shipped; no scope creep found (the two `CommandBar.tsx` edits are
  tasks 6.4a/6.4b and touch the same lines already in the diff).
- Spec deltas (`command-action-registry`, `palette-quick-create`, `workspace-create-actions`) match
  the implemented behavior. No wire/schema impact; `CommandAction` gains one optional field, which
  HEL-519/HEL-503 inherit additively.

**The six claims:**

1. **Reach — VERIFIED.** `AddSourceModal` is shell-mounted (`App.tsx:267-269`) skipped on
   `location.pathname !== "/sources"` exactly; `OutputPicker` (`App.tsx:276-287`) skipped via
   `!onDashboardView` (= `location.pathname === "/"`, `App.tsx`'s existing derivation). No
   navigate-then-act anywhere; the e2e asserts `toHaveURL(/\/pipelines$/)` after each action.
   I mutated the shell `AddSourceModal` mount away and the e2e reach test went **red**, then
   restored — so the reach proof genuinely discriminates, it does not merely pass.
2. **`currentDashboardPanels` — VERIFIED, not `[]`.** Passes `panels.items` only behind
   `currentDashboardPanelsReady`, otherwise withholds the picker and re-dispatches `fetchPanels`.
   See CR3 for the guard gap.
3. **StrictMode guard (1.3a) — VERIFIED BY MY OWN MUTATION.** The committed guard mounts without
   `React.StrictMode`, follows the 4-step sequence including step 3 (`onClose` dismissal, asserted
   via `store.getState().sources.addModalOpen === false`), and asserts DOM presence only with an
   in-file statement of what it cannot prove. I deleted the shell mount and ran
   `npx jest src/app/App.test.tsx -t "HEL-516"`: **2 failed** including the 1.3a test at
   `App.test.tsx:1217`. Restored, green again. The executor's claim holds.
4. **Task 5.3 not vacuous — VERIFIED.** The e2e section asserts only the positive direction
   (modal opens in place on `/sources/:id`) and cross-references 1.3a in-file for the negative.
   The rejected dev-server form is absent.
5. **KeyCap — VERIFIED.** `shared/ui/KeyCap` is **unmodified** (`git diff` under
   `frontend/src/shared/` is empty). Rendered inline after the title inside
   `.command-palette__item-title`, one cap per `formatCombo` token. The only CSS added is
   `margin-inline-start: var(--space-2)` on `.command-palette__item-title .ui-keycap` — spacing,
   not a restyle. Visual comparison against `help-overlay-light.png` / `palette-rest-dark.png`:
   identical atom (`Ctrl` `J`), same typography/border/radius. No escalation was owed.
6. **Seams consumed, not forked — VERIFIED.** `CreateCommandActions.tsx` calls all four HEL-548
   seams at top level (the `usePickerSelection.ts` prior-art shape) and writes no creation logic:
   each action's `run` is literally `cta.onClick`, asserted in `builtInActions.test.tsx`.
   `useAddSourceAction` was **extended in place**, not forked — but see CR2.

**The four self-reported items:**

- **`panelsMatchDashboard` extraction + empty-dashboard fallback — REAL DEFECT, CORRECT FIX,
  UNGUARDED.** The `PanelList` substitution is behavior-preserving by De Morgan
  (`!(len>0 && items[0].dashboardId===sel)` ≡ the old `len===0 || items[0].dashboardId!==sel`).
  I probed the fallback directly with a throwaway test (genuinely-empty dashboard,
  `items: []`, `status: "succeeded"`, `loadedDashboardId: "dash-1"`, driven from `/pipelines`):
  it **passes** with the fallback and **fails** with the fallback removed. So the finding was real
  and the fix works. It faithfully mirrors `PanelList`'s intent — `showPanelGridSkeleton` also
  stops gating on `status` once a fetch resolves, regardless of whether `items` came back empty —
  and is deliberately stricter (`PanelList` also un-skeletons on `idle && staleDashboardId ===
  selected`; the shell mount does not). Stricter is right here and is documented in-file.
  **But no committed test covers this branch** — see CR3.
- **`useAddSourceAction` DOM check — mechanism is a smell, and it is entirely unverified.**
  See CR2.
- **Omit vs disable for the panel action — ACCEPTABLE.** The ticket AC says "unavailable"; the
  `workspace-create-actions` scenario says every consumer "reflects the same unavailability,
  without restating the rule". `CommandAction` has no `disabled` field, so omitting is the only
  faithful reading that does not invent a second mechanism, and the rule is still read from the
  seam (`if (!panel.cta.disabled)`), never restated. Covered by two committed tests (omitted when
  disabled; present when enabled). See suggestion 1 for the UX downside.
- **Two fixture bugs — BOTH WERE GENUINELY WRONG FIXTURES, NOT TEST-MASSAGING.** Evidence:
  (a) `schemas/sources/static-column-payload.schema.json:7` — `"required": ["name", "type"]`, and
  `backend/.../DataSourceProtocol.scala:238` — `final case class StaticColumnPayload(name: String,
  \`type\`: String)`. `dataType` belongs to a *different* payload
  (`field-override-payload.schema.json`). The original fixture would have been rejected by the
  contract; correcting it makes the fixture match the shipped API, and the assertion it feeds
  (modal opens on `/sources/:id`) is unchanged and still mutation-failable.
  (b) A freshly-registered account genuinely has zero dashboards, and `useCreatePanelAction`
  genuinely reports `disabled` then — so "Add panel" is legitimately absent. Creating a dashboard
  via `POST /api/dashboards` establishes the precondition the test is *about* (reach with a
  dashboard selected); it does not weaken any assertion. Neither is a defect symptom.

### Phase 2: Code Review — FAIL

Standards read: `CONTRIBUTING.md`, `DESIGN.md`. Design tokens used correctly (`--space-2`,
existing `.eyebrow` section mechanism, no new cap styling, no hardcoded values). No inline FQNs.
No dead code, no TODO/FIXME, no new lint warnings. DRY is respected (the extraction is the
opposite of duplication).

Blocking findings: CR1, CR2, CR3, CR4 below.

### Phase 3: UI Review — FAIL

Servers healthy (dev 5948 → 200, backend 8855 → 200); `start-servers.sh` reported READY for both.
Reviewed against the running app in both themes, plus the committed evidence screenshots.

- Happy path works end-to-end from unrelated routes (7/7 e2e, plus my own live drive).
- **Focus handoff (AC + task 3.1) actually works** — I measured it live rather than trusting the
  claim: after running "Add source" from `/pipelines`,
  `{"paletteOpen":false,"focusInsideModal":true,"active":"H2.ui-modal__title"}`. Behavior correct;
  no committed guard asserts it (suggestion 2).
- Shell-mounted `AddSourceModal` opened from `/pipelines` looks like it belongs on that page
  (captured: `.concertino/runs/HEL-516/evidence/eval-addsource-on-pipelines-dark.png`).
- KeyCaps read identically in the palette and the help overlay, light and dark; hover and focus
  rows show no light-theme token collision (HEL-866 class of defect not reproduced).
- **CR1 (section-order nondeterminism) is a UI defect and is why this phase fails.**

### Overall: FAIL

### Change Requests

1. **BLOCKING — the palette's section order is nondeterministic across page loads.**
   Measured, not inferred: six identical boots of the same account on `/`, reading
   `.eyebrow` section labels in order, produced
   `["Navigation","General","Create"]` ×5 and `["Create","Navigation","General"]` ×1.
   The executor's own committed evidence shows the same split
   (`palette-rest-dark.png`: Create last; `palette-hover-light.png`: Create first).
   Root cause: none of the four HEL-548 seams memoize their return value —
   `useCreateDashboardAction.tsx:46`, `useCreatePanelAction.tsx:32`,
   `useCreatePipelineAction.tsx:24`, `useAddSourceAction.tsx:31` each build a fresh
   `CreateActionResult` object every render. `CreateCommandActions.tsx:25-34` memoizes on those
   four object identities, so the `useMemo` never hits, `useCommandActions`'s effect re-runs on
   every render, and each dispose/register cycle re-orders the Create group relative to
   `BuiltInCommandActions`'s registration. `hooks.ts`'s own docstring warns about exactly this
   ("a fresh array every render churns the registration on every render") — the memo as written
   does not satisfy it.
   Fix: make the memo depend on stable values, not object identity — either extend the seams to
   memoize their `CreateActionResult` (the "extend, don't fork" rule applies and this benefits
   every consumer), or key `CreateCommandActions`'s `useMemo` on the primitives it actually reads
   (`label`s + `panel.cta.disabled`) with `useCallback`-stable `onClick`s. Add a guard that is
   failable by mutation — e.g. a render test asserting the registry is registered once across N
   re-renders, or an e2e asserting a fixed section order across repeated boots.

2. **BLOCKING — the new DOM check in `useAddSourceAction.tsx:35-41` is completely unverified,
   on a shared seam.** `useAddSourceAction.test.tsx` is untouched by this change (`git diff
   --stat` on it is empty) and no e2e exercises the nested-modal path
   (`grep -n "nested\|CreatePipelineModal" e2e/hel516-*.spec.ts` → zero hits). Task 1.5 says
   "Verify explicitly in a real browser, not by reasoning" and is marked `[x]`; nothing in the
   commit or `files-modified.md` records that verification. This is a `verification-before-
   completion` violation on the one hunk that changes behavior for *other* consumers
   (`usePickerSelection`, both empty states).
   The mechanism is also a smell: `document.querySelector('dialog[open][aria-label="Add data
   source"]')` couples a Redux-dispatching hook to a literal string that lives in
   `AddSourceModal.tsx:368` (`ariaLabel="Add data source"`). If that label is ever reworded the
   guard silently becomes a no-op with nothing to catch it.
   Required: (a) add a guard that actually exercises both branches — a jsdom test asserting the
   early return with a matching `dialog[open]` in the document and the normal dispatch without
   one is legitimate here (DOM presence only), plus the real-browser nested case task 1.5 asked
   for; and (b) either derive the selector from a shared constant that `AddSourceModal` also
   consumes, or move the collision check out of the shared seam into the palette call site so
   the empty-state consumers are not silently altered.

3. **BLOCKING — the `currentDashboardPanelsReady` empty-dashboard fallback
   (`App.tsx:105-110`) has no committed guard.** I demonstrated it is failable by mutation
   (removing the `items.length === 0 && loadedDashboardId === selectedDashboardId && status ===
   "succeeded"` arm turns a genuinely-empty-dashboard off-route open red), so the guard is cheap
   and non-vacuous. The executor found a real defect here and then shipped the fix untested.
   Also add the parity assertion task 1.2a actually asked for: that the picker's "already on this
   board" marking off-route matches the `/` flow's post-fetch result for the same dashboard —
   the committed tests assert mounting/withholding only, never the marking.

4. **`configureStore({ ... } as never)` in `App.test.tsx:171`** — an undocumented type escape
   hatch introduced to work around the partial `preloadedState`, replacing a previously
   well-typed literal. `CONTRIBUTING.md` / CLAUDE.md forbid untyped escape hatches without clear
   justification. Type `RenderAppOptions`'s spread properly (build the object as
   `Parameters<typeof configureStore>[0]["preloadedState"]`, or assemble the full slice states
   rather than spreading conditionals) and drop the assertion. If some assertion is genuinely
   unavoidable, narrow it and document why in-file.

### Non-blocking Suggestions

- `buildCreateActions` casts each seam icon `as ReactNode` four times
  (`builtInActions.ts:88,96,104,113`). `EmptyStateCta.icon` is `IconDefinition | ReactNode`, so
  the narrowing is real, not decorative — but it is undocumented and silently wrong if a seam
  ever returns a FontAwesome `IconDefinition`. A one-line comment, or a small
  `toCommandIcon(icon)` helper that handles both, would remove the trust assumption.
- Omitting the panel action when no dashboard is selected is correct per the spec, but a user
  with no dashboard gets no signal that panel creation exists at all. Worth a follow-up ticket
  (not this change) on whether `CommandAction` should grow a disabled-with-reason presentation —
  HEL-519/HEL-503 inherit this shape.
- Task 3.1's focus behavior is correct (I measured it live) but has no committed guard; a
  Playwright assertion that `dialog.contains(document.activeElement)` after running a create
  action would cost two lines in the existing spec.
- `e2e/hel516-*.spec.ts` each carry their own `registerAndLogin` copy that returns right after
  `page.waitForURL("/")`, **without** the post-mount precondition wait HEL-1030 (`c317e244`) just
  standardized for exactly this race. I measured this specifically: 42/42 at `--workers=12
  --repeat-each=6`, because every raw `keyboard.press` here is wrapped in a bounded `expect.poll`
  that re-presses. So this is not a demonstrated new instance of the flake — but it diverges from
  the convention landed two commits ago and relies on a retry rather than a precondition. Adding
  the same `getByRole("button", { name: "Add dashboard" })` wait is two lines and makes the ninth
  copy consistent with the two that were just fixed.
- Task 5.4 asked for a capture of each shell-mounted modal opened from an unrelated route;
  `hel516-screenshots.spec.ts` captures only the palette and the help overlay. I captured the
  missing one myself (`eval-addsource-on-pipelines-dark.png`) and it is cohesive, so this is a
  documentation gap, not a defect.
