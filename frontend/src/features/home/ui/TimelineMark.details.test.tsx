import { render, screen } from "@testing-library/react";

import type { HomeRun } from "../types/homeSummary";
import { MarkDetails } from "./TimelineMark";

// HEL-1815: a home timeline mark's details label the trigger source with the run-history wording.

const run = (triggerSource: string): HomeRun => ({
  runId: "r1",
  status: "succeeded",
  startedAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:00:05Z",
  triggerSource,
  rowCount: 3,
  errorLog: null,
});

describe("MarkDetails trigger label (HEL-1815)", () => {
  it.each([
    ["auto-run", "Auto-run"],
    ["manual", "Manual"],
    ["scheduled", "Scheduled"],
    ["external", "External"],
  ])("labels %s as %s", (source, label) => {
    render(
      <MarkDetails
        pipelineName="Pipe"
        id="tip"
        mark={{
          key: "k",
          status: "succeeded",
          time: Date.parse("2026-01-01T00:00:00Z"),
          run: run(source),
        }}
      />,
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(`3 rows · ${label}`);
  });
});
