# HEL-1749 measurements (head implementation)

Browser: Playwright 1.55.1 bundled Chromium 140.0.7339.186 on the host and in `helio1678-ci` / `helio1678-dv`
(`playwright run-server`, --network host). Faces proven with CDP in the sweep (`sweep-*.out`): web = Schibsted Grotesk,
fonts blocked = Liberation Sans (ci, host) / DejaVu Sans (dv).

## Bar look vs D2 targets (`head-faces.txt`, real CSS, pixel scan of a screenshot, flat fill)
- 20px size (320, 375, 430): 2 lines, 2 fragments, thickness 16px (0.8em = 16), gap 9px (>= 8).
- 24px size (431, 480, 500, 604): 2 lines, 2 fragments, thickness 19px (0.8em = 19.2, +/-1), gap 11px.
- 605 and 1280: 1 line, 1 fragment, 19px.
- Same numbers in the web font, Liberation fallback, DejaVu fallback; light and dark. The `[16, 2]` at 320 in the Liberation
  fallback is a 2px speck of the Home page's dot-grid background below the bar, not part of it (the e2e takes runs >= 8px).
- Corners: the top-left pixel is page background and 8px along the top edge is bar (e2e, every geometry width).
- Computed `box-decoration-break` and `-webkit-box-decoration-break` = clone; the placeholder height is unchanged.

## Layout guard (C2)
- HEL-1737 `vsweep2.cjs` (ghost height, web font vs fonts blocked, 320-1300, light and dark): zero differing widths of 981
  at head in both images (`sweep-ci.out`, `sweep-dv.out`) and on base (`sweep-base-*.out`).
- Host: hel1665 four files 90 passed (`guards-host-1/2.txt`), hel1678 + hel1572 + the new spec 63 passed (`guards-host-3.txt`).
- CI-like browser: hel1665 light x2 + dark summary-first 65 passed, hel1665 dark dashboards-first + hel1678 + the new spec 73
  passed (`guards-ci-1/2.txt`).
- Not run: the hel1665/hel1678 files in the dv browser (the sweep, which is the placeholder-height guard, was).

## Screens
`screens/lines-{light,dark}-{431,500,604,1280}.png` and `-500-reduced.png` (e2e, host web font); `screens/{host,ci,dv}-*`
(probe, web and fonts-blocked faces at 320, 431, 604, 1280).
