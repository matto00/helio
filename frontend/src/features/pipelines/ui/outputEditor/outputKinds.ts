import type { SelectOption } from "../../../../shared/ui/index";
import type { OutputKind } from "../../types/output";

/** The kinds the Output editor's create flow offers. `insight` is deliberately absent until its authoring UI ships (HEL-1744);
 *  `outputKindDrift.test.ts` pins this exclusion. */
export const CREATABLE_KIND_OPTIONS: SelectOption[] = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
  { value: "metric", label: "Metric" },
  { value: "collection", label: "Collection" },
  { value: "timeline", label: "Timeline" },
  { value: "markdown", label: "Markdown" },
];

/** The picker's options for an Output of `kind`: an existing insight (opened read-only on its kind) needs its own label shown. */
export function kindOptionsFor(kind: OutputKind): SelectOption[] {
  return kind === "insight"
    ? [...CREATABLE_KIND_OPTIONS, { value: "insight", label: "Insight" }]
    : CREATABLE_KIND_OPTIONS;
}
