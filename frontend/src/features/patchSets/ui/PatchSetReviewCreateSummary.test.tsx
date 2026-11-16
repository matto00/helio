import { render, screen } from "@testing-library/react";

import { PatchSetReview } from "./PatchSetReview";
import { describeCreate } from "./createSummary";
import type { EditPreview, PatchSetPreviewResponse } from "../types/patchSet";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const outputCreate: EditPreview = {
  index: 0,
  kind: "output",
  op: "create",
  before: null,
  after: {
    id: "(pending)",
    name: "Wins by team",
    kind: "chart",
    pipelineId: "p-1",
    nodeStepId: "step-2",
    config: { chartType: "bar", fieldMapping: { xAxis: "display_name", yAxis: "settings.wins" } },
  },
  impact: [],
};

const refPanelCreate: EditPreview = {
  index: 1,
  kind: "panel",
  op: "create",
  before: null,
  after: {
    id: "(pending)",
    title: "Wins by team",
    type: "output",
    config: { outputId: "$ref:wins" },
  },
  impact: [],
};

describe("describeCreate (HEL-1639)", () => {
  it("summarises an output create with its node and mapped columns", () => {
    expect(describeCreate(outputCreate)).toBe(
      "New chart Output “Wins by team” at step step-2 (xAxis ← display_name, yAxis ← settings.wins)",
    );
  });

  it("summarises a panel create bound by $ref to an Output of the same set", () => {
    expect(describeCreate(refPanelCreate)).toBe(
      "New panel “Wins by team” shows the Output created by this patch set (wins)",
    );
  });

  it("returns null for a panel create bound to an existing Output, and for non-creates", () => {
    const existing: EditPreview = {
      ...refPanelCreate,
      after: { title: "T", config: { outputId: "out-existing" } },
    };
    expect(describeCreate(existing)).toBeNull();
    expect(describeCreate({ ...outputCreate, op: "update" })).toBeNull();
    expect(describeCreate({ ...outputCreate, after: null })).toBeNull();
  });
});

describe("PatchSetReview with an output create and a $ref panel (HEL-1639)", () => {
  it("renders the plain-language line for each create above its raw JSON", () => {
    const preview: PatchSetPreviewResponse = { edits: [outputCreate, refPanelCreate] };
    render(
      <PatchSetReview
        preview={preview}
        applying={false}
        onAccept={jest.fn()}
        onReject={jest.fn()}
      />,
    );
    expect(screen.getByText(/New chart Output “Wins by team” at step step-2/)).toBeInTheDocument();
    expect(
      screen.getByText(/shows the Output created by this patch set \(wins\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("2 edits")).toBeInTheDocument();
  });
});
