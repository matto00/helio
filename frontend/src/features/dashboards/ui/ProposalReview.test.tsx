import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { ProposalReview, type ReviewDataType } from "./ProposalReview";
import type { DashboardProposal } from "../types/proposal";

beforeAll(() => {
  // jsdom does not implement <dialog> showModal/close natively; stub them.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const outputTypeId = "type-output";
const companionTypeId = "type-companion";

const dataTypesById: Record<string, ReviewDataType> = {
  [outputTypeId]: { name: "Sales Output", sourceId: null },
  [companionTypeId]: { name: "Sales Companion", sourceId: "src-1" },
};

function makeProposal(): DashboardProposal {
  return {
    dashboardName: "Regional Sales",
    panels: [
      {
        title: "Total Revenue",
        type: "metric",
        dataTypeId: outputTypeId,
        fieldMapping: { value: "revenue" },
        layout: { x: 0, y: 0, w: 4, h: 3 },
      },
      {
        title: "Notes",
        type: "text",
      },
    ],
  };
}

function renderReview(overrides: Partial<ComponentProps<typeof ProposalReview>> = {}) {
  const onAccept = jest.fn();
  const onReject = jest.fn();
  render(
    <ProposalReview
      proposal={makeProposal()}
      dataTypesById={dataTypesById}
      applying={false}
      onAccept={onAccept}
      onReject={onReject}
      {...overrides}
    />,
  );
  return { onAccept, onReject };
}

describe("ProposalReview", () => {
  it("renders the dashboard name, panels, and their bindings", () => {
    renderReview();
    expect(screen.getByLabelText("Dashboard name")).toHaveValue("Regional Sales");
    expect(screen.getByLabelText("Panel 1 title")).toHaveValue("Total Revenue");
    expect(screen.getByLabelText("Panel 2 title")).toHaveValue("Notes");
    expect(screen.getByText("Sales Output")).toBeInTheDocument();
    expect(screen.getByText("value → revenue")).toBeInTheDocument();
  });

  it("accepts the edited proposal (edited title, dashboard name preserved)", () => {
    const { onAccept } = renderReview();
    fireEvent.change(screen.getByLabelText("Panel 1 title"), { target: { value: "Revenue" } });
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    const edited: DashboardProposal = onAccept.mock.calls[0][0];
    expect(edited.dashboardName).toBe("Regional Sales");
    expect(edited.panels[0].title).toBe("Revenue");
    expect(edited.panels).toHaveLength(2);
  });

  it("removing a panel excludes it from the accepted proposal", () => {
    const { onAccept } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /remove panel notes/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));

    const edited: DashboardProposal = onAccept.mock.calls[0][0];
    expect(edited.panels).toHaveLength(1);
    expect(edited.panels[0].title).toBe("Total Revenue");
  });

  it("reject writes nothing (calls onReject, never onAccept)", () => {
    const { onAccept, onReject } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("flags a panel bound to a source companion (not a pipeline output)", () => {
    const proposal: DashboardProposal = {
      dashboardName: "Bad",
      panels: [
        { title: "X", type: "metric", dataTypeId: companionTypeId, fieldMapping: { value: "a" } },
      ],
    };
    renderReview({ proposal });
    expect(screen.getByText(/source companion/i)).toBeInTheDocument();
  });

  it("disables accept while applying and shows a server error", () => {
    renderReview({ applying: true, error: "Panels can only bind to pipeline-output data types" });
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
    expect(
      screen.getByText("Panels can only bind to pipeline-output data types"),
    ).toBeInTheDocument();
  });
});
