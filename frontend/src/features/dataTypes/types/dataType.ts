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
