## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Surfaces re-parsed from `frontend/src/theme/theme.css` myself** (not from the brief's list):
light `--app-bg #f4f2ed` L=0.8885, `--app-surface #fdfcfa` L=0.9741, `--app-surface-soft #efece6`
L=0.8405, `--app-surface-raised #ffffff` L=1.0000, `--app-surface-strong #ffffff` L=1.0000
(lines 193-197); dark `#121110` L=0.0057, `#1a1816` L=0.0093, `#161514` L=0.0076,
`#232019` L=0.0146, `#262320` L=0.0172 (lines 149-153). Presets re-parsed from `theme.ts:22-31`.

**Luminance function validated** against a known anchor before use: `#ffffff`/`#000000` = 21.00 exact.

**Decision 2 and 3 reproduced exactly and independently.** Minimum integer % darkening clearing 3:1:
Red/Purple/Blue 0%, Pink 1%, Orange 12%, Cyan 18%, Green 21%, Yellow 28%; resulting margins light
3.01-3.07, dark 3.95-4.40. These match design.md character-for-character. Red/Purple/Blue really do
pass unmodified (light min 3.19/3.36/3.12, dark min 4.15/3.95/4.25) — D2's "render unchanged" claim
is confirmed. A fixed `color-mix` ratio genuinely cannot serve a 0%-28% spread; D2's rejection stands.

**Decision 1's inequality directions and arithmetic are correct** given its inputs
(`1.05/3-0.05=0.3000`, `3*0.0557-0.05=0.1170`, `1.05/4.5-0.05=0.1833`, `4.5*0.0557-0.05=0.2005`).
**But the inputs are the wrong surfaces** — see CR1.

**HEL-1048 deferral is real**: live, OPEN (Todo), title
"Accent-as-text fails 4.5:1 in light theme and cannot be fixed theme-independently", v0.7, High.
**Its 4.5:1-impossibility framing does NOT collapse** — with the correct binding surfaces the 4.5:1
window is [0.2523, 0.1479], *more* emphatically empty than the design's [0.2005, 0.1833]. HEL-1048
needs no correction on that point.

**D4 is implementable**: `frontend/src/theme/theme.css.test.ts` and `elevationTokenGuard.css.test.ts`
already read and parse `theme.css` in Jest, so "re-read the surfaces from `theme.css`" has direct
in-repo precedent.

### Verdict: REFUTE

### Change Requests

1. **Decision 1 names the wrong surfaces as "worst", and the error propagates into the tasks.**
   design.md D1 (and ticket.md's premise table) assert the worst light surface is `#ffffff` (L=1.0000)
   and the worst dark surface is `--app-bg #121110` (L=0.0057). For a mid-luminance focus ring both
   are backwards: `#ffffff` is the *highest*-contrast light surface and `#121110` the
   *highest*-contrast dark surface. The binding constraints are the surfaces **nearest** the ring's
   luminance — light `--app-surface-soft #efece6` (L=0.8405) and dark `--app-surface-strong #262320`
   (L=0.0172). Verified per-surface: Orange scores 2.80 vs `#ffffff` but 2.38 vs `#efece6`; 6.73 vs
   `#121110` but 5.58 vs `#262320`.
   The true 3:1 window is **[0.1516, 0.2468], width 0.0953** — not [0.1170, 0.3000] width 0.1830.
   Both stated bounds are too permissive.
   **This is load-bearing, not cosmetic.** An executor implementing task 1.1's "minimum adjustment
   clearing 3:1 against the worst surface in BOTH themes" against D1's literal surfaces produces
   Orange 4%, Cyan 11%, Green 14%, Yellow 21% and Pink 0% — every one of which scores **2.58-2.99
   against `--app-surface-soft`** and therefore **ships this ticket's exact defect while passing its
   own stated proof.** Note D1-literal also leaves Pink unadjusted, contradicting D2's own "Pink 1%".
   Required: correct the D1 table (both bounds, both targets) and ticket.md's premise table to the
   binding surfaces `#efece6` / `#262320`; state explicitly that "worst" means the surface nearest
   the ring in luminance, not the palette extreme. Keep the conclusions — they survive and strengthen.
   (D2/D3's percentages and margins were evidently computed against the *correct* surfaces, so only
   the proof text is wrong — which is exactly why an executor following D1 would diverge from D2.)

2. **Task 4.2 and D4 would encode the same wrong surfaces into the permanent guard.** Both instruct
   the guard to "state in-file that the 3:1 luminance window depends on the surface extremes
   (`#ffffff`, `#121110`)". That would durably document the wrong dependency in the one artifact
   built to outlive this change. Required: restate as `--app-surface-soft` / `--app-surface-strong`
   (naming them as the current binding surfaces, not fixed hexes), and — since the guard must react
   when the surface *set* moves under HEL-866 — require the guard to **re-derive which surface is
   binding from the parsed set** rather than checking two named ones. A guard that re-reads five
   surfaces but only compares against a hardcoded worst two is stale by a different route.
   Also state where the derivation's own surface constants live (`appearance.ts` is TS and cannot
   read `theme.css` at runtime, so it must hardcode) and that the guard is the sync check between
   them; the design currently leaves this seam unstated.

3. **No task specifies `--app-focus-ring-color`'s static value in `theme.css`, so the shipped-default
   AC is untraceable.** Task 2.1 says only "add `--app-focus-ring-color`". Two paths render that
   static value, not the derived one: (a) task 1.2's unparseable-hex case — `buildAccentTokens`
   returns `{}` (`appearance.ts:307-309`), so nothing is written inline and the CSS declaration is
   what paints; and (b) first paint, since `ThemeProvider.tsx:89-92` applies tokens in a `useEffect`
   that has not run yet — the same pre-settle window the ticket's own MEASUREMENT TRAP documents as
   real. If that declaration is `var(--app-accent)` or the raw `#f97316`/`#ea580c` defaults, both
   paths render the **defective** ring, and the spec scenario "The shipped default is not an
   exception" is not satisfied by any task. Required: decide at design level what the `theme.css`
   static value is (the derived default, e.g. Orange's `#db6513`, is the obvious candidate), require
   task 1.2's fallback to name that same value, and require the guard to assert the **static
   declaration itself** clears 3:1 — the derived-per-preset loop does not cover it.

### Non-blocking notes

- **Thin 3.01 margins are acceptable, and the design's risk entry handles them correctly.** The
  derived value is an exact integer-RGB hex applied inline, so computed style returns that same hex
  and contrast is exact — there is no rendering-rounding path to erode 3.01 to 2.99. Raising the
  derivation target is not required. (This holds only because D2 rejected CSS `color-mix`; if the
  executor implements the darkening in CSS instead, browser colour-space mixing reintroduces this
  risk and the margin judgment changes.)
- **HEL-1048's description also claims task 3's work** ("`theme.css`'s per-theme `--app-accent` /
  `--app-accent-ink` defaults ... Correcting or removing them, and making the `theme.css:161-162`
  comment true, belongs here"). HEL-1046's ticket puts it in scope here and that scope is
  owner-ratified, so this ticket should do it — but HEL-1048 should be updated so the work is not
  attempted twice or reverted. Not a blocker for this gate.
- **Yellow's cohesion is a final-gate owner call, not a design-gate blocker.** 28% darkening yields
  `#a88106`, an olive/dark-gold that reads noticeably unlike `#eab308`. The design accepts this
  explicitly and task 5.6 already puts Yellow in both themes in front of a reviewer. I am not ruling
  on it here; I am flagging that it needs an explicit owner cohesion judgment at the final gate
  rather than being carried by the contrast table.

### Two axes

- **What no source text carries:** whether the ring is *perceptible*. Every artifact here reasons in
  hexes and ratios; a ring meeting 3.01 against the surface it lands on and a ring drawn under an
  overlapping element, clipped by `overflow: hidden`, or painted at an `outline-offset` that puts it
  on a *different* surface than the one measured are indistinguishable in all of it. Task 4.3 admits
  this for the guard; it is equally true of the design.
- **What path the gates did not exercise:** the pre-settle / fallback render (CR3). Every unit test
  and every guard reads either the derived function output or `theme.css` tokens by name; none
  exercises the window in which `useEffect` has not run and the static declaration is what paints.
