import { render, screen } from "@testing-library/react";

import { RunHistoryList } from "./RunHistoryModal";

// HEL-1661 (design.md D4): the empty copy invites the reader to run; a viewer cannot, so it reads "No runs yet."
describe("RunHistoryList empty copy", () => {
  it("invites a runner to run or dry-run", () => {
    render(<RunHistoryList runs={[]} view="fresh" onRetry={jest.fn()} canRun />);
    expect(screen.getByText("Run or dry-run this pipeline to see its history here.")).toBeVisible();
  });

  it("a viewer is not invited to act", () => {
    render(<RunHistoryList runs={[]} view="fresh" onRetry={jest.fn()} canRun={false} />);
    expect(screen.getByText("No runs yet.")).toBeVisible();
    expect(screen.queryByText(/Run or dry-run/)).toBeNull();
  });
});
