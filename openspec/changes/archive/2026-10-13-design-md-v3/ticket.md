# HEL-1571: DESIGN.md v3: sans+mono default, motion system, rail+tabs shell, live preview

## Description

DESIGN.md binds every frontend ticket and the Skeptic gate. Its v2 "curated instrument" doc fixes Fraunces as the display face and has no motion system or shell guidance. Over time it has also filled up with contrast forensics (the HEL-866 backdrop split, BottomNav glass measurements, the rules for enlarged tap areas tiling without overlapping) that crowd out design intent. The v0.9 re-design needs the doc updated first, or every later ticket will fail review against v2.

First child of epic HEL-1570 (v0.9 re-design: rail + tabs shell, Home, live pipelines, motion). Blocks HEL-1572 (Appearance settings), HEL-1573 (Motion foundation), HEL-1574 (Shell), HEL-1583 (Mobile dashboard + glass nav v2). DESIGN.md v3 becomes binding for every later frontend ticket in the epic.

## What

* **§0 design idea:** keep the warm neutral structure and the scarce accent. Type becomes **Schibsted Grotesk + JetBrains Mono** by default. Fraunces moves to an optional "Serif headings" type style (see the Appearance settings ticket, HEL-1572). State the "human touch" principle (plain-language copy, motion with some give, no gratuitous decoration).
* **Shell section:** icon rail, a resizable and collapsible context list (min/max widths, persisted), dashboard tabs, the meta row replacing page titles, and `⌘K` as "search, jump, or ask".
* **Motion section:** duration and easing tokens, "one entrance per surface" generalised into the motion primitives (staggered entrance, panels sliding to new positions, value tweens, crossfades), and the Full / Subtle / Off setting with `prefers-reduced-motion` as the default.
* **Live-preview pattern:** draft state vs saved, how the "live" marker is used, and changed rows flashing.
* **Glass nav v2:** 5 tabs, an expanding active label. Keep the HEL-774 contrast floor.
* **Densify gutters:** mobile edge gutters 10–12px.
* Move the measurement and contrast forensics into an appendix (or `docs/`) so the main body reads as intent. Do not delete the guards they describe.
* Matching token changes in `theme.css` (motion tokens, wider dark surface ramp if adopted).

Reference boards: B2 Dashboard, Home, Pipeline live, Motion II, Appearance, Dashboard/Pipeline mobile. Local copy (gitignored): `/home/matt/Development/helio/.concertino/design/HEL-1570/` — read `HANDOFF.md` first; approved boards are B2Dashboard, Home, PipelineLive*, MotionLive*, Appearance, DashboardMobile, PipelineMobile, Motion*. Main, RailWorkspace, Desk, PipelineDesktop are superseded. Precedence: ticket ACs and owner rulings, then HANDOFF.md, then the boards.

## Fixed constraints (driver brief + epic)

* The user-customizable accent and the glass BottomNav stay. Nothing may hardcode the accent or fonts; future user themes must remain possible.
* Do not delete any existing guard test or the guards the forensics describe (moving prose is fine).
* Motion tokens named in DESIGN.md must exist in theme.css — verified by a command, not by reading.
* Any visual change in theme.css is checked against the running app in both themes.

## Acceptance criteria

- [ ] DESIGN.md states sans + mono as the default type pairing and describes Fraunces only as an optional type style
- [ ] DESIGN.md has a Motion section with named duration/easing tokens that exist in `theme.css`, plus the rule for the Full / Subtle / Off setting and reduced motion
- [ ] DESIGN.md has a Shell section covering rail, context list, tabs, the meta row and `⌘K`, and a Live-preview pattern section
- [ ] Contrast/measurement forensics live in an appendix or `docs/` file linked from the main body; every existing guard test still passes
- [ ] Existing frontend lint, typecheck and tests pass unchanged
