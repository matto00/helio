## Evaluation Report — Cycle 1

Commit reviewed: `794a4168` on `feature/panel-caption-annotation/hel-318`.
Primary surface: `git diff main...HEAD`. All verification gates re-run independently
for fresh evidence.

### Phase 1: Spec Review — PASS

Traced all four HEL-318 acceptance criteria against the implementation and the three
spec deltas:

- **AC1 (image caption renders / hidden when unset)** — `ImagePanel.tsx` renders a
  `.image-panel__caption` strip only when `caption?.trim()` is non-blank; verified
  live (shown when set, gone when cleared). PASS.
- **AC2 (chart annotation renders / hidden when unset)** — `ChartRenderer.tsx` renders
  `.chart-panel__annotation` only for non-blank trimmed text; verified live. PASS.
- **AC3 (scales, truncates/wraps rather than overflows)** — both elements clamp to 2
  lines (`-webkit-line-clamp: 2` + `overflow: hidden` + `word-break: break-word`);
  verified at runtime a long caption clamps (scrollHeight 50 > clientHeight 34) and at
  400px width nothing overflows the panel or document. PASS.
- **AC4 (round-trips create/PATCH/read + config UI)** — dedicated nullable columns,
  two-level `Option[Option[String]]` PATCH with absent/null/blank semantics, editor
  `TextField` in both `ImageEditor` and `ChartDisplayFields`; verified persistence
  survives a full page reload. PASS.
- **AC5 (stretch: MCP)** — `create_panel` config is a `z.record(z.unknown())`
  passthrough and now documents `caption`/`annotation` in the tool description. There
  is no generic MCP config-update tool to extend (only `update_panel_appearance`), so
  the create surface is the full applicable surface. Stretch satisfied. PASS.

No AC silently reinterpreted. Tasks 1.1–5.6 all completed and match the code. No scope
creep (the `ChartRenderer` canvas-wrapper restructure is the minimum needed to host the
footnote and is behavior-preserving when no annotation is set — verified). Non-goals
(no DataType binding, no Markdown) respected. Schema/spec deltas match the wire shape.
`openspec validate panel-caption-annotation --strict` → valid.

### Phase 2: Code Review — PASS

- **Blank/null semantics (scrutiny item)** — normalized at every boundary: decode
  (`normalizeCaption`/`normalizeAnnotation`: absent/null/empty/whitespace ⇒ `None`),
  PATCH decode (two-level: absent ⇒ leave, null/blank ⇒ `Some(None)` clear, non-blank ⇒
  `Some(Some(v))`), row read (`normalizeText`), and render (`trim()` guards). Config
  fields are `Option[String]`, so spray-json `DefaultJsonProtocol` omits them when
  `None` (never emits `null`) — asserted by `PanelSpec` ("omit … from the wire when
  None"). A cleared caption round-trips as an omitted field, never a stored `""`.
- **PATCH routing (scrutiny item)** — chart annotation rides the existing single
  `updatePanelBinding` PATCH as a new trailing positional arg (10th); chart-only state
  in `BindingEditor`, `annotationDirty` folded into `dataDirty`, empty⇒`null` on save.
  All callers of `updatePanelImage`/`buildImagePatch`/`updatePanelBindingRequest`
  updated; positional-call test assertions updated. Verified via live PATCH round-trip.
- **ChartRenderer restructure (scrutiny item)** — canvas now wrapped in
  `.chart-panel__canvas` (`flex: 1 1 auto; min-height: 0`); footnote is `flex: 0 0
  auto`. Verified the canvas keeps non-zero height with and without annotation and at
  768/400px (172px / 69px, not collapsed).
- **DESIGN [mechanical]** — both new CSS blocks use only tokens (`--space-*`,
  `--text-xs`, `--app-text-muted`, `--font-sans`); editors reuse the shared `TextField`
  and existing `panel-detail-modal__data-*` label/section classes. No hardcoded colors
  or ad-hoc spacing.
- **CONTRIBUTING [mechanical]** — no inline FQNs; migration/domain/mapper follow the
  established scalar-per-column idiom (`image_url`/`divider_color` precedent);
  single-source-of-truth `configColumnsOf`/`configColumnValuesOf` updated so the PATCH
  `replace` write path persists the new columns. HList projection count comment updated
  (26→28). No dead code, no TODO/FIXME, type-safe throughout.
- **Tests meaningful** — `PanelSpec` covers decode/omission/Patch/applyPatch for
  absent/null/blank/value; `PanelRowMapperSpec` covers row round-trip (duplication/
  export parity) + NULL/blank⇒None; frontend covers shown/hidden/blank/clamp and
  editor PATCH-payload set + null-clear.

### Phase 3: UI Review — PASS

Servers started via canonical script (`start-servers.sh` → READY;
`assert-phase.sh servers` → PASS). Ports 5491/8398.

- Chart annotation: set via editor → renders as muted footnote beneath the canvas;
  persisted across a full page reload (DB round-trip, with `title` tooltip for full
  text). PASS.
- Image caption: created an image panel, set a long caption → clamps to 2 lines with
  `title` tooltip; editor re-opens pre-populated (read round-trip); cleared → strip
  removed. PASS.
- Empty/placeholder state: image with no URL still shows placeholder; unset
  caption/annotation render nothing (no empty strip). PASS.
- Console: 0 errors on our page (`:5491`). One `405 @ :5490` appears only under
  `all:true` — it belongs to a different worktree's frontend sharing the browser
  session, not this change.
- Accessibility: caption/annotation controls have `aria-label` + associated `<label
  htmlFor>`; keyboard-reachable text inputs.
- Breakpoints: 1440/768/400 render without layout breakage; no horizontal overflow;
  chart canvas retains height at every size.

### Overall: PASS

### Non-blocking Suggestions
- The chart annotation renders as a footnote beneath the canvas rather than a subtitle
  directly under the title. This satisfies the spec's "subtitle/**footnote**" wording,
  but deviates from design.md Decision 4's "beneath the title area" phrasing — worth a
  quick visual placement judgment by the skeptic (not a mechanical defect).
- Test image/annotation artifacts were left on the `skeptic-output overview` dashboard
  during the live check; harmless dev-DB state.
