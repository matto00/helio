import "./TypeRegistryBrowser.css";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { useAppSelector } from "../hooks/reduxHooks";
import type { DataType } from "../types/models";
import { TypeDetailPanel } from "./TypeDetailPanel";
import { EmptyState } from "./ui/EmptyState";

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
      <EmptyState
        variant="main"
        icon={faLayerGroup}
        title="No types defined"
        description="Types describe the shape of your data so panels can bind to it. Connect a data source or run a pipeline — types are generated automatically from their output."
      />
    );
  }

  return (
    <div className="type-registry-browser type-registry-browser--single">
      <TypeDetailPanel dataType={selectedType} />
    </div>
  );
}
