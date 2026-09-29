// HEL-1189 design.md D3/D6 — the frontend mirror of the backend's
// `OutputControlEligibility.kindsFor` (services/pipelines/OutputControlEligibility.scala), the
// SINGLE source of truth for which output-panel control kinds a column is currently eligible for.
// Drift-guarded by `outputControlEligibilityDriftGuard.test.ts` (C4, mirrors
// `controlFitnessDriftGuard.test.ts`'s convention) — never edit one side without the other.

import type { OutputControlKind } from "../types/panel";

/** Mirrors the backend's `OutputFilterCapability.Operator` wire strings
 *  (`GET /api/outputs/:id/filter-capabilities`'s `columns[].operators`). */
export type FilterOperator = "contains" | "gte" | "lte" | "eq" | "in";

/** `null` allowedFieldTypes means "any type is fine" — the operator set alone already encodes the
 *  type sensitivity (text/dropdown); `[types]` gates numeric-range/date-range additionally by the
 *  column's declared type. THE literal drift-guarded against the backend's `KindRequirements` Map. */
const KIND_REQUIREMENTS: Record<
  OutputControlKind,
  { requiredOperators: FilterOperator[]; allowedFieldTypes: string[] | null }
> = {
  text: { requiredOperators: ["contains"], allowedFieldTypes: null },
  dropdown: { requiredOperators: ["eq", "in"], allowedFieldTypes: null },
  "numeric-range": { requiredOperators: ["gte", "lte"], allowedFieldTypes: ["integer", "float"] },
  "date-range": { requiredOperators: ["gte", "lte"], allowedFieldTypes: ["timestamp"] },
};

// Exported for the drift guard only — every other caller should go through `kindsFor`.
export { KIND_REQUIREMENTS };

/** Every control kind `fieldType`/`operators` is currently eligible for, given the column's
 *  already-resolved operator set (from `GET /api/outputs/:id/filter-capabilities`, which already
 *  folds in the eq/in cardinality gate) and its declared schema type. Order matches
 *  `ValidKinds`/`KindRequirements`'s declaration order (not alphabetical) so "Add control"'s kind
 *  picker offers a stable, predictable order. */
export function kindsFor(operators: FilterOperator[], fieldType: string): OutputControlKind[] {
  const opSet = new Set(operators);
  return (Object.keys(KIND_REQUIREMENTS) as OutputControlKind[]).filter((kind) => {
    const { requiredOperators, allowedFieldTypes } = KIND_REQUIREMENTS[kind];
    const opsOk = requiredOperators.every((op) => opSet.has(op));
    const typeOk = allowedFieldTypes === null || allowedFieldTypes.includes(fieldType);
    return opsOk && typeOk;
  });
}
