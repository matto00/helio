import { act, fireEvent, screen, within } from "@testing-library/react";

import { iso, NOW, pipeline, run, summary } from "../test/homeFixtures";
import { renderHome } from "../test/renderHome";
import { formatClock } from "../utils/timelineScale";
import { RunTimeline, TimelineLegend } from "./RunTimeline";

const data = summary({
  pipelines: [
    pipeline({
      pipelineId: "p1",
      name: "orders-sync",
      runs: [
        run({ runId: "a", startedAt: iso(-8) }),
        run({
          runId: "b",
          startedAt: iso(-3),
          status: "failed",
          errorLog: "source returned 0 rows",
          completedAt: iso(-2.99),
        }),
      ],
      upcoming: [iso(1)],
    }),
    pipeline({
      pipelineId: "p2",
      name: "ci-health",
      runs: [run({ runId: "c", startedAt: iso(-3.1) })],
      upcoming: [],
    }),
  ],
  pipelinesWithActivity: 2,
});

function marks() {
  return screen.getAllByRole("button");
}

describe("RunTimeline", () => {
  it("renders every run and fire as a button with a label naming pipeline, status and local time", () => {
    renderHome(<RunTimeline summary={data} now={NOW} />);
    const labels = marks().map((b) => b.getAttribute("aria-label"));
    expect(labels).toHaveLength(4);
    expect(labels).toContain(`orders-sync, scheduled, ${formatClock(Date.parse(iso(1)))}`);
    expect(labels).toContain(
      `orders-sync, failed, ${formatClock(Date.parse(iso(-3)))}, source returned 0 rows`,
    );
    expect(labels).toContain(`ci-health, succeeded, ${formatClock(Date.parse(iso(-3.1)))}`);
  });

  it("is one tab stop (roving tabindex)", () => {
    renderHome(<RunTimeline summary={data} now={NOW} />);
    expect(marks().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(marks().filter((b) => b.tabIndex === -1)).toHaveLength(3);
  });

  it("moves focus to the next mark with Right Arrow and shows its details on focus", () => {
    renderHome(<RunTimeline summary={data} now={NOW} />);
    const first = marks()[0];
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = marks()[1];
    expect(second).toHaveFocus();
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("orders-sync");
  });

  it("shows status, error and row count in the details of a failed run, and Escape dismisses them", () => {
    renderHome(<RunTimeline summary={data} now={NOW} />);
    const failed = screen.getByRole("button", { name: /orders-sync, failed/ });
    fireEvent.focus(failed);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("failed");
    expect(tip).toHaveTextContent("source returned 0 rows");
    expect(tip).toHaveTextContent("3 rows");
    expect(failed).toHaveAttribute("aria-describedby", tip.id);
    fireEvent.keyDown(failed, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows details on hover and hides them on leave", () => {
    renderHome(<RunTimeline summary={data} now={NOW} />);
    const fire = screen.getByRole("button", { name: /orders-sync, scheduled/ });
    fireEvent.mouseEnter(fire);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Next scheduled run");
    fireEvent.mouseLeave(fire);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("moves between rows with Down to the nearest-in-time mark", () => {
    renderHome(<RunTimeline summary={data} now={NOW} />);
    const failed = screen.getByRole("button", { name: /orders-sync, failed/ });
    act(() => failed.focus());
    fireEvent.keyDown(failed, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /ci-health, succeeded/ })).toHaveFocus();
  });

  it("opens the pipeline on click", () => {
    renderHome(<RunTimeline summary={data} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /ci-health/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/pipelines/p2");
  });

  it("says how many earlier runs are not drawn", () => {
    renderHome(
      <RunTimeline
        summary={summary({
          pipelines: [
            pipeline({
              pipelineId: "p",
              name: "busy",
              runs: [run({ runId: "r", startedAt: iso(-1) })],
              runsOmitted: 7,
            }),
          ],
        })}
        now={NOW}
      />,
    );
    expect(screen.getByText("+7 earlier")).toBeInTheDocument();
  });

  it("labels the group and draws a legend whose entries carry text as well as shape", () => {
    renderHome(
      <>
        <RunTimeline summary={data} now={NOW} />
        <TimelineLegend />
      </>,
    );
    expect(screen.getByRole("group", { name: "Pipeline runs, last 24 hours" })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["ok", "failed", "running", "scheduled"]);
  });

  it("gives each status its own shape class (not hue alone)", () => {
    const { container } = renderHome(
      <RunTimeline
        summary={summary({
          pipelines: [
            pipeline({
              pipelineId: "p",
              name: "all",
              runs: [
                run({ runId: "1", startedAt: iso(-4) }),
                run({ runId: "2", startedAt: iso(-3), status: "failed" }),
                run({ runId: "3", startedAt: iso(-2), status: "running" }),
              ],
              upcoming: [iso(1)],
            }),
          ],
        })}
        now={NOW}
      />,
    );
    const shapes = Array.from(container.querySelectorAll(".tl-shape")).map((el) => el.className);
    expect(shapes).toEqual([
      "tl-shape tl-shape--succeeded",
      "tl-shape tl-shape--failed",
      "tl-shape tl-shape--running",
      "tl-shape tl-shape--scheduled",
    ]);
  });
});
