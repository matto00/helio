# HEL-774: Liquid Glass mobile bottom nav + DESIGN.md carve-out from the opacity invariant

## Description

Product-owner feedback from the installed PWA on iOS (2026-08-20): the mobile bottom nav should adopt the visual language of Apple's Liquid Glass navigation — a floating, translucent, material bar with depth — rather than the current flat opaque strip.

**This deliberately overrides an existing binding rule, and the amendment is part of the ticket.**

### Reference: Instagram's tab bar

The product owner named **Instagram's iOS tab bar** as the specific target (reference screenshot reviewed 2026-08-20). Observed properties, in implementable terms:

- **A floating capsule, not a full-width strip.** Inset from the left, right, and bottom edges with visible margin on all three sides, fully rounded — `border-radius` equal to half its height, so the ends are semicircular. It does not touch any screen edge.
- **Genuinely translucent, lightly blurred.** Content behind it stays recognisable: in the reference the bar sits over a photo of a penny, and the copper, red, and green of the image read clearly through the material. This is *not* heavy frosted glass — the blur radius is small and the surface is highly transmissive.
- **A light tint layer sits between the blur and the icons.** This is what keeps the glyphs legible over an arbitrary photo, and it is the mechanism this ticket's contrast requirement depends on. Blur alone will not carry it.
- **The active item gets its own inner lozenge** — a lighter, more opaque rounded rect behind the active icon, nested inside the outer capsule. The active state is expressed as material, not as an accent-coloured block or an underline.
- **Icons are solid, high-contrast, unlabelled.** The reference bar shows five icon-only items with no text labels; the last is a circular avatar carrying a notification dot.
- **It floats over scrolling content** rather than sitting on a reserved ledge — content passes beneath it.

### The rule being amended

`DESIGN.md` currently states, as a core principle:

> **Surfaces are opaque.** Cards, popovers, modals, and menus never let the page bleed through. Translucency exists only where the user explicitly opts in (the panel transparency slider). **This is the invariant that keeps custom dashboard backgrounds from tinting the whole UI.**

and, mechanically:

> **[mechanical]** Do not add translucent surfaces or `backdrop-filter` glass effects to structural chrome.

`BottomNav.css:21-23` cites it directly:

> `/* Opaque per DESIGN.md §0.2 — dashboards carry user-set backgrounds and must never tint through app chrome. No blur/translucent material. */`

The invariant exists for a real reason: Helio dashboards carry **user-set background images and colours**, and a translucent bar over an arbitrary user background is exactly the case the rule was written to prevent. The product owner has decided (2026-08-20) to carve out the mobile bottom nav specifically, keeping the invariant intact everywhere else. The reference's tint-under-blur layer is what makes that carve-out safe.

### Scope

- **Amend `DESIGN.md` first**, as part of this change: add an explicit, narrow carve-out for the mobile bottom nav. State what is permitted (translucency + `backdrop-filter` on this one element), and state the constraint that replaces the invariant for it — a contrast floor that must hold against **any** user dashboard background, not just the default surfaces. Update the `[mechanical]` clause so the rule and the code stop contradicting each other, and update `BottomNav.css`'s comment so it no longer cites a rule that no longer applies to it.
- Reshape the bar to the reference: inset floating capsule, fully rounded ends, translucent material with a small blur radius, a tint layer beneath the icons, layered shadow for depth, and an inner lozenge for the active item.
- **Decide and record whether Helio keeps its text labels.** The reference is icon-only; Helio's current bar labels every tab (Home, Sources, Pipelines, Types, Metrics, Assistant). Six labelled items in an inset capsule is materially tighter than five unlabelled ones. Whichever way this goes, it is a deliberate call to record in the design notes — dropping labels affects discoverability for a beta audience still learning the source -> pipeline -> type -> panel model.
- Guarantee legibility over hostile backgrounds. A dashboard background may be a photo, pure white, pure black, or the accent colour. Icon contrast must clear the floor in every case.
- Preserve everything already correct in `BottomNav.css`: `env(safe-area-inset-bottom)` handling and the >=44px touch targets (`min-height: 44px`, `BottomNav.css:43`). **Note the layout change:** the bar currently reserves a ledge via `padding-bottom` on the content region (`App.css:424`). A floating capsule no longer sits on that ledge, but content must still be able to scroll fully clear of it — recompute that clearance for the new geometry rather than deleting it.
- Respect `prefers-reduced-motion` for the added motion, and check `backdrop-filter` cost on a mid-range device — a blurred bar composited over a scrolling panel grid is the expensive case.

### Out of scope

- Extending translucency to any other chrome. The carve-out is the bottom nav alone; the top bar, sidebar, popovers, modals, and menus all stay opaque.
- Top-bar (HEL-772) and nav-sheet (HEL-773) work — their own tickets.

## Acceptance criteria

- [ ] `DESIGN.md` carries an explicit mobile-bottom-nav carve-out with a stated contrast floor, and no longer contradicts the shipped code; `BottomNav.css`'s comment is updated to match.
- [ ] The bar is an inset floating capsule with fully rounded ends, clear of all three screen edges — not a full-width strip.
- [ ] Content behind the bar remains recognisable through the material (small blur, high transmissivity), with a tint layer carrying icon legibility.
- [ ] The active item renders as an inner lozenge within the capsule, not as an accent block or underline.
- [ ] Icon contrast clears the stated floor over a photo background, pure white, pure black, and the accent colour — **measured, not eyeballed**.
- [ ] The labels decision is recorded with its reasoning; if labels are kept, six items fit the capsule without crowding at 375px.
- [ ] `env(safe-area-inset-bottom)` handling and >=44px touch targets preserved; content scrolls fully clear of the floating bar.
- [ ] `prefers-reduced-motion` disables the added motion; scrolling a dense dashboard behind the bar stays smooth on a mid-range device.
- [ ] Verified on a real device or correctly-configured emulation at 430px and 375px, in both themes.
- [ ] `npm run lint` / `npm test` pass with zero new warnings.

## Decisions taken during planning (recorded against the ACs above)

- **Labels (AC 6): DROPPED — icon-only.** Escalated to the product owner once the cost was measured and
  answered `drop-labels` on 2026-08-21. Basis: 10px labels are WCAG small text and bind a 4.5:1 contrast
  floor; icon-only is governed by WCAG 1.4.11's 3:1. That sets the tint alpha (0.65 -> 0.55) and so the
  transmissivity (35% -> 45%). AC 6's "if labels are kept, six items fit" is therefore moot; the
  discoverability half of AC 6 is accepted as a risk, mitigated by HEL-554.
- **Contrast floor (AC 5): 3:1**, per WCAG 1.4.11, measured from rendered pixels over all four backdrops in
  both themes — plus a second 3:1 floor on the active lozenge's boundary against the capsule material.
- **Data Types' icon:** `BookOpen` -> `Shapes`, because dropping the labels makes the glyph the sole carrier
  of meaning and an open book reads as documentation.

## Coordination constraints (from the run brief, binding on execution)

- **`--bottom-nav-height` is introduced by HEL-535**, not by this ticket, in `frontend/src/theme/theme.css` as
  `calc(var(--control-lg) + var(--space-4) + env(safe-area-inset-bottom))`, and `toast.css` consumes it
  (`bottom: calc(var(--bottom-nav-height) + var(--space-4))`, pinned by `toast.css.test.ts:105-107`).
  That token is **the single seam for bottom-nav geometry**. Update it; never hardcode geometry that bypasses it, and never duplicate it.
- **Do not edit `toast.css` or `toast.css.test.ts`** — they belong to HEL-535. This change must flow to the toast viewport through the token alone.
- **File-overlap fence with HEL-772:** this ticket owns `BottomNav.css`, `BottomNav.tsx`, `DESIGN.md`, and the content-clearance rule at `App.css:424`. HEL-772 owns `.app-shell` and `.app-command-bar` in that same `App.css`, plus `index.html`'s meta tags. Do not touch the shell or command-bar rules; escalate instead of editing them.
- **Do not use the MCP Playwright tools** — that session is shared with two concurrent runs. Launch an own headless Chromium (`~/.cache/ms-playwright/chromium-1208`).
- Touch-target and geometry verification must use `getComputedStyle` at real viewports, **not** by reading CSS source — HEL-535 shipped a defect where a `@media` block above the base rule made the 44px floor inert at equal specificity.
