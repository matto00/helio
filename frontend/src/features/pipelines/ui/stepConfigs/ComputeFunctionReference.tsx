import { COMPUTE_FUNCTION_REFERENCE } from "./computeFunctionReference";

/** Collapsible function reference for the compute expression input. A native disclosure, so it is
 *  keyboard reachable and announced with a real name without extra wiring. */
export function ComputeFunctionReference() {
  return (
    <details className="pipeline-detail-page__compute-functions">
      <summary className="pipeline-detail-page__compute-functions-summary tap-expand-44">
        Functions
      </summary>
      <ul
        className="pipeline-detail-page__compute-functions-list"
        aria-label="Expression functions"
      >
        {COMPUTE_FUNCTION_REFERENCE.map((fn) => (
          <li key={fn.name} className="pipeline-detail-page__compute-functions-item">
            <code className="pipeline-detail-page__compute-functions-signature">
              {fn.signature}
            </code>
            <span>{fn.description}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
