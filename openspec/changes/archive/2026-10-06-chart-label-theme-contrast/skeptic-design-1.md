## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- buildChartOption.ts:100-163 on main: `textColor = appearance?.color` is written verbatim into textStyle, xAxis/yAxis nameTextStyle, axisLabel.color, legend.textStyle (pie and non-pie). Matches design Context.
- chartAppearance.ts:162-190: the base option never sets axisLabel/legend colour (only tooltip uses themeTokens.text), so the "inherit" override is the only text colour source. Claim holds.
- appearance.ts:245-274: resolvePanelTextColor returns palette defaultText for "inherit" unless contrast < 4.5, then flips. Palette defaultText (#f2efe9 / #211d19) equals theme.css --app-text (lines 155/239). "transparent"/unparseable background falls back to the base surface (resolveTintedSurface), so D2's `background ?? "transparent"` is safe.
- useChartOption.ts already has `theme` from useTheme() and themeTokens.text; threading theme is straightforward. buildChartOption's only prod caller is useChartOption (per premise doc).
- Every AC maps to a task: AC1 -> 1.2/3.4 (all four kinds, both themes, ratio + threshold); AC2 -> 2.x + spec; AC3 -> D5 screenshots/3.4.
- No placeholders/TODOs blocking implementation; no contradictions between proposal/design/tasks/spec. No backend/schema delta needed.

### Judgment calls asked by the orchestrator
- D1 (inherit -> panel text colour --app-text, with card contrast flip): sound under DESIGN.md. It adds no token and changes no token value, reuses the existing resolvePanelTextColor rule (one owner), and DESIGN.md says text uses --app-text/--app-text-muted and forbids untokened colour. The "muted axes" alternative is the real visual-hierarchy call, but it is rejected with a defensible reason (muted is near the 4.5 floor; card doesn't share the rule) and is noted as a separate decision. Choosing the colour the card already uses for "inherit" is honouring existing semantics, not a new product decision. NO escalation needed; do not park the lane.
- D6 + D5 adequacy: adequate. The defect is the option value, so a red-first unit test with mutation proof is the right seam; the rendered measurement (zrender fill + pixel sample, before/after, both themes, tinted case) covers what jsdom cannot. Not a CI gate, acceptable given the AC asks for measurement/visual check.
- D4 pie: scoped acceptably. Measure-then-decide is honest; slice-label colour that comes from the sector is out of "axis and legend text" AC wording, provided it is recorded explicitly in evidence (the AC does say measure pie, so the measurement must still be reported).

### Verdict: CONFIRM

### Non-blocking notes
- Add a contingency to D5/task 1.2: if the "before" measurement shows the canvas already paints a passing colour (the premise's rendered colour is explicitly UNVERIFIED), record that, still ship the explicit-token guard, but state the finding honestly in docs/contrast-audit.md and the PR rather than claiming a before-fail.
- Ensure the pie unit tests assert legend.textStyle and global textStyle (pie has no axis keys) and that the compact-mode path (spread of `built`) does not drop the colour.
- 3.3 palette-vs-theme.css assertion: confirm no existing guard first (grep found none for defaultText in tests).
- Also assert the explicit-colour case does not call the flip path (explicit "#336699" returned unchanged even on a tinted surface where card would flip) - matches the stated Non-goal.
