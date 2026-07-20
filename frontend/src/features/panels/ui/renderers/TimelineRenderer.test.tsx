import { render, screen } from "@testing-library/react";

import { TimelineRenderer } from "./TimelineRenderer";
import type { TimelinePanel } from "../../types/panel";

function makeTimelinePanel(config: Partial<TimelinePanel["config"]> = {}): TimelinePanel {
  return {
    id: "p1",
    dashboardId: "d1",
    title: "Story Timeline",
    meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
    appearance: { background: "", color: "", transparency: 0 },
    ownerId: "u",
    refreshInterval: null,
    type: "timeline",
    config: {
      dataTypeId: "dt-1",
      fieldMapping: { time: "when", event: "what" },
      timelineOptions: { sort: "asc" },
      ...config,
    },
  };
}

const HEADERS = ["when", "what"];
const ROWS = [
  ["06:40", "Air-raid sirens sound"],
  ["06:14", "Missile launch detected"],
  ["09:00", "One confirmed dead"],
];

describe("TimelineRenderer — chronological ordering (HEL-317)", () => {
  it("renders one entry per bound row, each with its own time and event text", () => {
    const { container } = render(
      <TimelineRenderer panel={makeTimelinePanel()} rawRows={ROWS} headers={HEADERS} />,
    );
    const entries = container.querySelectorAll(".panel-content__timeline-entry");
    expect(entries).toHaveLength(3);
    expect(screen.getByText("Air-raid sirens sound")).toBeInTheDocument();
    expect(screen.getByText("Missile launch detected")).toBeInTheDocument();
    expect(screen.getByText("One confirmed dead")).toBeInTheDocument();
  });

  it("orders entries ascending by the time field by default", () => {
    const { container } = render(
      <TimelineRenderer panel={makeTimelinePanel()} rawRows={ROWS} headers={HEADERS} />,
    );
    const events = Array.from(container.querySelectorAll(".panel-content__timeline-event")).map(
      (el) => el.textContent,
    );
    expect(events).toEqual([
      "Missile launch detected",
      "Air-raid sirens sound",
      "One confirmed dead",
    ]);
  });

  it("orders entries descending when sort is desc", () => {
    const { container } = render(
      <TimelineRenderer
        panel={makeTimelinePanel({ timelineOptions: { sort: "desc" } })}
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    const events = Array.from(container.querySelectorAll(".panel-content__timeline-event")).map(
      (el) => el.textContent,
    );
    expect(events).toEqual([
      "One confirmed dead",
      "Air-raid sirens sound",
      "Missile launch detected",
    ]);
  });

  it("suppresses the trailing connector only on the last (chronologically) entry", () => {
    const { container } = render(
      <TimelineRenderer panel={makeTimelinePanel()} rawRows={ROWS} headers={HEADERS} />,
    );
    const entries = container.querySelectorAll(".panel-content__timeline-entry");
    expect(entries[0]).not.toHaveClass("panel-content__timeline-entry--last");
    expect(entries[1]).not.toHaveClass("panel-content__timeline-entry--last");
    expect(entries[2]).toHaveClass("panel-content__timeline-entry--last");
  });
});

describe("TimelineRenderer — degradation at the data edges", () => {
  it("shows an unbound placeholder when no data type is bound", () => {
    render(
      <TimelineRenderer
        panel={makeTimelinePanel({ dataTypeId: "" })}
        rawRows={null}
        headers={null}
      />,
    );
    expect(screen.getByText(/bind a data type/i)).toBeInTheDocument();
  });

  it("shows a No data state when bound but the snapshot has zero rows", () => {
    render(<TimelineRenderer panel={makeTimelinePanel()} rawRows={[]} headers={HEADERS} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders a single entry without a trailing connector", () => {
    const { container } = render(
      <TimelineRenderer
        panel={makeTimelinePanel()}
        rawRows={[["06:14", "Missile launch detected"]]}
        headers={HEADERS}
      />,
    );
    const entries = container.querySelectorAll(".panel-content__timeline-entry");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveClass("panel-content__timeline-entry--last");
  });

  it("renders a long description without truncating the underlying text (CSS wraps it)", () => {
    const longEvent = "A".repeat(500);
    render(
      <TimelineRenderer
        panel={makeTimelinePanel()}
        rawRows={[["06:14", longEvent]]}
        headers={HEADERS}
      />,
    );
    expect(screen.getByText(longEvent)).toBeInTheDocument();
  });
});
