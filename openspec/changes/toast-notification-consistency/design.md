## Context

Audited against base `3d93e82a` (HEL-539 merged). This change is the **mechanics half** of the original ticket; the
policy half was split to HEL-771 (see Goals / Non-Goals).

- **No cap, one politeness.** `ToastViewport` (`Toast.tsx:100`) maps all of `state.toasts.items` over a bare `push`
  reducer (`toastsSlice.ts:44`). Every toast renders `role="alert" aria-live="assertive"` (`Toast.tsx:61`) regardless
  of intent, so `"Panel deleted."` interrupts like an error; there is no polite path.
- **Motion drift.** The entrance uses `--app-transition` (0.16s, the *hover* token) where §3 assigns entrances
  `--transition-slow`. `.toast--exiting`'s literal `0.2s` is duplicated as a hardcoded `setTimeout(…, 200)`
  (`Toast.tsx:43`). `toast.css` has no `prefers-reduced-motion` block, unlike `MobileNavSheet.css:54` and
  `RefinementChatDrawer.css:58`; `theme.css:240`'s global rule only shortens animations to `0.01ms`, and it does not
  touch that JS delay at all — so under reduced motion a dismissed toast still occupies layout, invisible, for 200ms.
- **Mobile.** `.toast-viewport` sits at `bottom: var(--space-6)` (24px) with `--z-toast: 1000`, over `BottomNav.css`
  (`@media (max-width:768px)`; `fixed; bottom:0; z-index:5`; `calc(--control-lg + --space-4 + safe-area)` = 56px+), so
  the stack covers the phone navigation bar. `.toast__close` is 20px with no 44px mobile floor.
- **Two toasts, two wordings, one button.** `AddSourceModal.finishCreate` (`:81-87`) pushes `"Source added."` for all
  seven create paths, but the two *thunk* paths (`:167`, `:184`) also trigger the `.fulfilled` listeners
  (`toastListeners.ts:251`,`:275`), which say `Data source "X" connected."` / `created."`. So a SQL source produces two
  toasts, and a CSV source produces one with different wording. `AddSourceModal.test.tsx:165`/`:515` assert with
  `.some()` and cannot catch either.
- **Six failures reported nowhere** — no toast, no inline surface, no console signal:
  `updateDashboardLayout` (`useLayoutSave.ts:87-91`, bare `.catch`), `updatePanelsBatch`
  (`usePanelUpdatesFlush.ts:90-97`, bare `.catch`), `updatePanelColumnWidths` (`TableRenderer.tsx:123`, `void dispatch`,
  no catch), `savePipelineSchedule` from the header toggle (`PipelineDetailPage.tsx:338-351`, bare `void dispatch`;
  `scheduleSaveError` at `pipelinesSlice.ts:559-562` is read by nothing outside two test files, and
  `PipelineDetailHeader.tsx:139-144`'s `<Toggle>` silently refuses to move), `deletePipelineStep`
  (`PipelineDetailPage.tsx:449-451`, `.catch(() => {})` while its five siblings all toast), and `deleteMetric` (all
  three dispatch sites — `SidebarBody.tsx:196`, `MetricsPage.tsx:34`, `MetricDetailPage.tsx:64` — drop the rejection
  without `.unwrap()`). `SaveStateIndicator.tsx` has no failure state, so it cannot cover the first three.
  §7 forbids swallowing a failure.
- `toastListeners.ts` is 446 lines of 33 hand-written effects, past `CONTRIBUTING.md:24`'s ~400-line threshold, and its
  header comment claims a `renameDashboard` error toast (`:7`) that does not exist while also listing it as silent
  (`:24`). Colours in `toast.css` are clean — no literal hex/rgb.

## Goals / Non-Goals

**Goals:** a bounded, predictable stack; intent-correct announcement that cannot regress; a §3-correct surface that
honours reduced motion and clears the phone nav; one toast and one wording per user action; no failure reported nowhere.

**Non-Goals — and the load-bearing one first:** the **toast-versus-inline policy audit is out of scope, split to
HEL-771.** Three design-gate rounds each refuted a confidently-stated premise about existing surfaces derived by hand
from `toastListeners.ts`: round 1, that thirteen auto-save thunks had no inline surface (false for eight); round 2, an
entirely unaudited swallowed failure plus a tier definition that contradicted itself; round 3, that the inline surfaces
relied on to replace removed toasts are *announced* — false for most, because `InlineError.tsx:99`'s default render is a
bare `<p className="inline-error">` with no `role="alert"`, pinned deliberately by `InlineError.test.tsx:17`. That is a
method problem, so HEL-771 restarts the audit with mechanical derivation from the `createAsyncThunk` registry as its
premise. **Consequence for this change: it removes no toast that is a failure's only report, and alters the
announcement posture of no existing failure path.** Also out: `PanelList.tsx` entirely (HEL-770); notification
centre/history; redesigning HEL-539's components; skeletons (HEL-528); empty-state CTAs (HEL-548).

## Decisions

**D1 — Cap and coalesce in the reducer, with a sticky exemption.** `pushToast` enforces `MAX_VISIBLE_TOASTS = 3`,
evicting the oldest **auto-dismissing** toast. A toast with `duration: 0` or an `action` is **exempt**, because
`PatchSetReviewPage.tsx:101-121`'s Undo toast is sticky by contract (the user navigates away immediately) and FIFO
eviction would destroy the affordance without user action — and would falsify this change's own "a zero duration never
auto-dismisses" requirement. If every toast in state is exempt the push is still admitted: correctness over the cap,
and only one site in the app produces an exempt toast today. `pushToast` also coalesces an exact `variant`+`message`
match by removing the existing entry and re-pushing with a fresh id, restarting its timer and moving it to newest —
which also implements the Undo toast's documented "next successful apply's toast replaces it" clause. Reducer-side, so the store is the single truth and the cap is directly assertable. Two consequences stated on paper so
they reconcile with the "announcement coverage does not regress" criterion: eviction happens before render, so four or
more distinct failures dispatched in a single tick will drop the oldest before it is ever announced — inherent to any
cap, and "the newest feedback always remains visible" chooses it deliberately; and the exemption tracks *whether the
toast can leave without user action*, i.e. `duration === 0` or an `action` the user must be able to reach, which also
means a parked Undo toast holds a slot and leaves an effective cap of 2 until it is dismissed or replaced. Consequence, stated accurately: `updatePanelsBatch`
retains its pending updates and retries every `AUTO_SAVE_INTERVAL_MS = 30_000` (`usePanelUpdatesFlush.ts:95-96`), so a
sustained outage yields a toast visible 4s then absent 26s, recurring — not one persistent toast. Accepted: it mirrors
the real retry cadence, and `SaveStateIndicator` shows "Unsaved changes" throughout the gaps. `duration: 0` was
considered and rejected — it would park a stale error on screen after recovery.

**D2 — Announcement via always-mounted live regions, never per-node.** `ToastViewport` mounts two persistent
visually-hidden regions from first render — `role="status" aria-live="polite"` and `role="alert" aria-live="assertive"`
— and each toast's message is rendered into the region matching its intent (`error` → assertive, all others → polite).
The visible toast card carries **no** live-region role and no `aria-live`, so nothing is announced twice; its
`aria-atomic` goes with the role it qualified. The alternative — fixing politeness on the existing per-node region — was
rejected because announcement would still depend on a live region created together with its content, which is precisely
the failure mode that cannot be observed at a gate: a criterion the final gate cannot fail on is not a criterion.
Because the message text now exists both in the hidden region and in `.toast__message`, the visible copy is marked
`aria-hidden="true"` (the action and dismiss buttons stay reachable), so a screen-reader user browsing the
`role="region" aria-label="Notifications"` landmark does not meet it twice.

**D3 — One duration, owned by the slice.** `DEFAULT_DURATION = 4000` moves from `Toast.tsx:18` into `toastsSlice.ts`
and is applied in `pushToast`'s `prepare`, so every stored toast carries its effective duration and the cap, the
coalescing and the tests all read one value. Uniform across intents; `duration: 0` stays the sticky escape hatch.

**D4 — Surface, motion and mobile.** The entrance moves to `--transition-slow` (§3); the exit literal becomes a
`--toast-exit-duration: 200ms` custom property with `TOAST_EXIT_MS` in `Toast.tsx` documented as its counterpart; an
explicit `@media (prefers-reduced-motion: reduce)` block sets `animation: none` on `.toast`/`.toast--exiting`, and
`ToastItem` drops its exit delay to zero under the same query, so dismissal is immediate rather than invisible-but-
occupying. **`.toast__close` stays 20px**: `DESIGN.md` §5 blesses a sub-24px hand-rolled dismiss and names this very
button as its example, so resizing it would orphan its own justification and falsify §5 — it gains only the 44px tap
floor at ≤768 that §3 requires regardless. **Body type stays `--text-xs`**, matching `InlineError.css:4`/`:41`. At ≤768
the viewport's `bottom` clears `BottomNav`'s height plus `env(safe-area-inset-bottom)`.

**D5 — Close the six swallowed failures, add-only.** Error-toast entries for `updateDashboardLayout`,
`updatePanelsBatch`, `updatePanelColumnWidths`, `savePipelineSchedule` and `deleteMetric`; `deleteMetric` also gets the
success toast its three sibling delete affordances in `SidebarBody.tsx` already have (the `include-metrics` decision).
`deletePipelineStep`'s `.catch(() => {})` is replaced by the error toast its five siblings use — **and by restoring the
optimistically-removed step**, because `handleRemoveStep` (`:443-452`) deletes from local state *before* the request
and, unlike every sibling, never restores it; a toast alone would say "Failed to delete step" while the step is visibly
gone and still exists server-side. Two of these knowingly emit a toast on a path that already has an inline error — `savePipelineSchedule`'s dialog path
(`PipelineScheduleDialog.tsx:400`) and, already shipping, `createDashboard` — both recorded as tracked exceptions
resolved by HEL-771. The dialog case is milder than "the user sees both": `Modal` uses a native `<dialog>` +
`showModal()` (`Modal.tsx:103`), so while that dialog is open the toast viewport is painted below the top layer behind
`--app-overlay` (`Modal.css:62-65`), making the toast effectively invisible and inert — the header toggle is the only
real beneficiary of this entry. That toasts are unusable while any modal is open is a genuine system-level gap in the
toast surface, out of scope here and recorded as a follow-up at delivery. That trade is deliberate: a duplicate report is a safer interim
state than a silent failure, and this change's charter is that nothing announced today becomes unannounced.

**D6 — `AddSourceModal`: one action, one toast, one wording.** `finishCreate` gains a `{ toast: false }` option passed
by the two thunk call sites only (`:167`, `:184`), so each create emits exactly one toast; and its copy becomes
`Data source "<name>" created.` — `name` is already in scope — matching the listener copy exactly, which requires
renaming `createSqlSource`'s success from `"… connected."` to `"… created."`. This removes a *duplicate*, never a sole
announcement.

**D7 — Rewrite `toastListeners.ts` as two declarative tables.** `SUCCESS_TOASTS` (thunk → message or payload
formatter) and `ERROR_TOASTS` (thunk → fallback message), registered by two loops. Justified independently of the
deferred audit: the file is already 446 lines against `CONTRIBUTING.md:24`'s ~400-line threshold and D5 adds six
entries, so extending it by six more hand-written blocks is what that rule forbids. The self-contradicting header is
replaced by a comment recording that this change did not audit which thunks *should* toast — that is HEL-771 — so
absence from both tables means "unchanged by this change", not "deliberately silent".

## Risks / Trade-offs

- [D5 knowingly adds two toast+inline duplicates] → deliberate and tracked (HEL-771); the alternative is leaving a
  failure silent, which §7 forbids and which this change exists to fix.
- [D2 duplicates message text in the DOM] → mitigated by `aria-hidden` on the visible copy; the buttons stay reachable.
- [D7 rewrites a 446-line file] → the file-size rule requires it independently of the deferred audit, and round 3
  judged the tables "the right shape".
- [D1's exemption makes the cap a soft bound] → losing an Undo affordance is worse than a fourth toast; one site.

## Planner Notes

- Self-approved: D1's exemption and coalescing, D2's live-region architecture and `aria-hidden`, D4's decisions to keep
  20px and `--text-xs` rather than change them, D5's local-state restore alongside `deletePipelineStep`'s toast, and
  D7's rewrite.
- Human-decided: the narrowing itself (`narrow-to-surface`, after round 3's repeat findings); `include-metrics` for
  `deleteMetric`; and `PanelList.tsx` being out of bounds entirely (`keep-toast`, grant withdrawn — HEL-770).
- Scope fence honoured in full: `PanelList.tsx` is not touched at all, nor any loading branch, skeleton or render
  ladder. HEL-528's worktree, branch and ports were never accessed.
