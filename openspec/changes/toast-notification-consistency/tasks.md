## 1. Frontend — toast state

- [x] 1.1 Move `DEFAULT_DURATION = 4000` from `Toast.tsx:18` into `toastsSlice.ts`; apply it in `pushToast`'s `prepare` (D3)
- [x] 1.2 Add `MAX_VISIBLE_TOASTS = 3`; evict the oldest **auto-dismissing** toast in the `pushToast` reducer (D1)
- [x] 1.3 Exempt `duration: 0` and `action`-bearing toasts from eviction; admit the push even when every entry is exempt (D1)
- [x] 1.4 Coalesce an exact `variant`+`message` duplicate by removing the existing entry and re-pushing with a fresh id (D1)

## 2. Frontend — announcement and surface

- [x] 2.1 Mount persistent visually-hidden polite (`role="status"`) and assertive (`role="alert"`) live regions in `ToastViewport` from first render — **unconditionally**, never lazily — reusing the canonical `.sr-only` recipe at `theme/theme.css:279-287` rather than hand-rolling a clip rect (D2)
- [x] 2.2 Route each toast's message into the region matching its intent — `error` assertive, all others polite — keying each region's children by **toast id**, so a coalesced repeat mounts a new node and is re-announced rather than becoming a text-identical no-op (D1, D2)
- [x] 2.3 Remove `role`/`aria-live`/`aria-atomic` from the visible toast card, and mark `.toast__message` `aria-hidden="true"`, keeping the action and dismiss buttons reachable (D2)
- [x] 2.3a Give `.toast__message` an id and reference it from the action and dismiss buttons via `aria-describedby`, so those controls are not orphaned from their message in the accessibility tree (matters for the sticky Undo toast, which outlives the navigation that spawned it) (D2)
- [x] 2.4 Replace `Toast.tsx:43`'s literal `200` with `TOAST_EXIT_MS`; drop the exit delay to zero under `matchMedia("(prefers-reduced-motion: reduce)")` (D4)
- [x] 2.5 Switch `.toast`'s entrance to `--transition-slow`; move the exit's literal `0.2s` onto `--toast-exit-duration` (D4)
- [x] 2.6 Add `@media (prefers-reduced-motion: reduce)` setting `animation: none` on `.toast` and `.toast--exiting` (D4)
- [x] 2.7 Add the 44px tap-target floor to `.toast__close` at ≤768 — keep its 20px desktop size per `DESIGN.md` §5 (D4)
- [x] 2.8 Offset `.toast-viewport`'s `bottom` above `BottomNav`'s height plus `env(safe-area-inset-bottom)` at ≤768 — extract the height into a `--bottom-nav-height` custom property rather than adding a third copy of the `calc()` already duplicated at `BottomNav.css:27` and `App.css:424` (D4)

## 3. Frontend — listener tables

- [x] 3.1 Replace `toastListeners.ts`'s 33 hand-written effects with `SUCCESS_TOASTS`/`ERROR_TOASTS` tables and two registration loops, preserving **every** existing entry's behaviour exactly (D7)
- [x] 3.2 Add error entries for the three surface-less auto-save writes: `updateDashboardLayout`, `updatePanelsBatch`, `updatePanelColumnWidths` — naming each fallback string explicitly in the existing "Failed to <verb> <noun>." convention, phrased as what the user did (a column *resize*, not "update panel column widths") (D5)
- [x] 3.3 Add an error entry for `savePipelineSchedule`; annotate it in the table as a known duplicate on the dialog path, tracked by HEL-771 (D5)
- [x] 3.4 Add success **and** error entries for `deleteMetric` (D5)
- [x] 3.5 Rename `createSqlSource`'s success copy from "connected." to "created." so it matches `createStaticSource` and `finishCreate` (D6)
- [x] 3.6 Replace the self-contradicting header comment with one stating that this change did not audit which thunks *should* toast (HEL-771 owns that), so absence from both tables means "unchanged by this change" (D7)
- [x] 3.7 Remove **no** existing entry — this change's charter is that nothing announced today becomes unannounced (D5)

## 4. Frontend — call sites

- [x] 4.1 Add a `{ toast: false }` option to `AddSourceModal`'s `finishCreate`; pass it from the two thunk call sites only (`:167`, `:184`) (D6)
- [x] 4.2 Change `finishCreate`'s copy to `Data source "<name>" created.`, using the `name` already in scope (D6)
- [x] 4.3 Verify the five direct-service call sites (`:144`, `:147`, `:218`, `:246`, `:274`) still toast exactly once, with that same wording (D6)
- [x] 4.4 Replace `PipelineDetailPage.tsx:449-451`'s `.catch(() => {})` with an error toast **and** restore the optimistically-removed step, matching its five siblings (D5)
- [x] 4.5 Touch no other component: no inline error rendering, no `InlineError` variant, no removal of any existing toast (D5, Non-Goals)
- [x] 4.6 `frontend/src/features/panels/ui/PanelList.tsx` is out of bounds entirely — no edit of any kind (HEL-770)

## 5. Tests

- [x] 5.0 Before committing, confirm `git diff --stat` lists **no** change to `frontend/src/features/panels/ui/PanelList.tsx`
- [x] 5.1 `toastsSlice.test.ts` — cap eviction at and beyond the boundary; the newest toasts are retained
- [x] 5.2 `toastsSlice.test.ts` — a `duration: 0` / `action`-bearing toast survives eviction pressure (HEL-343 Undo regression guard)
- [x] 5.3 `toastsSlice.test.ts` — an all-exempt state still admits a new push
- [x] 5.4 `toastsSlice.test.ts` — identical `variant`+`message` coalesces to one entry with a fresh id; a differing message still stacks
- [x] 5.5 `toastsSlice.test.ts` — `prepare` applies the default duration; an explicit duration and `duration: 0` survive
- [x] 5.0a `Toast.test.tsx` — rewrite the two assertions this change contradicts: `:26-30` (asserts no `alert` role exists when empty — now false, the assertive region is always mounted) and `:50-64` (asserts four `alert` roles — now false under both the role removal and the cap). Resolve them **to the new contract**; do not make the regions lazy to keep the old assertion passing
- [x] 5.6 `Toast.test.tsx` — both live regions exist before any toast; messages route to the correct region per intent; a coalesced repeat mounts a new node in its region
- [x] 5.7 `Toast.test.tsx` — the visible card carries no live-region role and its message is `aria-hidden`; the dismiss and action buttons remain reachable by role
- [x] 5.8 `Toast.test.tsx` — dismissal removes the toast immediately under reduced motion
- [x] 5.9 New `toastListeners.test.ts` — the three auto-save writes, `savePipelineSchedule` and `deleteMetric` each emit exactly one error toast on rejection; `deleteMetric` emits one success toast on success
- [x] 5.10 New `toastListeners.test.ts` — regression guard: every entry that existed before this change still fires (no silent removal)
- [x] 5.11 `AddSourceModal.test.tsx` — replace the `.some()` assertions at `:165`/`:515` with exact counts, and assert one identical wording across a thunk path and a direct-service path
- [x] 5.12 `PipelineDetailPage` — a rejected step delete restores the step to the view and emits exactly one error toast
- [x] 5.13 New `toast.css.test.ts` per the `shared/ui/*.css.test.ts` convention — entrance token, reduced-motion block, mobile offset, 44px floor; `.toast-viewport`'s `width: 340px` literal is expected and allowed
- [x] 5.14 Run `npm run lint`, `npm run format:check`, `npm test` and `npm --prefix frontend test` clean, against the 224-suite / 2427-test green baseline
