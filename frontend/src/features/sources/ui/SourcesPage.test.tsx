import { fireEvent, screen, waitFor } from "@testing-library/react";

import { fetchSources as fetchSourcesRequest } from "../services/dataSourceService";
import { renderWithStore } from "../../../test/renderWithStore";
import { SourcesPage } from "./SourcesPage";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
  deleteSource: jest.fn(),
  refreshSource: jest.fn(),
  createRestSource: jest.fn(),
  createCsvSource: jest.fn(),
  inferFromJson: jest.fn(),
  inferFromCsv: jest.fn(),
  updateSource: jest.fn(),
}));

const fetchSourcesMock = jest.mocked(fetchSourcesRequest);

// AddSourceModal uses <dialog> showModal/close, which jsdom doesn't
// implement — mirrors PanelList.test.tsx's identical stub.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

describe("SourcesPage", () => {
  beforeEach(() => {
    fetchSourcesMock.mockClear();
  });

  it("renders the page shell (heading lives in the top breadcrumb, not in-page)", () => {
    renderWithStore(<SourcesPage />);
    // The in-page section heading was removed because the top breadcrumb
    // already shows "Data Sources / <name>"; just verify the page mounts.
    expect(document.querySelector(".sources-page")).toBeInTheDocument();
  });

  it("renders the empty-state message when no sources exist", async () => {
    // The page renders an EmptyState when no sources are connected.
    renderWithStore(<SourcesPage />);
    expect(await screen.findByText(/Connect a data source/i)).toBeInTheDocument();
  });

  it("HEL-528: renders a skeleton, not the empty state, while sources are loading", () => {
    fetchSourcesMock.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const { container } = renderWithStore(<SourcesPage />);

    expect(container.querySelector(".ui-empty-state--main .ui-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/Connect a data source/i)).not.toBeInTheDocument();
  });

  it("HEL-528: keeps rendering the selected source's detail panel during a refetch instead of the skeleton", async () => {
    renderWithStore(<SourcesPage />, {
      sources: {
        items: [
          {
            id: "src-1",
            name: "Sales CSV",
            type: "csv" as const,
            createdAt: "2026-05-01T00:00:00Z",
            updatedAt: "2026-05-01T00:00:00Z",
            inferredSchema: [],
            config: { path: "csv/src-1.csv" },
          },
        ],
        status: "loading",
      },
    });

    expect(document.querySelector(".ui-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("Sales CSV")).toBeInTheDocument();
  });

  // HEL-909 vocabulary refresh — "bindable type" (DataType) is retired;
  // the pipeline step now produces Outputs.
  it("F-011: the empty-state copy names the pipeline step, not a direct source-to-panel binding", async () => {
    renderWithStore(<SourcesPage />);
    expect(await screen.findByText(/shape into Outputs with a pipeline/i)).toBeInTheDocument();
  });

  it("F-072: fetches sources on a cold mount", () => {
    renderWithStore(<SourcesPage />, {
      sources: { items: [], status: "idle" },
    });
    expect(fetchSourcesMock).toHaveBeenCalled();
  });

  it("F-072: does not re-dispatch fetchSources once already loaded", () => {
    renderWithStore(<SourcesPage />, {
      sources: { items: [], status: "succeeded" },
    });
    expect(fetchSourcesMock).not.toHaveBeenCalled();
  });

  // HEL-539 — error state + retry recovery
  it("renders a visible error state with Retry on fetch failure, and Retry recovers on success", async () => {
    fetchSourcesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<SourcesPage />, {
      sources: { items: [], status: "idle" },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load sources");
    expect(alert).toHaveTextContent("Failed to load sources.");
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    fetchSourcesMock.mockResolvedValueOnce([]);
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText(/Connect a data source/i)).toBeInTheDocument();
    expect(fetchSourcesMock).toHaveBeenCalledTimes(2);
  });

  // HEL-554 D4/task 3.4/3.6 — the missing unmount cleanup for
  // `addSourceModalOpen`, mirroring `PanelList.test.tsx`'s identical
  // "panel-creation modal flag reset on unmount" suite.
  describe("add-source modal flag reset on unmount (HEL-554 D4)", () => {
    it("does not reopen the modal on a fresh mount after a prior instance unmounted with the flag left true", async () => {
      const { rerender } = renderWithStore(<SourcesPage />, {
        sources: { items: [], status: "succeeded", addModalOpen: true },
      });

      // Sanity: the preset flag really does open the modal on first mount —
      // proves the probe can detect "modal open" at all before trusting a
      // later "not open" reading.
      expect(await screen.findByRole("dialog", { name: "Add data source" })).toBeInTheDocument();

      // Unmount SourcesPage (fires its cleanup effect) — the store persists
      // (same Provider instance) — then mount a FRESH SourcesPage instance.
      rerender(<></>);
      rerender(<SourcesPage />);

      expect(screen.queryByRole("dialog", { name: "Add data source" })).not.toBeInTheDocument();
    });

    it("verifies the unmount path directly: opening the modal, navigating away, and returning does not re-open it", async () => {
      const { rerender } = renderWithStore(<SourcesPage />, {
        sources: { items: [], status: "succeeded" },
      });
      expect(screen.queryByRole("dialog", { name: "Add data source" })).not.toBeInTheDocument();

      fireEvent.click(await screen.findByRole("button", { name: "Add source" }));
      expect(await screen.findByRole("dialog", { name: "Add data source" })).toBeInTheDocument();

      // "Navigate away with it open" — unmount while the flag is still true.
      rerender(<></>);
      rerender(<SourcesPage />);

      expect(screen.queryByRole("dialog", { name: "Add data source" })).not.toBeInTheDocument();
    });
  });
});
