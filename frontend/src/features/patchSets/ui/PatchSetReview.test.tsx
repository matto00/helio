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
});
