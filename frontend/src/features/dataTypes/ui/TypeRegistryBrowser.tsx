import "./TypeRegistryBrowser.css";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { useAppSelector } from "../../../hooks/reduxHooks";
import { selectPipelineOutputDataTypes } from "../state/dataTypesSlice";
import type { DataType } from "../types/dataType";
import { TypeDetailPanel } from "./TypeDetailPanel";
import { EmptyState } from "../../../shared/ui/EmptyState";

export function TypeRegistryBrowser() {
  const { selectedTypeId } = useAppSelector((state) => state.dataTypes);
  const items = useAppSelector(selectPipelineOutputDataTypes);

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
        description="Types are created by pipelines. Create or run a pipeline to generate a type you can bind to panels."
      />
    );
  }

  return (
    <div className="type-registry-browser type-registry-browser--single">
      <TypeDetailPanel dataType={selectedType} />
    </div>
  );
}
