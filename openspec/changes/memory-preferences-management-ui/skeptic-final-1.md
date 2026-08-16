## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not trusting evaluation-1.md's narrative):
read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec files, both
`skeptic-design-*.md` reports, and `evaluation-1.md`; read `git diff main...HEAD --stat`
(32 files, 2792 insertions) and every changed frontend source file in full
(`PreferencesEditor.tsx`, `AgentMemoryList.tsx`, `SettingsPage.tsx`, `settingsSlice.ts`,
`settingsService.ts`, `types/preferences.ts`, `UserMenu.tsx`, `App.tsx` diff,
`AgentPreferencesProtocol.scala`).

**Gates re-run fresh, not trusted from the evaluator's report:**
- `npm run lint` → clean, zero warnings (fresh run).
- `npm run format:check` → "All matched files use Prettier code style!" (fresh run).
- `npx jest --testPathPatterns=settings` → 5 suites / 49 tests, all pass (fresh run).
- `npx jest` (full suite) → 174 suites / 1741 tests, all pass (fresh run) — matches the
  evaluator's claimed count, independently reproduced.
- `grep -rn "\bany\b" frontend/src/features/settings/` (excluding tests) → zero actual
  `any` type usage, only prose occurrences of the word — AC5 confirmed.

**The round-1/round-2 design-gate correctness gap — verified live, and pushed further
than the evaluator's own live test:**
- Started servers via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers`
  (both `READY`/`PASS`, main-checkout copies invoked against this worktree per the
  orchestrator's note about the worktree's stale `scripts/concertino/`).
- `PUT /api/preferences` directly (via authenticated browser fetch) with
  `namingConventions: {titleCase: true, count: 7, dashboardPrefix: "ws-", nested: {a: 1},
  arr: [1,2,3]}` and `defaultPanelStyle` carrying an unexposed `legacyKey: "keep-me"` plus
  `extras: {favoriteChart: "bar"}` — a broader probe than the evaluator's (which only
  covered bool/number/string; I added a **nested object** and an **array**, both legal
  per `schemas/agent-preferences.schema.json`'s unconstrained `namingConventions` type).
  Reloaded `/settings`: only `dashboardPrefix` (the string-valued key) rendered as an
  editable row; `titleCase`/`count`/`nested`/`arr` never rendered as rows, matching
  design.md Decision 2.
  Clicked "Save preferences" with **no edits** to naming conventions: `GET
  /api/preferences` confirmed `titleCase`, `count`, `nested`, and `arr` all persisted
  **unchanged as real JSON types** (bool/number/object/array — not coerced to strings,
  not dropped), `defaultPanelStyle.legacyKey` preserved verbatim, `extras.favoriteChart`
  preserved verbatim. Then edited `dashboardPrefix` → `"ws2-"` and saved again: the real
  edit persisted while every non-string/unexposed field remained untouched. This closes
  design.md Decision 2/4's three preservation guarantees (`extras`, `defaultPanelStyle`
  unexposed keys, `namingConventions` non-string values) end-to-end, against ground
  truth, not just via the unit test the evaluator cited.
- Code-level confirmation of the mechanism in `PreferencesEditor.tsx:116-143`:
  `mergedPanelStyle = {...panelStyleBase, background, color, transparency}` (spread
  preserves unexposed keys), `nonStringNamingEntries` filtered from the fetched base and
  concatenated with only the string-valued, editor-recognized rows before
  `Object.fromEntries`, `extras: preferences.extras` passed through untouched. Matches
  design.md Decision 4's specified shallow-merge-over-fetched-base mechanism exactly.

**Agent-memory happy paths — verified live:**
- Seeded real entries via the API, confirmed populated render (kind/content/last-used),
  never-used entry shows "Never used" (not fabricated).
- Per-entry delete: inline Confirm/Cancel appears (no `window.confirm`), confirming
  removes the entry and persists (`GET /api/agent/memory` re-checked).
- Clear all: inline "Clear all N entries?" Confirm/Cancel at the list level; cancel
  leaves entries intact (re-checked via `GET`); confirm clears to the `EmptyState`.
- Route/menu wiring: `UserMenu.tsx`'s new "Settings" `role="menuitem"` entry (gear icon,
  closes popover before navigating) matches the theme/sign-out items' shape;
  `/settings` sits inside the same `ProtectedRoute`/`AppShell` block as every other
  authenticated route in `App.tsx`'s diff, so unauthenticated redirect behavior is
  inherited, not reimplemented; `breadcrumbLabel()` got the round-1-flagged `/settings`
  case, confirmed live ("Settings" breadcrumb rendered).
- Light/dark parity: screenshotted both themes. Cards, borders, dot-grid background,
  color-swatch inputs, and the shared `EmptyState` (Fraunces-styled title) all render
  correctly with tokenized styling in both themes; no dark-only hardcoded colors bleeding
  through.
- The two DESIGN.md `[mechanical]` exceptions the evaluator flagged
  (`AgentMemoryList.css:87`, `SettingsPage.css:5`, literal `px` padding) — independently
  re-grepped and confirmed both values are verbatim, pre-existing precedent
  (`MetricsPage.css:5/83`, `PipelinesPage.css:5/112` use the identical literal values),
  not a new deviation.

### A live-reproduced defect the evaluator's test plan did not exercise

**Individual memory-entry delete failure is completely silent to the user — no error
feedback anywhere in the UI.** Reproduced directly, not hypothesized:
1. Created a real entry via the API, loaded it in the Settings UI.
2. Deleted the same entry out-of-band (`DELETE /api/agent/memory/:id` via direct fetch,
   confirmed backend returns `404 Not Found` for a now-nonexistent id —
   `AgentMemoryService.delete`, `backend/.../services/AgentMemoryService.scala:57-61`),
   simulating a real race/already-gone failure while the stale row is still shown in the
   UI.
3. Clicked "Delete" → "Confirm" on that same (now-stale) row in the running app.
4. Observed: the confirm/cancel pair silently reverts back to a plain "Delete" button.
   **No error message appears anywhere** — no inline error near the row, no toast, no
   `role="alert"` text — despite the underlying `DELETE` request genuinely failing (404,
   confirmed via a console network error). The user has zero indication the delete they
   just confirmed did not happen.

Root cause, read directly in the diff: `frontend/src/features/settings/state/
settingsSlice.ts:42-43` and `:184-199` track `deleteStatus`/`deleteError` keyed by entry
id (and this is unit-tested in isolation — `settingsSlice.test.ts:130-161`), but
`frontend/src/features/settings/ui/AgentMemoryList.tsx` never reads
`state.settings.agentMemory.deleteError` for any row — the state exists, is populated
correctly on failure, and is simply never rendered. This is inconsistent **within the
same file**: `AgentMemoryList.tsx:34,92` does wire `clearError` to `<InlineError
error={clearError} />` for the clear-all path, and `PreferencesEditor.tsx` wires
`saveError` the same way (design.md's own stated pattern, and the evaluator's own cited
test, "shows an error and keeps in-progress edits when save fails") — only the per-entry
delete path skips this.

This also breaks a real, pre-existing, self-documented codebase convention:
`frontend/src/features/toasts/state/toastListeners.ts`'s header comment explicitly
enumerates every structurally-identical "meaningful failure" delete action elsewhere in
the app (`deleteDashboard`, `deletePanel`, `deleteSource`, `deleteDataType`,
`deletePipeline` — all wired for both success and error toasts via `startListening`).
`deleteAgentMemoryEntryThunk` and `clearAgentMemoryThunk` are the same class of action
(explicit, user-initiated, confirmed via a dialog, destructive) and are not registered in
that file at all — confirmed by reading the full file, no `settings`/`agentMemory`
reference exists anywhere in it. (By contrast, `savePreferences` correctly omitting toast
wiring is *not* a gap — that file's own "Silent" list already documents
`updatePanelAppearance`, the exact explicit-save analogue design.md Decision 3 cites, as
intentionally toast-free, since it has its own inline dirty-state UI.)

Neither `AgentMemoryList.test.tsx` nor `settingsSlice.test.ts` exercises a delete-failure
UI path (`settingsSlice.test.ts` tests the reducer's `deleteError` state transition in
isolation; no component test ever mocks a rejected `deleteAgentMemoryEntry` and asserts
what renders) — which is exactly why this was never caught before reaching this gate.

### Verdict: REFUTE

### Change Requests

1. **(Blocking)** `frontend/src/features/settings/ui/AgentMemoryList.tsx` — surface
   `state.settings.agentMemory.deleteError[id]` for the row being deleted (e.g. an
   `InlineError` under/beside that row's confirm affordance, mirroring the existing
   `clearError` → `<InlineError>` wiring at line 92). A failed per-entry delete must never
   be silent. Add a regression test to `AgentMemoryList.test.tsx` mocking a rejected
   `deleteAgentMemoryEntry` and asserting the error is visible and the entry remains in
   the list — mirroring `PreferencesEditor.test.tsx`'s existing "shows an error and keeps
   in-progress edits when save fails" pattern for the save path.
2. **(Should fix alongside #1, same root cause)** Register
   `deleteAgentMemoryEntryThunk.fulfilled/.rejected` and
   `clearAgentMemoryThunk.fulfilled/.rejected` in
   `frontend/src/features/toasts/state/toastListeners.ts`, matching this codebase's own
   documented convention for every other destructive delete action
   (`deleteDashboard`/`deletePanel`/`deleteSource`/`deleteDataType`/`deletePipeline`, all
   already wired there for both success and failure). This closes the same silent-failure
   gap via the app's standard mechanism and restores parity with every sibling delete
   flow (a memory-entry delete currently gives no toast on success either, unlike its
   analogues). `savePreferences` correctly does **not** need this — it already matches
   that file's own documented "Silent" precedent (`updatePanelAppearance`-style explicit
   saves with inline dirty-state UI).

### Non-blocking notes

- `PreferencesEditor.tsx:228-238` — naming-convention rows' `aria-label`s
  ("Naming convention key"/"Naming convention value") are identical across every row,
  unlike the index-suffixed labels used for `defaultSeriesColors` rows in the same file.
  Consider suffixing for screen-reader distinguishability with multiple rows (same note
  the evaluator raised; independently confirmed still present).
- Whether the `namingConventions` editor supports adding a brand-new key vs.
  view/edit-existing-only remains implicit (round-2 skeptic's non-blocking note); still
  not required by any AC/spec scenario, and the add-row button (`"Add naming
  convention"`) I exercised live behaves sensibly (adds an empty row that merges in on
  save), so this is resolved satisfactorily in practice even though tasks.md never made
  it explicit.
