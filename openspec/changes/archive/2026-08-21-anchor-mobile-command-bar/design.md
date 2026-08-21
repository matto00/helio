## Context

Motivation and defect narrative are in `proposal.md` and `ticket.md`; this document records only what the
implementation must get right. Three facts drive every decision below.

**1. The shell is sized by the largest viewport.** `.app-shell` is `height: 100vh` (`App.css:5`); on iOS `100vh` is
the *largest* viewport, so the shell exceeds the visible area, the **document** scrolls as a whole, and the `position:
relative` command bar (`App.css:49`) travels with it under the status bar.

**2. A second cause the ticket never mentions.** `theme.css:204` sets `body { min-height: 100vh }` and
`theme.css:196-200` sets `html, body, #root { min-height: 100% }`. Migrating `.app-shell` alone leaves the document
taller than the visible viewport, so the defect survives.

**3. `* { box-sizing: border-box }` is global** (`theme.css:192-194`). A naive `height: 56px` + `padding-top:
env(...)` pair makes 56px the *border-box* height and the inset eats the bar from the inside — measured at a 47px
inset the content box collapses to 8px and the 44px control renders 18px **above** the inset's lower edge, under the
glyphs.

**Ticket premise correction (D3).** The ticket's 48px is the *desktop* value (`App.css:40`). Below 768px the bar is
already `var(--space-10)` = **64px** (`App.css:383`), raised from 48px by HEL-745 to clear the 44px `IconButton`
floor. The reduction here is **64px -> 56px**.

## Goals / Non-Goals

**Goals:** the document never scrolls (scrolling belongs to `.app-content`); the bar is immovable and reaches the
physical top; 64px -> 56px with every tap target still >=44px; one reusable top-edge seam for HEL-773.

**Non-Goals:** bottom-nav styling (HEL-774), nav-sheet direction (HEL-773), hiding the OS clock/battery, and proving
light-theme status-bar glyph legibility (see Risks).

## Decisions

**1. `100dvh` with a `100vh` first-declaration fallback.** `.app-shell` becomes `height: 100vh; height: 100dvh;` — the
second wins where supported, is dropped where not, so no `@supports` is needed. Already established in-codebase
(`PanelDetailModal.mobile.css:14`, `auth.css:6`, `App.css:432`). *Alternatives:* `position: fixed; inset: 0` (out of
flow, no gain); `100svh` (stable but leaves a permanent dead band).

**2. The ancestor chain migrates together (CR 4).** `theme.css:196-200`'s `html, body, #root { min-height: 100% }`
resolves against the initial containing block, whose sizing under a retracting toolbar is UA-dependent — and Helio
ships to Android Chrome as well as iOS. Rather than reason per-UA, the percentage is removed: all three take the same
`min-height: 100vh; min-height: 100dvh;` pair, and `body`'s separate `min-height: 100vh` (`theme.css:204`) is deleted
as redundant. *Alternative:* keep `100%` and argue per-UA — unverifiable here.

**3. Non-scrolling *structurally*, not by `position: sticky`.** Once the shell equals the visible viewport and
`.app-content` owns `overflow-y: auto` (`App.css:296`), the bar — a `flex-shrink: 0` child of a column flex shell —
cannot move, because nothing around it scrolls. `sticky` inside a non-scrolling container is a no-op that would only
*look* like the fix and would mask a regression if the shell height were reverted. *Alternative:* `position: fixed` —
needs its height re-reserved on `.app-content`, duplicating geometry.

**4. Seam tokens in `theme.css`; the height has exactly one source of truth (CR 3).**

```
:root {
  --app-safe-top: env(safe-area-inset-top, 0px);
  --app-command-bar-height: var(--space-9);                                        /* 48px desktop */
  --app-top-chrome-height: calc(var(--app-command-bar-height) + var(--app-safe-top));
}
@media (max-width: 768px) { :root { --app-command-bar-height: calc(var(--control-lg) + var(--space-4)); } }  /* 56px */
```

The mobile override **must** sit on `:root`: `--app-top-chrome-height` is substituted at computed-value time on the
element declaring it, so overriding the input below `:root` would not recompute it. Consequence: `App.css`'s mobile
block declares **no height at all**. **HEL-773 consumes `--app-top-chrome-height`** and must not re-derive
`env(safe-area-inset-top)`.

**5. Bar geometry, stated exactly (CR 1, CR 10).** Copying the idiom `BottomNav.css:27-28` already proved for the
mirror-image problem, on the **base** rule (all widths): `height: var(--app-top-chrome-height); padding-top:
var(--app-safe-top);`. Border-box height is `--app-command-bar-height` **plus** the inset; the content box is
`--app-command-bar-height` minus the 1px `border-bottom` = **55px** at mobile, giving **5.5px** clearance per side
over the 44px floor (not the 6px claimed in round 1 — the border was uncounted). Still 3.7x HEL-745's rejected 1.5px.

**6. All command-bar padding becomes longhand (CR 2).** `App.css:384`'s mobile `padding: 0 var(--space-3)` shorthand
silently resets `padding-top` to `0` at exactly the breakpoint needing the inset — measured: `paddingTop: "0px"`, bar
top at y=56, no test noticing. Both the base (`padding: 0 var(--space-5)`) and mobile shorthands become `padding-left`
/ `padding-right` / `padding-bottom` longhands, so no shorthand can reset the inset regardless of rule order.
Structural, not ordering discipline.

**7. Height = `calc(var(--control-lg) + var(--space-4))` (56px), computed locally.** Deliberately **not** via any
`BottomNav` token or `--bottom-nav-height`: HEL-774 is concurrently reshaping the bottom nav into a floating capsule.
The symmetry is **intentional-at-this-moment, not a maintained invariant** — later divergence is expected and must not
be "fixed" by re-coupling. *Alternative:* 48px — rejected by the product owner; re-creates HEL-745's 2px clearance.

**8. Tap targets: the painted box stays 28px, only the hit area reaches 44px (product-owner decision).** The product
owner settled this directly: *"28 is a good size for the icons, let's keep it at that. Whatever the avatar is set to
is the right size."* `--control-sm` is 28px (`theme.css:59`) and both `.user-menu__trigger` (`UserMenu.css:5-6`) and
`IconButton`'s `--sm` (`IconButton.css:46-50`) resolve to it, so the rule is: **nothing in the command bar grows
visually; only hit areas expand.** That splits every control in the bar by whether it paints a surface. **Controls
with no painted box** — `.app-command-bar__mobile-title` (19px measured) and `.app-command-bar__logo` (59.25x16px
measured; a real home link, `CommandBar.tsx:120`/`App.css:61-67`, F-185, and the third sub-44px control, found only in
round 3 and only by measuring the rendered bar) — take `min-height: 44px`, `DESIGN.md:130`'s named mechanism. Neither
paints a background or border, so the growth is invisible; round 3 measured the wordmark and separator not moving and
the bar staying 56px. **Controls with a painted box** — `.user-menu__trigger` (1px border, `border-radius: 50%`) and
the bar's `IconButton`s (`variant="secondary"`, 1px border) — keep a 28px painted box and gain a sized `::after` hit
expander at `<=768px`: `width: 44px; height: 44px; top: 50%; left: 50%; transform: translate(-50%, -50%)`. For the
`IconButton`s this means **overriding `IconButton.css:98-105`'s `min-width/min-height: 44px` back to `--control-sm`,
scoped to `.app-command-bar` only** — that global floor grows the box, so today those buttons render as visible 44px
bordered squares on mobile against 28px on desktop, which is very likely the ticket's "icons are larger than
necessary" complaint. The override must never leave `.app-command-bar`; changing `IconButton.css` itself would
silently undo HEL-308/314/319 on every other surface.

**8c. The bar's fifth interactive control, named explicitly.** `.app-command-bar__mobile-new-chat`
(`CommandBar.tsx:181-188`) is an `IconButton` with `size="xs"` — 24x24 by `IconButton.css:40-44`, a size DESIGN.md's
Control-metrics section separately sanctions for dense rows. Under Decision 8 it is a painted control, so it is
deliberately floored to `--control-sm` (28px) on mobile alongside its siblings rather than kept at 24px: it still
shrinks (44 -> 28 today), so the "nothing grows visually" rule holds, and 28px reads correctly beside the 28px
controls it sits next to. Round 4 measured it at 28x28 on `/chat`. It is in the set task 7.10 asserts.

**8a. Why a sized pseudo, and why not the two obvious alternatives.** `::after { inset: -8px }` measures **42x42px**:
an absolutely-positioned pseudo resolves `inset` against its containing block's *padding* box, and these controls
carry `border: 1px`, so the sum is 26+8+8. Round 2 measured it; round 3 re-measured the settled form at 44x44 with a
real hit extent of 44.5 by `elementFromPoint` bisection. An explicit 44px is also immune to a later change in the
border or `--control-sm`, which `inset: -9px` would not be. **`min-width`/`min-height: 44px` on these painted controls
is ruled out on product grounds, not aesthetics** — it inflates the avatar and the icon buttons, which is the thing
the product owner explicitly rejected. A future reader who "corrects" the `::after` back to the `DESIGN.md:130`
mechanism would be reversing a product decision, not a style preference. `44px` is DESIGN.md's sanctioned mobile
literal, so the explicit value is not token drift.

**8b. Hit areas must tile, not overlap — the gap widens with them.** `.app-command-bar__right` (`App.css:111-116`)
gaps its controls by `var(--space-2)` (8px). A 44px hit region around a 28px box extends 8px per side, so with an 8px
gap **adjacent hit regions overlap each other** — not a neighbour's painted box, which they never reach. In that
overlapping band the later sibling paints on top and wins the hit test, truncating the earlier control's own tap area:
round 4 measured the icon buttons at a real horizontal extent of **35.75px** with the gap left at 8px, while their
`::after` still computed a full 44px. The gap therefore becomes `var(--space-4)` (16px) at `<=768px`, at which the
regions exactly abut — round 4 measured the three right-hand expanders tiling `294..338 | 338..382 | 382..426` with
zero overlap and zero stolen sample points. **Net width, measured (not inferred):** the right group *narrows* 132px ->
116px (two painted boxes 44 -> 28 = -32px, two gaps 8 -> 16 = +16px), so the mobile title *gains* room — its usable
text width at 375 goes 99px -> 114px and it ellipses less. The group's hit footprint is unchanged at 132px. **Because
the failure is region-vs-region, a check that samples neighbouring painted boxes cannot see it** — the guard must
bisect each control's real hit extent (tasks 7.11, 6.10).

**9. `black-translucent` is global, so every full-viewport mobile surface is audited (CR 8).** Flipping
`index.html:14` puts *all* top-anchored mobile surfaces under the glyphs, not just the shell — the seam's second
consumer, and why it is a token rather than a literal. Round 3 enumerated every `position: fixed`, viewport-unit,
`top: 0`/`inset: 0`, `sticky` rule and portal consumer in `frontend/src` and found no surface the list omits; the
remaining fixed surfaces are bottom-anchored and exempt by construction. The per-surface list and its treat-or-exempt
verdicts live in tasks.md §5, so they are not duplicated here.

**10. The mobile glyph font-size reduction is DROPPED.** Earlier rounds planned `.app-command-bar .ui-icon-btn {
font-size: var(--text-sm) }` (16 -> 14px) plus a Lucide `size={16}` -> `size={14}` edit in `CommandBar.tsx`. Both are
dropped, so this change now touches no `.tsx` file at all. Two reasons. The product owner endorsed the current icon
size (Decision 8), and with the painted boxes back to 28px on mobile a mobile-only 14px glyph would diverge from
desktop's 16px inside an identically-sized box for no reason. More importantly the ticket's "icons are larger than
necessary" defect is now satisfied far more substantially by Decision 8 — the painted boxes go 44px -> 28px, a real
16px reduction, rather than a 2px glyph tweak. Decision 10 had pre-authorised its own reversal; this is that reversal,
taken at design time.

## Risks / Trade-offs

- **[Light-theme status-bar glyph legibility]** -> **Accepted, unverified, by the product owner.** `black-translucent`
  paints the glyphs light/white; the light-theme bar is `--app-surface` (~`#f4f2ed`). Unsettleable here: no iOS device
  or simulator, and headless Chromium does not reproduce iOS status-bar painting, so a green result there is
  meaningless. **No role may claim it is verified**; an unfounded claim is itself a defect. Checked on a physical
  iPhone post-merge. Pre-designed remedies: (a) a dark surface over the `env(safe-area-inset-top)` strip only, bar
  body keeping `--app-surface`; (b) a dark command bar in both themes.
- **[The re-scoped AC]** -> "Glyphs legible in light and dark" is replaced (ticket.md D2) by what is verifiable: bar
  reaches the physical top, inset applied and correctly sized, no overprint at any scroll position. Neither fail the
  gate on the retired AC nor accept a legibility claim.
- **[Chromium cannot reproduce the `vh`/`dvh` difference]** -> Measured: at 430x932, `100vh == 100dvh == 100svh ==
  100lvh == 932px`, with and without iPhone UA + `isMobile`, so a naive before/after probe is green on both builds and
  proves nothing. Mitigation is prescribed in tasks 7.1-7.4, not left to the executor.
- **[`getComputedStyle().height` cannot see the border-box collapse]** -> In the broken state it still reads `"56px"`
  and `rect.top` is still `0`, so assertions must use the content box and per-control `rect.top >= inset` (tasks
  7.5-7.8), with the inset simulated by overriding `--app-safe-top` on `:root`.
- **[Inert cascade, HEL-535 cycle-1]** -> The mobile `@media` block stays **after** the base rule; equal specificity
  resolves by source order. Verify computed values in a browser at 430 and 768, never by reading CSS.
- **[`App.css.test.ts` first-match scanning]** -> `findMediaBlock`/`findRuleBody` take the **first** match, and
  `findRuleBodyInSource` matches the base rule, not the mobile one. Keep one mobile media block with
  `.app-command-bar` first inside it, and assert base-rule declarations against the base rule.
- **[Concurrent HEL-774 edits]** -> Fenced: `App.css:424` and all `BottomNav.*` are theirs. This change touches
  `.app-shell`, `.app-command-bar` and descendants only; `theme.css`, `index.html`, `UserMenu.css`,
  `PanelDetailModal.mobile.css`, `Modal.css` are outside their fence.

## Planner Notes

Self-approved: the seam and its names; the `100vh`-then-`100dvh` idiom over `@supports`; migrating the whole `html,
body, #root` chain (Decision 2 — a global rule, and the one edit outside the ticket's stated file list); structural
non-scrolling; longhand padding; the hit expander over growing the avatar; folding the CR-7/CR-8 fixes in rather than
spinning them off.

Product-owner decisions: 56px (D1); `black-translucent` as specified with the legibility risk accepted and the AC
re-scoped (D2). The ticket's 48px premise was wrong and is corrected (D3).
