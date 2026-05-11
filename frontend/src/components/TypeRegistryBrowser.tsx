import "./TypeRegistryBrowser.css";
import { useAppSelector } from "../hooks/reduxHooks";
import type { DataType } from "../types/models";
import { TypeDetailPanel } from "./TypeDetailPanel";

export function TypeRegistryBrowser() {
  const { items, selectedTypeId } = useAppSelector((state) => state.dataTypes);

  // Derive the effective selection from the sidebar (Redux) — explicit user
  // choice wins, otherwise fall back to the first item so the panel is never
  // blank. Selection and delete are both owned by the sidebar now; the page
  // is just the detail panel.
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

  return (
    <div className="type-registry-browser type-registry-browser--single">
      <TypeDetailPanel dataType={selectedType} />
    </div>
  );
}
