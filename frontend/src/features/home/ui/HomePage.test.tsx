import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { dashboard, iso, pipeline, run, summary } from "../test/homeFixtures";
import { renderHome } from "../test/renderHome";
import { HomePage } from "./HomePage";

jest.mock("../services/homeService");
import { fetchHomeSummary } from "../services/homeService";

jest.mock("../hooks/useCoarsePointer");
import { useCoarsePointer } from "../hooks/useCoarsePointer";

jest.mock("../../../app/shell/useIsPhoneShell");
import { useIsPhoneShell } from "../../../app/shell/useIsPhoneShell";

jest.mock("../../onboarding/ui/FirstRunDropZone", () => ({
  FirstRunDropZone: ({ onStepByStep }: { onStepByStep: () => void }) => (
    <div>
      <p>Drop zone</p>
      <button type="button" onClick={onStepByStep}>
        Set up step by step
      </button>
    </div>
  ),
}));

const fetchMock = fetchHomeSummary as jest.MockedFunction<typeof fetchHomeSummary>;
const coarseMock = useCoarsePointer as jest.MockedFunction<typeof useCoarsePointer>;
const phoneMock = useIsPhoneShell as jest.MockedFunction<typeof useIsPhoneShell>;

const populated = summary({
  pipelines: [
    pipeline({
      pipelineId: "p1",
      name: "orders-sync",
      runs: [
        run({
          runId: "a",
          startedAt: iso(-3),
          status: "failed",
          errorLog: "source returned 0 rows",
        }),
      ],
      upcoming: [iso(2)],
    }),
  ],
  pipelinesWithActivity: 11,
  attention: [
    {
      kind: "failed",
      pipelineId: "p1",
      pipelineName: "orders-sync",
      runId: "a",
      at: iso(-3),
      reason: "source returned 0 rows",
      resolvedAt: null,
      inFlight: false,
    },
  ],
  upNext: [{ pipelineId: "p1", pipelineName: "orders-sync", at: iso(2) }],
});

const dashboards = [
  dashboard("d1", "Markets", "2026-10-13T00:00:00Z", [{ panelId: "x", x: 0, y: 0, w: 6, h: 4 }]),
  dashboard("d2", "News", "2026-10-12T00:00:00Z"),
];

describe("HomePage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    coarseMock.mockReturnValue(false);
    phoneMock.mockReturnValue(false);
  });

  it("makes exactly one summary request on load and none per pipeline", async () => {
    fetchMock.mockResolvedValue(populated);
    renderHome(<HomePage />, { dashboards });
    await screen.findByRole("group", { name: "Pipeline runs, last 24 hours" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when the tab becomes visible again", async () => {
    fetchMock.mockResolvedValue(populated);
    renderHome(<HomePage />, { dashboards });
    await screen.findByRole("group", { name: "Pipeline runs, last 24 hours" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("renders a Home landmark with the opening sentence, shelf, timeline, attention and up next", async () => {
    fetchMock.mockResolvedValue(populated);
    renderHome(<HomePage />, { dashboards });
    expect(screen.getByRole("region", { name: "Home" })).toBeInTheDocument();
    expect(await screen.findByText(/One run failed/)).toBeInTheDocument();
    expect(screen.getByText(/everything else is quiet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Markets/ })).toHaveAttribute("href", "/dashboards/d1");
    expect(screen.getByRole("link", { name: /All 2/ })).toHaveAttribute("href", "/dashboards");
    expect(screen.getByRole("region", { name: "Needs attention" })).toHaveTextContent(
      "source returned 0 rows",
    );
    expect(screen.getByRole("region", { name: "Up next" })).toHaveTextContent("orders-sync");
    expect(screen.getByRole("link", { name: "+10 more" })).toHaveAttribute("href", "/pipelines");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("shows no changed dot in Phase A", async () => {
    fetchMock.mockResolvedValue(populated);
    renderHome(<HomePage />, { dashboards });
    await screen.findByText(/One run failed/);
    expect(screen.queryByText(/changed since your last visit/)).not.toBeInTheDocument();
  });

  it("shows skeletons of the final layout while loading", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderHome(<HomePage />, { dashboards: [], dashboardsStatus: "loading" });
    expect(screen.getByRole("status", { name: "Loading dashboards" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading pipeline runs" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading summary" })).toBeInTheDocument();
  });

  it("keeps the runs head and the shelf head the same while loading (HEL-1665)", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderHome(<HomePage />, { dashboards: [], dashboardsStatus: "loading" });
    // The legend is in the runs head before the summary arrives, so the head does not change height when it does.
    expect(screen.getByRole("list", { name: "Legend" })).toBeInTheDocument();
    // The shelf head holds the All N link's line (hidden, not a link) until the list arrives.
    expect(screen.queryByRole("link", { name: /All/ })).not.toBeInTheDocument();
    expect(container.querySelector(".home-section__link-slot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // The placeholder holds the default sentence, hidden from assistive tech, under the skeleton bar.
    const status = screen.getByRole("status", { name: "Loading summary" });
    expect(status.querySelector(".home-opening__skeleton-line")).not.toBeNull();
    const ghost = status.querySelector(".home-opening__ghost");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    // Nothing selecting the real sentence may match the placeholder (HEL-1572's no-flash probe reads it by class).
    expect(container.querySelector(".home-opening__sentence")).toBeNull();
    expect(ghost).toHaveTextContent("All quiet: nothing has changed, failed or been missed.");
  });

  it("never claims nothing needs attention or nothing is scheduled while the summary is pending", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderHome(<HomePage />, { dashboards });
    expect(screen.getByRole("status", { name: "Loading needs attention" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading up next" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs attention.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is scheduled/)).not.toBeInTheDocument();
  });

  it("never claims nothing needs attention or nothing is scheduled after a failed summary, and offers a retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    renderHome(<HomePage />, { dashboards });
    await screen.findByText("Run activity isn't available right now.");
    expect(screen.queryByText("Nothing needs attention.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is scheduled/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThanOrEqual(2);
  });

  it("shows an error with a retry while the shelf still renders from the dashboards list", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    renderHome(<HomePage />, { dashboards });
    expect(await screen.findByText("Run activity isn't available right now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Markets/ })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(populated);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    expect(await screen.findByText(/One run failed/)).toBeInTheDocument();
  });

  describe("a brand-new user", () => {
    it("sees the first-run drop zone and the three empty states with no error", async () => {
      fetchMock.mockResolvedValue(summary());
      renderHome(<HomePage />, { dashboards: [] });
      await waitFor(() =>
        expect(screen.queryByRole("status", { name: "Loading summary" })).not.toBeInTheDocument(),
      );
      expect(
        screen.getByText("All quiet: nothing has changed, failed or been missed."),
      ).toBeInTheDocument();
      expect(screen.getByText("Drop zone")).toBeInTheDocument();
      expect(screen.getByText("No pipeline runs yet")).toBeInTheDocument();
      expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
      expect(
        within(screen.getByRole("region", { name: "Up next" })).getByRole("link", {
          name: "Schedule a pipeline",
        }),
      ).toHaveAttribute("href", "/pipelines");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Go to Data Pipelines" }));
      expect(screen.getByTestId("location")).toHaveTextContent("/pipelines");
    });

    it("opens /dashboards with the step-by-step flag from the drop zone", async () => {
      fetchMock.mockResolvedValue(summary());
      const { store } = renderHome(<HomePage />, { dashboards: [] });
      fireEvent.click(await screen.findByRole("button", { name: "Set up step by step" }));
      expect(screen.getByTestId("location")).toHaveTextContent('/dashboards|{"stepByStep":true}');
      expect(store.getState().onboarding.active).toBe(true);
    });
  });

  it("renders each pipeline as one disclosure control on a coarse pointer at tablet width", async () => {
    coarseMock.mockReturnValue(true);
    fetchMock.mockResolvedValue(populated);
    renderHome(<HomePage />, { dashboards });
    const toggle = await screen.findByRole("button", { name: /orders-sync, 1 run, 1 failed/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("group", { name: "Pipeline runs, last 24 hours" }),
    ).not.toBeInTheDocument();
  });

  it("at 375px (phone shell) shows a failed run's error with a link to the pipeline", async () => {
    phoneMock.mockReturnValue(true);
    fetchMock.mockResolvedValue(populated);
    renderHome(<HomePage />, { dashboards });
    fireEvent.click(await screen.findByRole("button", { name: /orders-sync, 1 run, 1 failed/ }));
    const failedRow = document.querySelector(".tl-disc__error")?.closest("li") as HTMLElement;
    expect(within(failedRow).getByText("failed")).toBeInTheDocument();
    expect(within(failedRow).getByRole("link", { name: "Open pipeline" })).toHaveAttribute(
      "href",
      "/pipelines/p1",
    );
  });
});

describe("HomePage trailing refetch", () => {
  it("lands the post-Retry refetch even when a request was in flight", async () => {
    coarseMock.mockReturnValue(false);
    phoneMock.mockReturnValue(false);
    fetchMock.mockReset();
    let release: (value: ReturnType<typeof summary>) => void = () => {};
    fetchMock
      .mockResolvedValueOnce(populated)
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      .mockResolvedValue(populated);
    const { store } = renderHome(<HomePage />, { dashboards });
    await screen.findByRole("group", { name: "Pipeline runs, last 24 hours" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // A Retry's refetch arrives while the visibility refetch is still pending.
    const { loadHomeSummary } = await import("../state/homeSummarySlice");
    await act(async () => {
      await store.dispatch(loadHomeSummary({ queueIfBusy: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      release(populated);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
