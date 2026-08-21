- `DESIGN.md` — amends §0.2 principle 2 ("Surfaces are opaque") with the narrow mobile-bottom-nav
  carve-out, amends the `[mechanical]` clause under "Surfaces & the opacity invariant" to stop
  forbidding what the bar now does, and states the glyph floor (>=3:1, WCAG 1.4.11, why 3:1 not
  4.5:1), the lozenge-boundary floor (>=3:1) with the honestly-stated accent-icon measurement, why
  the lozenge hairline uses `var(--app-text)` outside §3's two-token border vocabulary, and that
  every other surface stays opaque.
- `frontend/src/theme/theme.css` — redefines `--bottom-nav-height` in place as total clearance
  (capsule height + edge inset + safe-area inset) and adds the two new primitives
  (`--bottom-nav-capsule-height`, `--bottom-nav-inset`) it's composed from, so the geometry has
  exactly one definition and BottomNav.css/App.css/PanelList.css/toast.css all read the same family.
- `frontend/src/shared/chrome/BottomNav.css` — reshapes `.bottom-nav` into an inset floating capsule
  (semicircular ends, translucent `backdrop-filter` blur + a distinct `::before` tint layer at
  alpha 0.55, layered shadow + `--app-border-strong` hairline), moves inactive ink to full-contrast
  `--app-text`, adds the `.bottom-nav__lozenge` active-state material (opaque `--app-text` border,
  `--app-surface` fill at alpha 0.95, always-present transparent border on every tab), re-shapes the
  focus ring to a pill with `-3px` offset, and gates the lozenge's fade transition behind
  `prefers-reduced-motion: reduce` via `transition: none`.
- `frontend/src/shared/chrome/BottomNav.tsx` — removes the visible `.bottom-nav__label` span (icons
  only now), adds the `<span class="bottom-nav__lozenge">` carrier around each icon (required so
  Lucide's `width="22"` presentation attribute + global `box-sizing: border-box` doesn't clamp the
  icon's content box to 0px), keeps each `NavLink`'s full `aria-label` as the sole accessible name.
- `frontend/src/shared/chrome/sections.ts` — drops the now-dead `shortLabel` field (BottomNav was
  its only consumer) and its four values/comments, and swaps Data Types' icon from `BookOpen` to
  `Shapes` (D11) — also reaches the desktop sidebar, deliberately, per the registry's
  single-source-of-truth guarantee.
- `frontend/src/shared/chrome/navDestinations.ts` — drops the derived `shortLabel` field to match.
- `frontend/src/app/App.css` — points `.app-content`'s padding-bottom (line ~424) at the shared
  `--bottom-nav-height` token instead of the old inlined `calc()`; touches only this rule, not
  `.app-shell`/`.app-command-bar` (HEL-772's).
- `frontend/src/features/panels/ui/PanelList.css` — retargets `.panel-list__zoom-widget`'s `bottom`
  offset to clear `--bottom-nav-height` within the nav's own breakpoint (431-768px, where it would
  otherwise sit on top of the new floating capsule); desktop position unchanged (D10).
- `frontend/src/shared/chrome/BottomNav.test.tsx` — replaces the old visible-short-label assertion
  (the span it asserted on is deleted) with an accessible-name assertion covering all six
  destinations; active-route cases unchanged.
- `frontend/src/shared/chrome/sections.test.ts` / `navDestinations.test.ts` — add a direct assertion
  that Data Types resolves to the `Shapes` icon, not `BookOpen` (D11); no `shortLabel` references
  remained to update (grepped clean).
- `frontend/src/shared/chrome/BottomNav.css.test.ts` — new. Source-level regression guard (jsdom
  cannot observe `backdrop-filter` compositing, rendered contrast, or media-query evaluation)
  pinning: capsule geometry/tokens, the `-webkit-` prefix, the tint layer's alpha/z-index, the
  lozenge's opaque `var(--app-text)` border (never `color-mix`) and always-present transparent
  border, absence of `background-clip`, the reduced-motion `transition: none` override and its
  source-order position relative to the base rule, the single (unshadowed) `.bottom-nav__tab`
  44px-floor declaration, and the focus ring's `-3px` pill offset.
