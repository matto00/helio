import { summarizeAuthoringProposal } from "./authoringSummary";
import type { DashboardProposal } from "../types/proposal";

describe("summarizeAuthoringProposal", () => {
  it('formats as Proposed "<name>" (<n> panel(s))', () => {
    const proposal: DashboardProposal = {
      dashboardName: "Sales overview",
      panels: [
        { title: "Total", type: "metric" },
        { title: "Trend", type: "chart" },
      ],
    };

    expect(summarizeAuthoringProposal(proposal)).toBe('Proposed "Sales overview" (2 panel(s))');
  });

  it("formats zero panels the same way (0 panel(s), not a special-cased singular/plural)", () => {
    const proposal: DashboardProposal = { dashboardName: "Empty", panels: [] };

    expect(summarizeAuthoringProposal(proposal)).toBe('Proposed "Empty" (0 panel(s))');
  });
});
