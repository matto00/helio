import type { Panel } from "../types/models";
import { useAppSelector } from "./reduxHooks";

/**
 * Returns true when the given panel is "legacy-bound" — i.e. its bound DataType
 * was created directly from a DataSource (pre-v1.3) and therefore has a non-null
 * `sourceId`. Returns false for unbound panels, pipeline-backed DataTypes, and
 * when the DataTypes slice is not yet populated.
 */
export function useLegacyBoundPanel(panel: Panel): boolean {
  const dataTypes = useAppSelector((state) => state.dataTypes.items);

  if (!panel.typeId) {
    return false;
  }

  const dataType = dataTypes.find((dt) => dt.id === panel.typeId);
  if (!dataType) {
    return false;
  }

  return dataType.sourceId !== null;
}
