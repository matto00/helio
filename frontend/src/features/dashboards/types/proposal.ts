import type { Dashboard } from "./dashboard";
import type { Panel } from "../../panels/types/panel";

/** Per-panel grid placement in a proposal (optional). */
export interface ProposalPanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One proposed panel. No ids are minted until the proposal is applied. Data
 *  panels (metric/chart/table) reference an existing pipeline-output DataType
 *  by id. Mirrors schemas/dashboard-proposal.schema.json. */
export interface ProposalPanel {
  title: string;
  type: string;
  dataTypeId?: string;
  fieldMapping?: Record<string, string>;
  layout?: ProposalPanelLayout;
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
