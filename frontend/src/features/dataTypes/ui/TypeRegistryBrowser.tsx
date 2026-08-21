import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layers } from "lucide-react";

import "./TypeRegistryBrowser.css";
import { useCreatePipelineAction } from "../../pipelines/hooks/useCreatePipelineAction";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { selectPipelineOutputDataTypes, setSelectedTypeId } from "../state/dataTypesSlice";
import type { DataType } from "../types/dataType";
import { TypeDetailPanel } from "./TypeDetailPanel";
import { EmptyState } from "../../../shared/ui/EmptyState";

export function TypeRegistryBrowser() {
  const { id: routeId } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { selectedTypeId } = useAppSelector((state) => state.dataTypes);
  const items = useAppSelector(selectPipelineOutputDataTypes);
  // HEL-548 D4/D4a/5.1 — types exist only as pipeline output, so this
  // section's only create path is "New pipeline", never a (nonexistent)
  // "add type" action.
  const createPipelineAction = useCreatePipelineAction();

  // F-075: hydrate the Redux selection from the URL on a deep-link/reload —
  // e.g. a shared /registry/:id link, or a browser refresh that would
  // otherwise reset to items[0] below.
  useEffect(() => {
    if (routeId && selectedTypeId === null && items.some((dt) => dt.id === routeId)) {
      dispatch(setSelectedTypeId(routeId));
    }
  }, [routeId, selectedTypeId, items, dispatch]);

  // Derive the effective selection from the sidebar (Redux) — explicit user
  // choice wins, otherwise fall back to the first item so the panel is never
  // blank. Selection and delete are both owned by the sidebar now; the page
  // is just the detail panel.
  const selectedType: DataType | null =
    items.find((dt) => dt.id === selectedTypeId) ?? items[0] ?? null;

  // F-075: keep the URL in sync with the effective selection (sidebar click,
  // the hydration effect above, or the items[0] fallback) so the address bar
  // always reflects what's on screen and can be shared/reloaded.
  useEffect(() => {
    if (selectedType && routeId !== selectedType.id) {
      navigate(`/registry/${selectedType.id}`, { replace: true });
    }
  }, [selectedType, routeId, navigate]);

  if (selectedType === null) {
    return (
      <EmptyState
        variant="main"
        icon={<Layers />}
        title="No types defined"
        description="Types are created by pipelines. Create or run a pipeline to generate a type you can bind to panels."
        cta={createPipelineAction.cta}
      />
    );
  }

  return (
    <div className="type-registry-browser type-registry-browser--single">
      {/* F-001: keyed on the selected type's id so React remounts the panel
       * (and re-initializes its editable Name/Schema/Computed-fields form
       * state) on every selection change, instead of reusing the previous
       * instance's stale local state against a new `dataType` prop. */}
      <TypeDetailPanel key={selectedType.id} dataType={selectedType} />
    </div>
  );
}
