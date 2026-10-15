## Context

See proposal.md - Why. Facts from the tree (main 60086f02b):

- `frontend/app.html:32` loads Schibsted Grotesk / JetBrains Mono / Fraunces from fonts.googleapis.com via a
  NON-BLOCKING stylesheet (`media="print"`, swapped to `all` in `onload`). Until that stylesheet applies, no web
  `FontFace` exists in `document.fonts`, so `document.fonts.status` can read `"loaded"` vacuously and
  `document.fonts.ready` resolves immediately. The ticket's suggested `status === "loaded"` wait is therefore a claim
  whose sufficiency depends on ordering (stylesheet applied before the row is visible?) and MUST be probed.
- CI fetches the fonts from Google's CDN (no `page.route` stub for fonts anywhere in e2e/). Any wait must be bounded.
- HEL-1605 skeptic evidence (`.../skeptic-final-evidence-2/reflow2.log`): the row-height change is observed at the
  `rect` sample BEFORE the `loadingdone` event (e.g. 817 vs 845ms), i.e. layout changes when the face is applied.
- Call sites: `rowDeleteGesture.ts` `gotoSettled` (:175) and `placeBottomNearViewportEdge` (:8, via `settledRowTop`);
  `hel1574-shell-rail.spec.ts` bare `page.goto("/sources")` (:374) and the HEL-1604 test loop (:477+);
  `hel1605-row-delete-confirm.spec.ts` uses `gotoSettled` + `placeBottomNearViewportEdge` (:95/:100/:156/:171/:216/:273).

## Goals / Non-Goals

**Goals:** a deterministic, bounded, non-vacuous "web fonts are applied" wait, owned by one shared helper, used by
every row double-click test before a gesture point is computed; measured before/after flake rates.

**Non-Goals:** product font changes; retries/timeouts; adopting the helper in unrelated specs.

## Decisions

**D1 - Probe the mechanism first (gating).** Before writing the fix, the executor writes a throwaway probe spec
(scratch dir, not committed) that logs, per frame from navigation: the font stylesheet link's `media`, the
`document.fonts` size/status and each web face's status, and a mid-list row's rect. It must establish: (a) whether
`status === "loaded"` can be true before the stylesheet applies at the moment a row is first visible (vacuous pass);
(b) the predicate that actually guarantees no further reflow. The fix is chosen from the probe's output, not from
this document. If (a) never occurs over >= 20 loads, the simple predicate may be kept, but the helper still asserts
non-vacuity (D2) because ordering is network-timing dependent.

**D2 - Predicate shape (expected; confirm by D1).** Evaluated only once the gesture's target row is visible (D4).
Settled when ALL of: the Google Fonts stylesheet link's `media` is `all` (onload ran); no face in `document.fonts` is
`loading`; `document.fonts.status === "loaded"`; and (if D1 shows it is non-vacuous) the faces the target row's text
actually uses are `loaded` or `error`. Faces left `unloaded` are ALLOWED: the stylesheet defines ~34 faces (every
unicode-range subset, Fraunces, unused JetBrains Mono weights - verified by the design skeptic) and Chromium only
fetches faces some rendered text needs, so a "nothing unloaded" rule would never pass. Alternative considered:
`document.fonts.check(...)` - vacuous for unregistered families; use only if D1 shows otherwise. Rejected:
`document.fonts.ready` after `goto` (shown vacuous by HEL-1605 skeptic).

**D3 - Bounded, loud failure.** The helper waits with an explicit bound (e.g. 10s, `waitForFunction`'s own timeout -
not a raised test/expect timeout) and on timeout throws naming the observed state (stylesheet media, loading faces).
A face that ends in `error` counts as settled (an errored face never swaps). A stylesheet that fails to load also
never swaps: if D1 shows that case is detectable from the page (probe with `page.route(...fonts.googleapis.com...,
r => r.abort())`, e.g. via a `performance` resource entry or an `error` listener), the helper treats it as settled so
a Google Fonts outage keeps today's pass-on-fallback behaviour; otherwise it fails loudly and the report says so.
`pwaConfig.ts` runtime-caches Google font files - the probe must note whether a service worker is active in the e2e
context, since a warm cache skews arrival timing.

**D3a - Fake clock.** `installFreshClock` installs Playwright's fake clock before navigation in the four
label-ageing tests. D1 must confirm that `page.waitForFunction` (default rAF polling) and the font-load path still
progress under that clock; if not, the helper polls with an explicit `polling` interval or is placed so it works,
and the report shows it working inside one fake-clock test.

**D4 - Ownership and placement.** New `e2e/support/webFonts.ts` exporting `waitForWebFonts(page)`, reusable by any
layout-sensitive spec. It is called from `settledRowTop(button)` in `rowDeleteGesture.ts` (before its stability
loop), because EVERY row double-click in both specs reaches its gesture point through `settledRowTop` (directly, or
via `placeBottomNearViewportEdge`), at which point the target row is visible. NOT in `gotoSettled`: it has no row to
wait on and on /pipelines can return before rows render, so a wait there can pass before any font load starts.
Fonts reload per document, so the wait runs per navigation via each `settledRowTop` call. Call sites the executor
must enumerate and verify (grep, line numbers in the report): hel1574-shell-rail.spec.ts 1280/375 double-click test
(:374 bare goto -> `placeBottomNearViewportEdge`) and the HEL-1604 820/375 test loop (:477+); hel1605 spec :95/:100,
:156/:171, I19 (:216/:225/:236), I17 (:273/:281/:287/:307). Any double-click path NOT going through `settledRowTop`
gets an explicit call. The wait never inspects labels (HEL-1605 AC unaffected).

**D5 - Measurement.** "Before": run the two row double-click specs at `--repeat-each=30 --workers=2` on base, AND a
forced-delay repro (delay the font response ~600ms-1s via `page.route` on fonts.gstatic.com so the swap lands after
`settledRowTop`), run on at least one fake-clock (`installFreshClock`) double-click test, showing red without the
wait and green with it - the natural rate (~3%) is too low to prove by repeats alone. "After": same repeats on the
fix. The forced-delay probe stays out of the committed suite unless cheap and deterministic (executor's call,
stated in the report).

## Risks / Trade-offs

- [Google CDN slow in CI adds wait time] -> bounded; the fonts are cached after the first document per context.
- [Predicate vacuous on some ordering] -> D1 probe + D2 non-vacuity requirement.
- [Font host unreachable] -> errored faces count as settled (D3); stylesheet-never-applied fails loudly.

## Planner Notes

- Self-approved: test-only, no new dependency, no product change, `skip_specs: true`.
- The optional product AC is deferred (unattended overnight run; UI change). Recorded in proposal Non-goals.
