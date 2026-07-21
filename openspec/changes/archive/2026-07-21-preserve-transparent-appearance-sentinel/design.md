## Context

`PanelDetailModal` seeds its editable appearance state from the panel, but the two color
fields are edited via `<input type="color">`, which can only hold a 6-digit hex. To make
those inputs displayable, the modal runs each stored value through `getColorInputValue`
(`frontend/src/theme/appearance.ts`), which returns the value only if it matches
`/^#[0-9a-f]{6}$/i` and otherwise substitutes a fallback hex:

- `PanelDetailModal.tsx:81` — `initialBackground = getColorInputValue(panel.appearance.background, panelAppearanceEditorFallback /* #1a1816 */)`
- `PanelDetailModal.tsx:85` — `initialColor = getColorInputValue(panel.appearance.color, panelTextEditorFallback /* #f2efe9 */)`

So a stored sentinel (`background: "transparent"`, `color: "inherit"`) becomes a fallback hex
in `background` / `color` state (lines 90–91). On save (`handleEditSubmit`, lines 203–208)
the payload is built directly from that state:

```
const appearancePayload = { background, color, transparency: ..., ...chart };
```

Since the appearance PATCH is a full replacement, the untouched sentinel is persisted as the
fallback hex — silent data loss. **Probe-confirmed root cause:** the sentinel→fallback
substitution needed for the color input is never reversed when the field is untouched.

## Goals / Non-Goals

**Goals:**
- On save, restore the original sentinel for a color field the user did not edit.
- Persist explicitly chosen hex colors unchanged.
- Guard the round-trip with a regression test (untouched sentinel stays sentinel; edited
  field persists as hex).

**Non-Goals:**
- Converting the appearance PATCH to partial/merge semantics (broader; noted follow-up).
- Changing sentinel resolution for rendering or the color-input control itself.
- Any backend/schema/contract change.

## Decisions

**Decision 1 — Store the raw appearance value in state; resolve to a display hex only at the
color input (adopted after design-gate review).** Seed `background` / `color` state with the
raw `panel.appearance` value (which may be the sentinel `"transparent"` / `"inherit"`), not the
pre-resolved fallback hex. Resolve to a display-safe hex only where the value is passed into
`<AppearanceEditor>`, e.g. `background={getColorInputValue(background, panelAppearanceEditorFallback)}`.
Because the native `<input type="color">` `onChange` only ever emits a valid 6-digit hex,
`setBackground` / `setColor` can be passed through **unwrapped**: an untouched field keeps its
raw sentinel in state; an edited field is overwritten with the chosen hex. `handleEditSubmit`
then builds the payload from `background` / `color` directly — no restore step, no comparison.

Rationale: this needs **zero new state**, and it is strictly more correct than the alternatives
because the state itself is unambiguous — untouched is *literally* `"transparent"`, edited is
*literally* the picked hex — so there is no value-collision edge to reason about. It also
matches the resolve-at-render idiom already used for these same sentinels in `appearance.ts`
(`resolveDashboardBackground`, `getDashboardBgContrastRatio`, `buildPanelSurface` all take the
raw sentinel and resolve only at the point of use, never pre-resolving into stored state).
`initialBackground` / `initialColor`, the `appearanceDirty` comparison, and `resetFormToPanel`
all hold/compare the raw value, so they keep working unchanged in meaning.

**Alternative considered — per-field `touched` boolean flags.** Add `backgroundTouched` /
`colorTouched`, wrap the setters to mark touched, and restore `panel.appearance.*` in the
payload when untouched. Correct, but adds two pieces of state and wrapped setters (which must
stay inline, contextually-typed arrows to satisfy `strictFunctionTypes`) to solve a problem the
raw-storage approach avoids entirely. Rejected as unnecessarily heavy.

**Alternative considered — value comparison against `initialBackground` / `initialColor`.**
Simplest in spirit, but a user who deliberately picks a hex equal to the display fallback would
read as "unchanged" and get the sentinel wrongly restored (visible in light theme, where
`"inherit"` resolves dark but `panelTextEditorFallback` is light `#f2efe9`). Rejected.

**Decision 2 — Keep the logic in `PanelDetailModal`, not `AppearanceEditor`.**
`AppearanceEditor` stays presentational; it receives an already-display-safe hex for the color
inputs and an unwrapped setter. No `AppearanceEditor` prop-signature change is required.

**Decision 3 — Panel-switch reset is already handled by remount; no new effect.** Panel
switching remounts the modal via `key={panel.id}` (`DesktopPanelGrid.tsx:299`,
`MobilePanelStack.tsx:133`, the HEL-307 fix), which re-runs every `useState(initial*)`
initializer with fresh raw values. There is no panel-sync `useEffect` to touch and none should
be added. Only `resetFormToPanel` (discard/cancel within the same open modal) re-seeds state,
and under raw storage it already re-seeds the raw sentinel correctly with no extra work.

## Risks / Trade-offs

- [Chart appearance / transparency are unaffected] → those fields have no sentinel; leave their
  payload construction as-is. Only `background` and `color` carry sentinels.
- [State no longer always holds a display-safe hex] → confirmed safe: the only consumers of
  `background` / `color` are the two color inputs (now resolved at the prop boundary) and the
  save payload; no live-preview path reads the draft state.
- [Transparency slider still full-replaces] → unchanged and correct; transparency is a number
  with no sentinel. No behavior change there.

## Planner Notes

Self-approved (no escalation): frontend-only, no new dependency, no contract change, scope
matches the ticket. Design-gate review (round 1) adopted the raw-storage approach over the
originally-proposed touched-flags, and corrected a false "panel-switch sync effect" reference
(switching is handled by the `key={panel.id}` remount). The broader "make appearance PATCH a
partial merge" question is recorded as an explicit non-goal per the ticket's minimal-fix guidance.
