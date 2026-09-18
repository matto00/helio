# Files modified — HEL-1084 form field-type builder

Every path below is a full repo-relative span, declared on its own bulleted line.

## Backend

- `backend/src/main/scala/com/helio/domain/panels/FormPanel.scala` — added `FormFieldSpec.FittingControls` (design D2) and `defaultControlFor`.
- `backend/src/main/scala/com/helio/domain/panels/FormSchemaConsistency.scala` — new: the D1(b)-(e) schema-consistency check.
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — added `rejectInconsistentForm`/`formConfigOf`/`effectiveFormConfig`; wired into `buildForCreate` and `update` (on the EFFECTIVE post-patch config, C2).
- `backend/src/test/scala/com/helio/domain/panels/FormPanelSpec.scala` — added `FittingControls` coverage.
- `backend/src/test/scala/com/helio/domain/panels/FormSchemaConsistencySpec.scala` — new: one case per D1 rule/pinned message.
- `backend/src/test/scala/com/helio/api/routes/panels/FormPanelRoundTripSpec.scala` — added the schema-consistency route-level cases (kind rejection, undeclared field, unfit control, options/initialValue typing, re-bind re-validation, consistent round-trip).
- `backend/src/test/scala/com/helio/api/routes/proposals/ApplyProposalSpecBase.scala` — extended the shared fixture: `datasetSourceId`/`otherDatasetSourceId` now declare a real schema (`quantity`/`note`/`when`/`flag`/`total`), plus new `datasetSourceIdWithoutQuantity` and `csvSourceId` fixtures.
- `schemas/panels/panel.schema.json` — `$defs.FormFieldConfig.options` tightened to `type: array, minItems: 1`; description updates for `options`/`initialValue`.

## Frontend — services/state

- `frontend/src/features/panels/services/panelService.ts` — `createPanel` gains an optional `config` param; added `updatePanelForm`.
- `frontend/src/features/panels/state/panelPayloads.ts` — `buildCreatePanelBody`/`seedCreateConfig` gain a `config` override, used only for `form`.
- `frontend/src/features/panels/state/panelThunks.ts` — `createPanel` thunk carries `config`; added `updatePanelForm` thunk.
- `frontend/src/features/panels/state/panelsSlice.ts` — re-exports `updatePanelForm`; added its `.fulfilled` reducer case.
- `frontend/src/features/panels/state/formConfigValidation.ts` — new: `CONTROL_FITNESS` mirror of the backend matrix, `parseTypedValue`/`isValidTypedValue`/`isOptionsArray`/`computeFormIssues`.

## Frontend — UI

- `frontend/src/features/panels/ui/editors/useFormEditorState.ts` — new: the field-list reducer (add/remove/move/setControl/setDataset/reset/dirty), stable `rowIds`/`rowKeys`, and the pure `focusTargetIndexAfterRemove` helper.
- `frontend/src/features/panels/ui/editors/FormEditor.tsx` — new: the builder container, mounted from `PanelDetailModal`'s if-chains; explicit focus management on Add/Remove; stale-save-error clearing.
- `frontend/src/features/panels/ui/editors/FormEditor.css` — new: tokens-only styling for the builder container.
- `frontend/src/features/panels/ui/editors/FormFieldRow.tsx` — new: one field's row; wires `aria-invalid`/`aria-describedby` onto the sourceField control's error (C8).
- `frontend/src/features/panels/ui/editors/FormOptionsEditor.tsx` — new: typed-value select-options editor.
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` — added the `isFormPanel`/`formEditorRef` arm to both `activeEditorRef` and `renderSubtypeEditor` (C5).
- `frontend/src/features/panels/ui/OutputPicker.tsx` — added a Form content-panel card that switches into the dataset step instead of creating directly.
- `frontend/src/features/panels/ui/OutputPicker.css` — added the dataset-step header layout styles.
- `frontend/src/features/panels/ui/DatasetStep.tsx` — new: the picker's second step — choose a `dataset`-kind source, creates the bound `form` panel.
- `frontend/src/shared/ui/FormField.tsx` — added an optional `errorId` prop (falls back to an internal `useId()` when omitted, so every pre-existing call site is behaviour-unchanged); the error `<p>` now carries that id (C8).
- `frontend/src/shared/ui/Select.tsx` — added optional `ariaInvalid`/`ariaDescribedBy` passthrough props, wired onto the trigger button (C8).

## Tests — new

- `frontend/src/features/panels/state/controlFitnessDriftGuard.test.ts` — C4 drift guard (parses `FormPanel.scala`).
- `frontend/src/features/panels/state/formConfigValidation.test.ts`
- `frontend/src/features/panels/ui/editors/useFormEditorState.test.ts`
- `frontend/src/features/panels/ui/editors/FormEditor.test.tsx`
- `frontend/src/features/panels/ui/editors/FormFieldRow.test.tsx`
- `frontend/src/features/panels/ui/editors/FormOptionsEditor.test.tsx`

## Tests — extended

- `frontend/src/features/panels/state/panelPayloads.test.ts` — form `config` override cases.
- `frontend/src/features/panels/state/panelsSlice.test.ts` — updated `createPanel` call-signature assertion (new trailing `config` arg).
- `frontend/src/features/panels/ui/OutputPicker.test.tsx` — updated call-signature assertion + 7 new Form-entry/dataset-step cases (task 4.10).
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.test.tsx` — 2 new form-panel cases (task 4.11).
- `frontend/src/theme/elevationTokenGuard.css.test.ts` — pinned CSS-file-count bumped 113→114 for the new `FormEditor.css` (mechanical, not a design-language change).
- `frontend/src/theme/motionTokenGuard.css.test.ts` — same 113→114 file-count bump.

## Planning / review artifacts

- `openspec/changes/form-field-type-builder/.openspec.yaml`
- `openspec/changes/form-field-type-builder/design.md`
- `openspec/changes/form-field-type-builder/proposal.md`
- `openspec/changes/form-field-type-builder/tasks.md` — all 27 tasks checked off; C8 standing constraint recorded.
- `openspec/changes/form-field-type-builder/ticket.md`
- `openspec/changes/form-field-type-builder/specs/form-panel-builder/spec.md`
- `openspec/changes/form-field-type-builder/specs/form-panel-type/spec.md`
- `openspec/changes/form-field-type-builder/specs/output-picker/spec.md`
- `openspec/changes/form-field-type-builder/specs/panel-detail-modal/spec.md`
- `openspec/changes/form-field-type-builder/skeptic-design-1.md`
- `openspec/changes/form-field-type-builder/evaluation-1.md`
- `openspec/changes/form-field-type-builder/evaluation-2.md`
- `openspec/changes/form-field-type-builder/skeptic-final-1.md`
- `openspec/changes/form-field-type-builder/skeptic-final-2.md` — CONFIRM verdict, round 2.
- `openspec/changes/form-field-type-builder/mutation-evidence.md` — C2/C4/C5/C8 mutation transcripts, plus the focus-on-Remove root-cause/fix record.
- `openspec/changes/form-field-type-builder/files-modified.md` — this file.
