import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import type { SourceDeleteConflict } from "../state/sourcesSlice";
import "./SourceDeleteConflictNotice.css";

interface SourceDeleteConflictNoticeProps {
  sourceName: string;
  conflict: SourceDeleteConflict;
  onDismiss?: () => void;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `a ${one} you cannot access` : `${n} ${many} you cannot access`;
}

function composeCopy(hasNamed: boolean, hiddenPipelines: number, hiddenPanels: number): string {
  const hidden = [
    hiddenPipelines > 0 ? plural(hiddenPipelines, "pipeline", "pipelines") : null,
    hiddenPanels > 0 ? plural(hiddenPanels, "form panel", "form panels") : null,
  ].filter((x): x is string => x !== null);
  const parts = [...(hasNamed ? ["the items below"] : []), ...hidden];
  const subject = parts.length > 0 ? parts.join(", and ") : "other resources";
  return `it is still referenced by ${subject}. Remove each reference first.`;
}

const KIND_LABELS: Record<string, string> = {
  root: "root",
  join: "join input",
  lookup: "lookup input",
  union: "union input",
  upsertTarget: "upsert target",
};

/** HEL-989 / HEL-1252: shown when `DELETE /api/data-sources/:id` is refused (409) because the source is still
 *  referenced -- as a pipeline root, a join/lookup/union input, an upsert target, or a form panel's binding.
 *  Names each visible referencing pipeline (link to its editor, with the kinds it holds) and form panel (link to
 *  its dashboard). The copy is composed HERE from the structured fields (`hiddenPipelineCount` /
 *  `hiddenPanelCount` give the unnamed hidden counts); the server `message`/`reason` carries ids meant for
 *  API/MCP agents and is NOT shown, except as a fallback for an older server body with no structured data. */
export function SourceDeleteConflictNotice({
  sourceName,
  conflict,
  onDismiss,
}: SourceDeleteConflictNoticeProps) {
  const { pipelines, panels } = conflict;
  const hasNamed = pipelines.length > 0 || panels.length > 0;
  const hiddenPipelines = conflict.hiddenPipelineCount ?? 0;
  const hiddenPanels = conflict.hiddenPanelCount ?? 0;
  const structured =
    conflict.hiddenPipelineCount !== undefined || conflict.hiddenPanelCount !== undefined;
  // The server `message` carries ids (useful to API/MCP agents), so the UI composes its own copy from the structured
  // fields; it falls back to `message` only when the body names no reference AND carries no structured counts.
  const copy =
    !hasNamed && !structured
      ? conflict.message
      : composeCopy(hasNamed, hiddenPipelines, hiddenPanels);
  return (
    <div className="source-delete-conflict" role="alert">
      <p className="source-delete-conflict__message">
        <TriangleAlert aria-hidden="true" size={12} /> {`"${sourceName}" was not deleted: `}
        {copy}
      </p>
      {hasNamed ? (
        <ul className="source-delete-conflict__list">
          {pipelines.map((p) => (
            <li key={`pipeline-${p.id}`}>
              <Link className="source-delete-conflict__link" to={`/pipelines/${p.id}`}>
                {p.name}
              </Link>
              {p.references.length > 0
                ? ` (pipeline, ${p.references.map((r) => KIND_LABELS[r] ?? r).join(", ")})`
                : " (pipeline)"}
            </li>
          ))}
          {panels.map((p) => (
            <li key={`panel-${p.id}`}>
              <Link className="source-delete-conflict__link" to={`/dashboards/${p.dashboardId}`}>
                {p.title}
              </Link>
              {` (form panel on ${p.dashboardName})`}
            </li>
          ))}
        </ul>
      ) : null}
      {onDismiss !== undefined ? (
        <button type="button" className="source-delete-conflict__dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
