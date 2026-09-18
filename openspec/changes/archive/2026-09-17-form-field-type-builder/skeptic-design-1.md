## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/form-field-type-builder/HEL-1084`.
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all four spec deltas
  (`form-panel-builder` ADDED, `form-panel-type`/`output-picker`/`panel-detail-modal` MODIFIED) in full.
- Independently re-verified every file:line citation in `design.md`/`ticket.md` against the actual tree
  (not the orchestrator's summary):
  - `PanelDetailModal.tsx` (`frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx`):
    `activeEditorRef` (185–198) and `renderSubtypeEditor` (312–344) both `return null`/fall through for a `form`
    panel via if-chains, exactly as claimed — no `isFormPanel` arm exists yet.
  - `DataSourceRepository.getDeclaredSchema` at line 875, signature
    `(id: DataSourceId, user: AuthenticatedUser): Future[Option[Vector[DatasetFieldDeclaration]]]` — exact match.
  - `PanelService.buildForCreate` at 183, `update` at 437, both gated only by `rejectMissingDataSource` (506) —
    confirmed existence/ownership-only, no kind check, matching the HEL-1083 D6 gap claim.
  - `DataSourceService.getDatasetSchema` (line 891) already 400s a non-`dataset`-kind source
    (`"declared schema is only available for dataset sources..."`) — confirms D1(a)'s claim that the schema
    fetch itself closes part of the kind gap as a side effect.
  - `FormPanel.validateConfig` (line 300) is structural-only exactly as design.md states, and its explicit
    comment says schema-consistency is out of scope for this class — matches D1's premise precisely.
  - `FormFieldSpec.ValidControls` = `{text, textarea, number, date, select, checkbox, file}` (7 controls) —
    matches every control name used across D2's fitness matrix with no extras/omissions.
  - `DataFieldType` has exactly 7 cases (`StringType, IntegerType, FloatType, BooleanType, TimestampType,
    StringBodyType, BinaryRefType`) — D2's matrix covers all 7 with no gaps.
  - `DatasetRowValidator.validateValue` accepts exactly `JsString` for string/string-body,
    integral `JsNumber` for integer, any `JsNumber` for float, `JsBoolean` for boolean, timestamp-parseable
    `JsString` for timestamp, `JsObject` for binary-ref — consistent with the matrix's control choices per type
    (e.g. `binary-ref` excluded from `select`/`text`, matching its `file`-only fitting set).
  - `OutputPicker.CONTENT_PANEL_KINDS` currently lists exactly `text, markdown, image, divider` (no `form`) —
    confirms proposal's "AC4 exists because the builder is otherwise unreachable" premise.
  - `panelPayloads.ts` `buildCreatePanelBody`/`CreatePanelBody` currently carries no optional `config` override —
    confirms the `createPanel` claim.
  - `schemas/panels/panel.schema.json` `$defs.FormFieldConfig.options` has no `minItems`/type constraint today
    (bare, undocumented) and `control` enum already lists the same 7 values — confirms task 1.4's premise.
  - `DESIGN.md` §8 "Accessibility baseline" exists, backing the AC5/D7 a11y binding citation.
- Cross-checked every spec-delta scenario against the design decisions (D1–D8) and the ticket's 5 ACs: each AC
  traces to at least one spec requirement/scenario and at least one tasks.md item (AC1→D1/tasks 1.2–1.3/4.1–4.2;
  AC2→D2/tasks 1.1/2.3/3.2; AC3→D4/D5/tasks 2.4/3.2/3.3; AC4→D6/tasks 3.5; AC5→D7/tasks 3.1/3.6/4.8/4.9). No AC is
  left uncovered by any task, and no task reaches outside the stated scope boundary (HEL-1085/86/87/88/89/90 are
  named and excluded consistently across proposal, design Non-Goals, and tasks' Standing Constraints).
- Checked the two called-out judgment areas:
  - D2's control-fitness matrix: cross-checked every cell against `validateValue`'s actual accepted JSON kinds
    and found no cell that admits a control whose input shape can't satisfy the declared type at submission time
    (e.g. `text` on `integer`/`float`/`timestamp` is explicitly deferred to HEL-1087's submit-time coercion per
    the design's own words, and `initialValue`'s typed input in D4 bypasses this concern entirely by rendering a
    typed widget regardless of the chosen `control`). No cell struck me as wrong.
  - D6's two-step picker flow: consistent with HEL-1083 D5 (unbound form panel is uncreatable) and with
    `output-picker`'s existing one-modal contract; the "no auto-open" choice matches the other four content
    kinds' existing behavior (verified `CONTENT_PANEL_KINDS`'s siblings don't auto-open either, per the existing
    picker code read above).
- Checked internal consistency: proposal ↔ design ↔ tasks ↔ specs do not contradict each other anywhere I found
  (matrix ordering, closed-attribute-set language, tighten-only `required` semantics, and the "effective
  post-patch config" enforcement rule are stated identically across all four artifacts).
- No placeholders, TODOs, or deferred-but-blocking decisions found in any artifact.
- `openspec validate form-field-type-builder --type change` — not re-run by me directly, but the artifacts read
  clean and self-consistent; no drafting defect found that validation would need to catch.

### Verdict: CONFIRM

### Non-blocking notes

- The ticket's own AC5 (a11y) is acknowledged in `ticket.md` as a "drafting gap" — the epic states every leaf
  has an inline a11y AC, but this leaf's body doesn't; the design correctly treats it as binding anyway via the
  epic statement + DESIGN.md §8. Worth flagging to the epic's author for the sibling leaves' tickets, but it does
  not block this plan since the derived AC is fully covered by D7/tasks 3.1/3.6/4.8/4.9.
- D2's `text` control being fittable for `integer`/`float`/`timestamp` fields relies on HEL-1087 (out of scope
  here) to do submit-time type coercion. That's an explicit, disclosed dependency in the design (not hidden), and
  `initialValue` sidesteps it with a typed input regardless of chosen control — so it isn't a soundness gap for
  this ticket, just a forward reference worth the executor keeping in mind if HEL-1087 lands differently than
  expected.
