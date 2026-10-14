import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  deleteSource as deleteSourceRequest,
  fetchSourceReferences as fetchSourceReferencesRequest,
  fetchSources as fetchSourcesRequest,
} from "../services/dataSourceService";
import { renderWithStore } from "../../../test/renderWithStore";
import { SourcesPage } from "./SourcesPage";
import { SourceDetailPanel } from "./SourceDetailPanel";
import type { DataSource } from "../types/dataSource";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn(),
  deleteSource: jest.fn(),
  refreshSource: jest.fn(),
  updateSource: jest.fn(),
  fetchCsvPreview: jest.fn(),
  fetchRestPreview: jest.fn(),
}));

const fetchSourcesMock = jest.mocked(fetchSourcesRequest);
const fetchReferencesMock = jest.mocked(fetchSourceReferencesRequest);
const deleteMock = jest.mocked(deleteSourceRequest);

const csv: DataSource = {
  id: "s-1",
  name: "Sales CSV",
  type: "csv",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
  config: { path: "csv/s-1.csv" },
  inferredSchema: [],
};
const other: DataSource = { ...csv, id: "s-2", name: "Orders CSV" };

describe("Data Sources overview: Delete row action (HEL-1574, owner ruling 2026-10-14)", () => {
  beforeEach(() => {
    fetchSourcesMock.mockReset().mockResolvedValue([csv, other]);
    fetchReferencesMock.mockReset().mockResolvedValue([]);
    deleteMock.mockReset();
  });

  it("offers a Delete button per row, named with the source, reachable by keyboard", async () => {
    renderWithStore(<SourcesPage />);
    const button = await screen.findByRole("button", { name: "Delete Sales CSV" });
    button.focus();
    expect(button).toHaveFocus();
    expect(screen.getByRole("button", { name: "Delete Orders CSV" })).toBeInTheDocument();
  });

  it("confirms, deletes and stays on the overview", async () => {
    deleteMock.mockResolvedValue(undefined);
    renderWithStore(<SourcesPage />, undefined, "/sources");
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales CSV" }));
    const confirm = screen.getByRole("group", { name: "Confirm delete Sales CSV" });
    expect(confirm).toHaveFocus();
    expect(deleteMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Sales CSV" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("s-1"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Delete Sales CSV" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Delete Orders CSV" })).toBeInTheDocument();
  });

  it("shows the reference warning the page already fetched", async () => {
    fetchReferencesMock.mockResolvedValue([
      {
        sourceId: "s-1",
        pipelines: [],
        panels: [],
        hiddenPipelineCount: 2,
        hiddenPanelCount: 0,
      },
    ] as never);
    renderWithStore(<SourcesPage />);
    await waitFor(() => expect(fetchReferencesMock).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales CSV" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "Confirm delete Sales CSV" })).getByText(
          /2 pipelines reference this source/,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders the conflict notice and keeps the source on a 409", async () => {
    deleteMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { message: "in use", pipelines: [{ id: "p-1", name: "Orders" }], panels: [] },
      },
    });
    renderWithStore(<SourcesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Sales CSV" }));
    expect(await screen.findByText(/still referenced by/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Sales CSV" })).toBeInTheDocument();
  });

  it("Cancel deletes nothing and returns focus to the row's button", async () => {
    renderWithStore(<SourcesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Sales CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete Sales CSV" })).toHaveFocus(),
    );
  });

  it("is absent from the source detail header", () => {
    renderWithStore(
      <SourceDetailPanel source={csv} />,
      { sources: { items: [csv], status: "succeeded" } },
      "/sources/s-1",
    );
    const header = document.querySelector<HTMLElement>(".source-detail-panel__header")!;
    expect(within(header).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).not.toBeInTheDocument();
  });
});
