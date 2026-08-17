import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { PatchSetReview } from "./PatchSetReview";
import type { PatchSetPreviewResponse } from "../types/patchSet";

beforeAll(() => {
  // jsdom does not implement <dialog> showModal/close natively; stub them
  // (mirrors ProposalReview.test.tsx's own stub).
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

function makePreview(): PatchSetPreviewResponse {
  return {
    edits: [
      {
        index: 0,
        kind: "panel",
        op: "update",
        before: { id: "p-1", title: "Old title" },
        after: { id: "p-1", title: "New title" },
        impact: [],
      },
      {
        index: 1,
        kind: "dataType",
        op: "delete",
        before: { id: "dt-1", name: "Sales" },
        after: null,
        impact: ["Panels shared by other users may be unbound"],
      },
    ],
  };
}

function renderReview(overrides: Partial<ComponentProps<typeof PatchSetReview>> = {}) {
  const onAccept = jest.fn();
  const onReject = jest.fn();
  render(
    <PatchSetReview
      preview={makePreview()}
      applying={false}
      onAccept={onAccept}
      onReject={onReject}
      {...overrides}
    />,
  );
  return { onAccept, onReject };
}

describe("PatchSetReview", () => {
  it("renders each edit's kind/op/impact/before/after", () => {
    renderReview();
    expect(screen.getByText("panel")).toBeInTheDocument();
    expect(screen.getByText("update")).toBeInTheDocument();
    expect(screen.getByText("dataType")).toBeInTheDocument();
    expect(screen.getByText("delete")).toBeInTheDocument();
    expect(screen.getByText(/Panels shared by other users may be unbound/)).toBeInTheDocument();
    expect(screen.getByText(/Old title/)).toBeInTheDocument();
    expect(screen.getByText(/New title/)).toBeInTheDocument();
  });

  it("clicking Accept calls onAccept", () => {
    const { onAccept } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("clicking Reject calls onReject", () => {
    const { onReject } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("applying disables both Accept and Reject", () => {
    renderReview({ applying: true });
    expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
  });

  it("shows a server error via InlineError", () => {
    renderReview({ error: "Something went wrong" });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders an empty state when the patch set has no edits", () => {
    renderReview({ preview: { edits: [] } });
    expect(screen.getByText("This patch set has no edits.")).toBeInTheDocument();
  });

  // F-067 — an `update` edit shows only its changed leaf field(s), not the full unrelated
  // before/after JSON, so the actual change is never scrolled out of view.
  it("isolates the changed field(s) of an update edit instead of the raw JSON panes", () => {
    renderReview({
      preview: {
        edits: [
          {
            index: 0,
            kind: "panel",
            op: "update",
            before: { id: "p-1", title: "Old title", unrelatedField: "same on both sides" },
            after: { id: "p-1", title: "New title", unrelatedField: "same on both sides" },
            impact: [],
          },
        ],
      },
    });

    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("Old title")).toBeInTheDocument();
    expect(screen.getByText("New title")).toBeInTheDocument();
    // The unrelated, unchanged field isn't rendered as its own changed row.
    expect(screen.queryByText("unrelatedField")).not.toBeInTheDocument();
    // No raw JSON pane rendered for an edit with an isolated change.
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
    expect(screen.queryByText("After")).not.toBeInTheDocument();
  });

  // A `delete` edit has no `after` to diff against, so it falls back to the raw before/after
  // panes (the only shape that makes sense when one side is entirely absent).
  it("falls back to raw before/after panes for a delete edit", () => {
    renderReview({
      preview: {
        edits: [
          {
            index: 0,
            kind: "dataType",
            op: "delete",
            before: { id: "dt-1", name: "Sales" },
            after: null,
            impact: [],
          },
        ],
      },
    });

    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByText(/"name": "Sales"/)).toBeInTheDocument();
  });
});
