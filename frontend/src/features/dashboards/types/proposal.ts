import type { Dashboard } from "./dashboard";
import type { Panel } from "../../panels/types/panel";

/** Per-panel grid placement in a proposal (optional). */
export interface ProposalPanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One proposed panel. No ids are minted until the proposal is applied. An
 *  `output` panel references an existing Output by `outputId`; its data
 *  configuration lives on the Output's `config`, not here. Mirrors
 *  schemas/dashboards/dashboard-proposal.schema.json.
 *
 *  `content`/`url`/`orientation` seed the initial config of text/markdown,
 *  image, and divider panels respectively (applied at create time).
 *  `fieldMapping`, `label` and `unit` are deprecated and ignored (HEL-1440): the
 *  apply path never reads them, and so are the chart fields
 *  (`chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`), which the backend
 *  decodes but never applies. They stay accepted so existing proposals still
 *  round-trip. */
export interface ProposalPanel {
  title: string;
  type: string;
  outputId?: string;
  /** @deprecated Ignored on apply; set the mapping on the Output's `config` instead. */
  fieldMapping?: Record<string, string>;
  content?: string;
  url?: string;
  orientation?: string;
  chartType?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  seriesColors?: string[];
  /** @deprecated Ignored on apply; set it on the Output's `config` instead. */
  label?: string;
  /** @deprecated Ignored on apply; set it on the Output's `config` instead. */
  unit?: string;
  layout?: ProposalPanelLayout;
  /** Output panels only (HEL-1193). Validated by the same rule as the panel write path. */
  controls?: ProposalControl[];
}

/** One control declared on an output panel in a proposal; `id` is minted at apply when absent. */
export interface ProposalControl {
  id?: string;
  kind: "date-range" | "dropdown" | "numeric-range" | "text";
  column: string;
  label?: string;
  defaultValue?: unknown;
}

/** A dashboard proposal — the shared Proposal → Review → Apply artifact. */
export interface DashboardProposal {
  dashboardName: string;
  panels: ProposalPanel[];
}

/** Response from POST /api/dashboards/apply-proposal. */
export interface AppliedProposal {
  dashboard: Dashboard;
  panels: Panel[];
}
