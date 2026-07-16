// Shared field-option builder for panel-config editors. Extracted at the
// third use (BindingEditor, TextContentEditor, MarkdownEditor — HEL-245,
// rule of three) so the identical field + computed-field option shape lives
// in one place.

import type { SelectOption } from "../../../../shared/ui/index";
import type { DataType } from "../../../dataTypes/types/dataType";

/** Field + computed-field options for a selected DataType. */
export function fieldOptions(dataType: DataType): SelectOption[] {
  return [
    ...dataType.fields.map((f) => ({ value: f.name, label: f.name })),
    ...(dataType.computedFields ?? []).map((cf) => ({
      value: cf.name,
      label: `${cf.name} (computed)`,
    })),
  ];
}
