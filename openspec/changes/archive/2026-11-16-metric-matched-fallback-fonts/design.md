## Context

See proposal.md - Why. Web fonts load from Google Fonts with `display=swap` (`frontend/app.html`: Fraunces, Schibsted
Grotesk, JetBrains Mono; `frontend/index.html` landing: Schibsted + JetBrains only). The stacks live in
`frontend/src/theme/theme.css` as `--font-face-sans|mono|serif`; `--font-sans`, `--font-heading`, `--font-display` and
`--font-mono` alias them, and the Mono/Serif type styles rebind the aliases (DESIGN.md §3). `theme.css` is imported by
both the app (`main.tsx`) and the landing page (`landing/landing.ts`). There is no `@font-face` anywhere in
`frontend/src` today. The HEL-1665 Home shift spec (`e2e/hel1665-home-phone-stability.spec.ts`) already records the
cold-load swap as `fontSwapSpread` (runs card top spread over the frames before the load series starts) but never
asserts it. HEL-1665's numbers came from the `mcr.microsoft.com/playwright:v1.55.1-noble` image's browser (present
locally) with `fonts-dejavu` installed, driven by the host specs. The host has Liberation fonts, not DejaVu; fontTools
4.68 is installed.

## Goals / Non-Goals

**Goals:** fallback text occupies the web font's box on Linux (DejaVu, Liberation), macOS/Windows (Arial family);
AC numbers (at most 4px swap, all AC widths, light and dark) measured red-first in the CI-like environment; the swap
asserted so it cannot regress silently.

**Non-Goals:** see proposal.md Non-goals (placeholder polish is a follow-up). No change to font loading itself.

## Decisions

**D1. One fallback family per platform-font family, not one family with several `local()` sources.** A single
`@font-face` with `src: local(Arial), local("DejaVu Sans")` can carry only one `size-adjust`, but DejaVu Sans is far
wider than Arial, so one number cannot match both. Declare e.g. `"Schibsted Grotesk Fallback Arial"` (`src:
local("Arial"), local("ArialMT"), local("Liberation Sans"), local("Arimo")` - metric-compatible fonts share one number)
and `"Schibsted Grotesk Fallback DejaVu"` (`local("DejaVu Sans"), local("DejaVuSans")`). A face whose `local()` sources
are all missing is skipped and the browser moves to the next family. Same pattern for mono (the Liberation/Courier family = Courier
New/Liberation Mono/Cousine; DejaVu Sans Mono) and serif (the Liberation/Times family = Times New Roman/Liberation
Serif/Tinos; DejaVu Serif; Georgia on macOS/Windows may be added if cheap). Chromium's Linux `local()` lookup matches the
full or PostScript name exactly (no fontconfig aliasing), so list both (e.g. `"Liberation Sans"`, `"LiberationSans"`).
On macOS/Windows the Arial-family face now precedes `system-ui`, so pre-swap text changes from San Francisco/Segoe UI to
adjusted Arial: intended and harmless (it is only visible until the web font arrives; the exception is glyphs outside Google's `latin` subset, e.g. the U+2192 arrow in "All N →", which now render in the matched, size-adjusted fallback after load too instead of `system-ui`). Stack order: web font, Arial-family fallback, DejaVu fallback, then the
existing system entries unchanged. Exact family names are the executor's, but must be self-describing.
Alternative rejected: Next.js-style single fallback - fits only one platform and CI is DejaVu.

**D2. Bold.** Headings use `--weight-semibold`/bold. A single regular `local()` face makes the browser synthesise bold,
whose width differs from the web font's real bold. The executor measures the swap with regular-only faces first; if
any AC width exceeds 4px because of headings, add weight-specific faces (`font-weight: 600 900` with `local("Arial
Bold")`/`local("DejaVu Sans Bold")` etc. and their own `size-adjust`). Record which was needed and why in the evidence.

**D3. Derivation is committed and reproducible.** A small dev-only script (e.g. `scripts/fonts/fallback-metrics.py`,
fontTools; not run in CI, no CI network) reads the exact web-font files Google serves (URLs and the date fetched
recorded in the script output) and the local fallback files, and prints each `@font-face` block: `ascent-override =
webAscent/unitsPerEm / sizeAdjust` (hhea or typo per USE_TYPO_METRICS, matching what Chromium uses),
`descent-override`, `line-gap-override` likewise, `size-adjust` = ratio of average advance widths over a weighted
English letter-frequency sample (the capsize/Next.js method). Values are then checked in a real browser (D5); if a
sentence still wraps differently the executor may tune `size-adjust` empirically, and must record the final number and
its measured width ratio. Variable web fonts: use the default (400) instance's metrics;
Fraunces has an `opsz` axis and `font-optical-sizing: auto`, so record which opsz the derivation assumed and rely on the
empirical tune if Serif-heading sizes miss.

**D4. Tokens and lints.** The fallback families are added inside the existing `--font-face-*` values only, so every
type style keeps working through the aliases (DESIGN.md §3). `@font-face { font-family: ... }` descriptors are not
ad-hoc `font-family` declarations; if a design-token lint or `appearanceTokens.css.test.ts` flags them, adjust the test
to the new contract (and say so), never weaken an unrelated assertion. Update `appearanceTokens.css.test.ts` to assert
D1's order and the four overrides + local()-only src (the frontend-theme-system scenarios). DESIGN.md §3 gains one
sentence: a new web face needs matched fallback faces. `chartAppearance.ts` literals stay (canvas, proposal non-goal).

**D5. Measurement environment and red-first.** CI's ubuntu-24.04 e2e legs install Playwright's `tools` deps group
(`scripts/e2e-apt-deps.sh` via `playwright install-deps --dry-run chromium`), which includes `fonts-liberation`; the
`mcr.microsoft.com/playwright:v1.55.1-noble` image (matches the resolved `@playwright/test` 1.55.1; present locally)
ships Liberation too and no DejaVu, and HEL-1665's "CI-like" numbers added `fonts-dejavu` on top. So the **CI-like
environment** = that image + `fonts-dejavu`, Liberation left in place; its browser is driven by the host specs against
this lane's dev server (ports from workflow-state). On base the pre-swap face is expected to be DejaVu (via
`system-ui`/`sans-serif`); on head it is expected to be the Liberation-matched face, because D1 puts the
Liberation/Arial-family fallback before the DejaVu one - **this is the face CI uses after this change**. Before trusting
any number, prove which platform font rendered pre-swap (CDP `CSS.getPlatformFontsForNode` on the opening sentence and
the shelf heading, or equivalent) and record it. Runs, in order:
(1) **base** 7d9b2ea2d, CI-like env, HEL-1665 spec as it is (its `VIEWPORTS` already include 620x900 and 1024x900),
light+dark, all widths -> red numbers (expect about 8/24/22/24);
(2) **head**, CI-like env -> at most 4px at every width, light+dark;
(3) **head, DejaVu-only** (same image with Liberation removed, e.g. `apt-get remove fonts-liberation` or a fontconfig
reject rule in the container) -> at most 4px, proving the DejaVu-matched face, which nothing else exercises (the host has
no DejaVu);
(4) a local (host, Liberation) column; (5) Serif-headings and Mono swaps at 540 and 1280 in env (2) - confirm or correct
HEL-1665's "about 30px at 540" Serif claim; (6) the 605-615px band the spec's comment records as a known fallback-wrap
residual: measure 610x900 in envs (1) and (2) and state whether it closed.
If the docker browser route proves impossible, stop and report (BLOCKER) rather than substituting a host-only number.

**D6. Assert the swap.** `hel1665-home-phone-stability.spec.ts` `VIEWPORTS` already contains 620x900 and 1024x900
(25aca3660); do not add them. Only add `expect(fontSwapSpread).toBeLessThanOrEqual(4)` (replacing the "recorded, never
asserted" comment, and updating the 605-615px comment to whatever D5 step 6 found). Fonts cached/already loaded give 0,
so the assertion only fails on a real wide swap. On CI it runs against the Liberation-matched face (D5). Its red proof is
D5 step 1 (base in env (1) exceeds 4). The home-page delta is worded per asserted width, with the 605-615 band as an explicit MAY;
if D5 step 6 shows the band closed, the PR says so and the MAY stays (harmless); if not, its 610px number goes in the
evidence and PR body.

**D6a. Box-match measurement (frontend-theme-system "occupies the web font's box").** In a real browser, render a fixed
sample - the default opening sentence ("All quiet: ..." as Home renders it) plus the pangram "The quick brown fox jumps
over the lazy dog" - at 16px and at the shelf-heading size, weight 400 (and 600 if D2 adds bold faces), once in the web
font and once in each matched fallback face (forced via an inline `font-family` of just that fallback family), with
`line-height: normal` (the app's unitless line-heights would make equal heights trivially true). Record width ratio
(revised after measurement, was "within 2% at every size": the mean over the sample sizes must be within 2% and no single sample beyond 8% at weight 400, because Chromium's hinted integer advances are not linear in font size; measured worst case 7.4%, Fraunces Fallback DejaVu at 16px) and the `line-height: normal` box height (must be equal within 1px). Faces/environments: Liberation
on the host and in docker env (2), DejaVu in docker env (3). This is evidence, not a CI test (it needs the web font file).

**D7. Larger default font size e2e.** New `e2e/hel1678-home-large-font.spec.ts`: set Chromium's default font size via
CDP `Page.setFontSizes` (standard 24px; check the app's root sizing really follows it - a red precondition asserts the
opening sentence's computed font-size is larger than under 16px) before navigating to `/home` at 375x812 and 1280x900,
light and dark; assert no horizontal scroll, and runs card top 0px after fonts loaded (reuse the HEL-1665 helpers by
import if they are exported, else a small local recorder - no copy of the whole spec). If `Page.setFontSizes` does not
change rem sizing in this Chromium, try a context-level alternative; if none works, report it and file as follow-up.

**D8. Cheap extras.** `DashboardShelf.tsx`: drop the inner `aria-hidden` inside the already-hidden link slot (unit
test still green). Archived `openspec/changes/archive/2026-10-18-home-phone-timeline-stability/design.md:145`:
22-26px -> 22-24px (docs-only edit of an archive; nothing else in the archive changes).

## Risks / Trade-offs

- [`local()` names differ by OS/fontconfig] -> list full and PostScript names; measure in docker and on host.
- [Synthetic bold mismatch] -> D2.
- [New assertion flakes on CI] -> it can only fail when fallback text is visible and wraps differently; the CI-like
  docker run is the proof. If CI's fallback is not DejaVu, the evidence must say what it is.
- [Shared e2e file with other lanes] -> HEL-1731 owns `hel1681-refresh-control.spec.ts`, HEL-1705 owns pipelines
  feature files; this change touches neither.

## Planner Notes

- Self-approved: assert the swap (D6) rather than record-only - the AC is about CI-like numbers and an unasserted
  number is exactly how HEL-1665 regressed it. Self-approved: placeholder polish to follow-up (design change).
- Evidence (docker runs, JSON, table) goes under the change directory / `.concertino/runs/HEL-1678/evidence`; the
  final table goes in the PR body and the home-page spec text points at it.
