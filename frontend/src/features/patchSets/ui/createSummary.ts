import { OUTPUT_REF_PREFIX, type EditPreview } from "../types/patchSet";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** HEL-1639: one plain-language line for a `create` edit the raw before/after JSON makes hard to read — an `output`
 *  create (what it shows, on which node, which columns) and a `panel` create bound by `$ref` to an Output the same
 *  patch set creates. `null` for every other edit, which keeps the raw JSON panes only. */
export function describeCreate(edit: EditPreview): string | null {
  if (edit.op !== "create") return null;
  const after = asRecord(edit.after);
  if (!after) return null;

  if (edit.kind === "output") {
    const name = typeof after.name === "string" ? after.name : "Output";
    const kind = typeof after.kind === "string" ? after.kind : "output";
    const node = typeof after.nodeStepId === "string" ? ` at step ${after.nodeStepId}` : "";
    const mapping = asRecord(asRecord(after.config)?.fieldMapping);
    const columns = mapping
      ? Object.entries(mapping)
          .map(([slot, column]) => `${slot} ← ${String(column)}`)
          .join(", ")
      : "";
    return `New ${kind} Output “${name}”${node}${columns ? ` (${columns})` : ""}`;
  }

  if (edit.kind === "panel") {
    const outputId = asRecord(after.config)?.outputId;
    if (typeof outputId === "string" && outputId.startsWith(OUTPUT_REF_PREFIX)) {
      const title = typeof after.title === "string" ? after.title : "Panel";
      return `New panel “${title}” shows the Output created by this patch set (${outputId.slice(OUTPUT_REF_PREFIX.length)})`;
    }
  }
  return null;
}
