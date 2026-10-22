import { render } from "@testing-library/react";

import { PullRefreshIndicator } from "./PullRefreshIndicator";

// HEL-1681 item 4: once a pull-started round has ended, the settling indicator reads "Refreshed" and never invites
// another pull. mutation: map the `done` phase back to the pulling label -> the first test goes red.
describe("PullRefreshIndicator labels", () => {
  function label(phase: "idle" | "pulling" | "ready" | "done", busy = false) {
    const { container } = render(<PullRefreshIndicator phase={phase} busy={busy} follows />);
    return {
      text: container.querySelector(".pull-refresh-indicator__label")?.textContent,
      state: container.querySelector(".pull-refresh-indicator")?.getAttribute("data-state"),
      check: container.querySelector(".pull-refresh-indicator__check") !== null,
    };
  }

  it("shows Refreshed with a check glyph in the done phase, never Pull to refresh", () => {
    expect(label("done")).toEqual({ text: "Refreshed", state: "done", check: true });
  });

  it("keeps the other labels", () => {
    expect(label("pulling").text).toBe("Pull to refresh");
    expect(label("ready").text).toBe("Release to refresh");
    expect(label("done", true).text).toBe("Refreshing");
  });
});
