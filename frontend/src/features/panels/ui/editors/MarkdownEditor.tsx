// Markdown panel's Content editor (HEL-245 design.md Decision 2). Rebuilt on
// the field-or-literal pattern, mirroring `TextContentEditor`: "field" mode =
// Source (writes `fieldMapping.content`, rendered from a bound DataType
// field), "literal" mode = Static (writes `config.content`, authored
// markdown). Composes `useBoundOrLiteralState`, a mode-gated `DataTypePicker`,
// and `BoundOrLiteralField` with `literalMultiline`.

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../../dataTypes/state/dataTypesSlice";
import { updatePanelMarkdownBinding } from "../../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type { MarkdownPanel } from "../../types/panel";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";
import { BoundOrLiteralField, defaultBoundOrLiteralMode } from "./BoundOrLiteralField";
import { DataTypePicker } from "./DataTypePicker";
import { fieldOptions } from "./fieldOptions";
import { useBoundOrLiteralState } from "./useBoundOrLiteralState";

interface MarkdownEditorProps {
  panel: MarkdownPanel;
  onDirtyChange: DirtyChangeCallback;
}

export const MarkdownEditor = forwardRef<PanelEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ panel, onDirtyChange }, ref) {
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
    // Mirrors TextContentEditor's mode-default heuristic: Markdown has no
    // independent "literal override is set" signal (content is always
    // present), so "literal is set" is derived from bound-ness — an
    // already-bound panel defaults to Source, an unbound one to Static.
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
              updatePanelMarkdownBinding({
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
            literalPlaceholder="# Hello&#10;Write your markdown here…"
            literalMultiline
          />
        </div>
        <InlineError error={saveError} />
      </>
    );
  },
);
