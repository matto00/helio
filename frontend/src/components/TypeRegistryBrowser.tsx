import { useState } from "react";

import "./TypeRegistryBrowser.css";
import { deleteDataType, setSelectedTypeId } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import type { DataType } from "../types/models";
import { TypeDetailPanel } from "./TypeDetailPanel";

export function TypeRegistryBrowser() {
  const dispatch = useAppDispatch();
  const { items, selectedTypeId } = useAppSelector((state) => state.dataTypes);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Derive the effective selection from the sidebar (Redux) — explicit user
  // choice wins, otherwise fall back to the first item so the panel is never
  // blank. Type selection is now driven entirely by the sidebar to match the
  // dashboards pattern; the inline list is gone.
  const selectedType: DataType | null =
    items.find((dt) => dt.id === selectedTypeId) ?? items[0] ?? null;

  if (selectedType === null) {
    return (
      <div className="type-registry-browser__empty-state">
        <p className="type-registry-browser__empty-message">
          No data types yet. Add a data source to create types automatically.
        </p>
      </div>
    );
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    const result = await dispatch(deleteDataType(id));
    if (deleteDataType.rejected.match(result)) {
      setDeleteError(
        result.payload ?? "One or more panels are bound to this type. Unbind them before deleting.",
      );
    } else if (selectedTypeId === id) {
      // After deleting the selected type, clear the explicit selection so the
      // page falls back to the next first item.
      dispatch(setSelectedTypeId(null));
    }
    setConfirmingDelete(false);
  }

  return (
    <div className="type-registry-browser type-registry-browser--single">
      {deleteError && (
        <p className="type-registry-browser__delete-error" role="alert">
          {deleteError}
        </p>
      )}
      <TypeDetailPanel
        dataType={selectedType}
        onClose={() => dispatch(setSelectedTypeId(null))}
        confirmingDelete={confirmingDelete}
        onDeleteRequest={() => setConfirmingDelete(true)}
        onDeleteConfirm={() => void handleDelete(selectedType.id)}
        onDeleteCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
