// HEL-553 cycle-2 regression (evaluation-1.md change request 1, integration
// shape) — mirrors CreatePipelineModal.test.tsx's dialog-stub precedent.
//
// The evaluator's live-browser reproduction: opening "Allowed dimensions"
// inside the real Create-metric modal and pressing Escape closed the whole
// modal and discarded all in-progress form state. The component-level
// regression guard for the actual fix (AllowedDimensionsPicker's Escape
// handler calling `preventDefault`) lives in AllowedDimensionsPicker.test.tsx
// — see its file comment for why: jsdom does not implement native <dialog>
// Escape-to-close at all, so an Escape-keypress-then-assert-modal-still-open
// test through a REAL <dialog> would pass unconditionally in this
// environment regardless of the fix. This test instead exercises the full
// composed flow (open modal → fill a field → open the popover → Escape) and
// asserts on what jsdom *can* observe: the popover closes, the modal's
// component tree (and the in-progress name value) survives, and `onClose`
// is never invoked — a regression in whatever calls `AllowedDimensionsPicker`
// wires up (e.g. an errant `onClose` call from the picker itself) would still
// be caught here even though the native-dialog dismissal path is not
// reproducible in jsdom.

import { fireEvent, screen } from "@testing-library/react";

import * as metricService from "../services/metricService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { DataType } from "../../dataTypes/types/dataType";
import { CreateMetricModal } from "./CreateMetricModal";

jest.mock("../services/metricService", () => ({
  createMetric: jest.fn(),
}));

const dataType: DataType = {
  id: "dt-1",
  name: "Sales",
  sourceId: null,
  version: 1,
  fields: [
    { name: "amount", displayName: "amount", dataType: "number", nullable: false },
    { name: "region", displayName: "region", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

function renderModal(onClose = jest.fn()) {
  return {
    onClose,
    ...renderWithStore(<CreateMetricModal onClose={onClose} />, {
      dataTypes: { items: [dataType], status: "succeeded" },
    }),
  };
}

beforeEach(() => {
  jest.mocked(metricService.createMetric).mockReset();
  // jsdom does not implement showModal/close natively; stub them (mirrors
  // Modal.test.tsx / CreatePipelineModal.test.tsx's precedent).
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

describe("CreateMetricModal — F-057 pinned footer actions", () => {
  it("renders Cancel/Create metric inside the modal's sticky footer, submitting the form by id", () => {
    renderModal();

    const footer = document.querySelector(".ui-modal__footer");
    expect(footer).not.toBeNull();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    const createBtn = screen.getByRole("button", { name: "Create metric" });
    expect(footer).toContainElement(cancelBtn);
    expect(footer).toContainElement(createBtn);

    // The form itself no longer renders its own action row inside the
    // scrollable body — there is exactly one "Create metric" button.
    expect(screen.getAllByRole("button", { name: "Create metric" })).toHaveLength(1);
    expect(createBtn).toHaveAttribute("form", "metric-editor-form");
    expect(createBtn).toHaveAttribute("type", "submit");
  });

  it("clicking the footer Cancel calls onClose", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the footer's Create button submits the form and disables itself while saving", async () => {
    let resolveCreate: (
      metric: Awaited<ReturnType<typeof metricService.createMetric>>,
    ) => void = () => {};
    jest
      .mocked(metricService.createMetric)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)));
    renderModal();

    fireEvent.change(screen.getByLabelText("Metric name"), { target: { value: "Total Revenue" } });
    fireEvent.click(screen.getByText("Sales"));
    fireEvent.click(screen.getByRole("combobox", { name: "Measure field" }));
    fireEvent.click(screen.getByRole("option", { name: "amount" }));

    const createBtn = screen.getByRole("button", { name: "Create metric" });
    fireEvent.click(createBtn);

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();

    resolveCreate({
      id: "m-1",
      ownerId: "owner-1",
      dataTypeId: "dt-1",
      name: "Total Revenue",
      description: null,
      measureField: "amount",
      aggregation: "sum",
      allowedDimensions: [],
      format: { unit: null, decimals: null, prefix: null, suffix: null },
      deprecated: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    await screen.findByRole("button", { name: "Create metric" });
  });
});

describe("CreateMetricModal — Allowed-dimensions Escape containment", () => {
  it("pressing Escape while the Allowed-dimensions popover is open closes only the popover — the modal and in-progress edits survive", () => {
    const { onClose } = renderModal();

    fireEvent.change(screen.getByLabelText("Metric name"), {
      target: { value: "Total Revenue" },
    });
    fireEvent.click(screen.getByText("Sales"));

    const trigger = screen.getByRole("button", { name: "Allowed dimensions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "Allowed dimensions options" })).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(
      screen.queryByRole("listbox", { name: "Allowed dimensions options" }),
    ).not.toBeInTheDocument();
    // The modal was never asked to close, and the in-progress name edit —
    // the exact data the evaluator's live reproduction lost — survived.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Metric name")).toHaveValue("Total Revenue");
    expect(document.querySelector("dialog")).toHaveAttribute("open");
  });
});
