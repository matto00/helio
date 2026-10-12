import {
  COMPUTE_FUNCTION_REFERENCE,
  COMPUTE_LITERAL_REFERENCE,
  COMPUTE_OPERATOR_REFERENCE,
  type ComputeFunctionDoc,
} from "./computeFunctionReference";

function ReferenceList({ label, items }: { label: string; items: readonly ComputeFunctionDoc[] }) {
  return (
    <ul className="pipeline-detail-page__compute-functions-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.name} className="pipeline-detail-page__compute-functions-item">
          <code className="pipeline-detail-page__compute-functions-signature">
            {item.signature}
          </code>
          <span>{item.description}</span>
        </li>
      ))}
    </ul>
  );
}

/** Collapsible function and operator reference for the compute expression input. A native disclosure,
 *  so it is keyboard reachable and announced with a real name without extra wiring. */
export function ComputeFunctionReference() {
  return (
    <details className="pipeline-detail-page__compute-functions">
      <summary className="pipeline-detail-page__compute-functions-summary tap-expand-44">
        Functions and operators
      </summary>
      <ReferenceList label="Expression functions" items={COMPUTE_FUNCTION_REFERENCE} />
      <ReferenceList
        label="Expression operators"
        items={[...COMPUTE_OPERATOR_REFERENCE, ...COMPUTE_LITERAL_REFERENCE]}
      />
    </details>
  );
}
