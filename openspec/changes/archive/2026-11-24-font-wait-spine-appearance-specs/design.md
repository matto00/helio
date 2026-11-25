## Context

- Ruling (ticket.md "Owner rulings"): scope is exactly four sites, and every one is converted, red or not.
- `e2e/support/webFonts.ts` `waitForWebFonts(target: Locator)`: settled when the Google Fonts stylesheet `<link>`
  (selected by `href*="fonts.googleapis.com/css2"`) has `media="all"`, no face is `loading` page-wide,
  `document.fonts.status === "loaded"`, and every web family used by text inside `target.closest("tr") ?? target` has a
  `loaded`/`error` face. Bounded 10s, loud on timeout.
- Since the ticket was filed (2026-10-16): metric-matched fallback faces (archive `2026-11-16-metric-matched-fallback-
  fonts`, `size-adjust`/ascent/descent overrides in `frontend/src/theme/theme.css`) shrink what a swap moves, and
  HEL-1757 (archive `2026-11-18-e2e-local-web-fonts-fixture`) routes `fonts.googleapis.com`/`fonts.gstatic.com` to a
  local HTTPS server via Chromium `--host-rules` in `playwright.config.ts` (with a marker response header,
  `e2e/support/webFontsHost.ts`). Whether Playwright `page.route` still sees and can hold these requests is unverified.
- HEL-1613 method (archive `2026-10-15-adopt-webfonts-wait-layout-specs`, design D1/D5, `evidence/`): a scratch spec
  HOLDS the font responses in a `page.route` handler awaiting a promise and releases them at chosen points (never a
  tuned timer alone); exercises fallback-only and per-family mixed states; in the green run fonts are released
  concurrently (a timer) so the new wait does not deadlock on a fixed release point.
- The four sites (main 793802e50):
  - S1 hel1579:296 - "820/900/1100px [dark|light]: the header keeps one row" - per width, after `goto`, measures
    `.spine-header` item boxes (no overlap), header height < 60, document scroll extents.
  - S2 hel1579:465 - "sweep 769-1100px" - per list width x theme, after `goto` (and the max-width handle drag), then
    1280 spine track width, then a 43-width sweep of `.spine-header` items, `.spine-body__main`, and
    `.step-focused__actions` buttons.
  - S3 hel1572:672 - "under Mono no Appearance control or bottom-nav/command-bar label is clipped" - per width,
    `findClipped` over `.appearance`, `.app-command-bar`, `.bottom-nav`, `.app-rail` selectors.
  - S4 hel1572:764 - run-history modal `1111` vs `8888` duration widths per type style (sans/mono/serif).

## Goals / Non-Goals

**Goals:** the four waits converted; per-site, honest forced-delay evidence (red or "no red possible") before the
conversion and green after; 20/20 for both files.

**Non-Goals:** any other `fonts.ready` site (HEL-1884); any change to `webFonts.ts`, `playwright.config.ts`, a
tolerance, a timeout, a retry or an assertion; product code; fixing `hel1572:126` (only reporting on it).

## Decisions

**D1 - Verify the delay mechanism first (gating).** Before any red run, prove in a scratch spec (on base) which
mechanism actually holds the font responses under HEL-1757: (a) `page.route("**://fonts.gstatic.com/**")` /
`fonts.googleapis.com` handler that awaits a release promise then `route.continue()` (or `route.fallback()`); record
whether the handler fires, the request count it saw, and that the faces stay `loading`/unloaded while held (a
`document.fonts` dump and the stylesheet link's `media`). If `page.route` does not see them, use the next mechanism
that does (e.g. `context.route`, or a held route on the CSS request only) and state it. The evidence names the
mechanism and shows non-zero held-request counts. If NO mechanism can hold them, stop and report as a BLOCKER
rather than claim a delay.

**D2 - Forced-delay run on pre-conversion code, per site.** Scratch copies (never committed as specs; committed as
`.txt` evidence) of each of the four tests, adapted from HEL-1613's `evidence/scratch/zzfontgate.ts.txt` (per-family
holds, URL-to-family mapping from the CSS response). Rules:
- **Navigation (the one deviation).** A held font request keeps `load` open (HEL-1757 fixture README), so every
  `page.goto(...)` in a scratch copy becomes `page.goto(url, { waitUntil: "commit" })`, exactly as every HEL-1613
  held-font scratch spec did. The existing visibility awaits stay and still gate the measurement. This is the ONLY
  deviation from the committed test, recorded in each evidence file, and applied identically to the red (D2), green
  and never-released (D4) runs. A run that fails in `goto` or at the test timeout is an INVALID run, neither a red
  nor "no red possible"; fix the harness and re-run.
- **Re-armed per navigation.** Each site navigates several times (S1: 4 widths, S2: 4 list-width x theme loads,
  S3: 4 widths, S4: 3 type styles). The hold is re-armed for every `goto` (a fresh hold per navigation) and released
  at that iteration's measurement point, so EVERY iteration measures held. If an iteration cannot be held, the
  evidence names exactly which iterations ran held.
- **Proof the hold was live.** At each held measurement, record the gate's `document.fonts` state dump (per-family
  face statuses, `loading` faces, stylesheet `media`), so "the measurement ran with the face held" is checkable per
  iteration, not asserted.
- **States exercised.** Release-at-measurement (measure in the fallback face, then release) and fallback-only (never
  released). Mixed states, one family held alone, for every family the measured text uses: Schibsted Grotesk and
  JetBrains Mono everywhere they appear, and **Fraunces** for S3 (the serif type card's `.appearance__type-card-title`
  is in Fraunces, `AppearanceSection.tsx:27,63,80`) and for S4 under `serif` (the dialog title is in Fraunces, inside
  the dialog scope; the measured durations are not - record both). The report lists exactly which states ran per site.
- Record the asserted values with and without the delay. Outcome per site: RED (cite the failing assertion text) or
  "NO RED POSSIBLE" (cite the values that held). A "no red possible" run is never described as a red anywhere
  (evidence, commits, PR).

**D3 - Conversion.** Each `await page.evaluate(() => document.fonts.ready)` becomes
`await waitForWebFonts(<container>)` at the same point (after the same visibility awaits), scoped to the narrowest
container holding all text the following measurement reads:
- S1: `page.locator(".spine-header")` (only the header's boxes and the document extents are measured; the extents
  depend on layout of the page as a whole - if the executor finds non-header text affecting `scrollHeight`/
  `scrollWidth`, widen to the page's main region and say why).
- S2: one wait scoped to a container holding both `.spine-header` and `.spine-body` (the narrowest common ancestor;
  name it), since the spine track, header items, main area and step actions are all measured. Called once per `goto`
  (fonts reload per document), not inside the 43-width loop and never inside a poll.
- S3: a container holding the Appearance section and the nav chrome measured by `findClipped` (narrowest common
  ancestor, likely the app shell; name it).
- S4: the run-history modal (the dialog containing `.run-history-modal__row-duration`), called after the existing
  visibility await, per type style.
The import of `waitForWebFonts` already exists in hel1572; add it to hel1579.

**D4 - Green proof.** The same forced-delay scratch runs from D2 (same `waitUntil: "commit"` deviation, hold
re-armed per navigation) with the conversion applied, fonts released concurrently on a timer (HEL-1613 green-run
note) so the new wait sees them settle: green. A run with fonts never released must fail loudly at the
`waitForWebFonts` 10s bound (not at `goto` or the test timeout - that would be invalid) - record that message. Read
mixed-state green runs knowing `loadingFaces` is page-wide: holding one family can block a scoped wait for a
different family (HEL-1613 D5); report such a case as what it is.

**D5 - Repeat runs.** Each touched file: `nice -n 19 npx playwright test <file> --repeat-each=20 --workers=2` (full
file, every project it runs under), lane servers + lane DB, counts recorded as evidence. Any failure is investigated,
not retried away. The C11 "hel1572:126" candidate is identified by TITLE, not by today's line number (today `:126`
falls inside the `findClipped` helper, which is unrelated): resolve it with `git show 943b5dd73^:e2e/hel1572-appearance-preferences.spec.ts`
(the tree just before HEL-1826's "Deflake ... hel1572:126"), where `:126` is the test "re-renders headings with no
reload and survives a fresh browser context (another device)" (now ~`:200`; no `fonts.ready`, no geometry). Check the
note against HEL-1826's recorded root cause (archive `2026-11-22-deflake-hel1820-e2e-specs`): report whether that
test failed in the 20x runs and whether the conversion could plausibly explain it - evidence only, no list changes.

## Risks / Trade-offs

- [page.route cannot see host-ruled font requests] -> D1 finds the working mechanism or BLOCKER; no faked delay.
- [Metric-matched fallbacks make every site green under delay] -> expected by the ticket; recorded as "no red
  possible" per site, converted anyway per the ruling.
- [Wider scope (S1/S3) waits for more families than needed] -> bounded 10s; fonts are local so settle fast.
- [Container strictness] each D3 container must resolve to exactly one element (`target.evaluate` is strict); the
  executor confirms this per site, especially for S3 (e.g. `.app-shell`) and S2's common ancestor.
- [20x of hel1579 is slow (240s timeout test)] -> run per file, under the Bash timeout in chunks if needed
  (e.g. `--grep` per test with repeat-each, as long as every test of the file reaches 20 runs); record the `--grep`
  partition and show each test's counts add to 20.
- [S1 earlier measurements] hel1579 `:274-287` (filter-row width, name readability) still precede any font wait;
  out of scope under C15, noted for HEL-1884 in the PR body.

## Planner Notes

- Self-approved: test-only, no dependency, no product change, `skip_specs: true`. Scope set by owner ruling.
