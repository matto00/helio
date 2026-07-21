## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Round-1 Change Request 1 (fix strategy) adopted correctly.** design.md Decision 1 now
  specifies raw-storage: seed `background`/`color` state from the raw
  `panel.appearance.background`/`.color`, resolve to a display hex only at the
  `<AppearanceEditor>` prop boundary via `getColorInputValue`, pass `setBackground`/`setColor`
  unwrapped, and build the save payload directly from state. Verified against the current
  (pre-fix) code:
  - `PanelDetailModal.tsx:81-85` — `initialBackground`/`initialColor` currently call
    `getColorInputValue(...)` (the bug); the plan is to seed these raw instead.
  - `PanelDetailModal.tsx:136-140` (`resetFormToPanel`) — same `getColorInputValue` call to
    replace with the raw value, confirming task 1.4's target is real and correctly scoped.
  - `PanelDetailModal.tsx:203-208` (`handleEditSubmit`) — `appearancePayload` already builds
    directly from `background`/`color` state with no restore step; under raw storage this
    needs **zero changes** to become correct, exactly as the design claims.
  - `AppearanceEditor.tsx:11-14` — `background`/`setBackground`, `color`/`setColor` are typed
    plain `string` / `Dispatch<SetStateAction<string>>`, and the native `<input type="color">`
    (`AppearanceEditor.tsx:59-65,66-74`) calls `setBackground(e.target.value)` /
    `setColor(e.target.value)` directly on `onChange` — always a valid hex from the browser's
    color picker. Passing these setters through unwrapped is legitimate: an edited field is
    overwritten with a real hex, an untouched field is never called and keeps its raw seed.
  - `panel.ts:46-47` — `PanelAppearance.background`/`.color` are plain `string` (no narrow
    union), so storing the raw sentinel string in `useState<string>` requires no type changes.
  - `appearance.ts:9-13,80-82` — confirmed `defaultPanelAppearance` sentinels
    (`"transparent"`/`"inherit"`) and `getColorInputValue`'s regex-fallback behavior are exactly
    as described.
  - Confirmed no other consumer of the draft `background`/`color` state requires a resolved
    hex: read the full `PanelDetailModal.tsx` return JSX — view mode renders `<PanelContent
    panel={panel} .../>` from the original `panel` prop (not draft state); edit mode's only
    consumer of `background`/`color` is `<AppearanceEditor>` (resolved at that boundary) and
    the save payload. No live-preview path breaks under raw storage.

- **Round-1 Change Request 2 (bogus "panel-switch sync effect") corrected.** Decision 3 now
  correctly attributes panel-switch reset to the `key={panel.id}`-style remount, not a
  sync effect, and confirmed there is no such effect:
  - Read the full `PanelDetailModal.tsx` (417 lines) — no `useEffect` re-syncing state to a
    changed `panel` prop. `usePanelDetailModalLifecycle.ts` — grepped for
    `background|color|appearance`, no matches; it doesn't touch appearance state either.
  - `DesktopPanelGrid.tsx:292-302` — `<PanelDetailModal key={detailPanelId} .../>` with the
    HEL-307 comment matching the design's description almost verbatim (minor naming nit:
    design.md says `key={panel.id}`; actual code is `key={detailPanelId}` /
    `key={detailPanel.id}` — same mechanism, cosmetic mismatch only, not a defect).
    `MobilePanelStack.tsx:128-136` — same pattern.
  - Found a **pre-existing** `PanelDetailModal.panelSwitch.test.tsx` (HEL-307 regression) that
    already drives the real `MobilePanelStack` call site through a direct A→B panel switch and
    asserts B's fields (including `"Panel B background color"`) are correctly re-seeded and
    that Save never carries A's staged values onto B. This test exists independent of this
    change and further corroborates that the remount mechanism is real, tested, and already
    covers what tasks.md 2.4 asks for — a keyed remount, not a re-render of the same instance.
  - tasks.md 2.4 now correctly specifies "mount with a changing `key`, mirroring the real
    parent usage, not a re-render of the same instance" — addresses the round-1 concern.

- **Existing tests won't conflict with the fix.** Grepped `PanelDetailModal.test.tsx` and all
  sibling `PanelDetailModal.*.test.tsx` files for `background`/fallback-hex assertions — every
  fixture already seeds `appearance: { background: "transparent", color: "inherit", ... }`,
  and no existing test asserts the current buggy fallback-hex payload. Nothing needs updating
  besides the two files task 1 targets.

- **Spec delta.** `specs/panel-appearance-settings/spec.md` (ADDED requirement) matches the
  existing spec's format/style (MUST/SHALL language, GIVEN/WHEN/THEN scenarios) seen in
  `openspec/specs/panel-appearance-settings/spec.md`. The three scenarios (untouched
  transparent stays transparent, untouched inherit stays inherit, explicit color persists as
  hex) map 1:1 onto the ticket's three ACs and tasks 2.1-2.3.

- **Scope.** Non-goals (no PATCH-partial/merge conversion, no AppearanceEditor prop-signature
  change, no backend/schema change) match ticket.md's explicit scope guidance and are honored
  by the plan — no scope drift.

### Verdict: CONFIRM

### Non-blocking notes

- design.md Decision 3 and DesktopPanelGrid.tsx's actual variable name differ cosmetically
  (`key={panel.id}` in prose vs. `key={detailPanelId}` in code) — purely a citation nit, not
  a design defect; no action needed.
- Worth having the implementer note in the PR description (not required in tasks.md) that the
  pre-existing `PanelDetailModal.panelSwitch.test.tsx` continues to pass unmodified under raw
  storage, as an extra confirmation that Decision 3's "no new effect" claim holds after the
  change lands.
