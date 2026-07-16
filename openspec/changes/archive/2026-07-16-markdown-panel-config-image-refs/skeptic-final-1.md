## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth / diff**
- `git log`, `git diff main...HEAD --stat` (45 files, backend+frontend+docs+specs) reviewed.
- Read `ticket.md`, `design.md`, `files-modified.md`, `evaluation-1.md` as claims, then independently checked
  each against the diff and a live app.

**AC traceability**
1. "Static OR DataType-bound markdown" — `MarkdownPanelConfig` gains `dataTypeId`/`fieldMapping`
   (`backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala`); `MarkdownEditor.tsx` rebuilt on
   `useBoundOrLiteralState` + `DataTypePicker` + `BoundOrLiteralField`. Live-verified: switched an existing
   Markdown panel's Content editor to "Bind to field" and saw the `DataTypePicker` render with real pipeline
   output types.
2. "`helio://uploads/image/<id>` resolves" — `frontend/src/features/panels/ui/markdownUrls.ts`
   (`resolveMarkdownUrl`), wired via `urlTransform` in `MarkdownPanel.tsx`. Live-verified: the pre-existing
   "HEL-245 Static Image Ref Smoke" panel's `<img>` resolved to
   `http://localhost:5418/api/uploads/image/a77cfe5e-fc01-4f9e-b5a9-62a3b2324751`, `complete: true`,
   `naturalWidth/Height: 800x400`.
3. "Docs updated" — `docs/uploads.md` (new), covers both endpoints and the `helio://` scheme with the
   render-time-vs-stored-rewrite rationale.
4. "Config UI matches sibling redesigns" — diffed `MarkdownEditor.tsx` against `TextContentEditor.tsx`
   side-by-side: identical composition (`useBoundOrLiteralState`, mode-gated `DataTypePicker`,
   `BoundOrLiteralField` with `literalMultiline`), identical mode-default heuristic, identical dirty-tracking/
   save shape. No new form primitives invented.

**Backend persistence-gap fix (the "skeptic-verified gap" from round 1)**
- `PanelRowMapper.scala`: `domainToRow`'s Markdown arm and `markdownConfig` now read/write `typeId`/
  `fieldMapping`, mirroring `TextPanel`.
- I did not just trust the claim that the new `PanelRowMapperSpec` tests are a real regression lock. I manually
  reverted the two `PanelRowMapper.scala` hunks to the pre-fix state and ran
  `sbt "testOnly com.helio.infrastructure.PanelRowMapperSpec"` — the new bound-Markdown round-trip test
  **failed** (`None was not equal to Some("dt1")`), confirming the regression lock is real, then restored the
  fix and re-ran to confirm green (77/77 in `PanelSpec`+`PanelRowMapperSpec` combined).

**Gates re-run fresh (not trusted from evaluator's report)**
- `npm run lint` (frontend) — 0 warnings.
- `npx jest` full suite — 93 suites / 1007 tests passed.
- `sbt "testOnly com.helio.domain.PanelSpec com.helio.infrastructure.PanelRowMapperSpec"` — 77/77 passed.
- Schema diff (`schemas/panel.schema.json` `MarkdownConfig` gains `dataTypeId`/`fieldMapping`) matches the
  Scala/TS shapes.

**DESIGN.md token audit**
- Confirmed every token used in `MarkdownPanel.css`'s new/touched rules is real: `--space-2`, `--space-3`,
  `--app-radius-sm` (6px), `--text-sm`, `--text-xs`, `--weight-semibold`, `--font-mono`, `--app-accent` — all
  present in `DESIGN.md`. No hardcoded fallback on the new `--app-radius-sm` image rule (round-1 skeptic note
  addressed).

**Desktop UI (dark + light)**
- Screenshots of the live "HEL-246 Eval Check" dashboard's two pre-existing HEL-245 smoke panels (bound
  Source-mode Markdown, and Static-mode Markdown with an embedded `helio://` image) in both dark and light
  theme: consistent card chrome, correct image rounding/constraint, readable text in both themes, no console
  errors.

**Mobile (390×844) — where I diverge from the evaluator's report**
- Resized to 390×844: mobile stack renders both Markdown panels correctly, image scales without horizontal
  overflow (`document.documentElement.scrollWidth === clientWidth === 390` in both the stack and the panel
  detail dialog), `BottomNav` links measure 97.5×55px (fine, unaffected).
- **However**, `evaluation-1.md` Phase 3 states: *"Confirmed panels in the mobile stack are click-inert (no
  editor dialog opens on tap)... the ticket's ≥44px touch-target requirement doesn't apply to any new
  control."* This is **factually wrong**, both by spec and by live reproduction:
  - `openspec/specs/mobile-viewer-stack/spec.md`: *"Tapping a panel card opens the panel detail modal."*
    (explicit, current requirement — not a gap, a documented feature.)
  - Live repro: clicking the "HEL-245 Static Image Ref Smoke" panel card at 390×844 opened the full
    `PanelDetailModal` with an "Edit" button; clicking Edit rendered the complete Markdown config UI
    (Content-mode toggle, textarea) at mobile width, no overflow. I also clicked the unrelated "Upload Test
    Image" panel and got its own settings dialog too — confirming this is generic, pre-existing behavior
    across **all** panel types (not something this diff introduced), but it does mean the editor UI is
    reachable on mobile, contrary to the evaluator's premise.
  - Measured the new Markdown Content-mode toggle buttons ("Bind to field" / "Fixed text") in that mobile
    dialog: **28×84px** (`--control-sm`), well under 44×44 CSS px.
  - This 44×44 CSS px bar is not an arbitrary bar I'm inventing for this review — it's the codebase's own
    established mobile convention: `openspec/specs/mobile-bottom-nav/spec.md` line 32/44 requires "every tab
    a tap target of at least 44x44 CSS px."

### Verdict: REFUTE

The code/architecture/backend work is genuinely strong — TextPanel mirroring is exact, the persistence-gap fix
is real and regression-locked (I reproduced the failure myself), tokens are correct, and the `helio://`
resolution + docs fully satisfy the ticket DoD. This REFUTE is narrowly about the session's explicit,
binding mobile touch-target requirement, which the evaluator's report both mis-verified and used to wave away
a real, measurable requirement.

### Change Requests

1. **Fix the evaluation record**: `evaluation-1.md`'s Phase 3 claim that mobile panels are "click-inert" and
   that the new editor UI is "desktop-only and not reachable from the mobile shell" is incorrect — correct or
   remove this claim. `openspec/specs/mobile-viewer-stack/spec.md` explicitly documents that tapping a panel
   card opens the panel detail modal, and I reproduced it live at 390×844.

2. **Resolve the touch-target requirement for the new Markdown Content-mode toggle**: the "Bind to field" /
   "Fixed text" buttons rendered by the new `MarkdownEditor.tsx` (via the shared `BoundOrLiteralField`) measure
   28×84px in the mobile panel-detail dialog — below the session's binding ≥44px requirement and below this
   codebase's own established 44×44 CSS px mobile tap-target convention
   (`openspec/specs/mobile-bottom-nav/spec.md`). Since `design.md`'s Decision 2 explicitly lists "changes to
   `BoundOrLiteralField`" as a Non-Goal (shared by Text/Metric/Markdown), a full component fix is out of this
   ticket's narrow scope — but the requirement can't simply be marked "doesn't apply" when it does. Pick one:
   - (a) Add a narrow, mobile-viewport-scoped CSS override (e.g. a `@media (max-width: 767px)` rule bumping
     `.panel-detail-modal__mode-toggle-btn` min-height to 44px) — a style-only change, not a `BoundOrLiteralField`
     logic change, so it stays in-scope for "style-debt cleanup in files already being edited" if the CSS lives
     alongside `MarkdownPanel.css`/`PanelDetailModal.css`; or
   - (b) If fixing the shared control is judged out of scope for this ticket, get explicit sign-off to accept
     this as known, pre-existing mobile debt (inherited from HEL-243/244, not introduced by HEL-245) and open a
     tracked follow-up ticket — but do not let the evaluation record assert compliance it didn't verify.

### Non-blocking notes

- The round-1 skeptic's note about the two leftover hardcoded `border-radius` literals in `MarkdownPanel.css`
  (`3px` inline-code, `4px` pre-block) is still open per the evaluator's own non-blocking suggestion — agree
  this is fine to leave as a documented follow-up, not a blocker.
- `selectPipelineOutputDataTypes` unstable-selector-reference console warning fires repeatedly during editor
  interaction (pre-existing, shared by Text/Metric/Markdown editors alike, not introduced by this diff) — worth
  a separate memoization fix ticket, not blocking here.
