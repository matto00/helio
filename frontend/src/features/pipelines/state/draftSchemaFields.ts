// draftSchemaFields -- HEL-1777 (design.md D1/D2): the one field list (name + type) a draft step's "Rows after step N" grid and its
// "Output schema" chips both show. Pure; no request. Names are the draft's column order; a type comes from, in order: the column the
// shown step's own draft rename produced it from (saved input schema, then saved output), the saved output schema by name (today's
// grid rule), then the type inferred from the draft rows.

import type { Frame } from "../evaluator";
import { renameOrigins } from "../evaluator/steps/rowOps";
import type { SchemaField } from "../types/pipelineStep";
import { schemaFromFrame } from "./draftEvaluation";

export interface DraftSchemaFieldsInput {
  frame: Frame;
  /** The draft's column names in grid order. */
  names: readonly string[];
  savedOutput: readonly SchemaField[];
  savedInput: readonly SchemaField[];
  /** The shown step's draft renames in fold order; `undefined` when it is not a rename step. */
  renames?: ReadonlyArray<[string, string]>;
}

export function draftSchemaFields({
  frame,
  names,
  savedOutput,
  savedInput,
  renames,
}: DraftSchemaFieldsInput): SchemaField[] {
  const inputTypes = new Map(savedInput.map((f) => [f.name, f.type]));
  const outputTypes = new Map(savedOutput.map((f) => [f.name, f.type]));
  const renamed = new Map<string, string>();
  if (renames !== undefined && renames.length > 0) {
    for (const { name, originName } of renameOrigins(
      savedInput.map((f) => f.name),
      renames,
    )) {
      if (name !== originName) renamed.set(name, originName);
    }
  }
  let inferred: Map<string, string> | undefined;
  const inferredType = (name: string): string => {
    inferred ??= new Map(schemaFromFrame(frame).map((f) => [f.name, f.type]));
    return inferred.get(name) ?? "string";
  };
  return names.map((name) => {
    const origin = renamed.get(name);
    const fromOrigin =
      origin === undefined ? undefined : (inputTypes.get(origin) ?? outputTypes.get(origin));
    return { name, type: fromOrigin ?? outputTypes.get(name) ?? inferredType(name) };
  });
}
