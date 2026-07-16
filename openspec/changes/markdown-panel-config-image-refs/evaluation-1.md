## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS

Issues: none.

- All ticket DoD bullets addressed explicitly: (1) Markdown panel Source/Static content modes implemented
  (`MarkdownPanelConfig.dataTypeId`/`fieldMapping`, `MarkdownEditor.tsx` rebuilt); (2) `helio://uploads/image/<id>`
  resolves via `resolveMarkdownUrl`/`urlTransform`; (3) `docs/uploads.md` added; (4) config UI mirrors the
  Text/Metric pattern (`useBoundOrLiteralState` + `DataTypePicker` + `BoundOrLiteralField`).
- No AC reinterpreted. All 7 task groups in `tasks.md` are checked done except 7.3 (manual smoke), which was
  explicitly and correctly deferred to the evaluator/skeptic gate — independently re-verified below (task 7.3 is
  now satisfied by this evaluation's live smoke test).
- No scope creep: `fieldOptions` extraction (rule-of-three, justified in design.md Decision 2) and
  `buildTextBindingPatch` → `buildContentBindingPatch` rename are the only cross-cutting touches, both flagged
  in design.md as anticipated, in-scope, mechanical generalizations. `PanelCreationModal`/`PanelCreationPreview`
  changes are the direct, required "markdown joins DATA_BOUND_TYPES" corollary.
- No regressions: full backend suite (1321 tests) and full frontend suite (1007 tests, 93 suites) pass fresh.
  The skeptic-verified `PanelRowMapper` persistence gap (Markdown binding silently dropped on read) is fixed
  and regression-locked with two new round-trip tests.
- Schema (`schemas/panel.schema.json` `MarkdownConfig`) updated in the same change; `check:schemas` passes
  (schema/JsonProtocols parity).
- Planning artifacts (proposal/design/tasks/specs) match the implemented behavior — verified line-by-line
  against the diff; no drift found.

### Phase 2: Code Review — PASS

Issues: none blocking.

- **Backend mirrors `TextPanel` exactly** (confirmed via side-by-side diff of `MarkdownPanel.scala` vs
  `TextPanel.scala`): config shape, tolerant `decode`, `Patch` absent-vs-null convention, `withBindingCleared`
  divergence rationale, `buildQuery`. `PanelRowMapper.scala` gap fix mirrors the `TextPanel` case exactly.
- **Frontend editor mirrors `TextContentEditor.tsx`** near-verbatim (confirmed via diff): same
  `useBoundOrLiteralState`/`DataTypePicker`/`BoundOrLiteralField` composition, same mode-default heuristic,
  same dirty-tracking/save/reset shape. Reuses `BoundOrLiteralField`/`useBoundOrLiteralState`/`DataTypePicker`
  per the session's binding requirement — no new form primitives invented.
- **DRY**: `fieldOptions` extracted to `editors/fieldOptions.ts` at the third use (`BindingEditor`,
  `TextContentEditor`, `MarkdownEditor`) per rule-of-three; `buildContentBindingPatch` shared by Text and
  Markdown. Orphaned `updatePanelContent`/`buildMarkdownPatch`/`buildContentPatch` deleted, not left dead
  (matches the skeptic's round-1 non-blocking note that both had zero remaining callers).
- **DESIGN.md [mechanical] compliance**: `MarkdownPanel.css` new image rule uses `var(--app-radius-sm)` with
  no fallback (correcting the design doc's own erroneous `var(--radius-sm, 4px)` example, as the skeptic
  anticipated); padding tokenized to `--space-2`/`--space-3`. No raw hex/rgb, no ad-hoc font-family/size/weight
  introduced. `check:scala-quality` reports zero inline-FQN violations; only pre-existing file-size soft
  warnings (informational per CONTRIBUTING, none newly introduced by this diff's files).
- **Type safety**: no new `any`; `Patch`/`decode`/`Option[Option[_]]` shapes are fully typed on both sides.
- **Tests meaningful**: new backend tests (`PanelSpec`, `PanelRowMapperSpec`) exercise decode-absent,
  Patch absent-vs-null, round-trip, binding-scrub, and `buildQuery` — the `PanelRowMapperSpec` additions are a
  real regression lock (fail against the pre-fix mapper). New frontend tests cover `resolveMarkdownUrl`
  (including traversal/query rejection), `urlTransform` wiring, and Source/Static save shapes.
- **Gates re-run fresh** (not trusting the executor's report): `npm run lint` (0 warnings), `npm test`
  (1007/1007 passed, 93 suites), `npm run format:check` (clean), `npm run build` (succeeds),
  `sbt test` (1321/1321 passed), `check:schemas` (in sync), `check:openspec` (clean).

Non-blocking style-debt note (see below) — does not affect PASS.

### Phase 3: UI Review — FAIL (corrected post-hoc; see note below)

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` → `PASS servers`.

Manual smoke (ticket's deferred task 7.3, run fresh by this evaluator):

- **Static markdown with a `helio://` image ref**: uploaded a real image via
  `POST /api/uploads/image` (curl, `X-Helio-Requested-With: 1` header) → got a real id
  (`a77cfe5e-fc01-4f9e-b5a9-62a3b2324751`). Created a Markdown panel, switched the Content editor to
  "Fixed text" (Static mode), authored markdown containing
  `![Test Upload](helio://uploads/image/a77cfe5e-fc01-4f9e-b5a9-62a3b2324751)`, saved. The rendered `<img>`
  resolved to `src="http://localhost:5418/api/uploads/image/a77cfe5e-fc01-4f9e-b5a9-62a3b2324751"`,
  loaded successfully (`naturalWidth/Height` 800×400, `complete: true`), and rendered with rounded corners
  constrained to the panel width.
- **Bind to a pipeline-output DataType field**: created a second Markdown panel bound to `TextNotesType`
  (a real pipeline-output type in the dev DB), selected the `content` field in Source mode (default mode was
  correctly Source given a pre-selected DataType), saved. The grid panel immediately rendered the bound
  row's markdown ("Hello World" heading + paragraph) — confirming `usePanelData`'s generic per-slot mapping
  and `MarkdownRenderer`'s `data?.content ?? config.content` resolution both work end-to-end.
- **Mobile (390×844)**: resized the browser; both new Markdown panels (bound and static-with-image) rendered
  correctly in the read-only `MobilePanelStack`, image scaled to fit with no horizontal overflow
  (`document.documentElement.scrollWidth === clientWidth === 390`). `BottomNav` links measured 97.5×55px,
  unaffected/no regression.
  **Correction (per skeptic-final-1.md, applied post-hoc after the final-gate skeptic REFUTEd on this
  claim):** this evaluator's original claim that mobile panels were "click-inert" and that the new editor
  UI was "desktop-only and not reachable from the mobile shell" was **factually wrong** — an artifact of a
  flawed verification check (`document.querySelector('[role="dialog"]')`, which misses the app's native
  `<dialog>` element). `openspec/specs/mobile-viewer-stack/spec.md` explicitly requires "tapping a panel
  card opens the panel detail modal," and re-verifying live at 390×844 confirms it does: tapping the
  "HEL-245 Static Image Ref Smoke" card opens the `PanelDetailModal`, and its "Edit" button surfaces the
  full Markdown Content editor (Content-mode toggle + textarea) at mobile width. The new Content-mode
  toggle buttons ("Bind to field" / "Fixed text") measured **83.5×28px** in that mobile dialog — under the
  session's binding ≥44px touch-target requirement and under this codebase's own established 44×44 CSS px
  mobile tap-target convention (`openspec/specs/mobile-bottom-nav/spec.md`). The touch-target requirement
  **does apply** and is **not met** by the new UI as shipped. See `skeptic-final-1.md` change request #2
  for the remediation options under consideration.
- **No console errors** at any point during the flow (0 errors throughout; only pre-existing warnings).
- **Breakpoints** 1440 / 1100 / 768 / 390 all render with `scrollWidth === clientWidth` (no horizontal
  overflow at any of the four canonical breakpoints).
- **Accessible names / keyboard**: Content-mode toggle buttons ("Bind to field"/"Fixed text") and the field
  combobox all carry accessible names/roles (confirmed via accessibility snapshot); these are the pre-existing
  shared `BoundOrLiteralField`/`DataTypePicker` components, not new controls, and measured at
  `--control-sm` (28px height, 12px/`--text-xs` font, 6px/`--app-radius-sm` radius) — consistent with
  DESIGN.md §"Control metrics".

### Overall: FAIL (corrected post-hoc — see Change Requests)

**Correction note:** This evaluator's cycle-1 submission originally recorded Overall: PASS. The final-gate skeptic (`skeptic-final-1.md`) REFUTEd, catching that this report's Phase 3 mobile
verification was factually wrong (see the correction inline above) and that the session's binding
≥44px mobile touch-target requirement is genuinely unmet by the new Markdown Content-mode toggle.
Correcting the record here rather than leaving a false PASS on file.

### Change Requests

1. **Resolve the touch-target requirement for the new Markdown Content-mode toggle** — the "Bind to field" / "Fixed text" buttons rendered by `MarkdownEditor.tsx` (via the shared `BoundOrLiteralField`) measure 83.5×28px in the mobile panel-detail dialog, below the session's binding ≥44px requirement and below `openspec/specs/mobile-bottom-nav/spec.md`'s established 44×44 CSS px mobile tap-target convention. Per `skeptic-final-1.md` change request #2, pick one: (a) a narrow, mobile-viewport-scoped CSS override (e.g. `@media (max-width: 767px)` bumping the toggle's min-height to 44px) kept alongside `MarkdownPanel.css`/`PanelDetailModal.css` as in-scope style-debt cleanup, not a `BoundOrLiteralField` logic change; or (b) explicit sign-off to accept this as known, pre-existing mobile debt inherited from HEL-243/244 (not introduced by HEL-245) with a tracked follow-up ticket.

### Non-blocking Suggestions

- `frontend/src/features/panels/ui/MarkdownPanel.css` still has two pre-existing hardcoded `border-radius`
  literals left over from before this change — `border-radius: 3px` (inline `code`, line 50) and
  `border-radius: 4px` (`pre` block, line 61). Design Decision 6 / task 5.2 asked for an in-scope style-debt
  pass on this exact file and the round-1 skeptic report specifically named these two literals (alongside the
  `8px 12px` padding, which *was* fixed) as the debt to clean up. Neither radius exactly matches an existing
  token (`--app-radius-sm` is 6px), so this isn't a strict DESIGN.md `[mechanical]` violation, but it's an
  incomplete instance of the requested cleanup — worth a follow-up pass to `var(--app-radius-sm)` (or leaving
  as an explicitly-noted "small optical tweak" exception) rather than silent literals.
