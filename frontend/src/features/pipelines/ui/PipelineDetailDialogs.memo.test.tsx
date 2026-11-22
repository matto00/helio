// HEL-1809: PipelineDetailDialogs is memoised with a page comparator that ignores the fields a draft edit changes. The values it
// DOES compare must reach the dialogs: an open Output sheet gets the new `steps`, and `hasDraft` switches the sheet's mode.

import { render } from "@testing-library/react";

import { PipelineDetailDialogs } from "./PipelineDetailDialogs";
import type { PipelinePageState } from "./spine/PipelineSpineLayout";

const sheet = jest.fn();
const schedule = jest.fn();
jest.mock("./outputEditor/OutputEditorSheet", () => ({
  OutputEditorSheet: (props: object) => {
    sheet(props);
    return null;
  },
}));
jest.mock("./schedule/PipelineScheduleDialog", () => ({
  PipelineScheduleDialog: (props: object) => {
    schedule(props);
    return null;
  },
}));
jest.mock("./PipelineShareDialog", () => ({ PipelineShareDialog: () => null }));
jest.mock("./RunHistoryModal", () => ({ RunHistoryModal: () => null }));
jest.mock("./outputHistory/OutputHistoryModal", () => ({ OutputHistoryModal: () => null }));

const noop = () => undefined;
const ROOTS: never[] = [];
const STEPS_A = [{ id: "s1" }] as never;
const STEPS_B = [{ id: "s1" }, { id: "s2" }] as never;

function page(over: Record<string, unknown> = {}): PipelinePageState {
  return {
    id: "p1",
    pipelineName: "P",
    roots: ROOTS,
    steps: STEPS_A,
    laneGraph: {},
    draftSave: {},
    draft: { hasDraft: false },
    outputSheet: null,
    historyOutput: null,
    historyOpen: false,
    shareOpen: false,
    scheduleOpen: false,
    pipelineSchedule: null,
    sheetDraftNode: null,
    setSheetNodeStepId: noop,
    setShareOpen: noop,
    setScheduleOpen: noop,
    handleCloseOutputSheet: noop,
    handleAddOutputViaAggregateTail: noop,
    handleCreateOutput: noop,
    handleUpdateOutput: noop,
    handleDeleteOutput: noop,
    runRole: "owner",
    isOwner: true,
    ...over,
  } as unknown as PipelinePageState;
}
const lastSheet = () =>
  sheet.mock.calls[sheet.mock.calls.length - 1][0] as {
    steps: unknown;
    draft: unknown;
  };
const OPEN = { output: undefined, createTargetStepId: "s1" };

describe("PipelineDetailDialogs comparator (HEL-1809)", () => {
  beforeEach(() => {
    sheet.mockClear();
    schedule.mockClear();
  });

  it("an open Output sheet receives the new steps", () => {
    const { rerender } = render(<PipelineDetailDialogs page={page({ outputSheet: OPEN })} />);
    expect(lastSheet().steps).toBe(STEPS_A);
    rerender(<PipelineDetailDialogs page={page({ outputSheet: OPEN, steps: STEPS_B })} />);
    expect(lastSheet().steps).toBe(STEPS_B);
  });

  it("hasDraft flipping switches the open sheet's mode", () => {
    const { rerender } = render(<PipelineDetailDialogs page={page({ outputSheet: OPEN })} />);
    expect(lastSheet().draft).toBeUndefined();
    rerender(
      <PipelineDetailDialogs page={page({ outputSheet: OPEN, draft: { hasDraft: true } })} />,
    );
    expect(lastSheet().draft).toBeDefined();
  });

  it("a non-volatile field reaches the dialogs (the schedule dialog sees a new schedule)", () => {
    const { rerender } = render(<PipelineDetailDialogs page={page()} />);
    rerender(<PipelineDetailDialogs page={page({ pipelineSchedule: { enabled: true } })} />);
    const last = schedule.mock.calls[schedule.mock.calls.length - 1][0] as { schedule: unknown };
    expect(last.schedule).toEqual({ enabled: true });
  });

  it("an edit that changes only the volatile fields renders the dialogs no more", () => {
    const { rerender } = render(<PipelineDetailDialogs page={page()} />);
    const before = schedule.mock.calls.length;
    rerender(
      <PipelineDetailDialogs page={page({ steps: STEPS_B, laneGraph: {}, draftSave: {} })} />,
    );
    expect(schedule.mock.calls.length).toBe(before);
  });
});
