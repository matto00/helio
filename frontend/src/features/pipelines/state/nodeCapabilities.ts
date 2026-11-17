// nodeCapabilities -- HEL-1733 (design.md D5/D7): a client port of the server's `PipelineNodeReads.buildNodeCapabilities` and
// `OutputBindingSpec.evaluate`, so the Output editor sheet can offer a draft node's columns and per-kind bindings from the typed
// schema the server projected for the DRAFT (never inferred from rows). Held to the server by `__fixtures__/nodeCapabilitiesParity.json`
// (`NodeCapabilitiesParitySpec.scala` asserts the Scala side, `nodeCapabilities.test.ts` this one).

import { CANONICAL_FIELD_TYPES } from "../../sources/types/dataSource";
import type { Capability, NodeCapabilities, OutputSchemaField } from "../types/output";

type Eligibility = "numeric" | "orderable" | "any";

interface BindingSpec {
  kind: string;
  required: string[];
  optional: string[];
  eligibility: Record<string, Eligibility>;
}

const METRIC: BindingSpec = {
  kind: "metric",
  required: ["value"],
  optional: ["label", "unit"],
  eligibility: { value: "numeric", label: "any", unit: "any" },
};

/** `OutputBindingSpec.All`, in the server's order. */
const SPECS: BindingSpec[] = [
  METRIC,
  {
    kind: "chart",
    required: ["xAxis", "yAxis"],
    optional: ["series", "annotation"],
    eligibility: { xAxis: "any", yAxis: "numeric", series: "any", annotation: "any" },
  },
  { kind: "table", required: [], optional: [], eligibility: {} },
  { ...METRIC, kind: "collection" },
  {
    kind: "timeline",
    required: ["time", "event"],
    optional: [],
    eligibility: { time: "orderable", event: "any" },
  },
  { kind: "markdown", required: [], optional: [], eligibility: {} },
];

const CANONICAL: ReadonlySet<string> = new Set(CANONICAL_FIELD_TYPES);

/** `DataFieldType.canonicalizeLegacy`, then `fromString`: a known synonym is normalised, anything else unknown is `null`. The server's
 *  `SchemaField` already refuses both, so this is defensive for a wire that ever carries one. */
export function canonicalFieldType(raw: string): string | null {
  const type =
    raw === "number" || raw === "double"
      ? "float"
      : raw === "long"
        ? "integer"
        : raw === "date"
          ? "timestamp"
          : raw;
  return CANONICAL.has(type) ? type : null;
}

function accepts(eligibility: Eligibility, type: string | null): boolean {
  if (eligibility === "any") return true;
  if (type === null) return false;
  if (eligibility === "numeric") return type === "integer" || type === "float";
  return type === "timestamp" || type === "integer" || type === "float";
}

export const MISSING_COLUMNS_REASON = "missing-required-column-type";

/** The columns the typed wire knows and one bindability verdict per Output kind, for the node whose schema is `schema`. */
export function buildNodeCapabilities(
  schema: readonly OutputSchemaField[],
  stepId?: string,
): NodeCapabilities {
  const typed = schema.map((f) => ({ name: f.name, type: canonicalFieldType(f.type) }));
  const columns = typed.flatMap((f) =>
    f.type === null ? [] : [{ name: f.name, dataType: f.type, nullable: false }],
  );
  const capabilities: Record<string, Capability> = {};
  for (const spec of SPECS) {
    const eligibleColumns: Record<string, string[]> = {};
    for (const slot of [...spec.required, ...spec.optional]) {
      const eligibility = spec.eligibility[slot] ?? "any";
      // `any` accepts every column the schema lists, including a type the wire does not know (the server's `accepts(Any, _)`
      // is vacuous; its `eligibleColumnNames` filters on `fromString` first, so an unknown type never reaches it).
      eligibleColumns[slot] = typed
        .filter((f) => f.type !== null && accepts(eligibility, f.type))
        .map((f) => f.name);
    }
    const bindable = spec.required.every((slot) => (eligibleColumns[slot] ?? []).length > 0);
    capabilities[spec.kind] = {
      bindable,
      requiredSlots: spec.required,
      optionalSlots: spec.optional,
      eligibleColumns,
      ...(bindable
        ? {}
        : {
            reason: MISSING_COLUMNS_REASON,
            message: `No column satisfies a required slot for '${spec.kind}'`,
          }),
    };
  }
  return { ...(stepId !== undefined ? { stepId } : {}), columns, capabilities };
}
