## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `bug/tone-contrast-custom-backgrounds/HEL-1490` @ `9e51550f16b7a2d29250e7b2f7e5b8c91076349f`. The
planning artifacts are untracked under this change dir. I took owner ruling C1 (runtime auto-adjust, no editor warning)
as settled and did not re-litigate it.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/tone-contrast-custom-backgrounds/HEL-1490`.
- **Round-1 CR1 (cross-tone wash under a row-rule mark) is resolved.**
  - D3 now scores every tone variant against the surface plus all three washes.
  - The rationale cites the `tableConditionalFormats.tsx` mark placement.
  - Task 1.4 adds the dark `#3366ff` error-on-warning-wash case, and 2.2 adds the cross-tone mark cell to the
    measurement table.
  - The ADDED spec requirement says "every tone's `-surface` wash over it".
- **Round-1 CR2 (rounding margin) is resolved.**
  - D2's "Margin rule" scores against unrounded (float) wash and unit/label composites with an internal target of 4.55.
    The 4.5 contract stays.
  - Task 1.1 pins a near-threshold pair.
  - I checked that the model matches the browser on the one rounding-sensitive input. `buildPanelSurface`
    (`theme/appearance.ts:229-243`) emits integer `rgba(r, g, b, a)`, so the surface is exact in both TS and the
    browser. Only the `color-mix(... transparent)` washes (`theme.css:221-223, 297-299`) and the unit/label mix
    (`PanelContent.css:31,40`) composite unrounded. Those are exactly the backdrops D2 now models in float.
- **I re-ran the revised algorithm independently.** The scratchpad `probe2.js` uses the D2 picker at a 4.55 target with
  t-steps of 0.04, and backdrops of the integer surface plus three float washes. It also runs the D5 mix search at 4.55.
  I ran it over 18 backgrounds × 2 themes:
  - Every tone and the muted delta found a passing step. The NONE fallback was never hit.
  - The worst final minimum across all backdrops is 4.550.
  - D5 p tops out at 72% for the theme-default and readable-literal panel text.
  - Largest tone step: t = 0.68, dark theme on `#ffffff`, error `#f17b67` becomes `#fbd5ce`, a pale pink. That is still
    in the red family, and the glyph and sr label carry the meaning, so AC2 holds. See the notes.
- **Wash shares and token mirrors match `theme.css`.**
  - Dark: 14/14/14% (`theme.css:221-223`).
  - Light: 11/11/10% (`theme.css:297-299`).
  - `--panel-secondary-text-mix` is 60% dark / 62% light (`theme.css:171,261`), and its only consumers are
    `PanelContent.css:31,40` (unit and label). So the per-panel D5 override cannot leak to other text.
- **D7 consumers are complete for the AC1/AC4 surfaces:**
  - `PanelContent.css:53-63` (metric figure tones)
  - `PanelContent.css:270-280` (trend up/down/flat). Every `metric-trend` usage in `MetricRenderer.tsx:118,137-140,182`
    carries a direction modifier, so the 60% base colour never shows on its own.
  - `TableRenderer.css` (cell tone text and tone marks)

  The table wash sits over the panel surface. Pinned cells layer the wash over `--panel-surface-override`
  (`TableRenderer.css` pinned rules, `DataGrid.css:212-213`), so "surface + wash" is the right backdrop model in both
  the pinned and unpinned cases. D7 now settles the fullscreen and public paths, and the public-viewer scenario wording
  was fixed as round 1 suggested.
- **ECharts (AC6):** no tone or delta colour reaches ECharts, and the picker output is `#rrggbb`. Confirmed.
- **Spec validity:** `openspec validate tone-contrast-custom-backgrounds --strict` printed "Change
  'tone-contrast-custom-backgrounds' is valid".
- **ACs to tasks:**

  | AC | Covered by |
  | --- | --- |
  | AC1 | D2/D3, 1.1-1.6, 2.2 |
  | AC2 | D2 |
  | AC3 | D5, 1.4 |
  | AC4 | D3/D7 |
  | AC5 | D4, 2.3 |
  | AC6 | D2 hex output |
  | AC7 | 1.1/1.4 red-first, 2.1 (no `eslint-disable`) |
  | AC8 | 2.2 |

  No placeholders, no TODO/TBD, no scope drift, and no editor change.

### Verdict: CONFIRM

The design is sound enough to implement. Both round-1 blockers are fixed in design.md, tasks.md and the spec deltas,
and my independent model of the revised rules finds no failing case. The items below are nits for the executor to fold
in. None of them blocks.

### Non-blocking notes

1. **Spec wording vs the 4.55 margin.** The ADDED requirement says "When the tone token already does [measure >= 4.5],
   the token SHALL be used unchanged". `panel-appearance-settings` says "token unchanged when it passes". With D2's
   internal 4.55 target, a token measuring 4.50-4.55 on a custom background would be stepped, which contradicts that
   literal SHALL.
   - It is low impact: it only happens on custom backgrounds, and only in a 0.05 band.
   - The executor should still align the wording, for example "when the token clears the threshold with the design's
     rounding margin", so the evaluator does not read the near-threshold test as a spec violation.
2. **D5 has no stated result when no p reaches 4.55.** `resolvePanelTextColor` only guarantees 4.5. A custom panel text
   colour at 4.50-4.55 on its surface would leave the D5 search empty. My probe found grey custom texts in that band on
   light `#3366ff`/`#00ffff`/`#ffc0cb` and dark `#000000`/`#008000`/`#20b2aa`.
   - Implement it as "cap at 100%". At 100% the browser renders `currentColor` exactly, with no composite rounding, so
     the 4.5 contract still holds.
   - Pin that case in the 1.4 tests.
3. **The MODIFIED "Rendering per Output kind" requirement under-describes the backdrops.** It says "against the tone's
   wash over that surface", while the ADDED requirement and D3 say every tone's wash. It is a subset, not a
   contradiction. Aligning it would avoid confusion.
4. **AC2 judgement at the extreme step.** The dark-theme `#ffffff` error variant (`#fbd5ce`, t = 0.68) is very pale. The
   final-gate skeptic should look at it in the running app next to the success and warning variants on that background,
   to judge whether the three tones remain distinguishable by colour as well as by glyph.
5. **Follow-ups outside AC1/AC4, not introduced here.** Other panel-body tone text also reads raw tone tokens on custom
   backgrounds:
   - form errors (`FormPanel.css:29`, `CounterControl.css:28`)
   - `PanelInspectView.css:12` (warning wash)

   Non-tone text in row-washed cells (round-1 note) is the same kind of gap. List these as follow-ups if 2.2's
   measurements show them failing.
