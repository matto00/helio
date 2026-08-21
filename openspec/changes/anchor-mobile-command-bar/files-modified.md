## Files modified — HEL-772

- `frontend/src/theme/theme.css` — top-chrome seam tokens (`--app-safe-top`,
  `--app-command-bar-height`, `--app-top-chrome-height`) and their `:root`-targeted
  `max-width: 768px` override (56px mobile); migrated the `html`/`body`/`#root` sizing
  chain off `min-height: 100%` onto `100vh`-then-`100dvh`; dropped `body`'s now-redundant
  `min-height: 100vh`.
- `frontend/src/theme/theme.css.test.ts` — **new**. CSS-lock for the seam tokens, the
  `:root`-scoped mobile override (and that it is NOT re-declared on `.app-command-bar`),
  and the ancestor sizing-chain migration.
- `frontend/src/app/App.css` — `.app-shell` takes `100vh` then `100dvh`; base
  `.app-command-bar` derives `height` from `--app-top-chrome-height` and claims
  `padding-top: var(--app-safe-top)`, with all padding as longhands; mobile block drops
  the HEL-745 `height: var(--space-10)` override entirely (height now comes only from the
  seam) and rewrites its stale comment; mobile block adds `min-height: 44px` to the
  unpainted `.app-command-bar__mobile-title`/`.app-command-bar__logo`; adds a
  `.app-command-bar`-scoped override that floors `.ui-icon-btn` back to
  `var(--control-sm)` (28px) plus a sized 44×44px `::after` hit expander; widens
  `.app-command-bar__right`'s gap to `var(--space-4)` so hit regions abut instead of
  overlapping; `.app-skip-link:focus-visible`'s `top` now clears `--app-safe-top`. Did
  **not** touch `App.css:424`'s `.app-content` bottom-clearance rule or any `BottomNav.*`
  file (HEL-774's fence).
- `frontend/src/app/App.css.test.ts` — replaced the stale HEL-745 `var(--space-10)` lock
  with the seam-derivation, longhand-padding, no-mobile-height, inert-cascade-ordering,
  `.app-shell` dvh, tap-target (`min-height: 44px`, scoped `.ui-icon-btn`, `::after`,
  `--space-4` gap) locks described above.
- `frontend/src/features/auth/ui/UserMenu.css` — `.user-menu__trigger` gets
  `position: relative`; its existing `<=768px` block adds a sized 44×44px `::after` hit
  expander so the 28px painted avatar box doesn't grow.
- `frontend/src/features/auth/ui/UserMenu.css.test.ts` — **new**. Locks
  `position: relative` + the 44×44px `::after` on the trigger inside the file's existing
  `<=768px` block, without disturbing the pre-existing `.user-menu__item` 44px lock.
- `frontend/index.html` — `apple-mobile-web-app-status-bar-style` -> `black-translucent`
  (`viewport-fit=cover` and both `theme-color` entries left unchanged).
- `frontend/src/features/panels/ui/PanelDetailModal.mobile.css` — `<=430px` full-screen
  block claims the top inset on the modal's own header, scoped to the compound
  `panel-detail-modal(--view)` selector so it doesn't pad every modal. **Cycle 2 fix**:
  originally a bare `padding-top: var(--app-safe-top)`, which overrode `Modal.css:116`'s
  `padding: var(--space-4) var(--space-5)` outright and dropped the header's 16px top
  padding to 0px wherever the browser reports no inset (evaluator cycle-1 finding). Now
  additive: `padding-top: calc(var(--app-safe-top) + var(--space-4))`, matching the idiom
  already used correctly at `RefinementChatDrawer.css` and `App.css`'s skip-link.
- `frontend/src/features/panels/ui/PanelDetailModal.mobile.css.test.ts` — **new** (cycle 2).
  CSS-lock guarding the additive form specifically, so a future regression to the bare
  substitution is caught statically rather than only by live measurement.
- `frontend/src/features/dashboards/ui/RefinementChatDrawer.css` — `.refinement-drawer`
  (a `top: 0`, portalled, full-height surface) splits its `padding: var(--space-5)`
  shorthand into longhands and adds the safe-area inset to `padding-top`.
- `DESIGN.md` — one line added to Control-metrics naming the sized-`::after` hit expander
  as the sanctioned alternative to `min-width`/`min-height` for painted chrome controls
  that must not visually grow (task 4.10).

## Full-viewport mobile surface audit (task 5.4/5.5/5.6)

- `auth.css:6` (`.auth-page`) and `:242` (`.auth-loading`) — **exempt**: both are
  vertically centered (`align-items: center`) full-viewport containers; neither renders
  content flush against the physical top edge, so `black-translucent` never occludes them.
- `App.css` `.app-not-found` (formerly `App.css:432`) — **exempt**, same reasoning
  (centered content, no top-anchored control).
- `RefinementChatDrawer.css:28-33` (`.refinement-drawer`) — **treated**: `position: fixed;
  top: 0`, portalled to `document.body`, with its own header at the top edge. Padding
  split to longhands with `padding-top: calc(var(--app-safe-top) + var(--space-5))`.
- `.app-skip-link` (`App.css:17-36`/focus rule) — **treated**: `position: fixed`, its
  focused `top: var(--space-3)` now reads `top: calc(var(--app-safe-top) + var(--space-3))`.
- `Modal.css:11` (`.ui-modal { max-height: 90vh }`) — **exempt**: native `<dialog>`
  vertical-centers itself; measured top ≈46.6px at 430×932, well below the physical top, so
  it never sits under the status-bar glyphs. Only `PanelDetailModal.mobile.css`'s
  `<=430px` full-screen override reaches the top, and that's separately treated above.
- Enumerated but out of scope by construction (bottom-anchored, or JS-positioned relative
  to a trigger, not viewport-top-anchored): `BottomNav.css`, `MobileNavSheet.css` (its
  `__panel` is `bottom: 0`; its `__backdrop` is an inert `inset: 0` scrim with no content
  near the top edge), `PanelList.css`'s zoom widget, `toast.css`'s viewport,
  `Popover.css`/`inputs.css`'s portalled dropdowns.

## Accepted-unverified (per ticket.md D2, binding)

Light-theme status-bar glyph legibility against `--app-surface` is **not** claimed
verified anywhere in this change, this report, or the commit message — it is explicitly
out of scope for this environment (no iOS device/simulator; headless Chromium does not
reproduce iOS status-bar painting) and is recorded as accepted-unverified, per the
product owner's decision.
