// HEL-1777 (design.md D5): while a draft grid is shown, the "Output schema" chips list the grid's columns (names, order) and the
// grid's header captions carry the same types; with no draft grid shown the chips keep the saved analyzed schema.

import { fireEvent, render, screen } from "@testing-library/react";

import type { Frame } from "../../evaluator";
import { decodeRow } from "../../evaluator/wire";
import { createInFlightDedupe } from "../../state/inFlightDedupe";
import type { DraftStepView } from "../../state/draftStepView";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { SchemaField } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { fetchStepPreview } from "../../services/pipelineService";
import { StepPreviewTable, type StepPreviewDraft } from "./StepPreviewTable";

jest.mock("../../services/pipelineService", () => ({ fetchStepPreview: jest.fn() }));

const frame = (...rows: Array<Record<string, unknown>>): Frame => rows.map(decodeRow);
const dedupe = createInFlightDedupe();

const opOf = (id: string) => OP_TYPES.find((op) => op.id === id)!;
const RENAME: Step = {
  id: "s1",
  opType: opOf("rename"),
  label: "Rename column",
  config: { renames: { region: "zone" } },
  enabled: true,
  rootId: "r1",
};
const FILTER: Step = {
  id: "s2",
  opType: opOf("filter"),
  label: "Filter rows",
  config: { combinator: "and", conditions: [] },
  enabled: true,
  rootId: "r1",
};

const SAVED_INPUT: SchemaField[] = [
  { name: "id", type: "integer" },
  { name: "region", type: "float" },
];

function draftOf(
  rows: Frame | null,
  columnOrder: string[],
  status: DraftStepView["status"] = "ok",
): StepPreviewDraft {
  const view: DraftStepView = {
    status,
    count: rows?.length ?? null,
    rows,
    frameStale: false,
    message: null,
  };
  return {
    active: true,
    view,
    savedStep: { ...RENAME, config: { renames: {} } },
    baseRows: undefined,
    savedCache: { store: new Map(), key: "k" },
    columnOrder,
  };
}

function ui(props: {
  step: Step;
  draft: StepPreviewDraft;
  input?: SchemaField[];
  output?: SchemaField[];
}) {
  return (
    <StepPreviewTable
      pipelineId="p1"
      step={props.step}
      draft={props.draft}
      stepNumber={1}
      stepIndex={0}
      enabledBits="1"
      analyzeSchema={props.input ?? SAVED_INPUT}
      analyzeOutputSchema={props.output ?? SAVED_INPUT}
      hasOwnAnalyze
      isCreating={false}
      dedupe={dedupe}
      beforeFetch={() => Promise.resolve()}
    />
  );
}

const chipNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".step-preview__schema-chip")).map((c) => c.textContent);
const headerNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("th")).map((th) => th.firstChild?.textContent ?? "");
const headerTypes = (container: HTMLElement) =>
  Object.fromEntries(
    Array.from(container.querySelectorAll("th")).map((th) => [
      th.firstChild?.textContent ?? "",
      th.querySelector(".ui-data-grid__th-type")?.textContent,
    ]),
  );

describe("StepPreviewTable draft schema chips", () => {
  beforeEach(() => jest.clearAllMocks());

  it("a draft rename: chips read the grid's headers, zone carries region's type, no request", () => {
    const rows = frame({ id: { $int: 1 }, zone: "a" });
    const { container } = render(ui({ step: RENAME, draft: draftOf(rows, ["id", "zone"]) }));
    expect(chipNames(container)).toEqual(["id", "zone"]);
    expect(chipNames(container)).toEqual(headerNames(container));
    expect(headerTypes(container)).toEqual({ id: "integer", zone: "float" });
    expect(fetchStepPreview).not.toHaveBeenCalled();
  });

  it("a large draft schema: the disclosure counts and lists the draft columns in grid order", () => {
    const names = Array.from({ length: 14 }, (_, i) => `c${String(14 - i).padStart(2, "0")}`);
    const row = Object.fromEntries(names.map((n) => [n, "x"]));
    const saved = [{ name: "region", type: "string" }];
    render(ui({ step: FILTER, draft: draftOf(frame(row), names), input: saved, output: saved }));
    const trigger = screen.getByRole("button", { name: /14 fields/ });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Output schema" });
    const listed = Array.from(
      dialog.querySelectorAll(".pipeline-detail-page__footer-schema-chip"),
    ).map((c) => c.textContent);
    expect(listed).toEqual(names);
  });

  it("a draft that turns the shown step off keeps the saved chips", () => {
    const off = { ...RENAME, enabled: false };
    const { container } = render(
      ui({
        step: off,
        draft: draftOf(frame({ id: { $int: 1 }, zone: "a" }), ["id", "zone"]),
      }),
    );
    expect(chipNames(container)).toEqual(["id", "region"]);
  });

  it("a not-previewed step keeps the saved chips", () => {
    const { container } = render(
      ui({
        step: RENAME,
        draft: draftOf(frame({ id: { $int: 1 }, zone: "a" }), ["id", "zone"], "notPreviewed"),
      }),
    );
    expect(chipNames(container)).toEqual(["id", "region"]);
  });

  it("a step below a draft rename: zone is in the chips, typed from the draft rows", () => {
    const rows = frame({ id: { $int: 1 }, zone: { $int: 5 } });
    const { container } = render(ui({ step: FILTER, draft: draftOf(rows, ["id", "zone"]) }));
    expect(chipNames(container)).toEqual(["id", "zone"]);
    expect(headerTypes(container)).toEqual({ id: "integer", zone: "integer" });
  });

  it("an empty draft frame keeps the saved chips (draft.columnOrder is empty for a zero-row frame)", () => {
    const { container } = render(ui({ step: FILTER, draft: draftOf([], []) }));
    expect(chipNames(container)).toEqual(["id", "region"]);
  });
});
