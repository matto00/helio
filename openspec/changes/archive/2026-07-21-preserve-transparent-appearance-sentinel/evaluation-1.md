## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All three ticket ACs addressed explicitly and match the 3 corresponding spec-delta scenarios and the 4 regression tests (untouched `"transparent"` stays transparent; untouched `"inherit"` stays inherit; explicitly-picked color persists as hex; plus an added panel-switch-remount scenario, task 2.4, which is a superset/no-reinterpretation of the ACs, not a substitute).
- No AC silently reinterpreted. The fix matches the adopted design.md Decision 1 exactly: `initialBackground`/`initialColor`/`background`/`color` now seed from the raw `panel.appearance.*` value; resolution to a display-safe hex moved to the `<AppearanceEditor>` prop boundary (`getColorInputValue(background, panelAppearanceEditorFallback)` / `getColorInputValue(color, panelTextEditorFallback)`); `resetFormToPanel` re-seeds raw values; `handleEditSubmit` builds `appearancePayload` directly from `background`/`color` state — no restore step, no touched-flags, matching Decision 1/2/3 verbatim.
- All 5 tasks.md items under section 1 and all 5 under section 2 are marked done and correspond 1:1 to the diff and the test file's four `it(...)` blocks.
- No scope creep: `git diff main...HEAD --stat -- frontend backend schemas openspec/specs` touches exactly the two files named in `files-modified.md` (`PanelDetailModal.tsx`, new `PanelDetailModal.appearanceSentinel.test.tsx`). No backend/schema/contract changes, consistent with the explicit non-goals.
- No regressions to `transparency`/`chart` payload construction — confirmed unchanged in the diff (design.md Risk 1 confirmed).
- No API contract/schema changes needed or made (frontend-only bug, `check:schemas` still passes — see Phase 2 gates).
- Planning artifacts (proposal/design/tasks/spec delta) accurately reflect the final implementation; no drift.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md mechanical rules**: no inline FQNs introduced (N/A — TS/frontend, rule scoped to Scala's `check:scala-quality`). File-size soft budget: `PanelDetailModal.tsx` was already at 416 lines pre-change (over the ~400-line "propose a split" threshold) and is now 420 lines post-change (+4, all comment/doc lines explaining the raw-storage invariant — no new logic added). This is explicitly an "informational only" budget per CONTRIBUTING.md:123, not a lint-enforced mechanical rule, so it does not fail Phase 2 — flagged as a non-blocking suggestion below since the executor didn't call out the pre-existing overage.
- **DESIGN.md**: no visual/markup change in this diff (no new tokens, spacing, or components), so DESIGN.md mechanical rules are not implicated.
- **DRY**: reuses the existing `getColorInputValue`, `panelAppearanceEditorFallback`, `panelTextEditorFallback` helpers and existing test utilities (`renderWithStore`, `makeMarkdownPanel`) — no duplication introduced.
- **Readable**: the added block comment (`PanelDetailModal.tsx:80-86`) clearly documents the raw-vs-display-hex invariant at the point future maintainers would need it; naming unchanged and still accurate (`initialBackground`/`initialColor` genuinely hold the initial *raw* value now).
- **Modular**: no new abstractions; `AppearanceEditor` remains purely presentational (receives an already-resolved hex + unwrapped setter), matching design.md Decision 2 — confirmed via `AppearanceEditor.tsx:11-14` (`background: string`, `setBackground: Dispatch<SetStateAction<string>>`, unchanged signature).
- **Type safety**: `PanelAppearance.background`/`.color` are `string` (`panel.ts:46-47`); no `any`, no unsafe casts introduced.
- **Security**: N/A — client-side UI state only, no new input boundary; `getColorInputValue`'s regex validation (`/^#[0-9a-f]{6}$/i`) is unchanged and still the only place a raw value is trusted into a native color input.
- **Error handling**: N/A — no new failure path introduced.
- **Tests meaningful and round-trip logic sound**: verified independently (not just trusting files-modified.md's claim) by running the 4 new tests against the diff — all pass. Root-cause probe cited in files-modified.md (`getColorInputValue("transparent", "#1a1816")` → fallback) is consistent with the actual `getColorInputValue` implementation at `appearance.ts:80-82`. The tests exercise: (a) untouched sentinel-background round-trip via Redux `pendingPanelUpdates`, (b) untouched sentinel-color round-trip, (c) edited-color persists as hex not sentinel, (d) `key`-driven remount across two panels confirms no cross-panel state leakage — this directly guards Decision 3 (remount-handles-reset, no new effect). Assertions read real Redux store state post-save (`store.getState().panels.pendingPanelUpdates[...]`), not component-internal state, so they'd genuinely catch a regression in the real save payload.
- **No dead code**: no unused imports/leftover TODOs in the diff.
- **No over-engineering**: no touched-flag state added, matching the rejected alternative in design.md — the simpler unwrapped-setter/raw-storage approach was correctly implemented as designed.
- **Behavior-preserving where expected**: `appearanceDirty` comparison (`PanelDetailModal.tsx:131-136`) still compares `background !== initialBackground` / `color !== initialColor` — both sides are now raw values instead of both being resolved hex, so the comparison's truth value is unchanged in meaning (design.md's claim that this "keeps working unchanged in meaning" holds up under inspection).

### Phase 3: UI Review — N/A (justified)
This is a state/serialization-only fix with no markup, styling, or visual change (confirmed via diff — no JSX/CSS touched, only state-seeding and payload-construction logic). Per the orchestrator's explicit brief, a Playwright pass was optional for this ticket; the diff was independently confirmed to have zero effect on rendered output (the `<input type="color">` still receives a resolved hex via `getColorInputValue` at the same call site, just later than before), so no dev-server pass was run. The 4 regression tests exercise the actual DOM (`fireEvent`, `screen.getByLabelText`) through `@testing-library/react`, which substitutes for a manual browser check of the same flow.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PanelDetailModal.tsx` was already over the ~400-line soft budget before this change (416 → 420 lines). Not a regression caused by this ticket and not lint-enforced, but since the fix touches this file, a future ticket could take the opportunity to extract the appearance-state block (title/background/color/transparency/chart state + `resetFormToPanel` + `appearanceDirty`) into a hook, shrinking the file back under budget.
