import type { ConditionalFormatRule } from "../../../panels/ui/renderers/conditionalFormatting";
import type { Output } from "../../types/output";
import { readCollectionConfig, readTableConfig } from "../outputEditor/outputConfigTypes";

/** Map a collection's rules onto cell rules of its mapped `value` column: a collection item evaluates its
 *  rules against its row's `fieldMapping.value` cell, so in a rows table that is the faithful equivalent.
 *  No mapped value column -> no rules (a rule can't be evaluated against nothing). */
export function collectionRulesAsCellRules(
  rules: readonly ConditionalFormatRule[],
  valueColumn: string | undefined,
): ConditionalFormatRule[] {
  if (!valueColumn) return [];
  return rules.map((rule) => ({ ...rule, column: valueColumn, target: "cell" }));
}

/** HEL-1490 D2/D3 -- the rules the history rows table applies: the Output's CURRENT rules. Table rules pass
 *  through; collection rules map onto the value column; a metric's rules evaluate one headline value, not a
 *  stored row, so metrics (and every other kind) apply none. Empty -> `undefined` (rendering unchanged). */
export function historyRowRules(output: Output): ConditionalFormatRule[] | undefined {
  let rules: ConditionalFormatRule[] | undefined;
  if (output.kind === "table") {
    rules = readTableConfig(output.config).conditionalFormats;
  } else if (output.kind === "collection") {
    const config = readCollectionConfig(output.config);
    rules = collectionRulesAsCellRules(
      config.conditionalFormats ?? [],
      config.fieldMapping.value || undefined,
    );
  }
  return rules && rules.length > 0 ? rules : undefined;
}
