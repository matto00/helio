import { getDataTypeId } from "../state/panelNarrowing";
import type { Panel } from "../types/panel";
import { useAppSelector } from "../../../hooks/reduxHooks";

/**
 * Returns true when the given panel is "legacy-bound" — i.e. its bound DataType
 * was created directly from a DataSource (pre-v1.3) and therefore has a non-null
 * `sourceId`. Returns false for unbound panels, pipeline-backed DataTypes, and
 * when the DataTypes slice is not yet populated.
 */
export function useLegacyBoundPanel(panel: Panel): boolean {
  const dataTypes = useAppSelector((state) => state.dataTypes.items);

  const typeId = getDataTypeId(panel);
  if (!typeId) {
    return false;
  }

  const dataType = dataTypes.find((dt) => dt.id === typeId);
  if (!dataType) {
    return false;
  }

  return dataType.sourceId !== null;
}
