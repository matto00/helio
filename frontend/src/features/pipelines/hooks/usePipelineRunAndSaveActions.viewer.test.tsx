// HEL-1661 (design.md D4): run handlers return early for a viewer (defence for any path the audit might miss).

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { makeSpineStore } from "../ui/pipelineSpineTestKit";

import { usePipelineRunAndSaveActions } from "./usePipelineRunAndSaveActions";
import type { PipelineRunRole } from "./usePipelineRunRole";

function actionsFor(runRole: PipelineRunRole, canEdit = runRole !== "viewer") {
  const dispatch = jest.fn(() => ({ unwrap: () => Promise.resolve({}) }));
  const setSseActive = jest.fn();
  const store = makeSpineStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const { result } = renderHook(
    () =>
      usePipelineRunAndSaveActions({
        id: "pipe-1",
        dispatch: dispatch as never,
        navigate: jest.fn(),
        setSseActive,
        allOutputsRef: { current: [] },
        refreshRunHistoryAfterRun: jest.fn(),
        outputName: "n",
        isDirty: false,
        setIsConfirmingCancel: jest.fn(),
        runRole,
        canEdit,
      }),
    { wrapper },
  );
  return { result, dispatch, setSseActive };
}

describe("run handlers by role", () => {
  it.each(["owner", "editor"] as const)("%s: Run and Dry run submit", async (role) => {
    const { result, dispatch } = actionsFor(role);
    await result.current.handleRunPipeline();
    await result.current.handleDryRun();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("viewer: Run and Dry run do nothing at all", async () => {
    const { result, dispatch, setSseActive } = actionsFor("viewer");
    await result.current.handleRunPipeline();
    await result.current.handleDryRun();
    expect(dispatch).not.toHaveBeenCalled();
    expect(setSseActive).not.toHaveBeenCalled();
  });

  it("HEL-1794: the rename save does nothing for a caller who cannot edit, and submits for one who can", async () => {
    const viewer = actionsFor("viewer");
    await viewer.result.current.handleSave();
    expect(viewer.dispatch).not.toHaveBeenCalled();
    const editor = actionsFor("editor");
    await editor.result.current.handleSave();
    expect(editor.dispatch).toHaveBeenCalledTimes(1);
  });
});
