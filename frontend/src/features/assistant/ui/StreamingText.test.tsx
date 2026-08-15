import { render, screen, waitFor } from "@testing-library/react";

import { StreamingText } from "./StreamingText";

describe("StreamingText", () => {
  // tasks.md 5.5 — StreamingText reveals a scripted chunk sequence in order with a visible
  // in-progress affordance until complete.
  it("reveals a scripted chunk sequence in order, with the cursor visible until it completes", async () => {
    render(<StreamingText chunks={["Look", "ing up ", "your data..."]} intervalMs={0} />);

    // In-progress affordance visible before the sequence completes.
    expect(screen.getByTestId("streaming-text-cursor")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Looking up your data...")).toBeInTheDocument());

    // Chunks revealed in order (not e.g. "your data...Looking up "), and the
    // in-progress affordance disappears once complete.
    await waitFor(() =>
      expect(screen.queryByTestId("streaming-text-cursor")).not.toBeInTheDocument(),
    );
  });

  it("shows no cursor for an empty chunk sequence", () => {
    render(<StreamingText chunks={[]} />);

    expect(screen.queryByTestId("streaming-text-cursor")).not.toBeInTheDocument();
  });
});
