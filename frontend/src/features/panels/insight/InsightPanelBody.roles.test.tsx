// HEL-1773 D6: an insight read is `GET /api/outputs/:id/insight` (an Output route), so a dashboard grantee gets a neutral
// state and no request is made; the public viewer (a `historySource`) is unaffected.
import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";

import { DashboardAccessProvider } from "../../dashboards/state/dashboardAccessContext";
import { InsightPanelBody } from "./InsightPanelBody";
import { useInsight } from "./useInsight";

jest.mock("./useInsight", () => ({
  useInsight: jest.fn(() => ({ data: null, loading: true, error: null, refetch: jest.fn() })),
}));

const output = {
  id: "o",
  pipelineId: "pl",
  ownerId: "u",
  name: "n",
  kind: "insight",
  config: {},
  schema: [],
  createdAt: "",
  updatedAt: "",
};

it("renders the neutral state for a non-owner and never reads the insight", () => {
  (useInsight as jest.Mock).mockClear();
  renderWithStore(
    <DashboardAccessProvider role="viewer">
      <InsightPanelBody panelId="p" outputId="o" output={output} />
    </DashboardAccessProvider>,
  );
  expect(screen.getByText("Not available on shared dashboards yet")).toBeInTheDocument();
  expect(useInsight).not.toHaveBeenCalled();
});

it("an owner's insight body reads the insight as before", () => {
  (useInsight as jest.Mock).mockClear();
  renderWithStore(
    <DashboardAccessProvider role="owner">
      <InsightPanelBody panelId="p" outputId="o" output={output} />
    </DashboardAccessProvider>,
  );
  expect(useInsight).toHaveBeenCalled();
});
