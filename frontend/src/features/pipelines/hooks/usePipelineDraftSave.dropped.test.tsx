// HEL-1684 (design.md D1a): Save & run replays the draft over the freshly read saved steps; if that replay drops an op it sends
// NOTHING (never a reduced tree) and says how many changes did not apply.

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { getPipelineWithDefinition, saveDraft } from "../services/draftSaveService";
import { EMPTY_OVERLAY } from "../state/pipelineDraft";
import type { DraftOverlay } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineDraftSave } from "./usePipelineDraftSave";

jest.mock("../services/draftSaveService", () => ({
  ...jest.requireActual("../services/draftSaveService"),
  getPipelineWithDefinition: jest.fn(),
  saveDraft: jest.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

function setup(overlay: DraftOverlay) {
  const wire = threeSteps();
  jest.mocked(getPipelineWithDefinition).mockResolvedValue({
    id: "pipe-1",
    fingerprint: "v1:" + "a".repeat(64),
    definition: { steps: wire, outputs: [] },
  } as never);
  const steps = wire.map(pipelineStepToStep);
  const draft = {
    overlayRef: { current: overlay },
    staleRestoredRef: { current: false },
    staleRestored: false,
    draftSteps: steps,
    droppedCount: 0,
    clearDropped: jest.fn(),
    discard: jest.fn(),
    rebase: jest.fn(),
  } as unknown as PipelineDraft;
  return renderHook(
    () =>
      usePipelineDraftSave({
        id: "pipe-1",
        dispatch: jest.fn() as never,
        pushToast: jest.fn() as never,
        draft,
        stepsRef: { current: steps },
        setSteps: jest.fn(),
        roots: [],
        allOutputsRef: { current: [] },
        draftSaveInFlightRef: { current: false },
        setOutputPickRemap: jest.fn(),
        outputsLoaded: false,
        setSseActive: jest.fn(),
        refreshRunHistoryAfterRun: jest.fn(),
        refreshVisibleOutputPreviews: jest.fn(),
        onRunNow: jest.fn(),
        runRole: "owner",
      }),
    { wrapper },
  );
}

afterEach(() => jest.clearAllMocks());

describe("Save & run when the replay over the fresh saved steps drops an op", () => {
  it("sends no draft save and reports the dropped count", async () => {
    const { result } = setup({
      ...EMPTY_OVERLAY,
      ops: [
        {
          kind: "insert",
          clientId: "draft-1",
          type: "limit",
          config: { count: 1 },
          anchor: { after: "gone" },
        },
      ],
    });
    await act(async () => {
      await result.current.saveAndRun();
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(result.current.notice).toEqual({ kind: "dropped", count: 1 });
  });

  it("does send the save when every op applies", async () => {
    jest.mocked(saveDraft).mockRejectedValue(new Error("stop after the request"));
    const { result } = setup({
      ...EMPTY_OVERLAY,
      ops: [
        {
          kind: "insert",
          clientId: "draft-1",
          type: "limit",
          config: { count: 1 },
          anchor: { after: "s1" },
        },
      ],
    });
    await act(async () => {
      await result.current.saveAndRun();
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
});
