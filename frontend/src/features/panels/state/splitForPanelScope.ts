import {
  composeOutputRowsFilter,
  type OutputRowsFilter,
  type OutputRowsFilterOp,
  type OutputRowsSort,
} from "../../pipelines/services/outputService";
import type { CrossFilterEq } from "../types/panel";

// HEL-1780 D4 -- on a dashboard the caller does not own, `GET /api/dashboards/:id/panels/:panelId/rows` accepts a sort or
// filter only on the panel's OWN control columns, and rejects `quick` outright (`PublicOutputControlScope`, HEL-1190 C11).
// Everything else is applied in the browser over the rows already loaded. This is the one pure place that cuts a full
// intent into the part the server may be sent and the part the client applies.

export interface RowsIntent {
  sort?: OutputRowsSort;
  filter?: OutputRowsFilter;
  crossFilterEq?: CrossFilterEq | null;
}

/** What the client applies to the loaded rows: the terms the server may not be sent. */
export interface ClientRowOps {
  sort?: { key: string; direction: "asc" | "desc" };
  columns?: Record<string, string>;
  quick?: string;
}

export interface PanelScopeSplit {
  /** The request's sort/filter: control columns only, never `quick`. */
  server: { sort?: OutputRowsSort; filter?: OutputRowsFilter };
  client: ClientRowOps;
}

export function hasClientOps(client: ClientRowOps | undefined): boolean {
  if (!client) return false;
  return (
    client.sort !== undefined ||
    (client.quick?.trim() ?? "") !== "" ||
    Object.values(client.columns ?? {}).some((t) => t.trim() !== "")
  );
}

/** Splits a full intent. `controlColumns` are the panel's own (non-orphaned) control columns. The cross-filter `eq`
 *  joins the server part only when its column is a control column; otherwise the client narrows by it (a separate path,
 *  `OutputPanelContent`), so it is simply absent from both halves here. */
export function splitForPanelScope(
  intent: RowsIntent,
  controlColumns: ReadonlySet<string>,
): PanelScopeSplit {
  const client: ClientRowOps = {};
  const server: PanelScopeSplit["server"] = {};

  const sort = intent.sort;
  if (sort) {
    if (controlColumns.has(sort.column)) server.sort = sort;
    else client.sort = { key: sort.column, direction: sort.direction };
  }

  const serverColumns: Record<string, string> = {};
  const clientColumns: Record<string, string> = {};
  for (const [column, term] of Object.entries(intent.filter?.columns ?? {})) {
    if (term.trim() === "") continue;
    (controlColumns.has(column) ? serverColumns : clientColumns)[column] = term;
  }
  if (Object.keys(clientColumns).length > 0) client.columns = clientColumns;
  const quick = intent.filter?.quick;
  if (quick !== undefined && quick.trim() !== "") client.quick = quick;

  const ops: OutputRowsFilterOp[] = [...(intent.filter?.ops ?? [])].filter((o) =>
    controlColumns.has(o.column),
  );
  const eq = intent.crossFilterEq;
  // Clash guard: the route refuses two ops with the same (column, op), so a cross-filter `eq` never joins a viewer-control
  // `eq` on the same column (the control stays the server filter; `useCrossFilterServerOps` already falls back to the client).
  const clashes = ops.some((o) => o.column === eq?.column && o.op === "eq");
  if (eq && controlColumns.has(eq.column) && !clashes) {
    ops.push({ column: eq.column, op: "eq", value: eq.value });
  }
  const filter = composeOutputRowsFilter(
    { columns: Object.keys(serverColumns).length > 0 ? serverColumns : undefined },
    ops,
  );
  if (filter) server.filter = filter;
  return { server, client };
}
