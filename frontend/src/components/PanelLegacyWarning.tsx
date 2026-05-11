import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";

import "./PanelLegacyWarning.css";

/**
 * Inline warning banner shown on panels whose bound DataType was created directly
 * from a DataSource (pre-v1.3 legacy binding). Prompts the user to re-attach via
 * a pipeline. The panel continues to render its existing data underneath.
 */
export function PanelLegacyWarning() {
  return (
    <div className="panel-legacy-warning" role="alert">
      <span className="panel-legacy-warning__icon" aria-hidden="true">
        <FontAwesomeIcon icon={faTriangleExclamation} />
      </span>
      <span className="panel-legacy-warning__text">
        This panel uses a legacy data binding. Attach a pipeline to migrate to the current data
        model.
      </span>
    </div>
  );
}
