// HEL-1661 (design.md D4): the save toast's "Run now" is a run entry; it is offered only when a run entry exists for the caller.

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import type { DraftSaveResponse } from "../types/draftSave";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineDraftSettle } from "./usePipelineDraftSettle";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

const REFUSED = {
  saved: {
    applicationId: "app-1",
    definition: { steps: [], outputs: [] },
  },
  run: { started: false, reason: "paused", code: 409 },
} as unknown as DraftSaveResponse;

function settleWith(onRunNow: (() => void) | undefined) {
  const pushToast = jest.fn();
  const draft = {
    draftSteps: [],
    draftOutputs: [],
    discard: jest.fn(),
  } as unknown as PipelineDraft;
  const { result } = renderHook(
    () =>
      usePipelineDraftSettle({
        draft,
        dispatch: jest.fn() as never,
        pushToast: pushToast as never,
        adoptDefinition: jest.fn(() => []),
        allOutputsRef: { current: [] },
        setOutputPickRemap: jest.fn(),
        dismissSavedToast: jest.fn(),
        savedToastRef: { current: null },
        requestUndo: jest.fn(),
        setCascade: jest.fn(),
        setNotice: jest.fn(),
        setSseActive: jest.fn(),
        refreshRunHistoryAfterRun: jest.fn(),
        refreshVisibleOutputPreviews: jest.fn(),
        onRunNow,
      }),
    { wrapper },
  );
  result.current("pipe-1", REFUSED);
  return pushToast;
}

function runRefusedToast(pushToast: jest.Mock) {
  return pushToast.mock.calls.map((c) => c[0]).find((t) => t.variant === "warning");
}

describe("the save toast's Run now", () => {
  it("is offered when a run entry exists", () => {
    const onRunNow = jest.fn();
    const toast = runRefusedToast(settleWith(onRunNow));
    expect(toast.action).toEqual({ label: "Run now", onClick: onRunNow });
  });

  it("is omitted when the caller has no run entry (a viewer), the refusal message stays", () => {
    const toast = runRefusedToast(settleWith(undefined));
    expect(toast).toBeDefined();
    expect(toast.action).toBeUndefined();
    expect(toast.message).toContain("Run not started");
  });
});
