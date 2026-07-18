## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Both call sites lack a `key` prop, exactly as claimed.**
  - `frontend/src/features/panels/ui/DesktopPanelGrid.tsx:285-290`: `{detailPanelId !== null ? (<PanelDetailModal panel={panels.find((p) => p.id === detailPanelId)!} onClose={...} />) : null}` — no `key`. Matches design.md's citation exactly.
  - `frontend/src/features/panels/ui/MobilePanelStack.tsx:128-130`: `{detailPanel ? (<PanelDetailModal panel={detailPanel} onClose={...} />) : null}` — no `key`. Matches design.md's citation exactly.
  - Grepped the whole frontend for `<PanelDetailModal` — confirmed these are the only two production render sites (rest are test harnesses).

- **`useState(initial*)` seeding is real and pervasive, and nothing resyncs it on `panel` identity change.**
  - `PanelDetailModal.tsx:83-89`: `title`, `background`, `color`, `transparency`, `chartAppearance` are all seeded via `useState(initial*)` derived from `panel` — confirmed at the cited lines.
  - Read every subtype editor (`BindingEditor`, `MarkdownEditor`, `ImageEditor`, `CollectionEditor`, `DividerEditor`, `TextContentEditor`) — all seed their local state the same way (`useState(initialTypeId)`, etc.), and their `useEffect`s only (a) fetch data types on idle, or (b) report dirty state upward via `onDirtyChange` — none react to `panel`/`initial*` changing to reset state. Confirmed by reading each file's `useEffect` blocks directly.
  - `useBoundOrLiteralState.ts:38-40`: same `useState(initial*)` pattern, no resync effect — only an imperative `reset()` invoked by the parent's `resetFormToPanel`, which itself is never called on a panel-identity change (only on explicit cancel/discard).
  - `usePanelDetailModalLifecycle.ts:51-53`: `showModal()` fires in a `useEffect(..., [])` — mount-only, confirmed. Nothing else in that hook resets form state on prop change.

- **The corruption path is real, not speculative.** `handleEditSubmit` (`PanelDetailModal.tsx:189-207`) dispatches `accumulatePanelUpdate({ panelId: panel.id, fields: { appearance: appearancePayload, ...(title changed) } })` — `panel.id` is the *current* prop (B, since React re-renders with the new panel object even without remounting), but `background`/`color`/`transparency`/`title`/`chartAppearance` are stale local state from A (per the previous bullet). So a save in the stale-render window genuinely writes A's staged appearance/title onto B's id. Checked `panelsSlice.ts:55-69` — `accumulatePanelUpdate` keys `pendingPanelUpdates` and `state.items` writes by the payload's `panelId`, so there's no additional cross-panel leak path beyond the one already identified; the reducer itself is correctly keyed.

- **The proposed fix (`key={panel.id}` at both call sites) is a structurally sound, idiomatic React fix** for identity-keyed state — remounting resets every `useState` seed, the mount-only `showModal()` effect, and imperative-handle-backed editor state in one move, without per-field patching. The rejected alternatives (per-field `useEffect` resync, guarding `handleEditSubmit` with a captured id) are correctly identified as incomplete (leaves stale display, or requires touching every editor).

- **AC traceability**: all 3 ticket ACs map to design decisions + spec scenarios + explicit tasks (display correctness → Decision 1 + task 2; no cross-panel save → Decision 1 + task 3.2; regression test → tasks 3.1-3.3). No AC is left uncovered, no task exceeds ticket scope (CSS/HEL-309 explicitly excluded as a non-goal, consistent with the ticket's briefing).

- **No placeholders/hand-waving found** — task 2.3 ("audit every field") is a concrete, testable inspection task with a clear completion signal (no module/Redux-cached form state found, or fix+note if found), not a deferred decision.

- Read `workflow-state.md` — confirms this is round 1, no prior skeptic verdict to reconcile against.

### Verdict: CONFIRM

### Non-blocking notes

- Design.md doesn't call out one interaction I noticed while reading `PanelDetailModal.tsx`: `chartAppearance`'s `initialChart` is derived via `useMemo(() => buildInitialChart(panel), [panel])`, which *does* recompute on panel-prop change today (unlike the `useState` seeds) — so pre-fix, `appearanceDirty`'s chart comparison could spuriously flip to `true` on a direct switch even before any edit. This is a symptom of the same root cause and will be resolved by the same keyed-remount fix; no action needed, just worth the executor being aware it's in scope for the audit (task 2.3) rather than a surprise.
