import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { useScrollEdges } from "../../../shared/ui/useScrollEdges";
import { StatusChip } from "../../../shared/ui/StatusChip";
import { labelForKind } from "../utils/labelForKind";
import type { DataSource } from "../types/dataSource";
import "./SourceListTable.css";

interface Props {
  sources: DataSource[];
  /** Names of the pipelines reading each source, keyed by source id. Drives
   *  the "Used by" column — the question a detail-only view could never
   *  answer without opening every source in turn. */
  pipelineNamesBySourceId: Map<string, string[]>;
}

/**
 * Overview table for `/sources`, mirroring `PipelineListTable`'s shape (same
 * scroll-shadow affordance, same whole-row-click navigation, same relative
 * timestamps) so the three section overviews read as one family.
 *
 * `Location` is derived per source kind rather than stored: the config shapes
 * keep their locator under different keys (`config.path` for file-backed
 * kinds, `url`-or-`endpoint` for REST, host/database for SQL) and `static` has
 * no config at all. Returning `null` for `static` is meaningful, not a gap — a
 * static source genuinely has no external location.
 */
function locationFor(source: DataSource): string | null {
  switch (source.type) {
    case "rest_api":
      // Exactly one of `url`/`connectorId` is set (see `RestApiSourceConfig`).
      // A connector-backed source carries no `url` — its locator is the
      // `endpoint` path, resolved against the Connector's base URL, so
      // showing the path alone is the honest answer here rather than
      // inventing an absolute URL this row cannot know.
      return source.config.url ?? source.config.endpoint ?? null;
    case "sql":
      return `${source.config.host}/${source.config.database}`;
    case "csv":
    case "text":
    case "pdf":
    case "image":
      return source.config.path;
    case "static":
      return null;
  }
}

export function SourceListTable({ sources, pipelineNamesBySourceId }: Props) {
  const navigate = useNavigate();
  const { ref: scrollRef, edges: scrollEdges } = useScrollEdges<HTMLDivElement>();

  // Whole-row click to match the row hover affordance, skipping clicks that
  // originated on an interactive descendant so the row never double-navigates
  // (the same guard `PipelineListTable.handleRowClick` documents).
  function handleRowClick(sourceId: string) {
    return (event: MouseEvent<HTMLTableRowElement>) => {
      if ((event.target as HTMLElement).closest("a, button")) return;
      navigate(`/sources/${sourceId}`);
    };
  }

  const scrollClasses = [
    "source-list-table__scroll",
    scrollEdges.left ? "source-list-table__scroll--left" : null,
    scrollEdges.right ? "source-list-table__scroll--right" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={scrollClasses} ref={scrollRef}>
      <table className="source-list-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col">Location</th>
            <th scope="col">Used by</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => {
            const location = locationFor(source);
            const usedBy = pipelineNamesBySourceId.get(source.id) ?? [];
            return (
              <tr
                key={source.id}
                className="source-list-table__row"
                onClick={handleRowClick(source.id)}
              >
                <td>
                  <Link className="source-list-table__name" to={`/sources/${source.id}`}>
                    {source.name}
                  </Link>
                </td>
                <td>
                  <StatusChip intent="neutral">{labelForKind(source.type)}</StatusChip>
                </td>
                <td>
                  {location === null ? (
                    <span className="source-list-table__muted">—</span>
                  ) : (
                    /* `title` carries the untruncated value: a REST URL or a
                       SQL host/database routinely exceeds the column, and the
                       cell clips rather than wrapping the row to two lines. */
                    <span className="source-list-table__location" title={location}>
                      {location}
                    </span>
                  )}
                </td>
                <td>
                  {usedBy.length === 0 ? (
                    <span className="source-list-table__muted">Unused</span>
                  ) : (
                    <span title={usedBy.join(", ")}>
                      {usedBy.length} pipeline{usedBy.length === 1 ? "" : "s"}
                    </span>
                  )}
                </td>
                <td className="source-list-table__muted">{formatRelativeTime(source.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
