## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Root cause claim** (design.md L1-22): confirmed against `PanelDetailModal.tsx`.
  - `initialBackground`/`initialColor` (lines 81-85) run the stored appearance through
    `getColorInputValue`, which substitutes the fallback hex whenever the stored value
    doesn't match `/^#[0-9a-f]{6}$/i` — i.e. whenever it's a sentinel (`appearance.ts:80-82`).
  - `handleEditSubmit`'s `appearancePayload` (lines 203-208) builds `background`/`color`
    directly from that already-resolved state, with no path back to the original sentinel.
  - Cited line numbers (81, 85, 136-145, 203-208) all match the actual file exactly. Root
    cause is real and probe-grounded, not hand-waved.

- **`defaultPanelAppearance` / sentinel values** (`appearance.ts:9-13`): confirmed
  `background: "transparent"`, `color: "inherit"` are the two sentinels in play, and that
  `transparency`/`chart` fields carry no sentinel (task 1.5's premise is correct).

- **AppearanceEditor contract** (`AppearanceEditor.tsx`): confirmed `background`/`setBackground`,
  `color`/`setColor` are opaque props (`string` / `Dispatch<SetStateAction<string>>`); the
  component is presentational and calls `onChange={(e) => setBackground(e.target.value)}`
  directly against the native color input. Design's claim that no `AppearanceEditor` prop
  changes are required is accurate.

- **"Panel-switch sync effect" claim** (design.md Decision 3, tasks.md 1.4/2.4): checked the
  full `PanelDetailModal.tsx` (417 lines) and `usePanelDetailModalLifecycle.ts` — there is
  **no `useEffect` that re-syncs form state to a changed `panel` prop**. Grepped and read the
  two call sites: `DesktopPanelGrid.tsx:293-302` and `MobilePanelStack.tsx:128-137` both render
  `<PanelDetailModal key={panel.id} .../>` with an explicit HEL-307 comment: *"key by panel id
  so a direct switch between panels remounts the modal subtree, re-seeding every
  `useState(initial*)` form field."* Panel-switch reset is handled today by React remounting
  the whole component (fresh `useState` initializers), not by an effect. This is a factual
  error in the design doc.

- **Whether a simpler fix than touched-flags exists**: traced how `background`/`color` state
  is used end-to-end (only into the two `<input type="color">`s via `AppearanceEditor` and
  into the save payload — no live-preview consumer in `PanelContent.tsx` reads this draft
  state, confirmed by grep). Nothing requires the state to always hold a display-safe hex.

### Verdict: REFUTE

### Change Requests

1. **Reconsider the fix strategy — a simpler, more-correct alternative to touched flags exists
   and isn't discussed.** Instead of adding `backgroundTouched`/`colorTouched` state (Decision
   1), store the **raw** appearance value (potentially `"transparent"`/`"inherit"`) in
   `background`/`color` state, and resolve to a display-safe hex only at the point it's passed
   into `<AppearanceEditor>` (e.g. `background={getColorInputValue(background, panelAppearanceEditorFallback)}`).
   Because the native color input's `onChange` only ever emits a valid hex, `setBackground`/
   `setColor` can be passed through unwrapped, and `handleEditSubmit`'s payload can use
   `background`/`color` directly — untouched stays the raw sentinel, touched becomes the real
   hex, with **zero new state**. `initialBackground`/`initialColor`, `appearanceDirty`, and
   `resetFormToPanel` would hold/compare the raw value instead of the resolved fallback.
   - This sidesteps Decision 1's own stated reason for rejecting value-comparison (the
     fallback-collision edge case): under raw storage there's no comparison at all — the state
     itself is unambiguous (still literally `"transparent"` vs. now literally a hex the user
     picked), so the collision Decision 1 worries about can't occur.
   - It also eliminates Decision 3 entirely (no touched flag to reset on panel-switch/discard
     beyond what `resetFormToPanel` already resets for every other field).
   - It matches the existing resolve-at-render idiom already used for these same sentinels
     elsewhere in `appearance.ts` (`resolveDashboardBackground`, `getDashboardBgContrastRatio`,
     `buildPanelSurface` all take the raw sentinel and resolve only at the point of use, never
     pre-resolving into stored/editable state).
   - Revise design.md's Decisions 1–3 to evaluate this alternative and either adopt it or give
     a concrete reason (beyond what's currently written) why touched-flags are still preferred.

2. **Decision 3 / tasks 1.4 / 2.4 reference a "panel-switch sync effect" that does not exist**,
   per the evidence above. `PanelDetailModal` has no such effect; panel-switch reset is already
   handled for free by the `key={panel.id}` remount added in HEL-307
   (`DesktopPanelGrid.tsx:299`, `MobilePanelStack.tsx:133`). Revise:
   - Decision 3 to correctly state that only `resetFormToPanel` (discard/cancel within the same
     open modal) needs an explicit touched-flag reset; panel-switch is already covered by the
     remount and needs no new code.
   - Task 1.4 to drop the "panel-switch sync effect" language (nothing to modify there).
   - Task 2.4 to specify that a regression test asserting "no stale touched state survives a
     panel switch" must mount `PanelDetailModal` with a changing `key` (mirroring the real
     parent usage), not merely re-render the same instance with a new `panel` prop — otherwise
     the test doesn't exercise the actual reset mechanism (remounting) and either passes
     trivially or pressures the implementer into adding an unneeded/incorrect prop-sync effect
     just to satisfy it.
   - If Change Request 1 is adopted, this whole concern becomes moot and item 2 can be dropped
     along with Decision 3.

### Non-blocking notes

- If the touched-flag design is kept despite (1), tasks.md should note that the wrapped
  `setBackground`/`setColor` must remain inline, contextually-typed arrow functions passed
  directly as the JSX prop value (not separately-declared `(value: string) => void` closures)
  to type-check against `AppearanceEditor`'s `Dispatch<SetStateAction<string>>` prop signature
  under `strictFunctionTypes`.
- Spec delta and ticket ACs otherwise line up well (untouched-stays-sentinel, explicit-stays-hex,
  regression test) and require no changes.
