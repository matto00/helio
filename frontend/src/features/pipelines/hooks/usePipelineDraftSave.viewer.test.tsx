// HEL-1661 (design.md D4): Save & run and the cascade confirmation return early for a viewer; nothing is requested.

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { getPipelineWithDefinition, saveDraft } from "../services/draftSaveService";
import { EMPTY_OVERLAY } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineDraftSave } from "./usePipelineDraftSave";
import type { PipelineRunRole } from "./usePipelineRunRole";

jest.mock("../services/draftSaveService", () => ({
  ...jest.requireActual("../services/draftSaveService"),
  getPipelineWithDefinition: jest.fn(),
  saveDraft: jest.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

function setup(runRole: PipelineRunRole) {
  const wire = threeSteps();
  jest.mocked(getPipelineWithDefinition).mockResolvedValue({
    id: "pipe-1",
    fingerprint: "v1:" + "a".repeat(64),
    definition: { steps: wire, outputs: [] },
  } as never);
  jest.mocked(saveDraft).mockRejectedValue(new Error("stop after the request"));
  const steps = wire.map(pipelineStepToStep);
  const draft = {
    overlayRef: {
      current: {
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
      },
    },
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
        runRole,
      }),
    { wrapper },
  );
}

afterEach(() => jest.clearAllMocks());

describe("Save & run by role", () => {
  it("an editor's Save & run reaches the server", async () => {
    const { result } = setup("editor");
    await act(async () => {
      await result.current.saveAndRun();
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it("a viewer's Save & run and cascade confirmation request nothing", async () => {
    const { result } = setup("viewer");
    await act(async () => {
      await result.current.saveAndRun();
      await result.current.confirmCascade();
    });
    expect(getPipelineWithDefinition).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
