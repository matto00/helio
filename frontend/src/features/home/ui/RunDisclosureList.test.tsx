import { fireEvent, screen, within } from "@testing-library/react";

import { iso, pipeline, run, summary } from "../test/homeFixtures";
import { renderHome } from "../test/renderHome";
import { formatClock } from "../utils/timelineScale";
import { RunDisclosureList } from "./RunDisclosureList";

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
        }),
      ],
      upcoming: [iso(1)],
    }),
  ],
});

describe("RunDisclosureList (coarse pointer and phone)", () => {
  it("makes each pipeline one control labelled with counts and the next fire, with no mark as a tap target", () => {
    renderHome(<RunDisclosureList summary={data} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(
      `orders-sync, 2 runs, 1 failed, next ${formatClock(Date.parse(iso(1)))}`,
    );
    expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to a newest-first list showing a failed run's error and a link to the pipeline", () => {
    renderHome(<RunDisclosureList summary={data} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    const rows = within(screen.getAllByRole("list")[1]).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".tl-disc__status")?.textContent)).toEqual([
      "scheduled",
      "failed",
      "succeeded",
    ]);
    expect(rows[1]).toHaveTextContent("source returned 0 rows");
    expect(within(rows[1]).getByRole("link", { name: "Open pipeline" })).toHaveAttribute(
      "href",
      "/pipelines/p1",
    );
  });

  it("collapses again", () => {
    renderHome(<RunDisclosureList summary={data} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("link", { name: "Open pipeline" })).not.toBeInTheDocument();
  });
});
