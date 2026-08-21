# Files Modified — HEL-535 toast-notification-consistency

## Cycle 3 — skeptic-final-1.md change requests (all three addressed)

- **CR1 (`Toast.tsx`, blocking)** — cycle 2's fix (removing the explicit `aria-atomic="true"`) did not
  actually make the live regions non-atomic: `role="status"`/`role="alert"` each carry an **implicit**
  `aria-atomic="true"` per the ARIA spec, so the effective semantics were unchanged. Confirmed independently
  via Chrome's computed accessibility tree (CDP `Accessibility.getFullAXTree`) on two isolated probes:
  `atomic: true` with no explicit attribute (reproducing the bug), `atomic: false` with an explicit
  `aria-atomic="false"` (confirming the fix) — the verification gap the skeptic named (markup vs. computed
  semantics). Added `aria-atomic="false"` explicitly to both regions, rewrote the comment to say the roles
  imply atomic and the explicit `"false"` is load-bearing (do not tidy it away), and inverted
  `Toast.test.tsx`'s guard from `not.toHaveAttribute("aria-atomic")` (which pinned the broken state) to
  `toHaveAttribute("aria-atomic", "false")`.
- **CR2 (`PipelineDetailPage.tsx`, blocking)** — `handleRemoveStep`'s fallback string
  (`"Failed to delete step."`) was identical to the toast's own prefix, so any bodyless failure (network
  error, offline, aborted request, non-JSON 5xx) rendered `"Failed to delete step: Failed to delete step."`.
  Changed the fallback to a reason-shaped string (`"the request could not be completed."`). Strengthened the
  existing fallback-path test to `toBe` the full expected string (the prior `toMatch(/failed to delete
  step/i)` would not have caught the doubled sentence, since that pattern matches it too — verified by
  reverting the fix and re-running: the strengthened assertion fails against the pre-fix code, passes after)
  and added a companion test for the server-supplied-reason arm, which was already correct and stays so.
  Left the four pre-existing sibling call sites (`:390`, `:420`, `:502`, `:548`) untouched, as directed.
- **CR3 (`toast.css`, blocking, small)** — the new mobile block's `margin: -12px -12px 0 0` was a bare
  literal; `DESIGN.md` §3 caps un-tokened optical tweaks at 4px and `12px` is `--space-3`. Changed to
  `margin: calc(var(--space-3) * -1) calc(var(--space-3) * -1) 0 0;` (identical computed value). Re-verified
  with the same headless-Chromium cascade probe used for cycle 2's CR1: 44px/44px still resolves at 430 and
  768, margin computes to `-12px -12px 0px 0px` as before, desktop (1440) unaffected — the cycle-2
  source-order fix is intact. Added a `toast.css.test.ts` guard pinning the margin resolves through
  `--space-3` rather than a literal, verified as a real regression guard (fails against the pre-fix CSS,
  passes after).

## Cycle 2 — evaluation-1.md change requests (all four addressed)

- **CR1 (`toast.css`, blocking)** — the 44px mobile tap floor was dead: its `@media (max-width: 768px)` block sat
  *above* the base `.toast__close` rule, and with equal specificity (0,1,0) the cascade resolves on source order, so
  the later base rule always won regardless of the query matching. Root cause probe-confirmed by reading the source
  directly (matches the evaluator's live `getComputedStyle` finding) and independently reproduced/fixed-verified with
  a headless-Chromium cascade probe (20px/20px before the fix at 430 & 768; 44px/44px after; desktop 1440 still 20px).
  Fix: split `.toast__close`'s mobile override into its own `@media (max-width: 768px)` block placed *after* the base
  rule (and after `:hover`); `.toast-viewport`'s offset left where it was (its base rule already precedes its block).
- **CR2 (`toast.css.test.ts`, blocking)** — the guard asserted only the override block's *text*, which passed
  regardless of source order. Replaced with an order-aware assertion (`findMediaBlockFor` returns the block's source
  index; the test asserts it is greater than the base `.toast__close {` rule's index). Regression-guard verified
  concretely: re-ran this test against the pre-fix CSS (`git show 839cd7fe:...toast.css`) and confirmed it fails (2
  assertions); ran again against the fixed CSS and confirmed it passes — the fail-before/pass-after pattern
  `systematic-debugging.md` requires.
- **CR3 (`panelThunks.ts` / `toastListeners.test.ts`, blocking)** — two of the three new auto-save fallback strings
  were unreachable: `updatePanelColumnWidths`/`updatePanelsBatch`'s `catch` blocks unconditionally call
  `rejectWithValue("<own literal>")`, so `.rejected.payload` is *always* defined and the table's `payload ?? fallback`
  never takes the fallback branch. Confirmed independently by reading both thunk bodies and grepping every consumer of
  each thunk's rejection payload (none outside `toastListeners.ts`). Fixed at the source — `panelThunks.ts`'s two
  literals changed to the user-phrased copy task 3.2 required (`"Failed to resize columns."`,
  `"Failed to save panel changes."`), table fallbacks left identical (already correct). Updated
  `toastListeners.test.ts` to dispatch the thunk's real `rejectWithValue` string as `payload` (the reachable path)
  instead of `payload: undefined` (a state these thunks cannot produce), for all three auto-save entries.
- **CR4 (`Toast.tsx`, blocking)** — `aria-atomic="true"` on the two live regions re-announced the whole region (all
  siblings, not just the added one) on every change, once a region could hold up to `MAX_VISIBLE_TOASTS` children —
  directly contradicting D2's "nothing is announced twice". Removed from both regions (default `false`/unset
  announces only the added node, which id-keyed children already deliver); added a comment recording why, so it isn't
  restored. New companion test (`Toast.test.tsx`) pins that neither region carries `aria-atomic` once it holds
  multiple messages.

## Source

- `frontend/src/features/toasts/state/toastsSlice.ts` — D1 (concurrent-toast cap `MAX_VISIBLE_TOASTS = 3` with
  oldest-first eviction of auto-dismissing toasts, exemption for `duration: 0`/action-bearing toasts, all-exempt
  admits anyway, variant+message coalescing) and D3 (`DEFAULT_DURATION` moved in from `Toast.tsx`, applied in
  `pushToast`'s `prepare`). `Toast.duration` tightened from optional to always-present on stored state (`ToastInput`
  keeps it optional for callers).
- `frontend/src/features/toasts/state/toastListeners.ts` — D7 rewrite: 33 hand-written `startListening` effects
  replaced by two declarative tables (`SUCCESS_TOASTS`/`ERROR_TOASTS`) and two registration loops, preserving every
  existing entry's behaviour exactly. D5 adds six new entries: error toasts for `updateDashboardLayout`,
  `updatePanelsBatch`, `updatePanelColumnWidths`, `savePipelineSchedule`, `deleteMetric`, plus a success toast for
  `deleteMetric`. D6 renames `createSqlSource`'s success copy from "connected." to "created.". Header comment replaced
  per task 3.6 (absence from the tables means "unchanged by this change", not "deliberately silent" — that
  classification is HEL-771's).
- `frontend/src/shared/ui/Toast.tsx` — D2 (always-mounted, visually-hidden polite/assertive live regions in
  `ToastViewport`, keyed by toast id, routed by intent; visible card drops its own `role`/`aria-live`/`aria-atomic`
  and marks `.toast__message` `aria-hidden`, with an id referenced via `aria-describedby` from the action/dismiss
  buttons) and D4 (`TOAST_EXIT_MS` replaces the literal `200`; `prefersReducedMotion()` skips the exit delay under
  `prefers-reduced-motion: reduce`, guarded for jsdom/environments with no `matchMedia`).
- `frontend/src/shared/ui/toast.css` — D4: entrance moved to `--transition-slow` (was the hover token
  `--app-transition`); exit literal `0.2s` moved onto a `--toast-exit-duration` custom property (scoped to `.toast`,
  documented as `Toast.tsx`'s `TOAST_EXIT_MS` counterpart); `@media (prefers-reduced-motion: reduce)` sets
  `animation: none`; one consolidated `@media (max-width: 768px)` block offsets `.toast-viewport`'s `bottom` above
  `--bottom-nav-height` and gives `.toast__close` a 44px tap floor (stays 20px above that breakpoint per DESIGN.md
  §5).
- `frontend/src/theme/theme.css` — adds `--bottom-nav-height` (the `BottomNav.css:27`/`App.css:424` calc, named once
  so toast.css's mobile offset doesn't add a third literal copy). `BottomNav.css`/`App.css` themselves are
  deliberately left untouched — not in the change's Impact scope.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — D6: `finishCreate` gains a `{ toast: false }` option, passed
  from the two thunk call sites (`createStaticSource`, `createSqlSource`) only, so those two rely on
  `toastListeners.ts`'s `.fulfilled` entry instead of double-toasting; copy changed to
  `Data source "<name>" created.` (using the in-scope `name` state), matching the listener's wording exactly across
  all seven create paths.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — D5: `handleRemoveStep`'s `.catch(() => {})` replaced
  with the same optimistic-snapshot/restore-on-failure + error-toast pattern its five siblings
  (reorder/enable/duplicate/add-step/instantiate-shape) already use.
- `frontend/src/test/renderWithStore.tsx` — adds an opt-in `withToastListeners` option (default off, unchanged
  behaviour for every other caller) that wires `listenerMiddleware` + `addToastListeners`, guarded to register at
  most once per test file. Needed so `AddSourceModal.test.tsx`'s thunk-dispatched create path can observe the
  listener's own toast (the one D6 now relies on for that path) rather than only `finishCreate`'s.
- `frontend/src/features/panels/state/panelThunks.ts` (cycle 2, CR3) — `updatePanelColumnWidths`/`updatePanelsBatch`'s
  `rejectWithValue` literals changed to the user-phrased copy the toast tables always intended to show (see Cycle 2
  section above).

## Tests

- `frontend/src/features/toasts/state/toastsSlice.test.ts` — new coverage: cap eviction at/beyond the boundary,
  sticky-toast (duration:0 / action-bearing) eviction exemption, all-exempt-state admits a push, coalescing (fresh id,
  moves to newest, doesn't coalesce a different message or a different variant), `prepare`'s default/explicit/zero
  duration.
- `frontend/src/features/toasts/state/toastListeners.test.ts` (new) — regression guard exercising every pre-existing
  table entry (still fires, unchanged fallback text) plus the six new HEL-535 entries, dispatched against a real
  `listenerMiddleware`-wired store.
- `frontend/src/shared/ui/Toast.test.tsx` — rewrote the two assertions the new contract contradicts (`role="alert"`
  now exists with zero toasts; four toasts no longer means four `alert` roles) to the new contract per task 5.0a, plus
  new coverage for live-region routing by intent, coalesced-repeat re-mounting, the visible card carrying no
  live-region role/aria-live, aria-hidden on the visible message with action/dismiss controls still reachable, and
  reduced-motion immediate dismissal.
- `frontend/src/shared/ui/toast.css.test.ts` (new) — static source guards (jsdom has no real layout/animation/media
  evaluation) for the entrance token, the reduced-motion block, the mobile offset, and the 44px floor.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — replaced the two `.some()` assertions with exact
  counts + exact wording; the thunk-path (static source) test now renders with `withToastListeners: true` so it can
  assert the toast comes from the listener (not a duplicate from `finishCreate`) and reads identically to the
  direct-service path's.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — new test: a rejected step delete restores the
  step to the view and emits exactly one error toast.
