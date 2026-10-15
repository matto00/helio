import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import { createRecentHistoryStore } from "../../features/commandPalette/model/recentHistoryStore";
import { fetchPipelineScheduleList } from "../../features/pipelines/services/pipelineScheduleListService";
import { renderWithStore } from "../../test/renderWithStore";
import { ScheduledContextList } from "./ScheduledContextList";

jest.mock("../../features/pipelines/services/pipelineScheduleListService");
jest.mock("../../features/commandPalette/model/recentHistoryStore", () => {
  const actual = jest.requireActual("../../features/commandPalette/model/recentHistoryStore");
  return { ...actual, recentHistoryStore: actual.createRecentHistoryStore("test.recents") };
});

const fetchMock = jest.mocked(fetchPipelineScheduleList);

const { recentHistoryStore } = jest.requireMock(
  "../../features/commandPalette/model/recentHistoryStore",
) as {
  recentHistoryStore: ReturnType<typeof createRecentHistoryStore>;
};

function renderList(kind: "pipelines" | "sources", path = `/${kind}`) {
  return renderWithStore(
    <Routes>
      <Route path="/pipelines" element={<ScheduledContextList kind={kind} />} />
      <Route path="/pipelines/:id" element={<ScheduledContextList kind={kind} />} />
      <Route path="/sources" element={<ScheduledContextList kind={kind} />} />
      <Route path="/sources/:id" element={<ScheduledContextList kind={kind} />} />
    </Routes>,
    { pipelines: { status: "succeeded", items: [] }, sources: { status: "succeeded", items: [] } },
    path,
  );
}

describe("ScheduledContextList", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    for (const entry of recentHistoryStore.getEntries()) {
      recentHistoryStore.pruneMissing(entry.kind, new Set());
    }
  });

  it("shows only the recently visited pipelines, never a list of every pipeline", async () => {
    fetchMock.mockResolvedValue({ items: [], sources: [] });
    recentHistoryStore.recordVisit("pipeline", "p-1", "Alpha");
    recentHistoryStore.recordVisit("pipeline", "p-2", "Beta");
    recentHistoryStore.recordVisit("source", "s-1", "A source");
    // 30 pipelines exist in the store; none of the others may appear.
    const items = [
      { id: "p-1", name: "Alpha" },
      { id: "p-2", name: "Beta" },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `pipe-${i}`,
        name: `Pipeline ${i}`,
        ownerId: "u",
        createdAt: "",
        updatedAt: "",
      })),
    ];
    renderWithStore(
      <ScheduledContextList kind="pipelines" />,
      { pipelines: { status: "succeeded", items: items as never } },
      "/pipelines",
    );
    const recent = await screen.findByRole("region", { name: "Recent" });
    expect(
      within(recent)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Beta", "Alpha"]);
    expect(screen.queryByText("Pipeline 3")).not.toBeInTheDocument();
    expect(screen.queryByText("A source")).not.toBeInTheDocument();
  });

  it("lists scheduled pipelines with their next run in the Scheduled group", async () => {
    fetchMock.mockResolvedValue({
      items: [
        {
          pipelineId: "p-9",
          pipelineName: "Nightly",
          kind: "interval",
          expression: "3600",
          timezone: "UTC",
          nextRunAt: "2030-01-01T14:00:00Z",
          lastRunAt: null,
        },
      ],
      sources: [],
    });
    renderList("pipelines");
    const scheduled = await screen.findByRole("region", { name: "Scheduled" });
    const link = await within(scheduled).findByRole("link", { name: /Nightly/ });
    expect(link).toHaveAttribute("href", "/pipelines/p-9");
    expect(link.textContent).toMatch(/next/);
  });

  it("shows a source feeding scheduled pipelines once, with the soonest run and its pipeline", async () => {
    fetchMock.mockResolvedValue({
      items: [],
      sources: [
        {
          sourceId: "s-1",
          sourceName: "Orders CSV",
          nextRunAt: "2030-01-01T09:00:00Z",
          pipelineId: "p-b",
          pipelineName: "Morning",
        },
      ],
    });
    renderList("sources");
    const scheduled = await screen.findByRole("region", { name: "Scheduled" });
    const link = await within(scheduled).findByRole("link", { name: /Orders CSV/ });
    expect(link).toHaveAttribute("href", "/sources/s-1");
    expect(link.textContent).toContain("Morning");
    expect(screen.getAllByText(/Orders CSV/)).toHaveLength(1);
  });

  it("makes exactly one schedule request for the whole list", async () => {
    fetchMock.mockResolvedValue({ items: [], sources: [] });
    renderList("pipelines");
    await waitFor(() => expect(screen.getByText("Nothing scheduled.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers View all and the add action", async () => {
    fetchMock.mockResolvedValue({ items: [], sources: [] });
    const { store } = renderList("sources");
    expect(await screen.findByRole("link", { name: "View all sources" })).toHaveAttribute(
      "href",
      "/sources",
    );
    screen.getByRole("button", { name: "Add source" }).click();
    expect(store.getState().sources.addModalOpen).toBe(true);
  });

  it("says so when the scheduled items cannot load", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    renderList("pipelines");
    expect(await screen.findByText("Couldn't load scheduled items.")).toBeInTheDocument();
  });

  it("marks the open item as current", async () => {
    fetchMock.mockResolvedValue({ items: [], sources: [] });
    recentHistoryStore.recordVisit("pipeline", "p-1", "Alpha");
    renderWithStore(
      <Routes>
        <Route path="/pipelines/:id" element={<ScheduledContextList kind="pipelines" />} />
      </Routes>,
      { pipelines: { status: "succeeded", items: [{ id: "p-1", name: "Alpha" } as never] } },
      "/pipelines/p-1",
    );
    expect(await screen.findByRole("link", { name: "Alpha" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks exactly one row current when the open item is both recent and scheduled", async () => {
    fetchMock.mockResolvedValue({
      items: [
        {
          pipelineId: "p-1",
          pipelineName: "Alpha",
          kind: "interval",
          expression: "3600",
          timezone: "UTC",
          nextRunAt: "2030-01-01T14:00:00Z",
          lastRunAt: null,
        },
      ],
      sources: [],
    });
    recentHistoryStore.recordVisit("pipeline", "p-1", "Alpha");
    renderWithStore(
      <Routes>
        <Route path="/pipelines/:id" element={<ScheduledContextList kind="pipelines" />} />
      </Routes>,
      {
        pipelines: {
          status: "succeeded",
          items: [{ id: "p-1", name: "Alpha" } as never],
        },
      },
      "/pipelines/p-1",
    );
    await screen.findByRole("link", { name: /Alpha.*next/ });
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const scheduled = screen.getByRole("region", { name: "Scheduled" });
    expect(within(scheduled).getByRole("link", { name: /Alpha/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("falls back to the Recent row as current when the open item is not scheduled", async () => {
    fetchMock.mockResolvedValue({ items: [], sources: [] });
    recentHistoryStore.recordVisit("pipeline", "p-1", "Alpha");
    renderWithStore(
      <Routes>
        <Route path="/pipelines/:id" element={<ScheduledContextList kind="pipelines" />} />
      </Routes>,
      { pipelines: { status: "succeeded", items: [{ id: "p-1", name: "Alpha" } as never] } },
      "/pipelines/p-1",
    );
    await screen.findByText("Nothing scheduled.");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("does not show a deleted pipeline or source in Recent, and never a raw id", async () => {
    fetchMock.mockResolvedValue({ items: [], sources: [] });
    recentHistoryStore.recordVisit("pipeline", "deleted-id", "Gone");
    recentHistoryStore.recordVisit("pipeline", "p-1", "Old title");
    renderWithStore(
      <ScheduledContextList kind="pipelines" />,
      { pipelines: { status: "succeeded", items: [{ id: "p-1", name: "Renamed" } as never] } },
      "/pipelines",
    );
    const recent = await screen.findByRole("region", { name: "Recent" });
    expect(
      within(recent)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Renamed"]);
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    expect(screen.queryByText("deleted-id")).not.toBeInTheDocument();
  });

  it("drops a deleted source from Recent too", async () => {
    fetchMock.mockResolvedValue({ items: [], sources: [] });
    recentHistoryStore.recordVisit("source", "s-gone", "Gone source");
    renderList("sources");
    await screen.findByText("Nothing scheduled.");
    expect(screen.queryByText("s-gone")).not.toBeInTheDocument();
    expect(screen.queryByText("Gone source")).not.toBeInTheDocument();
  });
});
