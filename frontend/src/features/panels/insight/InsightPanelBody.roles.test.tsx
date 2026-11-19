// HEL-1780 D7: an insight body reads through its panel's read scope. An owner's reads `GET /api/outputs/:id/insight`; a
// non-owner's (a per-panel source: the dashboard, no token) reads `/api/dashboards/:id/panels/:panelId/insight`. The
// "Not available on shared dashboards yet" placeholder is gone.
import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
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

it("a non-owner's insight body reads the per-panel insight route with no token", () => {
  (useInsight as jest.Mock).mockClear();
  renderWithStore(
    <InsightPanelBody
      panelId="p"
      outputId="o"
      output={output}
      historySource={{ variant: "public", dashboardId: "d" }}
    />,
  );
  expect(screen.queryByText("Not available on shared dashboards yet")).toBeNull();
  expect(useInsight).toHaveBeenCalledWith({
    variant: "public",
    dashboardId: "d",
    panelId: "p",
    token: undefined,
  });
});

it("an owner's insight body reads the Output insight route", () => {
  (useInsight as jest.Mock).mockClear();
  renderWithStore(<InsightPanelBody panelId="p" outputId="o" output={output} />);
  expect(useInsight).toHaveBeenCalledWith({
    variant: "authenticated",
    outputId: "o",
    pipelineId: "pl",
  });
});
