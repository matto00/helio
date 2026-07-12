// Text panel's Content editor (HEL-244 design.md Decision 2). Not a
// `BindingEditor` extension — `BindingEditor` is typed for the bound trio
// (metric/chart/table) and its generic `FieldMappingSlots`/aggregation-loop
// shape doesn't fit "one field, mode-gated DataTypePicker visibility." This
// composes `useBoundOrLiteralState` (mode/field/literal state — "field" mode
// = Source, writes `fieldMapping.content`; "literal" mode = Static, writes
// `config.content`), `DataTypePicker` (rendered only in Source mode), and
// `BoundOrLiteralField` (mode toggle + switched input, always rendered).

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import type { SelectOption } from "../../../../shared/ui/index";
import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../../dataTypes/state/dataTypesSlice";
import type { DataType } from "../../../dataTypes/types/dataType";
import { updatePanelTextBinding } from "../../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type { TextPanel } from "../../types/panel";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";
import { BoundOrLiteralField, defaultBoundOrLiteralMode } from "./BoundOrLiteralField";
import { DataTypePicker } from "./DataTypePicker";
import { useBoundOrLiteralState } from "./useBoundOrLiteralState";

/** Field + computed-field options for a selected DataType — mirrors
 *  `BindingEditor`'s `fieldOptions` helper (duplicated rather than
 *  extracted; see design.md Planner Notes). */
function fieldOptions(dataType: DataType): SelectOption[] {
  return [
    ...dataType.fields.map((f) => ({ value: f.name, label: f.name })),
    ...(dataType.computedFields ?? []).map((cf) => ({
      value: cf.name,
      label: `${cf.name} (computed)`,
    })),
  ];
}

interface TextContentEditorProps {
  panel: TextPanel;
  onDirtyChange: DirtyChangeCallback;
}

export const TextContentEditor = forwardRef<PanelEditorHandle, TextContentEditorProps>(
  function TextContentEditor({ panel, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const dataTypes = useAppSelector((state) => state.dataTypes.items);
    const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
    const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

    const initialTypeId =
      panel.config.dataTypeId && panel.config.dataTypeId.length > 0
        ? panel.config.dataTypeId
        : null;
    const initialFieldValue = panel.config.fieldMapping.content ?? "";
    const initialLiteralValue = panel.config.content;
    // HEL-244 — mirrors design.md Decision 2 / the `panel-config-field-or-
    // literal-pattern` capability's mode-default heuristic
    // (`defaultBoundOrLiteralMode`). Text has no independent "literal
    // override is set" signal the way Metric's `config.label`/`config.unit`
    // do (content is always present, never `undefined`), so "literal is
    // set" is derived from bound-ness instead: an already-bound panel
    // defaults to Source, an unbound one to Static.
    const initialMode = defaultBoundOrLiteralMode(initialTypeId === null);

    const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
    const [typeSearch, setTypeSearch] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);
    const contentState = useBoundOrLiteralState(
      initialMode,
      initialFieldValue,
      initialLiteralValue,
    );

    const dataDirty = selectedTypeId !== initialTypeId || contentState.dirty;

    useEffect(() => {
      if (dataTypesStatus === "idle") {
        void dispatch(fetchDataTypes());
      }
    }, [dataTypesStatus, dispatch]);

    useEffect(() => {
      onDirtyChange(dataDirty);
    }, [dataDirty, onDirtyChange]);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          setSelectedTypeId(initialTypeId);
          setTypeSearch("");
          contentState.reset();
          setSaveError(null);
        },
        save: async () => {
          if (!dataDirty) return { ok: true };
          try {
            await dispatch(
              updatePanelTextBinding({
                panelId: panel.id,
                mode: contentState.mode,
                typeId: selectedTypeId,
                fieldValue: contentState.fieldValue,
                literalValue: contentState.literalValue,
              }),
            ).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save content.";
            setSaveError(error);
            return { ok: false, error };
          }
        },
      }),
      [contentState, dataDirty, dispatch, initialTypeId, panel.id, selectedTypeId],
    );

    const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;
    const filteredDataTypes = pipelineOutputDataTypes.filter((dt) =>
      dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
    );

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Content</h3>
        {contentState.mode === "field" && (
          <DataTypePicker
            selectedType={selectedType}
            typeSearch={typeSearch}
            onTypeSearchChange={setTypeSearch}
            dataTypesStatus={dataTypesStatus}
            filteredDataTypes={filteredDataTypes}
            selectedTypeId={selectedTypeId}
            onSelect={(dataTypeId) => {
              setSelectedTypeId(dataTypeId);
              setTypeSearch("");
            }}
            onClear={() => {
              setSelectedTypeId(null);
              contentState.setFieldValue("");
              setTypeSearch("");
            }}
          />
        )}
        <div className="panel-detail-modal__data-section">
          <BoundOrLiteralField
            label="Content"
            mode={contentState.mode}
            onModeChange={contentState.setMode}
            fieldOptions={selectedType ? fieldOptions(selectedType) : []}
            fieldValue={contentState.fieldValue}
            onFieldChange={contentState.setFieldValue}
            literalValue={contentState.literalValue}
            onLiteralChange={contentState.setLiteralValue}
            literalPlaceholder="Write your text here…"
            literalMultiline
          />
        </div>
        <InlineError error={saveError} />
      </>
    );
  },
);
