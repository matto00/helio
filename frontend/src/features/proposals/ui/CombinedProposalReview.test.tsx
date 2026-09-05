import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { CombinedProposalReview } from "./CombinedProposalReview";
import type { CombinedProposal } from "../types/combinedProposal";

beforeAll(() => {
  // jsdom does not implement <dialog> showModal/close natively — mirrors
  // ProposalReview.test.tsx's own stub.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

function makeProposal(overrides: Partial<CombinedProposal> = {}): CombinedProposal {
  return {
    pipeline: {
      pipelineName: "Sales pipeline",
      roots: [{ type: "static", name: "Demo source", config: {} }],
      steps: [],
      outputs: [{ kind: "table", name: "SalesMetrics" }],
    },
    dashboard: {
      dashboardName: "Sales overview",
      panels: [
        {
          title: "Total sales",
          type: "output",
          outputId: "$pipelineOutput",
          fieldMapping: { value: "amount" },
        },
        {
          title: "Notes",
          type: "text",
          content: "hello",
        },
      ],
    },
    ...overrides,
  };
}

function renderReview(overrides: Partial<ComponentProps<typeof CombinedProposalReview>> = {}) {
  const onAccept = jest.fn();
  const onReject = jest.fn();
  render(
    <CombinedProposalReview
      proposal={makeProposal()}
      applying={false}
      onAccept={onAccept}
      onReject={onReject}
      {...overrides}
    />,
  );
  return { onAccept, onReject };
}

describe("CombinedProposalReview", () => {
  it("renders the nested pipeline proposal (via PipelineProposalSummary)", () => {
    renderReview();
    expect(screen.getByText(/Pipeline — Sales pipeline/)).toBeInTheDocument();
    expect(screen.getByText("SalesMetrics")).toBeInTheDocument();
  });

  it("renders the nested dashboard proposal's name and panel list", () => {
    renderReview();
    expect(screen.getByText(/Dashboard — Sales overview/)).toBeInTheDocument();
    expect(screen.getByText("Total sales")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  // design.md Risk 1 — a panel bound to the reserved "$pipelineOutput" sentinel must render as
  // referencing this proposal's own pipeline output, never as an unresolved/invalid outputId.
  it('special-cases a panel bound to the "$pipelineOutput" sentinel', () => {
    renderReview();
    expect(screen.getByText("This pipeline's own output")).toBeInTheDocument();
    expect(screen.queryByText("$pipelineOutput")).not.toBeInTheDocument();
  });

  it("renders a real (non-sentinel) outputId as-is for a data panel", () => {
    renderReview({
      proposal: makeProposal({
        dashboard: {
          dashboardName: "Sales overview",
          panels: [{ title: "Total sales", type: "output", outputId: "dt-real-id" }],
        },
      }),
    });
    expect(screen.getByText("dt-real-id")).toBeInTheDocument();
  });

  it("renders a field mapping when present", () => {
    renderReview();
    expect(screen.getByText("value → amount")).toBeInTheDocument();
  });

  it("renders a 'no panels' message when the dashboard proposal has no panels", () => {
    renderReview({
      proposal: makeProposal({ dashboard: { dashboardName: "Empty dashboard", panels: [] } }),
    });
    expect(screen.getByText("No panels proposed.")).toBeInTheDocument();
  });

  it("clicking Accept calls onAccept exactly once, covering both halves", () => {
    const { onAccept } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    // Only a single Accept/Reject pair renders — no second, dashboard-scoped footer.
    expect(screen.getAllByRole("button", { name: /accept/i })).toHaveLength(1);
  });

  it("clicking Reject calls onReject", () => {
    const { onReject } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: /reject/i })).toHaveLength(1);
  });

  it("applying disables both Accept and Reject", () => {
    renderReview({ applying: true });
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
  });

  it("shows a server error via InlineError", () => {
    renderReview({ error: "Something went wrong" });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
