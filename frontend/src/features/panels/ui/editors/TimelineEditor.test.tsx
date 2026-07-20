import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, createRef } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { dataTypesReducer } from "../../../dataTypes/state/dataTypesSlice";
import { updatePanelTimeline as updatePanelTimelineRequest } from "../../services/panelService";
import type { DataType } from "../../../dataTypes/types/dataType";
import type { TimelinePanel } from "../../types/panel";
import { TimelineEditor } from "./TimelineEditor";
import type { PanelEditorHandle } from "./editorTypes";

jest.mock("../../services/panelService");

const mockUpdatePanelTimeline = updatePanelTimelineRequest as jest.MockedFunction<
  typeof updatePanelTimelineRequest
>;

const DATA_TYPE: DataType = {
  id: "dt-1",
  name: "Story Events",
  sourceId: null,
  version: 1,
  fields: [
    { name: "when", displayName: "when", dataType: "string", nullable: false },
    { name: "what", displayName: "what", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "",
  updatedAt: "",
};

function makeTimelinePanel(config: Partial<TimelinePanel["config"]> = {}): TimelinePanel {
  return {
    id: "panel-1",
    dashboardId: "d1",
    title: "Story Timeline",
    meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
    appearance: { background: "", color: "", transparency: 0 },
    ownerId: "u",
    refreshInterval: null,
    type: "timeline",
    config: {
      dataTypeId: "dt-1",
      fieldMapping: { time: "when", event: "what" },
      timelineOptions: { sort: "asc" },
      ...config,
    },
  };
}

function makeStore() {
  return configureStore({
    reducer: {
      dataTypes: dataTypesReducer,
    } as never,
    preloadedState: {
      dataTypes: {
        items: [DATA_TYPE],
        status: "succeeded",
        error: null,
        selectedTypeId: null,
      },
    } as never,
  });
}

function renderEditor(panel: TimelinePanel, onDirtyChange = jest.fn()) {
  const store = makeStore();
  render(
    createElement(
      Provider,
      { store } as never,
      createElement(MemoryRouter, null, createElement(TimelineEditor, { panel, onDirtyChange })),
    ),
  );
  return { store, onDirtyChange };
}

describe("TimelineEditor — field mapping slots (HEL-317)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders Time and Event field-mapping slots for the bound DataType", () => {
    renderEditor(makeTimelinePanel());
    expect(screen.getByLabelText("Time field")).toBeInTheDocument();
    expect(screen.getByLabelText("Event field")).toBeInTheDocument();
  });

  it("reflects the current time/event mapping in the slot selects", () => {
    renderEditor(makeTimelinePanel());
    expect(screen.getByLabelText("Time field")).toHaveTextContent("when");
    expect(screen.getByLabelText("Event field")).toHaveTextContent("what");
  });

  it("marks the editor dirty when the event slot mapping changes", () => {
    const { onDirtyChange } = renderEditor(makeTimelinePanel());
    onDirtyChange.mockClear();

    fireEvent.click(screen.getByLabelText("Event field"));
    fireEvent.click(screen.getByRole("option", { name: "when" }));

    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});

describe("TimelineEditor — sort direction control", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows Oldest first as selected by default (sort: asc)", () => {
    renderEditor(makeTimelinePanel());
    const oldestBtn = screen.getByRole("button", { name: "Oldest first" });
    expect(oldestBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the pressed state when Newest first is clicked and marks dirty", () => {
    const { onDirtyChange } = renderEditor(makeTimelinePanel());
    onDirtyChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Newest first" }));

    expect(screen.getByRole("button", { name: "Newest first" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Oldest first" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("persists the chosen sort direction on save", async () => {
    mockUpdatePanelTimeline.mockResolvedValue(makeTimelinePanel());
    const editorRef = createRef<PanelEditorHandle>();
    const store = makeStore();
    const element = createElement(TimelineEditor, {
      panel: makeTimelinePanel(),
      onDirtyChange: jest.fn(),
      ref: editorRef,
    });
    render(createElement(Provider, { store } as never, createElement(MemoryRouter, null, element)));

    fireEvent.click(screen.getByRole("button", { name: "Newest first" }));
    await editorRef.current!.save();

    expect(mockUpdatePanelTimeline).toHaveBeenCalledWith(
      "panel-1",
      expect.objectContaining({ sort: "desc" }),
    );
  });
});
