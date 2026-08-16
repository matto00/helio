// schemaDiff.ts — HEL-405: pure per-step schema diff, computed from a step's
// analyze `inputSchema` vs `outputSchema`. Replaces the hardcoded StepCard
// placeholder chips (`+ col_a`, `− col_b`, `~ col_c`) with a real diff.
//
// Rename pairing is best-effort and op-aware: only the `rename` op's
// `config.renames` map (old→new) makes a rename determinable — see
// design.md Decision 1. Any other op, or any unpaired rename entry, leaves
// the columns as a plain add + drop.

import type { SchemaField } from "../types/pipelineStep";

export interface RenamedField {
  from: string;
  to: string;
  type: string;
}

export interface RetypedField {
  name: string;
  fromType: string;
  toType: string;
}

export interface SchemaDiff {
  added: SchemaField[];
  dropped: SchemaField[];
  renamed: RenamedField[];
  retyped: RetypedField[];
}

/**
 * Diffs a step's input schema against its output schema.
 *
 * Stable source-order emission: `retyped`/`dropped` follow input order,
 * `added` follows output order (design.md Decision 1 / Risks).
 */
export function computeSchemaDiff(
  input: SchemaField[],
  output: SchemaField[],
  renames?: Record<string, string>,
): SchemaDiff {
  const inputTypeByName = new Map(input.map((field) => [field.name, field.type]));
  const outputTypeByName = new Map(output.map((field) => [field.name, field.type]));

  const retyped: RetypedField[] = [];
  for (const field of input) {
    const outputType = outputTypeByName.get(field.name);
    if (outputType !== undefined && outputType !== field.type) {
      retyped.push({ name: field.name, fromType: field.type, toType: outputType });
    }
  }

  let added = output.filter((field) => !inputTypeByName.has(field.name));
  let dropped = input.filter((field) => !outputTypeByName.has(field.name));

  const renamed: RenamedField[] = [];
  if (renames) {
    for (const [from, to] of Object.entries(renames)) {
      const droppedField = dropped.find((field) => field.name === from);
      const addedField = added.find((field) => field.name === to);
      if (!droppedField || !addedField) continue; // unpaired — stays add/drop
      renamed.push({ from, to, type: addedField.type });
      dropped = dropped.filter((field) => field.name !== from);
      added = added.filter((field) => field.name !== to);
    }
  }

  return { added, dropped, renamed, retyped };
}
