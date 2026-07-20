import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../../dataTypes/state/dataTypesSlice";
import { PANEL_SLOTS } from "../../state/panelSlots";
import { updatePanelTimeline } from "../../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type { TimelinePanel, TimelineSort } from "../../types/panel";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";
import { DataTypePicker } from "./DataTypePicker";
import { FieldMappingSlots } from "./FieldMappingSlots";
import { fieldOptions } from "./fieldOptions";

interface TimelineEditorProps {
  panel: TimelinePanel;
  onDirtyChange: DirtyChangeCallback;
}

const SORT_OPTIONS: { value: TimelineSort; label: string }[] = [
  { value: "asc", label: "Oldest first" },
  { value: "desc", label: "Newest first" },
];

/** Timeline panel editor (HEL-317). Composes the DataType binding picker, the
 *  `time`/`event` field-mapping slots (via the shared `FieldMappingSlots`
 *  loop, `PANEL_SLOTS.timeline`), and a chronological sort-direction control.
 *  Save issues one config PATCH via `updatePanelTimeline`. Purely a section —
 *  `PanelDetailModal` owns the modal lifecycle. */
export const TimelineEditor = forwardRef<PanelEditorHandle, TimelineEditorProps>(
  function TimelineEditor({ panel, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const dataTypes = useAppSelector((state) => state.dataTypes.items);
    const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
    const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

    const initialTypeId =
      panel.config.dataTypeId && panel.config.dataTypeId.length > 0
        ? panel.config.dataTypeId
        : null;
    const initialFieldMapping = panel.config.fieldMapping;
    const initialSort = panel.config.timelineOptions.sort;

    const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>(initialFieldMapping);
    const [sort, setSort] = useState<TimelineSort>(initialSort);
    const [typeSearch, setTypeSearch] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);

    const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;

    const dataDirty =
      selectedTypeId !== initialTypeId ||
      JSON.stringify(fieldMapping) !== JSON.stringify(initialFieldMapping) ||
      sort !== initialSort;

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
          setFieldMapping(initialFieldMapping);
          setSort(initialSort);
          setSaveError(null);
        },
        save: async () => {
          if (!dataDirty) return { ok: true };
          try {
            await dispatch(
              updatePanelTimeline({
                panelId: panel.id,
                typeId: selectedTypeId,
                fieldMapping: Object.keys(fieldMapping).length > 0 ? fieldMapping : null,
                sort,
              }),
            ).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save timeline.";
            setSaveError(error);
            return { ok: false, error };
          }
        },
      }),
      [
        dataDirty,
        dispatch,
        fieldMapping,
        initialFieldMapping,
        initialSort,
        initialTypeId,
        panel.id,
        selectedTypeId,
        sort,
      ],
    );

    const filteredDataTypes = pipelineOutputDataTypes.filter((dt) =>
      dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
    );
    const slots = PANEL_SLOTS.timeline;

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Timeline</h3>

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
            setFieldMapping({});
            setTypeSearch("");
          }}
        />

        {selectedType && (
          <FieldMappingSlots
            slots={slots}
            fieldMapping={fieldMapping}
            onFieldChange={(slotKey, v) =>
              setFieldMapping((prev) => ({
                ...prev,
                [slotKey]: v,
              }))
            }
            fieldOptions={fieldOptions(selectedType)}
          />
        )}

        <div className="panel-detail-modal__data-section">
          <span className="panel-detail-modal__data-label" id="timeline-sort-label">
            Order
          </span>
          <div
            className="panel-detail-modal__segmented"
            role="group"
            aria-labelledby="timeline-sort-label"
          >
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`panel-detail-modal__segmented-btn${
                  sort === option.value ? " panel-detail-modal__segmented-btn--active" : ""
                }`}
                aria-pressed={sort === option.value}
                onClick={() => setSort(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <InlineError error={saveError} />
      </>
    );
  },
);
