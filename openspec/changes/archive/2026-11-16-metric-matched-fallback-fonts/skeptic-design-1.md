## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 7d9b2ea2d47f9ed0c57dddfdaf4fcfb4dd90317d (the base; the change dir is untracked planning only).

### What I verified (with evidence)

- **Font stacks and loading.** `frontend/src/theme/theme.css:20-23`: `--font-face-sans: "Schibsted Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; mono and serif have no Arial-family or DejaVu entry. `app.html:48` and `index.html:63` load from Google with `display=swap`. No `@font-face` in `frontend/src`. These match design.md Context.
- **Playwright version.** The resolved `@playwright/test` is 1.55.1, which matches `mcr.microsoft.com/playwright:v1.55.1-noble`. That image is present locally.
- **What the noble image contains.** I ran `docker run --rm mcr.microsoft.com/playwright:v1.55.1-noble fc-list : family`. It has **Liberation Sans/Mono/Serif**, FreeSans/Serif/Mono, WenQuanYi, IPA, Loma, Unifont and Noto Color Emoji, and **no DejaVu**. `fc-match sans-serif` there gives WenQuanYi Zen Hei, and `fc-match Arial` gives Liberation Sans. HEL-1665 added `fonts-dejavu` on top of this image, so its "CI-like" base numbers were taken with Liberation and DejaVu both installed.
- **What CI installs.** CI runs `.github/actions/e2e-setup` → `scripts/e2e-apt-deps.sh`, which installs the package list from `playwright install-deps --dry-run chromium`. Playwright always adds the `tools` group (`playwright-core/lib/server/registry/index.js:945`: `targets.add("tools")`). For ubuntu24.04-x64 that group is `fonts-liberation`, `fonts-freefont-ttf`, `fonts-wqy-zenhei`, `fonts-ipafont-gothic` and others (`nativeDeps.js`). So **CI's ubuntu-24.04 runner has Liberation Sans/Mono/Serif**. It also falls back to DejaVu for `sans-serif` (HEL-1665's archived design.md:145 says "CI (ubuntu, DejaVu-like fallback)"). I could not inspect the runner image directly.
- **Host.** `fc-list` shows Liberation Mono/Sans/Serif and no DejaVu or Arimo. `fc-match sans-serif` gives Noto Sans. fontTools is 4.68.0. design.md's Context is correct about the host.
- **The HEL-1665 spec today.** `e2e/hel1665-home-phone-stability.spec.ts:27-39`: `VIEWPORTS` **already contains** `620x900` and `1024x900`, with `sentenceLines: 1`. They were added in 25aca3660. A comment there records a "605-615px band where the cold-load fallback font wraps the default sentence (a disclosed residual, not asserted)". `fontSwapSpread` is computed at line 116 over frames before `start`, which is taken after `fonts.ready`, a 300ms pause and ten identical frames. It is not asserted (line 148).
- **D6 soundness.** The assertion is an upper bound. A warm cache or fonts that load before first paint give 0, so variance in network timing can only lower the number. That part is sound. Its flake surface is the fallback face actually used on CI (see CR 1) and future changes to the font files Google serves.
- **D7 premise.** No root `font-size` in px in `theme.css` (grep found none), and body text uses `var(--text-sm)` (rem). A change to the browser default size should therefore scale rem. The design also keeps a red precondition and a fallback path. Sound.
- **D4 lint concern.** `tokenAuditSweep.css.test.ts` sweeps only the 8 files in `SWEPT_FILES` (lines 59-68), not `theme.css`. `@font-face { font-family }` descriptors will not trip it. `appearanceTokens.css.test.ts:79-83` asserts each `--font-face-*` is declared once, and that stays compatible.
- **Cheap extras exist as described.** The nested `aria-hidden` is at `frontend/src/features/home/ui/DashboardShelf.tsx:45`. The text "22-26px" is at `openspec/changes/archive/2026-10-18-home-phone-timeline-stability/design.md:145`. DESIGN.md has a Typography section at line 358, under §3.
- **AC coverage.** AC 1 (at most 4px at every width, light and dark, CI-like) is covered by D5, D6 and task 2.4. AC 2 (the 0px series stays green) is covered by task 2.2/2.7. The extras are scoped sensibly, and placeholder polish goes to a follow-up, as the ticket's "grows into scope" rule allows.

### Verdict: REFUTE

### Change Requests

1. **D5, the Risks section and the home-page spec delta rest on a false CI premise. Fix the measurement environment and the spec wording.**
   - D5 says to run the noble image "WITHOUT Liberation/other Arial-metric fonts (so DejaVu is the fallback, as on CI's ubuntu runner)". CI does have Liberation, because `fonts-liberation` is in Playwright's always-installed `tools` group, which `e2e-apt-deps.sh` installs. The noble image ships it too.
   - D1's stack order is: web font, then the Arial-family fallback (`local("Liberation Sans")`), then the DejaVu fallback. On CI, and in HEL-1665's own docker environment, the head's pre-swap text would therefore render in the **Liberation-matched** face, not the DejaVu one. The new `fontSwapSpread <= 4` assertion would run against that face on CI.
   - The planned "DejaVu-only" docker run measures a face that CI would not use, and the AC's "CI-like" head number would come from an environment unlike CI.
   - Required revisions:
     - Define the CI-like environment as noble 1.55.1 plus `fonts-dejavu`, with Liberation left in place. That matches HEL-1665's base environment and CI. Measure base and head there for the AC table, and prove which platform font rendered (`CSS.getPlatformFontsForNode`). Expect DejaVu on base and Liberation Sans on head.
     - Add a second head run with Liberation removed (DejaVu-only), so the DejaVu fallback face is also proven at 4px or less. Without it nothing exercises that face, because the host has no DejaVu.
     - In the home-page spec delta, change "under the CI-like fallback (DejaVu Sans, Ubuntu noble)" and the scenario's "with DejaVu Sans as the platform fallback" so they name the real conditions. For example: "under the CI-like font set (Ubuntu noble with Liberation and DejaVu), and with DejaVu as the only fallback".
     - The alternative is to state and justify putting the DejaVu face first. Either way, the design must say which face CI uses.

2. **D5 step (1), D6 and task 2.2 tell the executor to "add 620x900 and 1024x900" to `VIEWPORTS`, but they are already there** (`e2e/hel1665-home-phone-stability.spec.ts:35-37`, from 25aca3660). Correct the text so the red run uses the spec as it is, and task 2.2 only adds the assertion.
   - The same comment block records a known 605-615px band where the fallback wraps the default sentence differently. The new home-page text says the hidden default sentence "SHALL NOT wrap differently in the fallback than in the web font", which is unbounded by width.
   - State whether that band is now expected to close, and add a measured width in the band (e.g. 610) to the evidence. Otherwise narrow the spec sentence to the asserted widths.

3. **The frontend-theme-system scenario "Fallback occupies the web font's box" (widths within 2%, equal line-box heights) has no task that verifies it, and its measurement is unspecified.** Add a task, or extend 1.1 or 2.4, that measures it in a real browser and records the result. Specify:
   - the sample: a fixed English sentence, e.g. the default opening sentence plus a pangram;
   - the weights: 400 at least, and 600 if D2 adds bold faces;
   - which faces are checked in which environment: Liberation on the host and in docker, DejaVu in docker;
   - that "line-box height" is compared with `line-height: normal`. With the app's unitless line-heights, equal heights hold trivially and prove nothing.

   Otherwise the requirement is untestable as written, and an evaluator has no acceptance signal for it.

### Non-blocking notes

- D1 calls the mono and serif fallbacks "Arial-metric", for Courier New/Liberation Mono/Cousine and Times New Roman/Liberation Serif/Tinos. Name them for what they match, e.g. "Liberation/Courier family", in the self-describing family names.
- Fraunces is served as a variable font with an `opsz` axis, and `font-optical-sizing: auto` changes widths with size. Derivation at the "default instance" may be off at Serif-heading sizes. D3's empirical-tune escape covers this; record which opsz was assumed.
- Chromium's `local()` lookup on Linux matches the full font name or PostScript name exactly, without fontconfig aliasing. `local("Arial")` will therefore not silently resolve to another font, which supports D1's skip behaviour. Keep both the full and the PostScript names (e.g. `"LiberationSans"`).
- On macOS and Windows the Arial-family face now comes before `system-ui`, so pre-swap text changes from San Francisco or Segoe UI to adjusted Arial. That is intended and harmless, but worth one line in the design.
