# HEL-1573: Motion foundation: tokens, motion setting plumbing, shared primitives

## Description

Parent epic: HEL-1570 (v0.9 redesign). Blocks HEL-1584 (motion pass). Related: HEL-1032, HEL-1034, HEL-538.

### Why

The owner's top complaint is a "general lack of motion" that makes Helio feel half-baked. Motion today is a
scattering of one-off transitions. HEL-1032 and HEL-1034 already document inconsistent durations, so motion has to
arrive as a system and not ad hoc.

### What

* Duration and easing tokens from DESIGN.md v3 (e.g. quick, standard, emphasized; an ease-out and a
  gentle-overshoot curve).
* One way to read the user's Motion setting (Full / Subtle / Off, from the Appearance ticket) plus
  `prefers-reduced-motion`. "Subtle" keeps fades and opacity changes and drops translation, scale and overshoot.
* Shared, tested primitives (hooks/CSS utilities):
  * **Staggered entrance:** a fade plus a 4–8px rise, about 40–50ms stagger, used for panel grids and lists.
  * **Layout motion:** elements slide to their new positions when siblings are added, removed or resized, instead
    of jumping.
  * **Value tween:** numbers tween to their new value. Reduced motion means an instant swap.
  * **Crossfade:** a skeleton fading into content in place.
  * **Indicator slide:** the active marker translates between items (rail, tabs, segmented controls).
* Reconcile react-grid-layout's vendor transition durations with the tokens (HEL-1032) and cap ECharts' entrance
  animation at a token duration without replaying it on option changes (HEL-1034). Either fold those in or confirm
  they're superseded.
* The interactive "Motion study" and "Motion II" boards on the epic's canvas are the reference feel
  (`.concertino/design/HEL-1570/`, HANDOFF.md takes precedence over README.md; screenshots Motion*.png,
  MotionLive*.png; canvas sources `canvas/project/Motion.dc.html`, `MotionLive.dc.html`).

## Acceptance criteria

- [ ] Motion tokens exist in `theme.css`, and every primitive uses them (no literal durations in the primitives)
- [ ] With the Motion setting "Off", or OS reduced motion and no saved preference, no primitive animates transform
      or position (verified in a real browser, not jsdom)
- [ ] Each primitive has a unit test and at least one real consumer in the app
- [ ] Panel-grid layout motion uses a single token duration (closes or supersedes HEL-1032)
- [ ] Chart entrance uses a token duration and does not replay on option change (closes or supersedes HEL-1034)

## Driver brief (binding run constraints)

- Premise: HEL-1572 (2a9f9e467) already shipped the Motion setting (`data-motion` root attribute,
  `appearancePrefs.ts` `effectiveMotion()`, `ThemeProvider` context `effectiveMotion`, `useReducedMotion`,
  `utils/prefersReducedMotion.ts`) and the `--motion-*` tokens in `theme.css`. Build on these; never add a second
  way to read the setting. See `.concertino/runs/HEL-1573/evidence/premise-validation.md`.
- HEL-1575 (dashboard tabs, running concurrently) owns the dashboard tab strip and is root-causing a
  react-grid-layout `setLayout` update-depth loop. Do NOT use the tab strip as an indicator-slide consumer. The
  HEL-1032 reconciliation must be CSS/token-only; any change to `PanelGrid.tsx` / `DesktopPanelGrid.tsx` logic or
  layout-motion wiring inside the grid needs an escalation first.
- AC 2 must be verified in a real browser in BOTH themes with screenshots/recordings in evidence.
- Scratch: only `/home/matt/Development/helio/.concertino/scratch/HEL-1573/`. Durable evidence:
  `.concertino/runs/HEL-1573/evidence/`.
