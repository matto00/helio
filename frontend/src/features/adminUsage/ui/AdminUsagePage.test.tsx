import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import * as service from "../services/adminUsageService";
import { usage } from "../adminUsage.fixture";
import { AdminUsagePage } from "./AdminUsagePage";

jest.mock("../services/adminUsageService", () => ({ fetchAdminUsage: jest.fn() }));
// The ECharts canvas is not exercised in jsdom; the page's text alternatives and tables are.
jest.mock("./UsageChart", () => ({
  UsageChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const fetchMock = jest.mocked(service.fetchAdminUsage);

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

  it("shows all-time totals, labelled as tracked-event activity, independent of the window", async () => {
    fetchMock.mockResolvedValue(usage);
    renderWithStore(<AdminUsagePage />);
    await screen.findByText("Data through 2026-04-13 (UTC)");

    const totals = within(screen.getByRole("region", { name: "All-time totals" }));
    expect(totals.getByText("Total users").nextElementSibling).toHaveTextContent("8");
    expect(totals.getByText("Active, last 7 days").nextElementSibling).toHaveTextContent("2");
    expect(totals.getByText("Active, last 30 days").nextElementSibling).toHaveTextContent("4");
    expect(
      totals.getAllByText(/users with a tracked product event, as of 2026-04-13/),
    ).toHaveLength(2);
  });

  it("renders an unavailable active count as a dash with a note, never 0", async () => {
    fetchMock.mockResolvedValue({
      ...usage,
      totals: { ...usage.totals, activeLast30Days: null },
    });
    renderWithStore(<AdminUsagePage />);
    await screen.findByText("Data through 2026-04-13 (UTC)");

    const totals = within(screen.getByRole("region", { name: "All-time totals" }));
    expect(totals.getByText("Active, last 30 days").nextElementSibling).toHaveTextContent("—");
    expect(totals.getByText("not yet available")).toBeInTheDocument();
    expect(totals.getByText("Active, last 7 days").nextElementSibling).toHaveTextContent("2");
  });

  it("still shows the total user count when nothing has been rolled up", async () => {
    fetchMock.mockResolvedValue({
      ...usage,
      rolledThrough: null,
      totals: { totalUsers: 8, activeLast7Days: null, activeLast30Days: null, asOf: null },
    });
    renderWithStore(<AdminUsagePage />);

    const totals = within(await screen.findByRole("region", { name: "All-time totals" }));
    expect(totals.getByText("Total users").nextElementSibling).toHaveTextContent("8");
    expect(totals.getAllByText("not yet available")).toHaveLength(2);
    expect(screen.getByText("No usage data yet")).toBeInTheDocument();
  });

  it("explains the rollup lag next to the data-through date", async () => {
    fetchMock.mockResolvedValue(usage);
    renderWithStore(<AdminUsagePage />);

    expect(
      await screen.findByText("The most recent ~2 days are still being rolled up."),
    ).toBeInTheDocument();
  });

  it("offers the 180 and 365 day windows and requests them", async () => {
    fetchMock.mockResolvedValue(usage);
    renderWithStore(<AdminUsagePage />);
    await screen.findByText("Data through 2026-04-13 (UTC)");

    fireEvent.click(screen.getByRole("combobox", { name: "Time window" }));
    expect(await screen.findByRole("option", { name: "Last 180 days" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Last 365 days" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(365));
  });
});
