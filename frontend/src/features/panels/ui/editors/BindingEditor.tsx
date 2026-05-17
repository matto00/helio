import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Link } from "react-router-dom";

import { Select, TextField } from "../../../../shared/ui/index";
import { fetchDataTypes } from "../../../dataTypes/state/dataTypesSlice";
import { PANEL_SLOTS } from "../../state/panelSlots";
import { updatePanelBinding } from "../../state/panelsSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import type { ChartPanel, MetricPanel, TablePanel } from "../../../../types/models";
import { InlineError } from "../../../../shared/chrome/InlineError";
import type { DirtyChangeCallback, PanelEditorHandle } from "./editorTypes";

interface BindingEditorProps {
  panel: MetricPanel | ChartPanel | TablePanel;
  /** Optional poll interval persisted only on the frontend until CS3 cleanup. */
  initialRefreshInterval: number | null;
  onDirtyChange: DirtyChangeCallback;
}

/** Per-panel typed binding (`dataTypeId` + `fieldMapping`) editor used by the
 *  three bound-capable subtypes (metric, chart, table). The previous flat-
 *  field PATCH path still flows through `updatePanelBinding`; this editor
 *  just narrows the inputs from the typed config and pushes them back via
 *  the same thunk so the wire shape ends up as a typed PATCH on `config`. */
export const BindingEditor = forwardRef<PanelEditorHandle, BindingEditorProps>(
  function BindingEditor({ panel, initialRefreshInterval, onDirtyChange }, ref) {
    const dispatch = useAppDispatch();
    const dataTypes = useAppSelector((state) => state.dataTypes.items);
    const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

    const initialTypeId =
      panel.config.dataTypeId && panel.config.dataTypeId.length > 0
        ? panel.config.dataTypeId
        : null;
    const initialFieldMapping = panel.config.fieldMapping;

    const [selectedTypeId, setSelectedTypeId] = useState<string | null>(initialTypeId);
    const [fieldMapping, setFieldMapping] = useState<Record<string, string>>(initialFieldMapping);
    const [refreshInterval, setRefreshInterval] = useState<number | null>(initialRefreshInterval);
    const [typeSearch, setTypeSearch] = useState("");
    const [saveError, setSaveError] = useState<string | null>(null);

    const dataDirty =
      selectedTypeId !== initialTypeId ||
      refreshInterval !== initialRefreshInterval ||
      JSON.stringify(fieldMapping) !== JSON.stringify(initialFieldMapping);

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
          setRefreshInterval(initialRefreshInterval);
          setSaveError(null);
        },
        save: async () => {
          if (!dataDirty) return { ok: true };
          try {
            await dispatch(
              updatePanelBinding({
                panelId: panel.id,
                typeId: selectedTypeId,
                fieldMapping: Object.keys(fieldMapping).length > 0 ? fieldMapping : null,
                refreshInterval,
              }),
            ).unwrap();
            return { ok: true };
          } catch {
            const error = "Failed to save data binding.";
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
        initialRefreshInterval,
        initialTypeId,
        panel.id,
        refreshInterval,
        selectedTypeId,
      ],
    );

    const selectedType = dataTypes.find((dt) => dt.id === selectedTypeId) ?? null;
    const slots = PANEL_SLOTS[panel.type];
    const filteredDataTypes = dataTypes.filter((dt) =>
      dt.name.toLowerCase().includes(typeSearch.toLowerCase()),
    );

    return (
      <>
        <h3 className="panel-detail-modal__edit-section-heading">Data</h3>
        <div className="panel-detail-modal__data-section">
          <span className="panel-detail-modal__data-label">Data type</span>
          {selectedType ? (
            <div className="panel-detail-modal__selected-type">
              <span className="panel-detail-modal__selected-type-name">{selectedType.name}</span>
              {selectedType.sourceId && (
                <span className="panel-detail-modal__type-badge">source</span>
              )}
              <span className="panel-detail-modal__type-count">
                {selectedType.fields.length} fields
              </span>
              <button
                type="button"
                className="panel-detail-modal__type-clear"
                aria-label="Clear selected data type"
                onClick={() => {
                  setSelectedTypeId(null);
                  setFieldMapping({});
                  setTypeSearch("");
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <TextField
                type="text"
                placeholder="Search data types…"
                value={typeSearch}
                onChange={(e) => setTypeSearch(e.target.value)}
                aria-label="Search data types"
              />
              {dataTypesStatus === "loading" ? (
                <p className="panel-detail-modal__type-hint">Loading…</p>
              ) : filteredDataTypes.length === 0 ? (
                <p className="panel-detail-modal__type-hint">No data types found.</p>
              ) : (
                <ul
                  className="panel-detail-modal__type-list"
                  role="listbox"
                  aria-label="Data types"
                >
                  {filteredDataTypes.map((dt) => (
                    <li
                      key={dt.id}
                      role="option"
                      aria-selected={dt.id === selectedTypeId}
                      className="panel-detail-modal__type-option"
                      onClick={() => {
                        setSelectedTypeId(dt.id);
                        setTypeSearch("");
                      }}
                    >
                      <span className="panel-detail-modal__selected-type-name">{dt.name}</span>
                      {dt.sourceId && (
                        <span className="panel-detail-modal__type-badge">source</span>
                      )}
                      <span className="panel-detail-modal__type-count">
                        {dt.fields.length} fields
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <Link to="/sources" className="panel-detail-modal__source-link">
            Add a new source →
          </Link>
        </div>

        {selectedType && slots.length > 0 && (
          <div className="panel-detail-modal__data-section">
            <span className="panel-detail-modal__data-label">Field mapping</span>
            {slots.map((slot) => (
              <div key={slot.key} className="panel-detail-modal__mapping-row">
                <label className="panel-detail-modal__mapping-label" htmlFor={`slot-${slot.key}`}>
                  {slot.label}
                </label>
                <Select
                  ariaLabel={`${slot.label} field`}
                  value={fieldMapping[slot.key] ?? ""}
                  onChange={(v) =>
                    setFieldMapping((prev) => ({
                      ...prev,
                      [slot.key]: v,
                    }))
                  }
                  placeholder="— None —"
                  options={[
                    ...selectedType.fields.map((f) => ({ value: f.name, label: f.name })),
                    ...(selectedType.computedFields ?? []).map((cf) => ({
                      value: cf.name,
                      label: `${cf.name} (computed)`,
                    })),
                  ]}
                />
              </div>
            ))}
          </div>
        )}

        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="refresh-interval">
            Refresh interval
          </label>
          <Select
            ariaLabel="Refresh interval"
            value={refreshInterval === null ? "" : String(refreshInterval)}
            onChange={(v) => setRefreshInterval(v === "" ? null : Number(v))}
            options={[
              { value: "", label: "Manual" },
              { value: "30", label: "30s" },
              { value: "60", label: "1m" },
              { value: "300", label: "5m" },
              { value: "900", label: "15m" },
              { value: "3600", label: "1h" },
            ]}
          />
        </div>

        <InlineError error={saveError} />
      </>
    );
  },
);
