import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { OutputPicker } from "./OutputPicker";
import {
  createPanel as createPanelRequest,
  fetchPanels as fetchPanelsRequest,
  patchPanelOutputId as patchPanelOutputIdRequest,
} from "../services/panelService";
import { listAllOutputs, listOutputPanels } from "../../pipelines/services/outputService";
import { getPipelines } from "../../pipelines/services/pipelineService";
import type { Output } from "../../pipelines/types/output";

jest.mock("../services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  patchPanelOutputId: jest.fn(),
}));

jest.mock("../../pipelines/services/outputService", () => ({
  listAllOutputs: jest.fn(),
  listOutputPanels: jest.fn(),
}));

jest.mock("../../pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn(),
}));

const createPanelMock = jest.mocked(createPanelRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const patchPanelOutputIdMock = jest.mocked(patchPanelOutputIdRequest);
const listAllOutputsMock = jest.mocked(listAllOutputs);
const listOutputPanelsMock = jest.mocked(listOutputPanels);
const getPipelinesMock = jest.mocked(getPipelines);

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

function makeOutput(overrides: Partial<Output>): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "user-1",
    name: "Throughput",
    kind: "chart",
    config: {},
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const pipelinesState = {
  items: [
    {
      id: "pipe-1",
      name: "Revenue Pipeline",
      sourceDataSourceId: "src-1",
      sourceDataSourceName: "Source",
      lastRunStatus: null,
      lastRunAt: null,
      lastRunRowCount: null,
    },
    {
      id: "pipe-2",
      name: "Signups Pipeline",
      sourceDataSourceId: "src-2",
      sourceDataSourceName: "Source 2",
      lastRunStatus: null,
      lastRunAt: null,
      lastRunRowCount: null,
    },
  ],
  status: "succeeded" as const,
};

const baseDashboardsState = {
  items: [
    {
      id: "dashboard-1",
      name: "Operations",
      meta: defaultMeta,
      appearance: { background: "transparent", gridBackground: "transparent" },
      layout: { lg: [], md: [], sm: [], xs: [] },
    },
  ],
  selectedDashboardId: "dashboard-1",
};

describe("OutputPicker", () => {
  beforeEach(() => {
    // `Modal` uses <dialog> showModal/close, which jsdom doesn't implement.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    createPanelMock.mockReset();
    fetchPanelsMock.mockReset();
    patchPanelOutputIdMock.mockReset();
    listAllOutputsMock.mockReset();
    listOutputPanelsMock.mockReset();
    listOutputPanelsMock.mockResolvedValue([]);
    getPipelinesMock.mockReset();
    getPipelinesMock.mockResolvedValue([]);
  });

  // HEL-909 evaluator cycle-1 finding 4 / CR3: the fixture above preloads
  // `pipelines.items` into the store directly, which the real app never
  // does on the dashboard route -- that ambient state let the grouping
  // assertion above pass while the shipped picker rendered the literal
  // "Pipeline" placeholder for every group. This test starts `pipelines` at
  // its real cold-boot shape (`status: "idle"`, empty `items`) and asserts
  // the real names still appear once `useOutputPickerData` loads them
  // itself -- it must fail against pre-fix code (no `fetchPipelines()`
  // dispatch at all).
  it("resolves real pipeline names with no preloaded pipelines slice (not the 'Pipeline' placeholder)", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
    ]);
    getPipelinesMock.mockResolvedValue([
      {
        id: "pipe-1",
        name: "Revenue Pipeline",
        sourceDataSourceId: "src-1",
        sourceDataSourceName: "Source",
        lastRunStatus: null,
        lastRunAt: null,
        lastRunRowCount: null,
      },
    ]);

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      {
        dashboards: baseDashboardsState,
        panels: { items: [] },
        pipelines: { items: [], status: "idle" as const },
      },
    );

    await waitFor(() => expect(screen.getByText("Revenue Pipeline")).toBeInTheDocument());
    expect(screen.queryByText("Pipeline", { exact: true })).not.toBeInTheDocument();
  });

  it("groups Outputs by their pipeline", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
      makeOutput({ id: "output-2", pipelineId: "pipe-2", name: "Signups" }),
    ]);

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Revenue Pipeline")).toBeInTheDocument());
    expect(screen.getByText("Signups Pipeline")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Throughput \(Revenue Pipeline\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Signups \(Signups Pipeline\)/ }),
    ).toBeInTheDocument();
  });

  it("marks an Output already placed on the current dashboard", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
    ]);

    const currentPanel = {
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Throughput",
      type: "output" as const,
      config: { outputId: "output-1" },
      meta: defaultMeta,
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
    };

    renderWithStore(
      <OutputPicker
        dashboardId="dashboard-1"
        currentDashboardPanels={[currentPanel]}
        onClose={jest.fn()}
      />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() =>
      expect(
        screen.getByRole("option", {
          name: /Throughput \(Revenue Pipeline\), already on this board/,
        }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("On this board")).toBeInTheDocument();
  });

  it("filters the grouped list by search query", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
      makeOutput({ id: "output-2", pipelineId: "pipe-2", name: "Signups" }),
    ]);

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Throughput")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("searchbox", { name: "Search outputs" }), {
      target: { value: "signups" },
    });

    expect(screen.queryByText("Throughput")).not.toBeInTheDocument();
    expect(screen.getByText("Signups")).toBeInTheDocument();
  });

  it("places the focused Output on Enter after arrow-key navigation", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
      makeOutput({ id: "output-2", pipelineId: "pipe-1", name: "Signups" }),
    ]);
    createPanelMock.mockResolvedValue({
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Signups",
      type: "output",
      config: { outputId: "output-2" },
      meta: defaultMeta,
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
    });
    fetchPanelsMock.mockResolvedValue([]);

    const onClose = jest.fn();
    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={onClose} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Signups")).toBeInTheDocument());

    const search = screen.getByRole("searchbox", { name: "Search outputs" });
    await act(async () => {
      fireEvent.keyDown(search.closest(".output-picker__inner")!, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(search.closest(".output-picker__inner")!, { key: "Enter" });
    });

    await waitFor(() =>
      expect(createPanelMock).toHaveBeenCalledWith("dashboard-1", "output", undefined, "output-2"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("arrow keys move real virtual focus (listbox/option roles, aria-activedescendant, scroll-into-view) — HEL-909 CR1", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
      makeOutput({ id: "output-2", pipelineId: "pipe-1", name: "Signups" }),
    ]);
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Signups")).toBeInTheDocument());

    // The results container is a real listbox, each card a real option with
    // a stable id — not just a class the arrow key paints.
    const listbox = screen.getByRole("listbox", { name: "Outputs" });
    const firstOption = screen.getByRole("option", { name: /Throughput/ });
    const secondOption = screen.getByRole("option", { name: /Signups/ });
    expect(listbox).toBeInTheDocument();
    expect(firstOption.id).toBeTruthy();
    expect(secondOption.id).toBeTruthy();
    expect(secondOption.id).not.toBe(firstOption.id);

    const scrollSpy = jest.fn();
    firstOption.scrollIntoView = scrollSpy;
    secondOption.scrollIntoView = scrollSpy;

    const search = screen.getByRole("searchbox", { name: "Search outputs" });
    // Focus never leaves the search input — DOM focus stays put while
    // aria-activedescendant tracks the logically-focused option.
    search.focus();
    expect(search).toHaveAttribute("aria-activedescendant", firstOption.id);

    await act(async () => {
      fireEvent.keyDown(search.closest(".output-picker__inner")!, { key: "ArrowDown" });
    });

    expect(document.activeElement).toBe(search);
    expect(search).toHaveAttribute("aria-activedescendant", secondOption.id);
    expect(secondOption).toHaveAttribute("aria-selected", "true");
    expect(firstOption).toHaveAttribute("aria-selected", "false");
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });

    await act(async () => {
      fireEvent.keyDown(search.closest(".output-picker__inner")!, { key: "ArrowUp" });
    });
    expect(search).toHaveAttribute("aria-activedescendant", firstOption.id);
  });

  it("keyboard focus is not hijacked by a mouseenter firing on another card mid-navigation — HEL-909 CR1/CR4 round 2", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Alpha" }),
      makeOutput({ id: "output-2", pipelineId: "pipe-1", name: "Bravo" }),
      makeOutput({ id: "output-3", pipelineId: "pipe-1", name: "Charlie" }),
      makeOutput({ id: "output-4", pipelineId: "pipe-1", name: "Delta" }),
    ]);
    fetchPanelsMock.mockResolvedValue([]);

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Delta")).toBeInTheDocument());

    const alpha = screen.getByRole("option", { name: /Alpha/ });
    const search = screen.getByRole("searchbox", { name: "Search outputs" });
    search.focus();
    expect(search).toHaveAttribute("aria-activedescendant", alpha.id);

    const inner = search.closest(".output-picker__inner")!;

    // Simulates `scrollIntoView` moving a stationary cursor over an unrelated
    // card mid-navigation — the browser fires a real `mouseenter` on whatever
    // card ends up under the pointer. This must NOT move keyboard focus.
    await act(async () => {
      fireEvent.keyDown(inner, { key: "ArrowDown" }); // -> Bravo (index 1)
      fireEvent.mouseEnter(alpha); // pointer parked over Alpha (index 0)
    });
    const bravo = screen.getByRole("option", { name: /Bravo/ });
    expect(search).toHaveAttribute("aria-activedescendant", bravo.id);

    await act(async () => {
      fireEvent.keyDown(inner, { key: "ArrowDown" }); // -> Charlie (index 2)
    });
    const charlie = screen.getByRole("option", { name: /Charlie/ });
    expect(search).toHaveAttribute("aria-activedescendant", charlie.id);

    await act(async () => {
      fireEvent.keyDown(inner, { key: "ArrowDown" }); // -> Delta (index 3)
    });
    const delta = screen.getByRole("option", { name: /Delta/ });
    expect(search).toHaveAttribute("aria-activedescendant", delta.id);
    expect(delta).toHaveAttribute("aria-selected", "true");

    // Hover must never paint the accent focus ring — only the keyboard-
    // focused card gets `--card--focused`.
    expect(alpha.className).not.toMatch(/output-picker__card--focused/);
    expect(alpha.className).toMatch(/output-picker__card--hovered/);
  });

  it("gives every Output card an accessible name naming the Output and its pipeline", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
    ]);

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Throughput (Revenue Pipeline)" }),
      ).toBeInTheDocument(),
    );
  });

  // HEL-909 CR5: a rejected create must surface a visible message, not fail
  // silently (`OutputPicker.tsx`'s prior bare `catch {}`).
  it("surfaces a visible error when placing an Output fails", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
    ]);
    createPanelMock.mockRejectedValue(new Error("network error"));

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Throughput")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: /Throughput \(Revenue Pipeline\)/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Failed to add panel/i),
    );
  });

  // HEL-909 CR4: swap mode PATCHes through `panelService.patchPanelOutputId`
  // (the normal service/thunk path), not an inline dynamic `httpClient` import.
  it("swaps an Output through panelService.patchPanelOutputId, not an inline PATCH", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
    ]);
    patchPanelOutputIdMock.mockResolvedValue({
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Panel",
      type: "output",
      config: { outputId: "output-1" },
      meta: defaultMeta,
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
    });
    fetchPanelsMock.mockResolvedValue([]);

    const onClose = jest.fn();
    renderWithStore(
      <OutputPicker
        dashboardId="dashboard-1"
        currentDashboardPanels={[]}
        onClose={onClose}
        mode="swap"
        swapPanelId="panel-existing"
      />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Throughput")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: /Throughput \(Revenue Pipeline\)/ }));

    await waitFor(() =>
      expect(patchPanelOutputIdMock).toHaveBeenCalledWith("panel-existing", "output-1"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // HEL-909 CR5: a rejected swap must also surface a visible message.
  it("surfaces a visible error when swapping an Output fails", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput" }),
    ]);
    patchPanelOutputIdMock.mockRejectedValue(new Error("network error"));

    renderWithStore(
      <OutputPicker
        dashboardId="dashboard-1"
        currentDashboardPanels={[]}
        onClose={jest.fn()}
        mode="swap"
        swapPanelId="panel-existing"
      />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("Throughput")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: /Throughput \(Revenue Pipeline\)/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Failed to swap output/i),
    );
  });

  // HEL-909 CR2 (evaluation-2.md finding 2): placement counts must come
  // straight off `output.panelCount` in the `GET /api/outputs` list
  // response, not a per-Output `GET /api/outputs/:id/panels` fetch -- the
  // prior N+1 loop self-rate-limited (429s) on a realistic Output count.
  // Asserting `listOutputPanels` is never called, while the count still
  // renders correctly, is genuinely red-capable: pre-fix code called
  // `listOutputPanels` once per Output and ignored `output.panelCount`
  // entirely.
  it("renders the placement count from output.panelCount without fetching per-Output placements", async () => {
    listAllOutputsMock.mockResolvedValue([
      makeOutput({ id: "output-1", pipelineId: "pipe-1", name: "Throughput", panelCount: 3 }),
    ]);

    renderWithStore(
      <OutputPicker dashboardId="dashboard-1" currentDashboardPanels={[]} onClose={jest.fn()} />,
      { dashboards: baseDashboardsState, panels: { items: [] }, pipelines: pipelinesState },
    );

    await waitFor(() => expect(screen.getByText("3 placements")).toBeInTheDocument());
    expect(listOutputPanelsMock).not.toHaveBeenCalled();
  });
});
