import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { PipelineProposalReview } from "./PipelineProposalReview";
import type { PipelineProposal } from "../../types/pipelineProposal";

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

function makeProposal(overrides: Partial<PipelineProposal> = {}): PipelineProposal {
  return {
    pipelineName: "Sales pipeline",
    roots: [{ sourceId: "src-1" }],
    steps: [
      { clientId: "s1", type: "rename", config: { renames: { old: "new" } } },
      { clientId: "s2", type: "limit", config: { count: 100 }, enabled: false },
    ],
    outputs: [{ kind: "table", name: "SalesMetrics" }],
    ...overrides,
  };
}

function renderReview(overrides: Partial<ComponentProps<typeof PipelineProposalReview>> = {}) {
  const onAccept = jest.fn();
  const onReject = jest.fn();
  render(
    <PipelineProposalReview
      proposal={makeProposal()}
      applying={false}
      onAccept={onAccept}
      onReject={onReject}
      {...overrides}
    />,
  );
  return { onAccept, onReject };
}

describe("PipelineProposalReview", () => {
  it("renders the source, ordered steps, and proposed Outputs", () => {
    renderReview();

    expect(screen.getByText("Sales pipeline")).toBeInTheDocument();
    expect(screen.getByText(/Existing source \(src-1\)/)).toBeInTheDocument();
    expect(screen.getByText("rename")).toBeInTheDocument();
    expect(screen.getByText("limit")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("SalesMetrics")).toBeInTheDocument();
  });

  it("renders an inline source's type/name/config when no sourceId is present", () => {
    renderReview({
      proposal: makeProposal({
        roots: [{ type: "csv", name: "New CSV source", config: { path: "/tmp/data.csv" } }],
      }),
    });

    expect(screen.getByText(/New csv source "New CSV source"/)).toBeInTheDocument();
    expect(screen.getByText("path")).toBeInTheDocument();
    expect(screen.getByText("/tmp/data.csv")).toBeInTheDocument();
  });

  it("renders a 'no steps' message when the proposal has no steps", () => {
    renderReview({ proposal: makeProposal({ steps: [] }) });
    expect(screen.getByText("No transform steps proposed.")).toBeInTheDocument();
  });

  it("clicking Accept calls onAccept", () => {
    const { onAccept } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /accept & create/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("clicking Reject calls onReject", () => {
    const { onReject } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
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

  // design.md D4 — a step kind the frontend's PipelineStepKind union doesn't recognize must still
  // render (type + best-effort config summary), never crash.
  it("renders an unrecognized step kind without crashing", () => {
    renderReview({
      proposal: makeProposal({
        steps: [{ clientId: "s1", type: "some_future_op", config: { fancy: true } }],
      }),
    });
    expect(screen.getByText("some_future_op")).toBeInTheDocument();
  });

  // HEL-914 task 6.8 — a proposal whose steps branch into more than one lane (two children
  // of the same parent step, each rooting its own lane per `buildLaneGraph`) must render
  // grouped by lane, label the branch lane by its parent step, surface a rejoin step's
  // second-input, and annotate a step with any Outputs bound to it — not a single flat list.
  it("renders multi-lane steps grouped by lane, with rejoin and per-step Output annotations", () => {
    renderReview({
      proposal: makeProposal({
        steps: [
          { clientId: "s1", type: "filter", config: {} },
          { clientId: "s2", type: "filter", config: {}, parentStepId: "s1" },
          {
            clientId: "s3",
            type: "join",
            config: { secondaryInput: { kind: "lane", stepId: "s2" } },
            parentStepId: "s1",
          },
        ],
        outputs: [{ kind: "table", name: "JoinedMetrics", nodeStepClientId: "s3" }],
      }),
    });

    expect(screen.getByText("3 steps across 3 lanes")).toBeInTheDocument();
    expect(screen.getByText("Primary lane")).toBeInTheDocument();
    expect(screen.getAllByText("Lane branching off step s1")).toHaveLength(2);
    expect(screen.getByText(/second input \(rejoin\): step s2/)).toBeInTheDocument();
    expect(screen.getByText(/Outputs: JoinedMetrics/)).toBeInTheDocument();
  });
});
