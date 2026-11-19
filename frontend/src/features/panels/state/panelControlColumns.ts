import { isOutputPanel } from "./panelNarrowing";
import type { Panel } from "../types/panel";

const NONE: ReadonlySet<string> = new Set();

/** The columns of a panel's own (non-orphaned) viewer controls: the only columns the per-panel route will sort or filter
 *  on (`PublicOutputControlScope`). A panel that is not in state, or not an Output panel, has none. */
export function panelControlColumns(panel: Panel | undefined): ReadonlySet<string> {
  if (panel === undefined || !isOutputPanel(panel)) return NONE;
  return new Set(panel.config.controls.filter((c) => !c.orphaned).map((c) => c.column));
}
