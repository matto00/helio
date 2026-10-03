import { TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import type { SourceDeleteConflict } from "../state/sourcesSlice";
import "./SourceDeleteConflictNotice.css";

interface SourceDeleteConflictNoticeProps {
  sourceName: string;
  conflict: SourceDeleteConflict;
  onDismiss?: () => void;
}

/** HEL-989: shown when `DELETE /api/data-sources/:id` is refused (409) because pipelines still
 *  root on the source. Names each visible referencing pipeline with a link to its editor; when
 *  none are visible to the caller (the server never names those) it falls back to the server's
 *  own non-leaky reason text. */
export function SourceDeleteConflictNotice({
  sourceName,
  conflict,
  onDismiss,
}: SourceDeleteConflictNoticeProps) {
  const named = conflict.pipelines;
  return (
    <div className="source-delete-conflict" role="alert">
      <p className="source-delete-conflict__message">
        <TriangleAlert aria-hidden="true" size={12} />{" "}
        {named.length > 0
          ? `"${sourceName}" was not deleted: it is still a root of ${named.length === 1 ? "this pipeline" : "these pipelines"}. Remove it from ${named.length === 1 ? "it" : "each"} in the pipeline editor first.`
          : `"${sourceName}" was not deleted. ${conflict.message}`}
      </p>
      {named.length > 0 ? (
        <ul className="source-delete-conflict__list">
          {named.map((p) => (
            <li key={p.id}>
              <Link className="source-delete-conflict__link" to={`/pipelines/${p.id}`}>
                {p.name}
              </Link>
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
