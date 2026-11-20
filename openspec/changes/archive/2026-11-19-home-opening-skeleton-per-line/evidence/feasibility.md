# Task 1.1 feasibility: PASS

Probe: `tools/probe.cjs` + `tools/bar.css` (the D1 span + D2 mask injected into the held placeholder; `reducedMotion: reduce`
flat fill, pixel scan of a screenshot at 5 columns per fragment, threshold 2/255; Home dot-grid specks of 1-2px ignored by
requiring a run of >= 8px).

Browser: the repo's Playwright 1.55.1 bundled Chromium, `browser.version()` = **140.0.7339.186**, on the host and inside
`helio1678-ci` (Liberation) and `helio1678-dv` (DejaVu-only) via `playwright run-server` (--network host); the same build
string in all three. Faces proven with CDP `CSS.getPlatformFontsForNode`: web = Schibsted Grotesk [custom]; fonts blocked =
Liberation Sans (ci), DejaVu Sans (dv), plain host fallback Liberation Sans.

Results (identical in host, ci, dv; light and dark identical):

| width | size | lines | fragments | bar thickness | gap | target |
|--|--|--|--|--|--|--|
| 320, 375, 430 | 20px | 2 | 2 | 16px | 9px | 0.8em = 16 +/-1; gap >= 8 |
| 431, 480, 500, 604 | 24px | 2 | 2 | 19px | 11px | 0.8em = 19.2 +/-1; gap >= 8 |
| 605, 1280 | 24px | 1 | 1 | 19px | - | one bar |

Computed: `box-decoration-break: clone`, `-webkit-box-decoration-break: clone`, `display: inline`, `visibility: visible`
in all runs. Ghost height unchanged (50px at 20px, 60px at 24px, 30px one-line). Rounded ends visible in the screenshots
(`feasibility-screens/`). The D2 targets are met in every face; no ESCALATION.
