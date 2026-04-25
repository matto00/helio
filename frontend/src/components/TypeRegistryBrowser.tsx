import { useState } from "react";

import "./TypeRegistryBrowser.css";
import { deleteDataType } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import type { DataType } from "../types/models";
import { TypeDetailPanel } from "./TypeDetailPanel";

export function TypeRegistryBrowser() {
  const dispatch = useAppDispatch();
  const { items } = useAppSelector((state) => state.dataTypes);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedType = items.find((dt) => dt.id === selectedTypeId) ?? null;

  if (items.length === 0) {
    return (
      <div className="type-registry-browser__empty-state">
        <p className="type-registry-browser__empty-message">
          No data types yet. Add a data source to create types automatically.
        </p>
      </div>
    );
  }

  async function handleDeleteConfirm(id: string) {
    setDeleteError(null);
    const result = await dispatch(deleteDataType(id));
    if (deleteDataType.rejected.match(result)) {
      setDeleteError(
        result.payload ?? "One or more panels are bound to this type. Unbind them before deleting.",
      );
    } else {
      if (selectedTypeId === id) setSelectedTypeId(null);
    }
    setConfirmDeleteId(null);
  }

  return (
    <div className="type-registry-browser">
      <div>
        {deleteError && (
          <p className="type-registry-browser__delete-error" role="alert">
            {deleteError}
          </p>
        )}
        <ul className="type-registry-browser__list" aria-label="Data types">
          {items.map((dt: DataType) => (
            <li
              key={dt.id}
              className={
                dt.id === selectedTypeId
                  ? "type-registry-browser__item type-registry-browser__item--selected"
                  : "type-registry-browser__item"
              }
            >
              <div className="type-registry-browser__item-row">
                <button
                  type="button"
                  className="type-registry-browser__item-btn"
                  aria-pressed={dt.id === selectedTypeId}
                  onClick={() => setSelectedTypeId(dt.id)}
                >
                  <span className="type-registry-browser__item-name">{dt.name}</span>
                  <span className="type-registry-browser__item-count">
                    {dt.fields.length} field{dt.fields.length !== 1 ? "s" : ""}
                  </span>
                </button>
                {confirmDeleteId === dt.id ? (
                  <div className="type-registry-browser__item-confirm">
                    <span className="type-registry-browser__confirm-text">Delete?</span>
                    <button
                      type="button"
                      className="type-registry-browser__confirm-btn type-registry-browser__confirm-btn--danger"
                      aria-label={`Confirm delete ${dt.name}`}
                      onClick={() => void handleDeleteConfirm(dt.id)}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className="type-registry-browser__confirm-btn"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="type-registry-browser__delete-btn"
                    aria-label={`Delete ${dt.name}`}
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmDeleteId(dt.id);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {selectedType && (
        <TypeDetailPanel dataType={selectedType} onClose={() => setSelectedTypeId(null)} />
      )}
    </div>
  );
}
