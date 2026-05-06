import { Link } from "react-router-dom";

import type { PipelineSummary } from "../types/models";

interface Props {
  pipelines: PipelineSummary[];
}

function StatusBadge({ status }: { status: PipelineSummary["lastRunStatus"] }) {
  if (status === null) {
    return <span className="pipeline-status pipeline-status--never">never run</span>;
  }
  return <span className={`pipeline-status pipeline-status--${status}`}>{status}</span>;
}

export function PipelineListTable({ pipelines }: Props) {
  return (
    <table className="pipeline-list-table">
      <thead>
        <tr>
          <th className="pipeline-list-table__th">Name</th>
          <th className="pipeline-list-table__th">Source</th>
          <th className="pipeline-list-table__th">Output Type</th>
          <th className="pipeline-list-table__th">Last Run Status</th>
          <th className="pipeline-list-table__th">Last Run At</th>
        </tr>
      </thead>
      <tbody>
        {pipelines.map((pipeline) => (
          <tr key={pipeline.id} className="pipeline-list-table__row">
            <td className="pipeline-list-table__td">
              <Link to={`/pipelines/${pipeline.id}`} className="pipeline-list-table__link">
                {pipeline.name}
              </Link>
            </td>
            <td className="pipeline-list-table__td">{pipeline.sourceDataSourceName}</td>
            <td className="pipeline-list-table__td">{pipeline.outputDataTypeName}</td>
            <td className="pipeline-list-table__td">
              <StatusBadge status={pipeline.lastRunStatus} />
            </td>
            <td className="pipeline-list-table__td">
              {pipeline.lastRunAt ?? <span className="pipeline-list-table__dash">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
