import type { SelectOption } from "../../../../shared/ui/index";

/** The kinds the Output editor's create flow offers: every Output kind. `outputKindDrift.test.ts` (and the backend
 *  `OutputKindDriftSpec`) pin that this equals the canonical kind list. */
export const CREATABLE_KIND_OPTIONS: SelectOption[] = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
  { value: "metric", label: "Metric" },
  { value: "collection", label: "Collection" },
  { value: "timeline", label: "Timeline" },
  { value: "markdown", label: "Markdown" },
  { value: "insight", label: "Insight" },
];
