# HEL-1757: e2e: stop third-party font requests from hanging any page.goto (shared fixture)

## Description

Follow-up of HEL-1754 (PR matto00/helio#1150, merged as 6e334120a).

HEL-1754 found that a Google Fonts stylesheet request that never answered held the page's `load` event open, so
`goto("/login")` timed out (hel813:93). The fix covers only the `uiLogin` helper: it now waits for
`domcontentloaded`. Every other `page.goto(` in `e2e/` (356 calls) still waits for `load`, so any of them can hang
on a stalled fonts request the same way.

**Fix:** handle the fonts host once, in a shared Playwright fixture, so no spec depends on it. For example, route
`fonts.googleapis.com` and `fonts.gstatic.com` to a local stub or an immediate empty response.

## Acceptance criteria

* One shared fixture applies to every spec. No per-spec edits.
* Fails first: stall the first fonts request in a spec that uses a bare `page.goto`. It is red before the fixture
  and green after. Record both runs.
* Check that visual specs are not affected by the font change, or state why they are.

## Driver context (claims, verified at Planning)

* Several e2e specs MEASURE the web font's rendering (Home opening sentence 40ch width/line count in
  hel1665-home-phone-stability, HEL-1737 font-independent cap specs, fallback-vs-web-face comparisons). An empty-stub
  response would change what those specs measure; prefer serving the REAL font files from a local committed copy via
  routing, proven with CDP getPlatformFontsForNode / document.fonts.check before and after.
* Font licensing must be verified before committing font files; escalate if not clearly allowed. (Verified at
  Planning: Fraunces, Schibsted Grotesk, JetBrains Mono are all SIL OFL 1.1 in google/fonts `ofl/`.)
* Frontend e2e only: no Flyway migration, no model calls.
* Concurrent lane HEL-1744 may touch shared e2e fixture/config; report exactly which shared e2e files change.
