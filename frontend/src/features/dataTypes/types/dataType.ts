// DataType domain types — extracted from `types/models.ts` as part of CS4
// cycle 1 to colocate types with their feature folder.

export interface DataTypeField {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export interface ComputedField {
  name: string;
  displayName: string;
  expression: string;
  dataType: string;
}

export interface DataType {
  id: string;
  name: string;
  sourceId: string | null;
  version: number;
  fields: DataTypeField[];
  computedFields: ComputedField[];
  createdAt: string;
  updatedAt: string;
}

/** Wire values for the `FieldTypeCategory.Content` field types (HEL-217):
 * `DataFieldType.asString` produces these for content-backed fields. */
const CONTENT_FIELD_DATA_TYPES = new Set(["string-body", "binary-ref"]);

/** A DataType is "unstructured" when it has at least one content-typed field
 * (`string-body` / `binary-ref`). Only `fields` are checked — `computedFields`
 * are expression outputs and no current compute op produces a content-typed
 * result. */
export function isUnstructuredDataType(dt: DataType): boolean {
  return dt.fields.some((field) => CONTENT_FIELD_DATA_TYPES.has(field.dataType));
}
