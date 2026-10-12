## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `bug/tone-contrast-custom-backgrounds/HEL-1490` @ `9e51550f16b7a2d29250e7b2f7e5b8c91076349f` (planning
artifacts untracked under this change dir). Owner ruling C1 (runtime auto-adjust, no editor warning) was taken as
settled. I judged whether the design implements it soundly, not whether it is the right ruling.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/tone-contrast-custom-backgrounds/HEL-1490`.
- **Design Context claims checked against the live tree:**
  - `getPanelCardStyle` (`frontend/src/features/panels/ui/PanelCard.tsx:23-40`) is the only writer of
    `--panel-surface-override` / `--panel-text-override`. Its only other caller is `MobilePanelStack.tsx:159`, so the
    375 px path is covered. Correction: it emits both vars on every panel, including transparent ones. D4's "only when
    `background !== transparent`" condition still keeps default panels free of the new vars.
  - `appearance.ts` has `parseHexColor`, `blendColors`, `resolveTintedSurface`, `getContrastRatio` and
    `themeAppearancePalette`, all module-private. `resolvePanelTextColor` keeps the preferred text only if it clears
    4.5 against the 0.24-tinted surface. Confirmed.
  - The tone tokens and wash shares match `theme.css`. Dark (`theme.css:202-223`): `#4cc38a/#f5b944/#f17b67`, 14%.
    Light (`theme.css:293-299`): `#166d43/#85551a/#af3325`, 11/11/10%. `--app-text-muted` is `#aaa49c` / `#645e56`.
    `--panel-secondary-text-mix` is 60% / 62%. Confirmed.
  - Consumers: `.panel-content__metric-figure--tone-*` is at `PanelContent.css:53-63`. Trend up/down/flat is at
    `PanelContent.css:270-280`, and every `metric-trend` usage in `MetricRenderer.tsx:118,182` carries a direction
    modifier. `td.ui-data-grid__cell--tone-*` and `.ui-data-grid__tone-mark--*` are in `TableRenderer.css:131-205`. The
    unit and label use `color-mix(currentColor var(--panel-secondary-text-mix), transparent)` at
    `PanelContent.css:31,40`. Confirmed.
  - No tone or delta colour reaches ECharts. Confirmed from the consumers above (DOM text and an SVG polyline only).
- **Re-running the algorithm.** I wrote a standalone JS model of D2/D3/D5 that copies the `blendColors` and
  `getContrastRatio` maths (scratchpad `probe.js`). I ran it over 10 backgrounds × 2 themes × 3 tones, plus muted and
  unit/label:
  - The planner's prototype numbers reproduce: light `#ff0000` gives 3.54-3.57 on the wash; light `#3366ff` unit gives
    4.15; dark `#ffffff` error gives 2.59 on the wash; dark `#ffcc00` unit gives 4.19.
  - D2 always finds a passing step with no NONE fallback, and the direction is always away from the theme surface.
    Light surfaces have L >= 0.52, so steps go darker. Dark surfaces have L <= 0.083, so steps go lighter.
  - Largest step: t = 0.56 (dark `#ffffff` error goes to `#f9c5bc`). That is still a pale red, so AC2 is plausible.
  - D5: p tops out at 71% (dark `#ffffff`). The 100% case is guaranteed, which confirms the "100% always passes" claim.
  - Default surfaces: every tone passes on its own wash and on the other tones' washes, minimum 4.86. AC5 is safe.
- **Tone-mark placement.** `tableConditionalFormats.tsx:16-20,46-74`: a row rule's mark sits at the start of the row's
  first visible data cell. A cell rule on that cell replaces the row wash (`TableRenderer.css` header comment). So a
  row-rule mark of tone A can sit on tone B's wash. **The design does not cover this case; see CR1.**
- **Rounding of the wash composite.** For dark `#00ffff` with the success variant `#8cd9b4`, the rounded TS wash
  `#1c5f56` gives 4.5023. The unrounded composite gives **4.4872**, and the wash one 8-bit step brighter gives
  **4.4356**. **The picker can certify a pass that the browser renders as a fail; see CR2.**
- **Fullscreen and public paths (D7).** The fullscreen overlay is a native `<dialog>` (`shared/ui/Modal.tsx:211`,
  `showModal()`, no portal) rendered inside the card's `<article style>` (`PanelCard.tsx:187,270`), so it inherits every
  inline panel var on `--app-surface-strong`. Because variants always step away from the theme surface, inheriting
  them only raises contrast there. The public viewer (`PublicDashboardViewerPage.tsx:114`) never applies
  `getPanelCardStyle`, so it shows the default surface, where the tokens pass. D7's deferred check therefore resolves
  safely either way.
- **Spec deltas.** The MODIFIED "Rendering per Output kind" requirement is a full copy of the live
  `openspec/specs/output-conditional-formatting/spec.md` requirement. `openspec validate tone-contrast-custom-backgrounds --strict` printed
  "valid".
- **ACs to tasks.** AC1 maps to 1.1-1.6 and 2.2. AC2 maps to D2. AC3 maps to D5 and 1.4. AC4 maps to D3/D7. AC5 maps to
  D4 and 2.3. AC6 maps to D2's hex output. AC7 maps to 1.1, 1.4 and 2.1. AC8 maps to 2.2. No scope drift. No editor
  change is planned.

### Verdict: REFUTE

The approach is sound: a TS picker on the already-resolved surface, inline vars only when needed, token fallback in
CSS, and guarded mirrors. Two defects would let the design pass its own tests and still fail AC1 in the running app.

### Change Requests

1. **D3 leaves out the cross-tone wash under a row-rule tone mark, so AC1 fails for `.ui-data-grid__tone-mark--*`.**
   - `withCellRules` (`tableConditionalFormats.tsx:46-74`) puts the row rule's mark in the first visible data cell. When
     that cell also matches a cell rule of another tone, the cell carries the other tone's wash.
   - D3 only scores each tone against the surface plus its own wash. Running D3 as written, the picked variant misses
     4.5 on another tone's wash in 21 combinations I measured, for example:

     | Theme | Background | Mark (variant) | Sits on | Contrast |
     | --- | --- | --- | --- | --- |
     | dark | `#3366ff` | error `#f28673` | warning wash | 4.17 |
     | dark | `#00ff00` | error | warning wash | 4.07 |
     | dark | `#808080` | success | warning wash | 4.33 |
     | light | `#ff0000` | error | success wash | 4.49 |

   - Required: amend D3 so the backdrops for each tone variant are the surface plus **all three** washes over it. This
     is the simplest single variant per tone; a separate mark-only variant would also work if justified. Then add a
     test case to 1.4 (for example dark `#3366ff`: the error variant is >= 4.5 against the warning wash). Add the
     cross-tone mark cell to 2.2's measurement table.
2. **Close the threshold-rounding gap between the TS model and the browser composite (D2, D3, D5).**
   - D3 models the wash as `blendColors(surface, tone, share)`, which rounds to 8 bits. D5 does the same with the
     alpha-composited unit/label.
   - The browser composites `color-mix(..., transparent)` from the unrounded alpha. My dark `#00ffff` success case
     certifies at 4.502 in TS but is 4.487 unrounded. AC1, AC3 and AC8 are hard ≥ 4.5 floors measured from computed
     styles, so a just-passing pick can be refuted in the running app.
   - Required: state one rule in D2 that gives a margin, and pin it in a 1.1/1.4 test with a near-threshold pair. Either
     of these works:
     - score against the unrounded (float) composite and require the pass on both the rounded and the float backdrop;
     - use an internal target such as 4.55 while keeping the 4.5 contract.

### Non-blocking notes

- D7 can be settled now instead of handed to the executor, using the facts above: the fullscreen overlay inherits the
  vars as a non-portalled `<dialog>`, and the public viewer shows the default surface. Record that in design.md so
  task 1.7 becomes a confirmation step.
- The MODIFIED scenario "Public dashboards render the same styling" says the public viewer renders "the same tones" as
  the authenticated dashboard. For a custom-background panel, the authenticated card will show a variant, while the
  public viewer shows the token on the default surface (it never applies the custom background). Reword it, for
  example "the same tones for a panel with no custom background", so the evaluator does not read it as a
  contradiction.
- Existing gap, not introduced here: ordinary (non-tone) panel text inside a row-washed cell on a custom background is
  only checked against the surface by `resolvePanelTextColor`, not against the wash. It is outside AC1's "tone text"
  wording; list it as a follow-up if 2.2 shows it failing.
- Existing comment drift, not introduced here: `theme.css:213-216` says "no rendered instance pairs --app-error with a
  different intent's tint". The row-rule mark placement does pair them. Default surfaces still pass (min 4.86), so it is
  harmless today, but the comment is wrong.
- Panel transparency > 0 makes the true backdrop differ from the opaque tinted surface. The design states this
  approximation and inherits it from `resolvePanelTextColor`, which is acceptable.
