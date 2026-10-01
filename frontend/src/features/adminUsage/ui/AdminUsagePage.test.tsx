import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import * as service from "../services/adminUsageService";
import type { AdminUsage } from "../types/adminUsage";
import { AdminUsagePage } from "./AdminUsagePage";

jest.mock("../services/adminUsageService", () => ({ fetchAdminUsage: jest.fn() }));
// The ECharts canvas is not exercised in jsdom; the page's text alternatives and tables are.
jest.mock("./UsageChart", () => ({
  UsageChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const fetchMock = jest.mocked(service.fetchAdminUsage);

const usage: AdminUsage = {
  days: 3,
  from: "2026-04-11",
  to: "2026-04-13",
  rolledThrough: "2026-04-13",
  signupsPerDay: [
    { day: "2026-04-11", count: 2 },
    { day: "2026-04-12", count: 0 },
    { day: "2026-04-13", count: 5 },
  ],
  ttfd: {
    newUsersOnly: true,
    perDay: [
      { day: "2026-04-11", sampleCount: 2, medianSeconds: 320, p90Seconds: 900 },
      { day: "2026-04-12", sampleCount: 0, medianSeconds: null, p90Seconds: null },
      { day: "2026-04-13", sampleCount: 0, medianSeconds: null, p90Seconds: null },
    ],
    latest: { day: "2026-04-11", sampleCount: 2, medianSeconds: 320, p90Seconds: 900 },
  },
  funnel: [
    { stage: "firstrun_file_dropped", users: 8, conversionFromPrevious: null },
    { stage: "firstrun_dashboard_created", users: 6, conversionFromPrevious: 0.75 },
    { stage: "first_dashboard_rendered", users: 3, conversionFromPrevious: 0.5 },
  ],
  templateChoices: [
    { template: "streamer", count: 4 },
    { template: "other", count: 1 },
  ],
  provenanceOpensPerDay: [
    { day: "2026-04-11", count: 1 },
    { day: "2026-04-12", count: 0 },
    { day: "2026-04-13", count: 3 },
  ],
  activeUsers: [
    { day: "2026-04-11", dailyActiveUsers: 4, weeklyActiveUsers: null },
    { day: "2026-04-12", dailyActiveUsers: 0, weeklyActiveUsers: null },
    { day: "2026-04-13", dailyActiveUsers: 7, weeklyActiveUsers: 12 },
  ],
};

beforeEach(() => fetchMock.mockReset());

function tableByCaption(caption: string) {
  return screen.getByRole("table", { name: caption, hidden: true });
}

describe("AdminUsagePage", () => {
  it("renders the data-through date and labels TTFD as new users only", async () => {
    fetchMock.mockResolvedValue(usage);
    renderWithStore(<AdminUsagePage />);

    expect(await screen.findByText("Data through 2026-04-13 (UTC)")).toBeInTheDocument();
    expect(
      screen.getByText(/New users only \(users who signed up after telemetry shipped\)/),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(30);
  });

  it("shows exact funnel, template and TTFD numbers in accessible tables, with gaps as a dash not 0", async () => {
    fetchMock.mockResolvedValue(usage);
    renderWithStore(<AdminUsagePage />);
    await screen.findByText("Data through 2026-04-13 (UTC)");

    const funnel = within(tableByCaption("First-run funnel"));
    expect(funnel.getByRole("row", { name: /File dropped 8 —/ })).toBeInTheDocument();
    expect(funnel.getByRole("row", { name: /Dashboard created 6 75%/ })).toBeInTheDocument();
    expect(funnel.getByRole("row", { name: /First dashboard rendered 3 50%/ })).toBeInTheDocument();

    const templates = within(tableByCaption("Template choices"));
    expect(templates.getByRole("row", { name: /streamer 4/ })).toBeInTheDocument();
    expect(templates.getByRole("row", { name: /other 1/ })).toBeInTheDocument();

    const ttfd = within(tableByCaption("Time to first dashboard per day, new users only"));
    expect(ttfd.getByRole("row", { name: /2026-04-11 2 5m 20s 15m 0s/ })).toBeInTheDocument();
    expect(ttfd.getByRole("row", { name: /2026-04-12 0 — —/ })).toBeInTheDocument();

    const active = within(tableByCaption("Daily and weekly active users"));
    expect(active.getByRole("row", { name: /2026-04-11 4 —/ })).toBeInTheDocument();
    expect(active.getByRole("row", { name: /2026-04-13 7 12/ })).toBeInTheDocument();

    const signups = within(tableByCaption("Signups per day"));
    expect(signups.getByRole("row", { name: /2026-04-13 5/ })).toBeInTheDocument();
  });

  it("gives every chart a text alternative", async () => {
    fetchMock.mockResolvedValue(usage);
    renderWithStore(<AdminUsagePage />);
    await screen.findByText("Data through 2026-04-13 (UTC)");

    expect(
      screen.getByRole("img", { name: /Signups per day, 7 in the last 3 days/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Time to first dashboard, new users only; latest/ }),
    ).toBeInTheDocument();
  });

  it("shows an empty state, not charts, when nothing has been rolled up", async () => {
    fetchMock.mockResolvedValue({ ...usage, rolledThrough: null });
    renderWithStore(<AdminUsagePage />);

    expect(await screen.findByText("No usage data yet")).toBeInTheDocument();
    expect(screen.queryByText("Signups per day")).not.toBeInTheDocument();
  });

  it("shows a visible error with Retry on failure, and recovers", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(usage);
    renderWithStore(<AdminUsagePage />);

    expect(await screen.findByText("Failed to load usage.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Data through 2026-04-13 (UTC)")).toBeInTheDocument();
  });

  it("refetches for a different window", async () => {
    fetchMock.mockResolvedValue(usage);
    renderWithStore(<AdminUsagePage />);
    await screen.findByText("Data through 2026-04-13 (UTC)");

    fireEvent.click(screen.getByRole("combobox", { name: "Time window" }));
    fireEvent.click(await screen.findByRole("option", { name: "Last 7 days" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(7));
  });
});
