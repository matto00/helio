import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { Select } from "../../../../shared/ui/index";
import {
  fetchDataTypes,
  selectPipelineOutputDataTypes,
} from "../../../dataTypes/state/dataTypesSlice";
import { updatePanelCollection } from "../../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type {
  CollectionItemOptions,
  CollectionLayout,
  CollectionMetricItemOptions,
  CollectionPanel,
} from "../../types/panel";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";
import { BoundOrLiteralField, defaultBoundOrLiteralMode } from "./BoundOrLiteralField";
import { DataTypePicker } from "./DataTypePicker";
import { aggFieldOptions, fieldOptions } from "./fieldOptions";
import { useBoundOrLiteralState } from "./useBoundOrLiteralState";

interface CollectionEditorProps {
  panel: CollectionPanel;
  onDirtyChange: DirtyChangeCallback;
}

const LAYOUT_OPTIONS: { value: CollectionLayout; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
];

/** Collection panel editor (HEL-247 D7). Composes a base-type control (single
 *  `metric` option today — a visible extension point), the DataType binding
 *  picker, shared metric item slots derived from `PANEL_SLOTS.metric` (value is
 *  bind-only; label/unit use the HEL-243 bound-or-literal pattern), and a
 *  grid/list layout control. Save issues one config PATCH via
 *  `updatePanelCollection`. Purely a section — `PanelDetailModal` owns the
 *  modal lifecycle. */
export const CollectionEditor = forwardRef<PanelEditorHandle, CollectionEditorProps>(
  function CollectionEditor({ panel, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const dataTypes = useAppSelector((state) => state.dataTypes.items);
    const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
    const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

    const initialTypeId =
      panel.config.dataTypeId && panel.config.dataTypeId.length > 0
        ? panel.config.dataTypeId
        : null;
    const initialFieldMapping = panel.config.fieldMapping;
    const initialLayout = panel.config.layout;
    const metricOptions = panel.config.itemOptions?.metric;

    const initialValueField = initialFieldMapping.value ?? "";
    const initialLabelField = initialFieldMapping.label ?? "";
    const initialUnitField = initialFieldMapping.unit ?? "";
    const initialLabelLiteral = metricOptions?.label ?? "";
    const initialUnitLiteral = metricOptions?.unit ?? "";

    const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
    const [valueField, setValueField] = useState<string>(initialValueField);
    const [layout, setLayout] = useState<CollectionLayout>(initialLayout);
    const [typeSearch, setTypeSearch] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);

    const labelState = useBoundOrLiteralState(
      defaultBoundOrLiteralMode(metricOptions?.label !== undefined),
      initialLabelField,
      initialLabelLiteral,
    );
    const unitState = useBoundOrLiteralState(
      defaultBoundOrLiteralMode(metricOptions?.unit !== undefined),
      initialUnitField,
      initialUnitLiteral,
    );

    const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;

    const dataDirty =
      selectedTypeId !== initialTypeId ||
      valueField !== initialValueField ||
      layout !== initialLayout ||
      labelState.dirty ||
      unitState.dirty;

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
          setValueField(initialValueField);
          setLayout(initialLayout);
          labelState.reset();
          unitState.reset();
          setSaveError(null);
        },
        save: async () => {
          if (!dataDirty) return { ok: true };
          try {
            // Field mapping carries only bound slots; a literal label/unit lives
            // under itemOptions.metric instead (design.md D3, HEL-243 semantics).
            const outgoingFieldMapping: Record<string, string> = {
              ...(valueField ? { value: valueField } : {}),
              ...(labelState.fieldMappingValue ? { label: labelState.fieldMappingValue } : {}),
              ...(unitState.fieldMappingValue ? { unit: unitState.fieldMappingValue } : {}),
            };

            const metricItem: CollectionMetricItemOptions = {};
            if (labelState.mode === "literal" && labelState.literalValue) {
              metricItem.label = labelState.literalValue;
            }
            if (unitState.mode === "literal" && unitState.literalValue) {
              metricItem.unit = unitState.literalValue;
            }
            // Preserve any options stored under a non-active base-type key (D3).
            const nextItemOptions: CollectionItemOptions = { ...(panel.config.itemOptions ?? {}) };
            if (Object.keys(metricItem).length > 0) {
              nextItemOptions.metric = metricItem;
            } else {
              delete nextItemOptions.metric;
            }
            const itemOptions = Object.keys(nextItemOptions).length > 0 ? nextItemOptions : null;

            await dispatch(
              updatePanelCollection({
                panelId: panel.id,
                typeId: selectedTypeId,
                fieldMapping:
                  Object.keys(outgoingFieldMapping).length > 0 ? outgoingFieldMapping : null,
                baseType: "metric",
                layout,
                itemOptions,
              }),
            ).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save collection.";
            setSaveError(error);
            return { ok: false, error };
          }
        },
      }),
      [
        dataDirty,
        dispatch,
        initialLayout,
        initialTypeId,
        initialValueField,
        labelState,
        layout,
        panel.config.itemOptions,
        panel.id,
        selectedTypeId,
        unitState,
        valueField,
      ],
    );

    const filteredDataTypes = pipelineOutputDataTypes.filter((dt) =>
      dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
    );
    const valueOptions = selectedType ? aggFieldOptions(selectedType) : [];
    const labelUnitOptions = selectedType ? fieldOptions(selectedType) : [];

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Collection</h3>

        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="collection-base-type">
            Base type
          </label>
          {/* Single option today; disabled as the visible extension point for
              future base types (image, markdown). */}
          <Select
            ariaLabel="Base type"
            value="metric"
            onChange={() => undefined}
            disabled
            options={[{ value: "metric", label: "Metric" }]}
          />
          <p className="panel-detail-modal__type-hint">
            More base types are coming; collections currently render metric tiles.
          </p>
        </div>

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
            setValueField("");
            setTypeSearch("");
          }}
        />

        {selectedType && (
          <div className="panel-detail-modal__data-section">
            <span className="panel-detail-modal__data-label">Item fields</span>
            <div className="panel-detail-modal__mapping-row">
              <label className="panel-detail-modal__mapping-label" htmlFor="collection-value-field">
                Value
              </label>
              <Select
                ariaLabel="Value field"
                value={valueField}
                onChange={setValueField}
                placeholder="— None —"
                options={valueOptions}
              />
            </div>
            <BoundOrLiteralField
              label="Label"
              mode={labelState.mode}
              onModeChange={labelState.setMode}
              fieldOptions={labelUnitOptions}
              fieldValue={labelState.fieldValue}
              onFieldChange={labelState.setFieldValue}
              literalValue={labelState.literalValue}
              onLiteralChange={labelState.setLiteralValue}
              literalPlaceholder="e.g. Region"
            />
            <BoundOrLiteralField
              label="Unit"
              mode={unitState.mode}
              onModeChange={unitState.setMode}
              fieldOptions={labelUnitOptions}
              fieldValue={unitState.fieldValue}
              onFieldChange={unitState.setFieldValue}
              literalValue={unitState.literalValue}
              onLiteralChange={unitState.setLiteralValue}
              literalPlaceholder="e.g. $, %, ms"
            />
          </div>
        )}

        <div className="panel-detail-modal__data-section">
          <span className="panel-detail-modal__data-label" id="collection-layout-label">
            Layout
          </span>
          <div
            className="panel-detail-modal__segmented"
            role="group"
            aria-labelledby="collection-layout-label"
          >
            {LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`panel-detail-modal__segmented-btn${
                  layout === option.value ? " panel-detail-modal__segmented-btn--active" : ""
                }`}
                aria-pressed={layout === option.value}
                onClick={() => setLayout(option.value)}
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
