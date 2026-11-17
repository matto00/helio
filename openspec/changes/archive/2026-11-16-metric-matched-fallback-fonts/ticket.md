# HEL-1678: Metric-matched fallback fonts (size-adjust) so a cold first load doesn't reflow Home by up to 24px under wide fallback fonts

## Description

origin_kind: followup
origin_ticket: HEL-1665 (PR matto00/helio#1068, merged as 25aca3660)

HEL-1665 made Home move 0px once fonts are loaded, in Sans, Serif and Mono. The cold-load reflow when the web font
arrives depends on the platform's fallback font, and under a wide fallback it is now worse than on base. Measured in
Docker noble with DejaVu, CI-like, in px:

| width | base | after HEL-1665 |
| -- | -- | -- |
| 375–540 | 4 | 8 |
| 620 | 4 | 24 |
| 1024 | 4 | 22 |
| 1280 | 4 | 24 |

Locally (a narrower fallback) it is 2 vs 3–4.

**Fix:** declare metric-matched fallback `@font-face`s (`size-adjust`, `ascent-override`, `descent-override`,
`line-gap-override`) for the heading and body faces, so the fallback occupies the same box as the web font. This is the
general fix, outside Home.

Also from HEL-1665:

* Confirm the "Serif headings" cold-load swap; an approximation measured about 30px at 540px.
* Placeholder polish: one bar per line at 431–604px.
* Remove the redundant nested `aria-hidden` in `DashboardShelf.tsx`.
* Add Home e2e coverage under a larger browser default font size.
* `design.md:145` in the archive quotes 22–26px; the final figure is 22–24.

## Acceptance Criteria

The cold-load swap measured under the CI-like fallback is at most 4px at every width above, recorded in light and dark.
The 0px-after-fonts-load series stays green.

## Driver notes (claims to verify, not facts)

- Reproduce the Docker noble + DejaVu measurement environment (or explain the stand-in); measure base first, red-first.
- Do the cheap extras; anything that grows into scope becomes a follow-up.
- Parallel lanes: HEL-1705 (frontend/src/features/pipelines/...), HEL-1731 (e2e/hel1681-refresh-control.spec.ts).
