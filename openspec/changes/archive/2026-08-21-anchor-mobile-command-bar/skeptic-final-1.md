## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `16eb3fca` + `a4bb1921` on top of `d7815d15`. Nothing below is taken from the
executor's or evaluator's narrative: every number is one I produced myself, in this worktree,
against the live dev server on 6204/9111, with my own headless Chromium required from
`/home/matt/Development/helio/node_modules/playwright` (the shared MCP Playwright session was
not touched). Probe scripts and raw logs:
`/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/probe{1..7}.mjs`,
`mutate.mjs`, `probe*.log`; screenshots under `.../scratchpad/shots` and `.../scratchpad/sk`.

### What I verified (with evidence)

**1. The diff itself, not the report of it.** `git diff main...HEAD --name-only` (main is now
`2eaf1d26`) — 11 source files: `DESIGN.md`, `frontend/index.html`, `App.css(+test)`,
`theme.css(+test)`, `UserMenu.css(+test)`, `RefinementChatDrawer.css`,
`PanelDetailModal.mobile.css(+test)`. I read every hunk in full.

**2. Fences — clean.** No `BottomNav.*`, no `IconButton.css`, no `DashboardList` /
`SourcesPage` / `PipelinesPage` / `TypeRegistryBrowser` / `PanelCreationModal` /
`shared/ui/EmptyState.tsx`. The bottom-nav clearance rule formerly at `App.css:424` (now
`App.css:506-508`, `.app-content { padding-bottom: calc(...) }`) is byte-identical to main —
`git diff main...HEAD -- App.css` mentions `.app-content` only inside two new comments. The
`.ui-icon-btn` floor override is scoped `.app-command-bar .ui-icon-btn` (`App.css:459`);
`IconButton.css` is untouched, and I confirmed the global floor still holds off the bar:
the panel-detail modal's `.ui-modal__close` measures **44×44** at 430 in both themes
(probe3).

**3. Gates — each hook re-run individually here, exit status read.**

| Command | Exit | Evidence |
| --- | --- | --- |
| `npm run lint` | **0** | `--max-warnings=0`, no output |
| `npm run format:check` | **0** | repo-wide: "All matched files use Prettier code style!" — the HEL-774 failure mode (a `-n` hiding a repo-wide DESIGN.md format failure) is **not** present |
| `npm run check:schemas` | **0** | 66 checked / 47 protocol files |
| `npm run check:openspec` | **1** | **one line, nothing else**: `change "anchor-mobile-command-bar" is complete (61/61) but not archived` (HEL-657) |
| `npm run check:scala-quality` | **0** | 128 pre-existing soft warnings, no backend file in the diff |
| `npm test` | **0** | 239 suites / 2518 tests |

Both commit messages disclose the `-n` bypass with per-hook exit statuses, and the disclosure
matches what I measured. Nothing other than the documented `check:openspec` line fails.

**4. The re-scoped legibility AC — no claim made anywhere.** I grepped the code, comments,
`files-modified.md`, the spec deltas and both commit messages: every occurrence of
"legib*"/"status-bar glyph" in this change is either a mechanism statement (*"black-translucent
puts its own header under the status-bar glyphs"*) or an explicit **accepted-unverified**
disclaimer. No role claims verification. I did not attempt to verify it, and I am not failing
the gate on it (ticket.md D2).

**5. Bar anchoring and the dynamic viewport — measured, with a discriminator first.**
Discriminator (probe1 §I): injecting `.app-shell { height: calc(100dvh + 120px) }` makes the
document scroll and the bar's `rect.top` go to **-120** with `docOverflow 120` — so my probe
detects the defect class. On the shipped build, across `/`, `/pipelines`, `/sources`,
`/registry`, `/settings`, `/chat` at **430 and 375** (probe5): `bar rect.top === 0` before and
after scrolling the content region to its end; `.app-content` absorbs the scroll (1649 /
1576 / 2717 / 3248 px on the pages that overflow); `document.scrollingElement`
`scrollHeight - clientHeight === 0` **vertically and horizontally** on every route (the 44px
`::after` overhangs introduce no horizontal overflow). Forced-overflow probe (probe2 §2:
3000px filler appended to `.app-content`): content scrolls to 2500, `docOverflow` stays 0,
bar stays at 0. Screenshot mid-scroll at `/pipelines`: `sk/scrolled-pipelines-430.png` — bar
static, no overprint.

**6. Seam geometry — border-box = token + inset, content box never eaten.** Measured at
430 (probe1 §A/§E) and desktop 1280 (probe2 §1), inset simulated by overriding
`--app-safe-top` on `:root`:

| Case | border-box | padding-top | content box | `rect.top` |
| --- | --- | --- | --- | --- |
| 430, no inset | 56 | 0px | **55** | 0 |
| 430, inset 47 | **103** | 47px | **55** | 0 |
| 430, inset 59 | **115** | 59px | **55** | 0 |
| 1280, no inset | 48 | 0px | **47** | 0 |
| 1280, inset 47 | **95** | 47px | **47** | 0 |

Tokens resolve as designed: `--app-command-bar-height` = `calc(40px + 1rem)` = 56 at ≤768,
`3rem` = 48 at 769; `--app-safe-top` = `0px` with no inset. Under both simulated insets every
control's `rect.top` (52.5 @47, 64.5 @59) is below the inset's lower edge and every
`rect.bottom` is above the bar's bottom edge, at every scroll step (bar top stayed 0 at
y=0/400/3000).

**7. Tap targets — measured in the browser, never read from CSS.** Controls enumerated from
the DOM (`bar.querySelectorAll("a, button")` filtered by `getClientRects().length > 0`) at
430, 375 and **768** (the breakpoint edge), light and dark, on `/`, `/chat` and `/pipelines`:

- Every control clears 44px in both axes as `max(border-box, computed ::after)`: logo
  44 high, mobile title 44 high, and 44×44 `::after` on "Refine with AI", "Open assistant",
  "New chat" (`size="xs"`, floored to 28) and the avatar trigger.
- Painted boxes are still **28×28** (`getBoundingClientRect`) — the product decision is
  honoured, not satisfied by inflating the box.
- **Real hit extent by `elementFromPoint` bisection at a 0.25px step** (probe1 §C/§E):
  44.00–44.75 per control, `centerOwned: true` for all, hit rows tiling with no theft.
  Discriminator (probe1 §H): forcing `.app-command-bar__right`'s gap back to `var(--space-2)`
  collapses the icon buttons' real extent to **36.00** while their `::after` still computes
  44 — so the `--space-4` gap is load-bearing and my check discriminates.
- At **769px** (desktop) there is no `::after` and the boxes stay 28px — the mobile-only
  scoping is real.

**8. The cycle-2 fix — verified independently, both themes** (probe3, panel-detail modal
opened by tapping a panel at 430): header `padding-top` = **16px** with no inset (title/`Edit`
`rect.top` 16 — the value `Modal.css:116`'s shorthand produces on main, i.e. byte-identical
behaviour), and **63px** at a 47px inset (title `rect.top` 63). Screenshots
`sk/modal-430-{light,dark}-{noinset,inset47}.png`. I then swept every consumer of
`--app-safe-top` for the bare-substitution shape: `App.css:66` is the only bare
`padding-top: var(--app-safe-top)` and it is correct (a fresh longhand set in a rule whose
height already adds the inset — measured content box unchanged at 55). The other two treated
surfaces degrade correctly: `.refinement-drawer` computes 20/20/20/20 with no inset (identical
to main's `padding: var(--space-5)`) and 67px top at a 47px inset; `.app-skip-link:focus-visible`
computes `top: 12px` with no inset and `59px` with one.

**9. Full-viewport surface audit — re-derived, not trusted.** I re-enumerated every
`position: fixed` rule in `frontend/src` (15) plus the viewport-unit surfaces. Bottom-anchored
or trigger-positioned: BottomNav, MobileNavSheet (`__panel` is `bottom: 0`, `max-height: 70dvh`
— screenshot `sk/navsheet-430-light.png` shows it opening from the bottom edge), toast viewport,
PanelList zoom widget, Popover/inputs dropdowns, and the `inset: 0` scrims. Top-anchored:
skip link, refinement drawer, phone panel-detail modal — all three treated. `auth.css` is
centered: at 430×932 with a 47px inset the login card's top measures **177.25** with zero
document overflow, so "exempt" is right. The audit list in `files-modified.md` matches what I
found; nothing top-anchored is missing.

**10. The CSS-lock tests are real guards, not decoration.** I replicated the tests' own
helpers and mutation-tested the shipped CSS **in memory** (`mutate.mjs`, no repo file touched).
Every extracted rule body is the intended one (printed and inspected — no comment-scanning
false match, no wrong-rule match), and every mutation flips its guard red: re-adding a mobile
`height`, gap back to `--space-2`, either padding longhand set collapsed to a shorthand,
`::after` at 42px (the `inset: -8px` outcome), dropping the scoped `--control-sm` floor,
dropping the logo `min-height`, `.app-shell` back to `100vh` only, `height: 48px` back on the
base rule, the `:root` mobile override moved onto `.app-command-bar`, the ancestor chain back
to `min-height: 100%`, the trigger's `::after` back to `inset: -8px`, and the modal back to the
bare substitution. The inert-cascade ordering guard is present and the mobile block is in fact
after the base rule in source.

**11. Root cause + regression protection (systematic-debugging).** A probe-confirmed root
cause is recorded in `ticket.md` / `design.md` (`100vh` = largest viewport + the
`min-height: 100%` ancestor chain + `position: relative` bar), the repro is reproducible on
demand (§5 discriminator), and the regressions are locked by tests I verified discriminate
(§10). Nothing about the fix rests on an unexercised path.

**12. UI / design judgement — my own eyes, at 430 and 375, light and dark.**
(`shots/bar-{430,375}-{light,dark}.png`, `shots/full-430-{light,dark}.png`,
`shots/bar-inset47-*`, `shots/chat-430-*`, `shots/pipelines-430-*`.)

- **It reads better than what it replaces.** I reconstructed main's geometry in-page
  (64px bar, `min-width/min-height: 44px` on the bar's icon buttons, 8px gap, no unpainted
  floors) and screenshotted it: `sk/bar-430-light-SIMULATED-MAIN.png`. Today's build has two
  visibly oversized 44px bordered squares sitting next to a 28px avatar — an obvious density
  mismatch, and plainly the "icons are larger than necessary" complaint. The shipped bar puts
  all three right-hand controls on the same 28px module, matching desktop, with an even 16px
  rhythm. That is a real improvement in coherence, not just a height saving.
- **Proportion at 56px:** 28px controls centred in a 55px content box = 13.5px above and below;
  the bar does not read cramped at either width, and the wordmark/separator/title line keeps
  its baseline. At 375 the title truncates ("Demo proposed…") but wider than before — the right
  group narrows 132 → 116px, which I confirmed by measurement (title box 128.19 at 375 vs
  167.19 on the simulated-main build at 430).
- **Light/dark parity:** identical geometry in both, all colour from `--app-surface` /
  `--app-border-subtle` / `--app-text-muted`; nothing hardcoded. The only literals introduced
  anywhere are `44px` (DESIGN.md's sanctioned mobile tap literal), `50%` positioning and `0`.
- **The inset band:** with `--app-safe-top` forced to 47px the bar's own surface paints
  continuously to y=0 in both themes (`shots/bar-inset47-430-{light,dark}.png`) — no seam, no
  inert band, exactly what D2 asks for. Whether iOS's glyphs read against the light surface is
  the PO's post-merge check, not mine.
- Keyboard focus on the mobile title now traces its 44px box (`sk/focus-title-430.png`) — it
  fits inside the content box with clearance and reads as a normal control focus ring.
- No console errors on any changed view; the only two errors in the whole session are 401s on
  `/login` from the pre-auth session probe, on a page this change does not touch.

**13. Acceptance criteria traced.**

| AC | Evidence |
| --- | --- |
| Bar never moves on scroll; never overprints | §5 — `rect.top === 0` at every step on 6 routes × 2 widths, with a discriminator that goes red |
| Bar reaches the physical top; no inert band | §6 (`rect.top === 0`, `padding-top` = inset, border-box = token + inset) + `shots/bar-inset47-*` |
| Shell matches the visible viewport | §5 — `docOverflow === 0` incl. under 3000px of injected content; `.app-shell` `100vh`→`100dvh` and the `html/body/#root` chain migrated (locked by tests that discriminate) |
| Height reduced from 64px with every control ≥44px | §6 (56px) + §7 (every enumerated control ≥44 measured, real hit extent 44.0–44.75) |
| ~~Glyph legibility~~ re-scoped | §4 — not claimed, not tested, correctly recorded as accepted-unverified |
| Verified at 430 and 375, both themes, not by unit test alone | §5–§7, §12 |
| Lint / tests clean | §3 |

### Verdict: CONFIRM

The change does what the ticket asks, does it structurally rather than cosmetically, and holds
up under every discriminating probe I could build against it. It ships.

### Non-blocking notes

1. **`DESIGN.md`'s new `::after` clause omits the part that actually bit.** The added line
   (`DESIGN.md:134-140`) accurately describes the mechanism, but not the constraint that made
   it work: a 44px expander around a 28px box extends 8px per side, so a control cluster must
   widen its gap to `--space-4` or the regions overlap and the later sibling steals the tap
   (I measured 36.00px real extent when the gap is forced back). Someone copying the sanctioned
   pattern into another dense mobile cluster will reproduce that defect. Worth one clause in a
   follow-up.
2. **`.user-menu__trigger::after` is not scoped to `.app-command-bar`** (`UserMenu.css:152`),
   unlike the `.ui-icon-btn` override next to it. Benign today — I confirmed `CommandBar.tsx:254`
   is the only render site of `UserMenu` — but if the trigger is ever placed in a dense mobile
   surface, an unscoped invisible 44px expander will steal neighbouring taps.
3. **The user-menu popover clips into the bar chrome** on mobile: it opens at `top: 49.5` while
   the bar's bottom edge is 56 (`sk/usermenu-430-light.png`). Pre-existing and *improved* by
   this change (main's 28px trigger in a 64px bar put it at ~53.5 against a 64px edge, a 10.5px
   overlap vs 6.5 now), so not a regression — but it is visible now that the bar is shorter, and
   would be a tidy polish ticket.
4. **Max-height dialogs graze the inset by a hair.** `Modal.css:11`'s `max-height: 90vh` puts a
   full-height dialog's top at **46.59px** at 430×932 (I measured it) — 0.41px above a 47px
   inset's lower edge. The "exempt" verdict is right for content (the header's own 16px padding
   keeps title and buttons clear) and `Modal.css` is correctly out of this change's scope; just
   worth an eye on the physical-device pass in case the dialog's top hairline sits under the band.
5. **Merge context.** `main` has moved to `2eaf1d26` (HEL-535), which added
   `--bottom-nav-height` to `theme.css` about seven lines above this change's seam block.
   `git merge-tree` reports no textual conflict. Note that design Decision 7's "do not couple
   the top bar to any BottomNav token" is now more tempting than when it was written — the
   in-file comment already forbids it, which is the right defence.
