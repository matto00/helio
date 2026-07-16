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

/** Same as `fieldOptions`, plus an explicit "— None —" (empty-value) option.
 *  Unlike field mapping (whose slots always carry a meaning once a DataType is
 *  picked), an aggregation spec is fully optional and the user needs a
 *  selectable way to clear a previously-configured field — hence the explicit
 *  clear option here only. */
export function aggFieldOptions(dataType: DataType): SelectOption[] {
  return [{ value: "", label: "— None —" }, ...fieldOptions(dataType)];
}
