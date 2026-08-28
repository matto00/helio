import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { useScrollEdges } from "../../../shared/ui/useScrollEdges";
import { StatusChip } from "../../../shared/ui/StatusChip";
import { isUnstructuredDataType, type DataType } from "../types/dataType";
import "./TypeListTable.css";

interface Props {
  dataTypes: DataType[];
  /** Producing pipeline name per DataType id. A type exists only as a
   *  pipeline's output, so provenance is the single most useful column here —
   *  the same mapping the sidebar already shows as a subtitle (HEL-270). */
  pipelineNameByTypeId: Map<string, string>;
}

/**
 * Overview table for `/registry`.
 *
 * Read-only by design, and that is a real difference from its Pipelines,
 * Metrics and Sources siblings rather than an unfinished edge: types have no
 * create action anywhere in the app (`SidebarBody`'s registry branch
 * deliberately omits `onAdd`) because they are produced BY pipelines. So this
 * page carries no toolbar and no create button — the columns are chosen for
 * auditing what exists and where it came from, not for managing it.
 */
export function TypeListTable({ dataTypes, pipelineNameByTypeId }: Props) {
  const navigate = useNavigate();
  const { ref: scrollRef, edges: scrollEdges } = useScrollEdges<HTMLDivElement>();

  function handleRowClick(typeId: string) {
    return (event: MouseEvent<HTMLTableRowElement>) => {
      if ((event.target as HTMLElement).closest("a, button")) return;
      navigate(`/registry/${typeId}`);
    };
  }

  const scrollClasses = [
    "type-list-table__scroll",
    scrollEdges.left ? "type-list-table__scroll--left" : null,
    scrollEdges.right ? "type-list-table__scroll--right" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={scrollClasses} ref={scrollRef}>
      <table className="type-list-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Shape</th>
            <th scope="col">Fields</th>
            <th scope="col">Produced by</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {dataTypes.map((dataType) => {
            const pipelineName = pipelineNameByTypeId.get(dataType.id);
            // Computed fields are part of the type's surface but are derived
            // rather than stored, so they are counted separately instead of
            // folded into one total that would overstate the stored schema.
            const computedCount = dataType.computedFields.length;
            return (
              <tr
                key={dataType.id}
                className="type-list-table__row"
                onClick={handleRowClick(dataType.id)}
              >
                <td>
                  <Link className="type-list-table__name" to={`/registry/${dataType.id}`}>
                    {dataType.name}
                  </Link>
                </td>
                <td>
                  <StatusChip intent="neutral">
                    {isUnstructuredDataType(dataType) ? "Unstructured" : "Structured"}
                  </StatusChip>
                </td>
                <td>
                  {dataType.fields.length}
                  {computedCount > 0 && (
                    <span className="type-list-table__muted"> + {computedCount} computed</span>
                  )}
                </td>
                <td>
                  {pipelineName === undefined ? (
                    /* Omitted rather than guessed when the producing pipeline
                       isn't loaded — the same choice the sidebar's provenance
                       subtitle makes (HEL-270). */
                    <span className="type-list-table__muted">—</span>
                  ) : (
                    pipelineName
                  )}
                </td>
                <td className="type-list-table__muted">{formatRelativeTime(dataType.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
