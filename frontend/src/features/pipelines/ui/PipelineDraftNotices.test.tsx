import { render, screen } from "@testing-library/react";
import { AxiosError } from "axios";

import { noticeForSaveError, type DraftNotice } from "../hooks/draftSaveRequest";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { PipelineDraftNotices } from "./PipelineDraftNotices";
import type { PipelinePageState } from "./spine/PipelineSpineLayout";
import { threeSteps } from "./pipelineSpineTestKit";

// HEL-1542: what the user reads when Save & run is refused over a lane reference. Red first against the pre-change builder,
// which rendered the server's step ids and named the lane target in the "Couldn't save step" prefix.
function pageWith(notice: DraftNotice): PipelinePageState {
  return {
    draftSave: {
      notice,
      reload: jest.fn(),
      dismissNotice: jest.fn(),
      confirmUndoWithDraft: jest.fn(),
    },
  } as unknown as PipelinePageState;
}

describe("PipelineDraftNotices on a refused lane reference (HEL-1542)", () => {
  it("reads with step labels only, names the saved step in the prefix, and keeps the draft", () => {
    const [limit, sort] = threeSteps().map(pipelineStepToStep);
    const target = { ...limit, id: "5c1e0d3a-4b27-4f10-9a52-0f6f5d2c9e11", label: "Limit" };
    const subject = { ...sort, id: "8a2f7b64-91cd-4d0e-b6a3-3c1d7e5f0a22", label: "Sort rows" };
    const err = new AxiosError("x", "ERR", undefined, undefined, {
      status: 400,
      data: {
        message: `Step '${subject.id}' has a lane reference to '${target.id}', which would be its descendant.`,
      },
    } as never);
    const mapped = noticeForSaveError(err, {
      steps: [target, subject],
      outputs: [],
      draftSteps: [target, subject],
    });
    if (!("notice" in mapped)) throw new Error("expected a notice");

    render(<PipelineDraftNotices page={pageWith(mapped.notice)} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      'Couldn\'t save step "Sort rows": Step "Sort rows" has a lane reference to "Limit", which would be its descendant. Your draft is still here.',
    );
    expect(alert.textContent).not.toContain(subject.id);
    expect(alert.textContent).not.toContain(target.id);
  });
});
