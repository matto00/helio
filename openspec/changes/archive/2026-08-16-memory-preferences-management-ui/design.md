## Context

HEL-525 (420-D) is the fourth ticket of the Agent Memory & Preferences epic (HEL-420). Its two
backend dependencies (420-A `AgentPreferences`, 420-B `AgentMemoryEntry`) are merged and already
wired into agent grounding (420-C/HEL-521, merged) — this ticket adds the human-facing surface
over the same two existing endpoints (`GET/PUT /api/preferences`, `GET/POST/DELETE
/api/agent/memory[/:id]`). This is the app's **first** settings/profile surface — there is no
existing `settings` feature folder, `/settings` route, or comparable page to extend; every
convention below is chosen from the closest existing analogues, not an existing settings pattern
(none exists yet).

Precedents checked directly (not assumed): `frontend/src/features/pipelines/{services,state,ui}`
(service/slice/UI shape, cited by the ticket itself), `frontend/src/features/metrics/ui/
MetricsPage.tsx` + `MetricListTable.tsx` (page-shell loading/empty/error convention and the
current **inline delete-confirm** pattern), `frontend/src/features/auth/ui/UserMenu.tsx` (the
existing account-scoped dropdown — theme/accent/sign-out — the natural home for a new "Settings"
entry), `frontend/src/app/App.tsx` (route table shape), `frontend/src/store/store.ts` (slice
registration), `DESIGN.md` (styling/token rules), and the backend wire DTOs directly
(`AgentPreferencesProtocol.scala`, `AgentMemoryProtocol.scala`).

## Goals / Non-Goals

**Goals:**
- View and edit preferences, persisted across reloads (AC1).
- View, individually delete, and clear-all agent-memory entries, with confirmation (AC2).
- Follow `DESIGN.md` and pass lint/format cleanly (AC3); Jest coverage for slice + key components
  (AC4); fully typed network calls, no unjustified `any` (AC5).

**Non-Goals:**
- The privacy opt-out toggle + retention policy (420-E/HEL-531) — this ticket is view/edit/clear
  only, no policy controls.
- Creating new memory entries by hand — the ticket's own acceptance criteria list only
  view/delete/clear-all for memory; entries are agent-authored, not user-authored, in this
  ticket's scope. (No backend gap either way — `POST /api/agent/memory` already exists for a
  later ticket to expose if ever needed.)
- Any backend change — both endpoints already exist and are unmodified by this ticket.

## Decisions

**Decision 1 — one new `settings` feature folder, one slice, reached via `UserMenu`, not the main
sidebar.** Mirrors the ticket's own "a `preferences`/`agentMemory` service" (one service file) /
"a Redux slice" (singular) framing: `settingsSlice.ts` holds both preferences and agent-memory
state as two sibling sub-trees, not two separate slices — avoids the ceremony of a second slice
for what is, structurally, one page's state. Reached from `UserMenu.tsx` (a new "Settings" menu
item, `role="menuitem"`, matching the existing theme/sign-out items' shape) rather than the
primary left-nav sidebar (`SidebarItemList.tsx`) — settings is an account-scoped concern, the same
category as theme/accent/sign-out already in that menu, not a workspace-content concern like
Sources/Pipelines/Metrics.

**Decision 2 — `defaultPanelStyle` gets concrete field editors (background/color/transparency);
`namingConventions` gets a generic, string-values-only key/value editor with non-string rows
preserved verbatim.** `defaultPanelStyle` has named example fields directly in HEL-472's own
ticket text ("background/color/transparency defaults mirroring `PanelAppearance`") — building real
color-input/range-slider controls for those three fields is well-grounded, not invented.
`namingConventions` has no concrete sub-fields defined anywhere in the codebase (HEL-472's ticket
text offers only an illustrative, non-binding example — "e.g. dashboard/panel title casing" — and
nothing in 420-A/420-B/420-C ever gives it a fixed shape), and `schemas/agent-preferences.schema.json`
types it as a genuinely unconstrained JSON object (the backend's own test suites round-trip
non-string values there, e.g. `{"titleCase": true}`) — a generic rows editor is the honest,
forward-compatible choice, but it is explicitly **string-values-only**: the editor lists and edits
only the keys whose fetched value is a JSON string; any key whose fetched value is not a string
(boolean/number/array/nested object) is never rendered as an editable row and is instead carried
through untouched on save, via the same overlay mechanism Decision 4 uses for
`defaultPanelStyle`'s unexposed keys — never silently coerced to a string. Both editors, and the
color-swatch list for `defaultSeriesColors`, are small, standalone components under `ui/` — not a
reuse of `panels/ui/editors/AppearanceEditor.tsx`, which is tightly coupled to `PanelDetailModal`'s
own state shape (panel title, `ChartAppearance`) and not meaningfully extractable for a bare
`{background, color, transparency}` triple with no panel behind it.

**Decision 3 — explicit "Save preferences" action, not auto-save.** Matches the existing
form-editing precedent (`PanelDetailModal`'s dirty-state + explicit save, not per-keystroke
persistence like `PanelGrid`'s debounced layout writes, which is for a fundamentally different,
continuously-dragged interaction). Simpler to reason about and test than a debounce; the ticket's
AC only requires reload-persistence, not any particular save cadence.

**Decision 4 — read-modify-write: `extras`, any editor-unexposed keys in `defaultPanelStyle`, and
any non-string-valued (or otherwise editor-unexposed) keys in `namingConventions` are all
preserved verbatim on save, never dropped or coerced.** `PUT /api/preferences` is a full replace
at the backend (420-A `AgentPreferencesService.put`'s own doc comment: "An absent
`defaultSeriesColors`/`defaultPanelStyle`/`namingConventions` key decodes to `None` ... clearing
any previously-stored value"; `AgentPreferencesServiceSpec.scala` has a test literally named "is a
full replace: a second put omitting a previously-set field clears it, not a merge") — the frontend
must therefore round-trip whatever it fetched that it doesn't have a control for, across all three
object-shaped fields uniformly, or a save would silently wipe or corrupt content some other,
future client wrote (`extras` entirely; `defaultPanelStyle` keys beyond background/color/
transparency; `namingConventions` keys whose value isn't a string, per Decision 2). `settingsSlice`'s
preferences form state keeps the full fetched `AgentPreferences` object and only overlays the
fields this UI actually edits before `PUT` — for `defaultPanelStyle`/`namingConventions`
specifically, this means a shallow merge of the edited/recognized keys over the fetched object,
not a wholesale replacement of either object.

**Decision 5 — memory-entry delete and "clear all" both use the established inline-confirm
pattern, never `window.confirm`.** Confirmed directly: `MetricListTable.tsx`'s own header comment
states `window.confirm` was deliberately removed from every delete flow in this codebase
(`PipelineDetailPage.tsx`'s inline discard-confirm is the other precedent). `AgentMemoryList.tsx`
mirrors `MetricListTable.tsx`'s per-row `confirmDeleteId` + Confirm/Cancel button pair exactly;
"Clear all" gets the same two-step confirm/cancel shape at the list-section level (a single
non-per-row instance of the same interaction, not a new pattern).

## Risks / Trade-offs

- [Risk] `namingConventions`' generic key/value editor can't validate structure a future consumer
  might expect (unlike `defaultPanelStyle`'s concrete fields). → Mitigation: no consumer of
  `namingConventions` exists anywhere yet (420-C's grounding renders `AgentPreferences` generically
  without inspecting `namingConventions`' internal shape) — a generic editor is strictly more
  correct than guessing a shape prematurely; a later ticket can add structure once a real consumer
  defines one.
- [Risk] This is the first settings surface — there's no existing settings page to keep visual
  consistency with, only cross-feature analogues. → Mitigation: every UI decision above is tied to
  a specific, cited existing pattern (page-shell, confirm affordance, menu-item shape) rather than
  invented from scratch; `DESIGN.md`'s tokens/spacing rules apply uniformly regardless of feature.
