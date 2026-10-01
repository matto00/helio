import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";

import { fetchDashboards as fetchDashboardsRequest } from "../../dashboards/services/dashboardService";
import { track } from "../../telemetry/track";
import { renderWithStore } from "../../../test/renderWithStore";
import { buildTemplateDashboard as buildTemplateRequest } from "../services/firstRunService";
import { FirstRunDropZone } from "./FirstRunDropZone";

jest.mock("../../telemetry/track", () => ({ track: jest.fn() }));
jest.mock("../services/firstRunService", () => ({
  buildFirstRunDashboard: jest.fn(),
  buildTemplateDashboard: jest.fn(),
}));
jest.mock("../../dashboards/services/dashboardService", () => ({ fetchDashboards: jest.fn() }));
jest.mock("../../sources/services/dataSourceService", () => ({
  createCsvSource: jest.fn(),
  createCsvSourceFromUrl: jest.fn(),
  fetchSources: jest.fn().mockResolvedValue([]),
  inferFromCsv: jest.fn(),
}));

const trackMock = jest.mocked(track);
const buildMock = jest.mocked(buildTemplateRequest);
const fetchDashboardsMock = jest.mocked(fetchDashboardsRequest);

const result = {
  dashboardId: "dash-t",
  dashboardName: "Streamer stats (sample)",
  panelCount: 3,
  pipelineId: "pipe-1",
  pipelineName: "Sample: Streamer stats pipeline",
  sourceId: "src-1",
  sourceName: "Sample: Streamer stats",
};
const dashboard = {
  id: "dash-t",
  name: "Streamer stats (sample)",
  meta: { createdBy: "u", createdAt: "2026-01-01T00:00:00Z", lastUpdated: "2026-01-01T00:00:00Z" },
};

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderZone() {
  return renderWithStore(
    <Routes>
      <Route path="/" element={<FirstRunDropZone onStepByStep={jest.fn()} />} />
      <Route path="/dashboards/:id" element={<LocationProbe />} />
    </Routes>,
    { auth: { status: "authenticated" } },
  );
}

describe("FirstRunTemplateChips (HEL-1210)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildMock.mockResolvedValue(result);
    fetchDashboardsMock.mockResolvedValue([dashboard] as never);
  });

  it("offers the four personas as labelled, keyboard-operable buttons in a named group", () => {
    renderZone();
    const group = screen.getByRole("group", { name: "No file? Start from sample data" });
    const names = within(group)
      .getAllByRole("button")
      .map((b) => b.textContent);

    expect(names).toEqual([
      "StreamerFollowers, hours and revenue by game",
      "FounderSignups and new MRR by channel",
      "OpsIncidents and uptime by service",
      "FinanceSpend by month and category",
    ]);
    within(group)
      .getAllByRole("button")
      .forEach((b) => {
        expect(b.tagName).toBe("BUTTON");
        expect(b).toBeEnabled();
      });
  });

  it.each(["streamer", "founder", "ops", "finance"])(
    "choosing %s calls the template endpoint, emits firstrun_template_chosen with that slug and lands on the dashboard",
    async (slug) => {
      renderZone();

      fireEvent.click(document.querySelector(`[data-template="${slug}"]`) as HTMLElement);

      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent("/dashboards/dash-t"),
      );
      expect(buildMock).toHaveBeenCalledWith(slug);
      expect(trackMock.mock.calls).toEqual([
        ["firstrun_template_chosen", { template: slug }],
        ["firstrun_dashboard_created", { panelCount: 3 }],
      ]);
    },
  );

  it("announces progress in a polite live region and disables every chip while working", async () => {
    let finish: (value: typeof result) => void = () => {};
    buildMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderZone();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");

    fireEvent.click(screen.getByRole("button", { name: /^Ops/ }));

    await waitFor(() => expect(status).toHaveTextContent("Loading sample data"));
    within(screen.getByRole("group", { name: "No file? Start from sample data" }))
      .getAllByRole("button")
      .forEach((b) => expect(b).toBeDisabled());
    await act(async () => finish(result));
  });

  it("announces a failure as an alert and Retry repeats the same template", async () => {
    buildMock.mockRejectedValueOnce(new Error("boom"));
    renderZone();

    fireEvent.click(screen.getByRole("button", { name: /^Finance/ }));

    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/dashboards/dash-t"),
    );
    expect(buildMock).toHaveBeenCalledTimes(2);
    expect(buildMock).toHaveBeenLastCalledWith("finance");
  });
});
