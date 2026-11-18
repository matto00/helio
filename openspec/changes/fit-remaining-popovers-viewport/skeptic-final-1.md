## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: cfe3a9540fc3d9b593f5dad10d47d616905ed00c. Base resolved live with `resolve-review-base.sh`: 36735a24aef1 (main/origin).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1756/evidence/.concertino/scratch/HEL-1756/skeptic/` (referred to as `EV/` below).
Every probe ran in my own Playwright process on port 7188. Every logged record carries `port: "7188"`, so C6 holds. I did not use the shared MCP browser.

### What I verified (with evidence)

**Diff read in full.** The diff covers:
- `usePortalPopover.ts`: `run` is extracted into a stable `reposition`, which is also exported.
- `DashboardAppearanceEditor.tsx`:
  - measured `place` via `fitPanelVertically`;
  - `panelRef` on the form;
  - an uncapped inner wrapper observed by a ResizeObserver;
  - hidden until placed;
  - the D14 focus layout effect.
- `ProvenanceTrigger.tsx` and `ProvenancePopover.tsx`: measured `place` with a 70vh/480 cap, the hook `panelRef` merged with the local ref, an inner wrapper with a ResizeObserver, and focus gated on `placed`.
- CSS: the column/gap moved to `.provenance-popover__inner`, plus a new scoped `.dashboard-appearance-editor__panel { overflow-y: auto }`.
- E2E: the new hel1756 spec and the hel1750 last-row guard.

UserMenu and its files are untouched; the diff has none of them.

**AC 1: probe each popover; convert the ones that can clip; each fix has a red-first `elementFromPoint` e2e.**
- **UserMenu:** probes.md has numbers at 1280x400/320 and 390x500/400. It is left unchanged, with the reason stated (158px menu).
- **Appearance editor:** it grows past the viewport after the contrast warning. Independently re-measured (`EV/probe.txt`, `ED-GEO`):
  - At 1280x320 the form is capped to 94.5-312 (scrollHeight 339, clientHeight 216).
  - At 1280x400 it is 94.5-392, so it is inside the viewport and scrolls.
  - Light and dark are identical.
  - Screenshots: `EV/editor-320-dark-warning.png` and `EV/editor-320-light-warning.png`.
  - On phone it is `display: none` (App.css:477), so phone is moot. This is confirmed.
- **Provenance:** re-measured with the middle card at 1280x400, 1280x320, 390x400 and 390x700 (`PROV` lines):
  - The panel is always inside the viewport, between 8px and innerHeight - 8.
  - Focus is inside the panel.
  - Six Tabs keep it open (`PROV-TAB open=1`) in both themes.
  - Screenshots: `EV/prov-desk400-light.png` and `EV/prov-phone400-dark.png`.
- Both converted popovers' e2e tests use `elementFromPoint` on the last section or control (spec lines 51 and 253).

**AC 2: rail guard on the last row, scrolled to its end, with the mutation recorded.**
- I reproduced the red independently, without editing source: I injected `.dashboard-list { position: static !important }` right after `seedRail`. This is the same effect as the recorded mutation (removing `position: relative`).
- Both themes failed at the **row-shift assertion itself**: `{"beforeBox":{"y":214},"afterBox":{"y":248}}  Expected <= 1  Received 34` (`EV/red-rail-mut.txt`).
- This matches red-evidence.md section 4. The guard is green without the injection.
- The temporary spec copy was deleted, and `git status` is clean for `e2e/`.

**Gates (fresh, in WORKTREE_PATH):**
- `npm run lint` (frontend) and `npm run typecheck`: clean.
- Prettier check on `src`: clean.
- Targeted jest (DashboardAppearanceEditor, Provenance, usePortalPopover, panelFit, ActionsMenu, UserMenu; maxWorkers 3): 20/20 suites, 140/140 tests.
- Both e2e specs, hel1756 and hel1750, with 2 workers: **24 passed** (`EV/e2e.txt`).
- I relied on evaluation-3's pasted full-suite result (799/799 frontend suites) for the untouched remainder.

**D14 (editor focus-on-open), proven in a real browser (C9):**
- Keyboard open: Enter on the trigger puts focus on `BUTTON:Default` inside the form (`KBD-OPEN`, both themes).
- Fifteen Tabs reach Save with the form open and focus inside it (`KBD-AT-SAVE tabs=15`).
- Mouse open: focus is also moved to Default, but `:focus-visible` is false, so no ring is painted (`ED-MOUSE fv=false`). The orange outline on Default in `EV/editor-900-dark-open.png` is the existing `.appearance-preset--selected` style, not a focus ring.
- The effect is keyed on `isOpen && placed`. `reposition()` re-sets `placed` to the same value, so it does not steal focus again on re-fit.
- I did not re-run the d4969e8d9 red myself. The recorded `red-editor-kbd.txt` shows `Expected: true Received: false`. The mechanism is directly readable from the code: with no focus effect, focus stays on the trigger, Tab moves to the next page element, and the hook's focusout handler sees that `relatedTarget` is outside both trigger and panel, so it closes. Evaluation-2 measured that close independently.

**Visual judgment (light/dark, desktop/phone):**
- Both popovers keep their existing chrome: `.popover__panel` and the token-based CSS. The only CSS change is moving the provenance column/gap onto an inner wrapper, which renders identically.
- Capped states scroll inside the panel, the same pattern HEL-1750 uses for ActionsMenu.
- Flipped provenance sits 8px from the viewport edge, keeps the 8px trigger gap, and keeps the horizontal 8px margins.
- No hardcoded values: `TRIGGER_GAP` and `VIEWPORT_MARGIN` are named constants, and the cap mirrors the CSS `min(70vh, 480px)`.
- Light and dark are visually at parity.
- No off-pattern UI.

**Evaluation-3's non-blocking note (failed save via the keyboard).** I measured it myself (`KBD-AFTER-FAIL`, `KBD-AFTER-FAIL-TAB`, both themes):
- After a failed save, focus is on `<body>` and the editor is open.
- The **next Tab does not close it**: still `open: true`, focus on body.
- The non-error path behaves identically. Tab past Save (`KBD-PAST-SAVE`) also leaves the editor open with focus on body, because the form is the last thing in `<body>` and the focusout has a null `relatedTarget`.
- The editor closes, and the draft resets, only once focus later lands on a real page element outside it. That is the shared hook's designed focus-out close: opt-in via `panelRef`, the same as ActionsMenu and Select, and recorded as an intended behavior change in probes.md (D3/D14).
- So the failed-save case is not a distinct defect introduced here. It reduces to "tabbing out of the editor closes it", which the design accepts.
- The pre-existing part is Save being `disabled` while saving, which drops focus to body.
- Verdict on the note: **acceptable follow-up, not a ship blocker.** My measurement corrects evaluation-3's "the next Tab now closes the editor": the close happens only when focus reaches a page control.

### Verdict: CONFIRM

### Non-blocking notes
- Follow-up suggestion, same as evaluation-3: after a failed save, return focus to Save or to the error (or use `aria-disabled` while saving), so a keyboard user does not drop to `<body>`.
- A capped editor or provenance panel shows no scroll affordance beyond the cut-off content. This matches HEL-1750's ActionsMenu and is acceptable. A shared fade or scroll-shadow would be a cross-popover polish ticket, not part of this change.
- Evidence-dir mtimes: none of my conclusions rest on mtime ordering. Every cited artifact is a content log or a screenshot.
