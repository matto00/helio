## 1. Preflight

- [x] 1.1 Merge `origin/main` into this branch (HEL-535 / PR #408 merged 2026-08-21), then confirm `--bottom-nav-height` is present in `frontend/src/theme/theme.css`
- [x] 1.2 If it is still absent after 1.1, STOP and escalate — do not invent a second token and do not proceed
- [x] 1.3 Confirm `toast.css` reads `bottom: calc(var(--bottom-nav-height) + var(--space-4))`; note `toast.css` and `toast.css.test.ts` as must-not-break, must-not-edit (HEL-535's)
- [x] 1.4 Confirm the geometry is still inlined at `BottomNav.css:27` and `App.css:424` — both are migrated onto the token by this change (D5)

### Docs

- [x] 2.1 Amend `DESIGN.md` §0.2 principle 2 ("Surfaces are opaque") with the narrow mobile-bottom-nav carve-out, naming the contrast floor that replaces the invariant for it
- [x] 2.2 Amend the `[mechanical]` clause under "Surfaces & the opacity invariant" so it no longer forbids what the bottom nav now does, following the existing overlay-scrim carve-out's prose shape (`DESIGN.md:102-112`)
- [x] 2.3 State the glyph floor: >=3:1 (WCAG 1.4.11 non-text) for every icon rendered against the translucent material, over photo/white/black/accent, in both themes — and state that it is 3:1 rather than 4.5:1 *because the bar carries no text* (D1/D4)
- [x] 2.4 State the lozenge floor: its boundary reaches >=3:1 against the adjacent capsule material, and state the accent icon's real measured position — dark theme drops by at most 0.49 with no preset below 4.24:1; light theme moves by at most 0.18, within a pre-existing 1.78-3.71:1 shortfall this ticket neither introduces nor materially moves. Claim exactly this and no more (D6)
- [x] 2.5 Note in the carve-out that the lozenge's hairline uses `var(--app-text)`, outside §3's two-token border vocabulary, and why (D6)
- [x] 2.6 Record that every other surface — top bar, sidebar, popovers, modals, menus — stays opaque

### Frontend

- [x] 3.1 In `theme.css`, add `--bottom-nav-capsule-height` (`--control-lg` + `--space-4`) and `--bottom-nav-inset` (`--space-3`), and redefine `--bottom-nav-height` as capsule + inset + `env(safe-area-inset-bottom)` — **replacing the existing declaration in place**, never adding a second — with a comment documenting the changed meaning and its three consumers
- [x] 3.2 Reshape `.bottom-nav` to an inset floating capsule: `left`/`right` at `--bottom-nav-inset`, `bottom: calc(var(--bottom-nav-inset) + env(safe-area-inset-bottom))`, `border-radius: var(--app-radius-pill)`, `height: var(--bottom-nav-capsule-height)`, horizontal padding `--space-2`, no vertical padding, keeping `z-index: 5` unchanged
- [x] 3.3 Remove `BottomNav.css:28`'s `padding-bottom: env(safe-area-inset-bottom)` — the new `bottom` offset carries the home indicator, and leaving it crushes the content box under `box-sizing: border-box`
- [x] 3.4 Apply the material: `backdrop-filter: blur(12px)` (range 10-16px) with `-webkit-backdrop-filter` alongside it, plus a distinct tint layer (`::before` filling the capsule) of `--app-surface` at **alpha 0.55**. Write no `@supports` block — the tint is unconditional, so a browser without `backdrop-filter` already renders the intended fallback
- [x] 3.5 Give the tabs `position: relative` (or the `::before` `z-index: -1`) so the tint paints between the blur and the glyphs rather than over them
- [x] 3.6 Replace the top hairline with a layered shadow (`--app-shadow-soft` family) and a 1px `--app-border-strong` hairline — NOT `--app-border-subtle`, which renders the capsule's edge at ~1.16:1 against a theme-matched page and is very nearly invisible. This edge is the only thing separating the capsule from the page over a theme-matched backdrop, so it is load-bearing
- [x] 3.7 Move inactive icon ink from `--app-text-muted` to `--app-text`
- [x] 3.8 Add a `<span class="bottom-nav__lozenge">` wrapper around the icon in `BottomNav.tsx` and put the lozenge styling on THAT element — never on the lucide `<svg>`. Lucide emits `width="22"`, and the global `* { box-sizing: border-box }` resolves padding inward from it, so styling the SVG directly clamps its content box to 0px and renders an empty ring with no glyph (D6)
- [x] 3.9 Style `.bottom-nav__lozenge`: `padding: var(--space-1) var(--space-3)`, `border-radius: var(--app-radius-pill)`, and `1px solid transparent` on EVERY tab so the icon never shifts between states; on the active tab only, set fill `--app-surface` at alpha 0.95 and `border-color: var(--app-text)`. Do NOT weaken the border to a `color-mix` (a 70% mix measures 2.50:1 at alpha 0.55), do NOT size the lozenge to the whole tab, do NOT use `--app-surface-strong` as the fill, and do NOT declare `background-clip` — with an opaque border it is pixel-identical to the default and would pin a retired premise (D6)
- [x] 3.10 Keep `--app-accent` on the active **icon**; there is no active-label treatment because there are no labels (D6)
- [x] 3.11 Remove the visible label from `BottomNav.tsx` — delete the `.bottom-nav__label` span and its CSS rule — while **keeping each `NavLink`'s full `aria-label`**, which is now the entire accessible name (D4)
- [x] 3.12 Remove `shortLabel` now that it is dead: `BottomNav.tsx` was its only consumer (verified), so drop the field from `sections.ts` and `navDestinations.ts`, its four values, and the F-080 comments that describe the removed labelled-tab surface. If any other consumer has appeared, keep the field and correct those comments instead — do not leave comments describing a surface that no longer exists
- [x] 3.13 In `sections.ts`, change Data Types' icon from `BookOpen` to `Shapes` (update the `lucide-react` import); leave the other five unchanged (D11)
- [x] 3.14 Gate any added transition behind `prefers-reduced-motion: reduce` using `transition: none` — NOT `transition-duration`, which `theme.css:244-251` silently overrides — placed AFTER the rule it overrides. Note a per-tab lozenge does not travel between tabs; at most it fades. Do NOT invent motion in order to have something to disable
- [x] 3.15 Verify base-rule/`@media` ordering in `BottomNav.css` so the 44px floor cannot be made inert by equal specificity
- [x] 3.16 Update `BottomNav.css`'s lines 21-23 comment to cite the new carve-out instead of the retired invariant
- [x] 3.17 Point `App.css:424`'s `.app-content` padding-bottom at `--bottom-nav-height` — touch only this rule, never `.app-shell` or `.app-command-bar` (HEL-772's)
- [x] 3.18 Re-shape the focus ring: give `.bottom-nav__tab` `border-radius: var(--app-radius-pill)` and deepen `:focus-visible`'s `outline-offset` to `-3px`, so the ring follows the capsule's curve instead of overhanging its rounded ends as a hard accent square. Note this as a documented exception to `DESIGN.md:291-293`'s flush-list-item recipe (D12)
- [x] 3.19 Retarget `.panel-list__zoom-widget` (`PanelList.css:79-96`) to clear `--bottom-nav-height` within the nav's breakpoint only, leaving its desktop position unchanged (D10)

### Tests

- [x] 4.1 Update `BottomNav.test.tsx`: its first case asserts `link.textContent` equals each destination's short label, which no longer renders. Replace with an assertion on accessible names (`getByRole("link", { name })`) covering all six destinations, and keep the active-route cases unchanged
- [x] 4.2 Update `sections.test.ts` / `navDestinations.test.ts` for the removed `shortLabel` and Data Types' new icon identity (D11)
- [x] 4.3 Add `BottomNav.css.test.ts` asserting the capsule geometry, the tint layer, the `-webkit-` prefix, the lozenge's full-strength opaque border and always-present transparent border, and that base/`@media` ordering keeps both the 44px floor and the reduced-motion override effective. Do NOT assert `background-clip` — it is a no-op here
- [x] 4.4 Confirm `toast.css.test.ts` still passes with `toast.css` unedited

### Verification

- [x] 5.1 In an own headless Chromium (`~/.cache/ms-playwright/chromium-1208`) — never the shared MCP Playwright session — render the bar at 375px, 430px, and 768px in both themes
- [x] 5.2 Assert via `getComputedStyle` on rendered elements (not CSS source) that every tab is >=44x44 and the capsule is inset from all three edges. Assert semicircular ends from rendered pixels — NOT from `getComputedStyle`, which reports `9999px` for the pill token. The probe must distinguish a pill from a modest radius: the pixel at `(left + height/4, top)` must still be backdrop
- [x] 5.3 Re-run 5.2 with a **non-zero simulated `safe-area-inset-bottom`**; assert the capsule's bottom edge sits at least `inset + inset-value` above the viewport edge and tabs still measure >=44px tall
- [x] 5.4 Assert every tab's accessible name from the **computed accessibility tree** (CDP `Accessibility.getFullAXTree`), not from markup — with no visible labels this is the only thing a screen-reader user has. All six must expose their full label ("Dashboards", "Data Sources", "Data Pipelines", "Data Types", "Metrics", "Assistant") (D4)
- [x] 5.5 Measure icon contrast by screenshotting and sampling composited pixels for every icon governed by the floor, over pure white, pure black, the accent, and a synthesised photo (inject a background image on `.app-shell`, and separately scroll a dense panel grid beneath the bar), both themes; assert >=3:1 and raise tint alpha if any case fails. **Retain these screenshots** as the evidence artefact for the final gate's recognisability judgement (AC 3), and include the capsule-edge-vs-page case over a theme-matched backdrop in both themes
- [x] 5.6 Measure the **lozenge's border against the adjacent capsule material** from rendered pixels, sampled on the lozenge's straight top edge (never the curve apex — antialiasing costs ~0.2 there); assert >=3:1. The matrix MUST include the theme-**mismatched** extremes (dark-over-white, light-over-black) and one accent-coloured backdrop, plus the theme-matched cases — the border's weak region is the exact complement of the fill's (D6)
- [x] 5.7 Assert the **active** icon actually renders: its rendered box is >=20x20 via `getBoundingClientRect`, and its glyph pixels are present in the screenshot inside the lozenge. The floor tasks above deliberately exclude the active icon, so nothing else would notice an empty ring (D6)
- [x] 5.8 Assert the `:focus-visible` ring stays within the capsule's bounds for the **first and last** tabs — the only ones that can overhang the semicircular ends — from rendered pixels (D12)
- [x] 5.9 Render under emulated `prefers-reduced-motion: reduce` and assert the **rendered** `transition-property`/`transition-duration` shows any added transition genuinely removed, not merely shortened — reading the element the lozenge actually lives on (`getComputedStyle(el, '::before')` if it is a pseudo-element)
- [x] 5.10 Confirm content scrolls fully clear of the floating capsule, and that the toast viewport still clears it with `toast.css` unedited
- [x] 5.11 Profile scrolling a dense dashboard behind the bar under 4x CPU throttling; compare against the same scroll with the bar forced opaque, and treat a dropped-frame ratio worse than that baseline by more than 10% as a fail needing escalation
- [x] 5.12 Confirm the nav's stacking is unchanged (`z-index: 5`) and no new stacking context worsens the tracked "toasts inert behind an open `<dialog>`" defect
- [x] 5.13 Run `npm run lint` and `npm test` from the worktree's own frontend; zero new warnings
