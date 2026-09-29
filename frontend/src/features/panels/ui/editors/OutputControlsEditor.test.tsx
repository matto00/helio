// HEL-1189 tasks.md 4.4 — the two-click add flow, kind-offering parity with a mocked capability
// contract, rebind, remove, and keyboard-only operation. `@testing-library/user-event` is not a
// dependency in this codebase (see PanelCard.test.tsx's established convention) — keyboard
// operability is exercised via `fireEvent.keyDown` against `Select`'s own hand-rolled
// `handleKeyDown` (real application logic, not a jsdom-faked browser affordance), asserting on
// resulting DOM state rather than `toHaveFocus()` (MISTAKES.md: jsdom cannot see focus).

import { createRef } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { getFilterCapabilities, getOutputById } from "../../../pipelines/services/outputService";
import { updatePanelOutputControls as updatePanelOutputControlsRequest } from "../../services/panelService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { OutputControlsEditor } from "./OutputControlsEditor";
import type { PanelEditorHandle } from "./editorTypes";
import type { Output } from "../../../pipelines/types/output";
import type { OutputControlSpec } from "../../types/panel";

jest.mock("../../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(),
  getFilterCapabilities: jest.fn(),
}));

jest.mock("../../services/panelService", () => ({
  updatePanelOutputControls: jest.fn(),
}));

const getOutputByIdMock = jest.mocked(getOutputById);
const getFilterCapabilitiesMock = jest.mocked(getFilterCapabilities);
const updatePanelOutputControlsMock = jest.mocked(updatePanelOutputControlsRequest);

function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Sales",
    kind: "table",
    config: {},
    schema: [
      { name: "created_at", type: "timestamp" },
      { name: "region", type: "string" },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("OutputControlsEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOutputByIdMock.mockResolvedValue(makeOutput());
    getFilterCapabilitiesMock.mockResolvedValue({
      columns: [
        { column: "created_at", operators: ["contains", "gte", "lte"] },
        { column: "region", operators: ["contains", "eq", "in"] },
      ],
    });
  });

  function renderEditor(
    controls: OutputControlSpec[] = [],
    onDirtyChange = jest.fn(),
    ref = createRef<PanelEditorHandle>(),
  ) {
    const panel = makeOutputPanel({ config: { outputId: "output-1", controls } });
    const rendered = renderWithStore(
      <OutputControlsEditor ref={ref} panel={panel} onDirtyChange={onDirtyChange} />,
      { panels: { items: [panel] } },
    );
    return { panel, onDirtyChange, ref, ...rendered };
  }

  it("adds a date-range control in two clicks, auto-bound to the date/timestamp column", async () => {
    const { onDirtyChange } = renderEditor();

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Add control" })).toBeInTheDocument(),
    );

    // Click 1 — open the kind picker.
    fireEvent.click(screen.getByRole("combobox", { name: "Add control" }));
    // Click 2 — choose a kind.
    fireEvent.click(screen.getByRole("option", { name: "Date range" }));

    expect(screen.getByRole("group", { name: /Date range control:/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Column for/ })).toHaveTextContent("created_at");
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("offers only the kinds the mocked capability contract allows (kind-offering parity)", async () => {
    // region is contains-only here (no eq/in) — dropdown must not be offered; created_at has no
    // gte/lte here either — date-range must not be offered. Only "text" survives on both columns.
    getFilterCapabilitiesMock.mockResolvedValue({
      columns: [
        { column: "created_at", operators: ["contains"] },
        { column: "region", operators: ["contains"] },
      ],
    });
    renderEditor();

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Add control" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Add control" }));

    expect(screen.getByRole("option", { name: "Text" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Date range" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Dropdown" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Numeric range" })).not.toBeInTheDocument();
  });

  it("two Outputs with the same column types but different filterability offer different kinds", async () => {
    // Output A: region is eq/in-eligible.
    getFilterCapabilitiesMock.mockResolvedValueOnce({
      columns: [{ column: "region", operators: ["contains", "eq", "in"] }],
    });
    getOutputByIdMock.mockResolvedValueOnce(
      makeOutput({ schema: [{ name: "region", type: "string" }] }),
    );
    const { unmount } = renderEditor();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Add control" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Add control" }));
    expect(screen.getByRole("option", { name: "Dropdown" })).toBeInTheDocument();
    unmount();

    // Output B: identically-typed region column, NOT eq/in-eligible.
    getFilterCapabilitiesMock.mockResolvedValueOnce({
      columns: [{ column: "region", operators: ["contains"] }],
    });
    getOutputByIdMock.mockResolvedValueOnce(
      makeOutput({ schema: [{ name: "region", type: "string" }] }),
    );
    renderEditor();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Add control" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Add control" }));
    expect(screen.queryByRole("option", { name: "Dropdown" })).not.toBeInTheDocument();
  });

  it("rebinds a control to another currently-eligible column", async () => {
    const existing: OutputControlSpec = {
      id: "c1",
      kind: "text",
      column: "region",
      label: "Region",
    };
    getFilterCapabilitiesMock.mockResolvedValue({
      columns: [
        { column: "created_at", operators: ["contains", "gte", "lte"] },
        { column: "region", operators: ["contains", "eq", "in"] },
      ],
    });
    renderEditor([existing]);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /Column for/ })).toBeInTheDocument(),
    );
    const columnSelect = screen.getByRole("combobox", { name: /Column for/ });
    fireEvent.click(columnSelect);
    fireEvent.click(screen.getByRole("option", { name: "created_at" }));

    expect(columnSelect).toHaveTextContent("created_at");
  });

  it("removes a control and announces the removal via an ARIA live region", async () => {
    const existing: OutputControlSpec = {
      id: "c1",
      kind: "text",
      column: "region",
      label: "Region",
    };
    const { onDirtyChange } = renderEditor([existing]);

    await waitFor(() => expect(screen.getByRole("button", { name: /Remove/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));

    expect(screen.queryByRole("group", { name: /Region/ })).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("status")).toHaveTextContent(/removed/i);
  });

  it("shows an orphaned control as visually and programmatically distinguished, and offers rebind/remove", async () => {
    const orphaned: OutputControlSpec = {
      id: "c1",
      kind: "dropdown",
      column: "region",
      label: "Region",
    };
    // region no longer reports eq/in — the persisted dropdown control is now orphaned.
    getFilterCapabilitiesMock.mockResolvedValue({
      columns: [{ column: "region", operators: ["contains"] }],
    });
    renderEditor([orphaned]);

    await waitFor(() => expect(screen.getByText(/Orphaned/)).toBeInTheDocument());
    // Rebind and remove remain available on an orphaned control.
    expect(screen.getByRole("combobox", { name: /Column for/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove/ })).toBeInTheDocument();
  });

  it("adding a control by keyboard alone — ArrowDown opens, Enter selects (Select's own hand-rolled key handling, no pointer interaction)", async () => {
    renderEditor();

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Add control" })).toBeInTheDocument(),
    );
    const trigger = screen.getByRole("combobox", { name: "Add control" });
    // Real, focusable, non-disabled trigger — reachable by Tab (PanelCard.test.tsx convention).
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");
    expect(trigger).not.toBeDisabled();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(screen.getByRole("group", { name: /Date range control:/ })).toBeInTheDocument();
  });

  it("save() persists the current controls list via updatePanelOutputControls", async () => {
    updatePanelOutputControlsMock.mockResolvedValue(
      makeOutputPanel({ config: { outputId: "output-1", controls: [] } }),
    );
    const ref = createRef<PanelEditorHandle>();
    renderEditor([], jest.fn(), ref);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Add control" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Add control" }));
    fireEvent.click(screen.getByRole("option", { name: "Text" }));

    const result = await ref.current!.save();

    expect(result.ok).toBe(true);
    expect(updatePanelOutputControlsMock).toHaveBeenCalledWith(
      "panel-1",
      // Auto-bound to "created_at" — first-in-schema-order column eligible for "text".
      expect.arrayContaining([expect.objectContaining({ kind: "text", column: "created_at" })]),
    );
  });
});
