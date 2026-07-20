## Skeptic Report — final gate (round 1)

Commit under review: `794a4168` on `feature/panel-caption-annotation/hel-318`.
Ground truth: full `git diff main...HEAD`, the actual source files, fresh gate
runs, and a live UI session on `:5491`/`:8398`. The evaluator's PASS was treated
as a claim and re-verified independently.

### What I verified (with evidence)

**Verification gates — all re-run fresh, full output read:**
- Backend `sbt test` → `Tests: succeeded 1456, failed 0, canceled 0` (exit 0).
- Frontend `npm test` → `Test Suites: 112 passed`, `Tests: 1182 passed` (exit 0).
- Frontend `npm run lint` → `eslint src --max-warnings=0` (exit 0, zero warnings).
- Frontend `npm run build` → PWA build generated `dist/sw.js` (exit 0).
- `openspec validate panel-caption-annotation --strict` → `Change ... is valid` (exit 0).

**Acceptance criteria — traced to real code + live behavior:**
- **AC1 (image caption renders / hidden when unset)** — `ImagePanel.tsx` renders
  `.image-panel__caption` only when `caption?.trim()` is truthy, inside
  `.image-panel-frame` after the visual (so it also shows over the placeholder,
  per spec scenario 3). LIVE: with no caption the strip was absent; after I typed
  and saved a caption it rendered beneath the (broken-URL) image. Confirmed.
- **AC2 (chart annotation renders / hidden when unset)** — `ChartRenderer.tsx`
  renders `.chart-panel__annotation` only for non-blank trimmed text, threaded
  `PanelContent → ChartRenderer annotation={panel.config.annotation}`. LIVE: the
  "amount by name" chart shows "Source: Bureau of Labor Statistics — preliminary Q3
  data, subject to revision" as a muted footnote; metric/table/timeline panels show
  none. Confirmed.
- **AC3 (scales, truncates/wraps rather than overflows)** — both elements use
  identical clamp CSS (`-webkit-line-clamp: 2`, `overflow: hidden`,
  `word-break: break-word`, `flex: 0 0 auto`) with the visual/canvas as
  `flex: 1 1 auto; min-height: 0`. LIVE: I set a ~240-char caption; in the grid
  panel it clamped to exactly 2 lines with an ellipsis and did not push the image
  out or overflow horizontally. Confirmed at 1440px; annotation shares the CSS.
- **AC4 (round-trips create/PATCH/read + config UI)** — backend persists via two
  dedicated nullable columns wired through `PanelRow`/`PanelTable`, the HList `*`
  projection (28 cols), AND `configColumnsOf`/`configColumnValuesOf` (the HEL-296
  single-source-of-truth the PATCH `replace`/`batchUpdate` write path uses).
  Two-level `Option[Option[String]]` Patch with absent=unchanged / null·blank=clear
  / value=set. `ImageEditor` + `ChartDisplayFields` expose a shared `TextField`;
  `panelPayloads`/`panelThunks`/`panelService` thread it. LIVE: the caption survived
  a Save + modal re-open + grid re-render (DB round-trip). Confirmed.
- **AC5 (stretch: MCP)** — `create_panel` config is a `z.record(z.unknown())`
  passthrough; the tool description now documents `caption` (image) and
  `annotation` (chart). No generic config-update MCP tool exists to extend, so the
  create surface is the full applicable surface. Satisfied.

**Wire-omission & clear semantics (design Decision 3) — independently confirmed:**
- `ImagePanelConfig`/`ChartPanelConfig` fields are `Option[String]` under
  `DefaultJsonProtocol`, so `None` is omitted (never `null`). `PanelSpec` asserts
  `fields.contains("caption") shouldBe false` when unset (and the same for
  annotation), plus absent/null/blank/value Patch + applyPatch coverage. Blank
  normalizes to `None` at every boundary (decode, PATCH decode, `PanelRowMapper.
  normalizeText` read path, and render-time `trim()`).
- `PanelRowMapperSpec` covers the full create→duplicate→read row round-trip for
  both fields plus NULL/blank⇒None (duplication/export parity — design risk closed).

**Design judgment (my domain):**
- Both new CSS blocks use only tokens (`--space-*`, `--text-xs`, `--app-text-muted`,
  `--font-sans`); editors reuse the shared `TextField` and existing
  `panel-detail-modal__data-*` label/section classes. No hardcoded colors/spacing.
- LIVE light/dark parity: toggled the theme; caption strip and chart footnote both
  render in adaptive muted grey against each background, still clamped and readable.
- 0 console errors on `:5491` after the live edit/save cycle.

**CONTRIBUTING [mechanical]:** scalar-per-column idiom matches
`image_url`/`divider_color`; no inline FQNs; tolerant read path consistent with the
mapper's established philosophy; HList column-count comment updated (26→28); no
dead code / TODOs.

### Verdict: CONFIRM

All four required ACs and the stretch trace to real, re-verified evidence; every
gate is green on a fresh run; wire/clear semantics and duplication parity are proven
by meaningful tests and a live round-trip; the UI is on-pattern in both themes.

### Non-blocking notes
- The chart annotation renders as a footnote **beneath the chart canvas** rather
  than a subtitle directly under the title text. The spec/design consistently say
  "subtitle/**footnote**", so this is within the stated latitude, and a source-credit
  footnote is the conventional placement for the motivating use case — I judge it
  correct, not a defect. Flagging only because design.md D4 also uses the phrase
  "beneath the title area."
- My live test left a long test caption on the "Image Display" panel of the
  `skeptic-output overview` dev dashboard (harmless dev-DB state, like the
  evaluator's artifacts).
