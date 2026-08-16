# Files modified — assistant-conversation-rename-ui (HEL-693)

- `frontend/src/features/assistant/state/assistantConversationsSlice.ts` — added the `renameConversation` thunk (mirrors `togglePinned`, rejects via `extractErrorMessage`) and its `fulfilled` reducer (replaces the matching `items` entry; syncs `activeConversation.data.title` when the renamed conversation is active).
- `frontend/src/features/assistant/state/assistantConversationsSlice.test.ts` — reducer tests for `renameConversation.fulfilled` (items update, active-conversation title sync, non-matching active conversation untouched) and thunk tests (calls `updateConversation` with `{ title }`; rejects with the server's message).
- `frontend/src/shared/chrome/SidebarItemList.tsx` — added the opt-in `onRename` prop and internal `renamingId`/`renameValue`/`renameInvalid`/`renameStatus`/`renameError` state; widened `renderRowAction`'s signature to pass a `{ startRename }` helper (additive, backward-compatible); implemented the full-row edit-mode swap (auto-focus + select-all `TextField`), Enter/Escape/blur commit-cancel semantics, blank/no-op guard rails, and in-flight/error handling per design.md D2–D5. **Cycle 2:** the auto-focus/select-all effect now also depends on `renameStatus` (not just `renamingId`), so it re-fires and restores focus when a failed save flips `renameStatus` back to `"idle"` while the row is still in edit mode (evaluator Change Request 1, `evaluation-2.md`).
- `frontend/src/shared/chrome/SidebarBody.tsx` — wired the chat section's `renderRowAction` to render a pencil rename button (lucide `Pencil`, sibling before the pin toggle) calling `helpers.startRename()`, and passed `onRename` as `dispatch(renameConversation(...)).unwrap()`.
- `frontend/src/shared/chrome/SidebarBody.test.tsx` — new "inline rename (HEL-693)" describe block: Enter commits and PATCHes `{ title }`; Escape cancels with no PATCH; blank-after-trim marks `aria-invalid` with no PATCH; unchanged title exits edit mode with no PATCH; a failed rename keeps the row editable and renders a `role="alert"` error; clicking rename does not select the conversation. **Cycle 2:** added a regression test for Change Request 1 — after a failed save, focus returns to the rename input.
- `frontend/src/features/dashboards/ui/DashboardList.css` — added `.dashboard-list__row-rename` / `.dashboard-list__row-rename-input` / `.dashboard-list__row-rename-error` (metrics matched to `.dashboard-list__filter-input`, all DESIGN.md tokens) and a `gap` on `.dashboard-list__row-action` so the new pencil button and the existing pin toggle don't render flush. **Final-gate round 1:** fixed the pre-existing CSS Grid track-sizing bug this ticket's new `.focus()` call exposed — see below.

## Notes for the evaluator

- **Bug caught and fixed during implementation (not a design deviation):** RTK's `dispatch(thunk(...)).unwrap()` throws the thunk's string `rejectValue` directly, not wrapped in an `Error` (confirmed by reading `unwrapResult` in `node_modules/@reduxjs/toolkit/dist/cjs/redux-toolkit.development.cjs`). `SidebarItemList`'s `commitRename` catch block therefore checks `typeof err === "string"` before the `err instanceof Error` fallback — otherwise a real server-side rejection message would silently be replaced by the generic "Failed to rename." string. Covered by `SidebarBody.test.tsx`'s failed-rename test, which asserts the specific message text renders.
- **Spinoff candidate (flagged, not fixed inline per CONTRIBUTING.md's refactor-discipline guidance):** `SidebarItemList.tsx` is now ~430 lines, over the ~400-line soft-budget flag point in CONTRIBUTING.md ("propose a split ... rather than adding to it"). This ticket's task list scoped the change to exactly this file, so I did not split it; a follow-up ticket to decompose the row-rendering branch (select/NavLink vs. rename-input vs. delete-confirm) into smaller sub-components would bring it back under budget.

## Cycle 2 — Change Request 1 (evaluation-2.md)

- **Root cause:** `commitRename`'s `catch` block re-enabled the rename input (`setRenameStatus("idle")`) but never restored focus to it. The only refocus site was a `useEffect` gated solely on `renamingId`, which does not change on a failed save (the row stays in edit mode on the same item), so the effect never re-ran and DOM focus was stranded on `<body>` after the request rejected. Escape (and further typing) requires the input to have focus, so a keyboard-only user was stuck.
- **Fix:** widened the auto-focus `useEffect`'s condition/deps to `renamingId !== null && renameStatus === "idle"` and added `renameStatus` to the dependency array, so the same effect that focuses+selects on entering edit mode also re-fires when a failed save flips `renameStatus` back to `"idle"`. Deliberately an effect (not a direct `.focus()` call added to the `catch` block, as the report's literal suggestion located it) because React batches `setRenameStatus` — a synchronous `.focus()` call immediately after it would run before React commits the DOM update that re-enables (`disabled={false}`) the input, and `.focus()` on a still-disabled element is a no-op. An effect is guaranteed to run only after the DOM has committed.
- **Probe (test-environment gap found and worked around, not silently accepted):** the first version of the regression test passed even against the pre-fix code — a false green. Probed directly (scratch `__probe.test.ts`, not committed): jsdom does not blur a focused element when it becomes `disabled` (real browsers do), and calling `.blur()` on an already-disabled-but-focused element is *also* a no-op in jsdom — so the input never actually lost focus in the jsdom test environment regardless of the fix. Rewrote the test to explicitly move focus to a different real, focusable element (the always-present "New chat" button) while the request is in flight, which the same probe confirmed *does* reliably move `document.activeElement` in jsdom. Verified red/green by hand: `git stash`-ing the `SidebarItemList.tsx` fix reproduces the failure (`expect(input).toHaveFocus()` fails, activeElement is the "New chat" button), restoring the fix makes it pass.
- **Gates re-run fresh after the fix:** `npm test` 1836/1836, `npm run lint` 0 warnings, `npm run format:check` clean (see commit message for pasted output).

## Final-gate round 1 — Change Request 1 (skeptic-final-1.md)

- **Root cause (mechanically confirmed, not live-browser-guessed — no dev server was started this round):**
  `.dashboard-list__items` (the `<ul>`, `display: grid`) declares no `grid-template-columns`, so CSS Grid's
  default single implicit column auto-sizes to the **max-content** width of the widest row. A grid item's
  automatic minimum width is its own min-content size unless overridden, and `.dashboard-list__name`'s
  `white-space: nowrap` makes an unwrapped text run's min-content size equal its full unwrapped width — so
  every row (`<li class="dashboard-list__item">`), regardless of its own text length, gets stretched to the
  widest sibling's width. `.dashboard-list__item` and `.dashboard-list__item-row` were also missing the
  `min-width: 0` that every other layer in the same descendant chain (`.dashboard-list__button` →
  `.dashboard-list__text` → `.dashboard-list__name-group` → `.dashboard-list__name`) already had — so even
  capping the grid track alone would not have been sufficient; the flex-item layers in between would still
  refuse to shrink below their own content. `.dashboard-list` (`overflow-y: auto`, which per the CSS
  single-axis-overflow rule also computes `overflow-x: auto`) horizontal-scrolls to fit the oversized row
  instead of the already-correct ellipsis machinery ever getting a chance to truncate. On `.focus()` (this
  ticket's new call, previously without `{ preventScroll: true }`), the browser scrolls that overflow into
  view, landing on the *end* of the newly-focused/selected input and hiding the start.
  - Confirmed the CSS is exactly as diagnosed by reading `DashboardList.css` directly (not assumed from
    memory): `.dashboard-list__items { display: grid; gap: 2px; ...}` had no `grid-template-columns`;
    `.dashboard-list__item { display: flex; align-items: stretch; gap: var(--space-2); }` had no
    `min-width: 0`; `.dashboard-list__item-row { display: flex; align-items: center; gap: var(--space-1); }`
    likewise. Reasoned through the CSS Grid/Flexbox automatic-minimum-size specification mechanics (a
    well-documented, deterministic behavior, not a guess) rather than fixing the symptom (the scroll) alone.
  - Traced the outer layers too, to rule them out: `.app-sidebar` is a fixed-240px column flex container, but
    `.dashboard-list` itself sets `overflow-y: auto` on its own box, which per spec forces ITS OWN automatic
    minimum size to 0 as a flex item — so `.dashboard-list` was already correctly clamped to the sidebar
    width; the blowout was entirely inside `.dashboard-list__items`'s own subtree, not from an outer layer.
  - This is a pre-existing, general bug (not new to this ticket) shared by all `SidebarItemList`-based
    sections (sources/pipelines/registry/metrics/chat) *and* `DashboardList.tsx` (same CSS classes) — it was
    simply dormant everywhere else because no prior interaction called `.focus()` on a full-row-width element,
    and/or existing content (dashboard names, other sections' item names) happened to be short enough not to
    visibly overflow. This ticket's rename `.focus()`/`.select()` call is what exposed it.
- **Fix (two layers, per the skeptic's preferred direction + minimum-fallback, both applied):**
  1. `frontend/src/features/dashboards/ui/DashboardList.css` — `.dashboard-list__items` gets
     `grid-template-columns: minmax(0, 1fr)`; `.dashboard-list__item` and `.dashboard-list__item-row` each
     get `min-width: 0`. Completes the min-width:0 chain from the grid container all the way down to
     `.dashboard-list__name`/`.dashboard-list__row-rename` (which already had it), letting the existing
     ellipsis/shrink machinery engage as originally intended — this is a genuine, general truncation fix
     for every section sharing this CSS, not a chat-specific patch.
  2. `frontend/src/shared/chrome/SidebarItemList.tsx` — the auto-focus effect now calls
     `renameInputRef.current?.focus({ preventScroll: true })` (skeptic's "minimum fallback"). Explicit
     `scrollIntoView` was deliberately **not** added on top: the row being renamed was just clicked, so it's
     already vertically in view — the only scroll `.focus()` was triggering was the horizontal overflow the
     CSS fix resolves at the root, so a second, redundant scroll-control mechanism for a case that can't
     structurally occur here was skipped as unnecessary complexity (CONTRIBUTING.md: keep changes focused).
- **What could and couldn't be verified this round:** dev servers were **not** started (per the orchestrator's
  explicit instruction) and jsdom cannot model real CSS Grid/Flexbox layout or scroll positions — so the
  actual visual fix (row width now bounded, no horizontal scroll on focus) could not be verified live by the
  executor. What *was* verified: (1) the CSS mechanics via direct spec-grounded reasoning against the actual
  rule text (not a live render), (2) all four `SidebarItemList`/`DashboardList`-touching test suites still
  pass (68/68 targeted, 1836/1836 full suite — jsdom doesn't apply real layout, so these confirm no
  functional/DOM-structure regression, not the visual fix itself), (3) a clean production build
  (`npm --prefix frontend run build`). **The re-spawned skeptic needs to re-verify the actual visual outcome
  live in the browser** (row width bounded, ellipsis engaging, no horizontal scroll on rename focus, across
  the registry's stacked-subtitle rows too) — this executor cannot self-certify a live-rendering claim without
  a browser.
- **Gates re-run fresh after the fix:** `npm test` 1836/1836, `npm run lint` 0 warnings, `npm run format:check`
  clean, `npm --prefix frontend run build` succeeds (see commit message for pasted output).
