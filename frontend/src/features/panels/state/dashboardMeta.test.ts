import type { Output } from "../../pipelines/types/output";
import type { PipelineSummary } from "../../pipelines/types/pipelineStep";
import {
  makeDividerPanel,
  makeFormPanel,
  makeOutputPanel,
  makeTextPanel,
} from "../../../test/panelFixtures";
import { deriveDashboardMeta } from "./dashboardMeta";

function output(id: string, pipelineId: string): Output {
  return {
    id,
    pipelineId,
    ownerId: "u1",
    name: id,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}

function pipeline(
  id: string,
  over: Partial<PipelineSummary> & { sources?: string[] } = {},
): PipelineSummary {
  const { sources = [], ...rest } = over;
  return {
    id,
    name: id,
    roots: sources.map((name, i) => ({
      id: `${id}-r${i}`,
      dataSourceId: `ds-${name}`,
      dataSourceName: name,
    })),
    lastRunStatus: null,
    lastRunAt: null,
    lastRunRowCount: null,
    ...rest,
  };
}

const panelFor = (outputId: string) =>
  makeOutputPanel({ id: `p-${outputId}`, config: { outputId } });

describe("deriveDashboardMeta", () => {
  it("one succeeded pipeline: refreshed time, success intent and its source", () => {
    const meta = deriveDashboardMeta(
      [panelFor("o1")],
      { o1: output("o1", "pl1") },
      {
        pl1: pipeline("pl1", {
          lastRunStatus: "succeeded",
          lastRunAt: "2026-10-15T08:00:00Z",
          sources: ["Orders"],
        }),
      },
    );
    expect(meta).toEqual({
      panelCount: 1,
      refreshState: "ran",
      refreshedAt: "2026-10-15T08:00:00Z",
      refreshIntent: "success",
      sources: ["Orders"],
      moreSources: 0,
    });
  });

  it("the latest run failed: danger intent from the most recent run, not the older success", () => {
    const meta = deriveDashboardMeta(
      [panelFor("o1"), panelFor("o2")],
      { o1: output("o1", "pl1"), o2: output("o2", "pl2") },
      {
        pl1: pipeline("pl1", { lastRunStatus: "succeeded", lastRunAt: "2026-10-15T06:00:00Z" }),
        pl2: pipeline("pl2", { lastRunStatus: "failed", lastRunAt: "2026-10-15T09:00:00Z" }),
      },
    );
    expect(meta.refreshedAt).toBe("2026-10-15T09:00:00Z");
    expect(meta.refreshIntent).toBe("danger");
  });

  it("known pipelines that never ran: 'never' with no time and no intent", () => {
    const meta = deriveDashboardMeta(
      [panelFor("o1")],
      { o1: output("o1", "pl1") },
      { pl1: pipeline("pl1", { sources: ["Orders"] }) },
    );
    expect(meta.refreshState).toBe("never");
    expect(meta.refreshedAt).toBeNull();
    expect(meta.refreshIntent).toBeNull();
    expect(meta.sources).toEqual(["Orders"]);
  });

  it("no output panels: unknown refresh, no sources, and every panel kind still counts", () => {
    const meta = deriveDashboardMeta(
      [makeTextPanel({ id: "t" }), makeDividerPanel({ id: "d" })],
      {},
      {},
    );
    expect(meta).toMatchObject({
      panelCount: 2,
      refreshState: "unknown",
      sources: [],
      moreSources: 0,
    });
  });

  it("an unknown pipeline (no summary held) is omitted, not fabricated", () => {
    const meta = deriveDashboardMeta(
      [panelFor("o1"), panelFor("o2")],
      { o1: output("o1", "pl1"), o2: output("o2", "pl2") },
      {
        pl2: pipeline("pl2", {
          lastRunStatus: "succeeded",
          lastRunAt: "2026-10-15T07:00:00Z",
          sources: ["B"],
        }),
      },
    );
    expect(meta.refreshedAt).toBe("2026-10-15T07:00:00Z");
    expect(meta.sources).toEqual(["B"]);
  });

  it("only unknown pipelines: refresh is unknown", () => {
    const meta = deriveDashboardMeta([panelFor("o1")], { o1: output("o1", "pl1") }, {});
    expect(meta.refreshState).toBe("unknown");
  });

  it("multiple sources keep first-seen panel order, dedupe, and collapse into +N after two", () => {
    const meta = deriveDashboardMeta(
      [panelFor("o1"), panelFor("o2")],
      { o1: output("o1", "pl1"), o2: output("o2", "pl2") },
      {
        pl2: pipeline("pl2", { sources: ["C", "A"] }),
        pl1: pipeline("pl1", { sources: ["B", "A"] }),
      },
    );
    expect(meta.sources).toEqual(["B", "A"]);
    expect(meta.moreSources).toBe(1);
  });

  it("two sources show both with no overflow", () => {
    const meta = deriveDashboardMeta(
      [panelFor("o1")],
      { o1: output("o1", "pl1") },
      { pl1: pipeline("pl1", { sources: ["A", "B"] }) },
    );
    expect(meta.sources).toEqual(["A", "B"]);
    expect(meta.moreSources).toBe(0);
  });

  it("an unbound output panel (empty outputId) and a form panel contribute nothing", () => {
    const meta = deriveDashboardMeta(
      [panelFor(""), makeFormPanel({ id: "f", config: { dataSourceId: "ds-1" } })],
      { "": output("", "pl-empty") },
      {
        "pl-empty": pipeline("pl-empty", {
          lastRunStatus: "succeeded",
          lastRunAt: "2026-10-15T07:00:00Z",
          sources: ["X"],
        }),
      },
    );
    expect(meta).toMatchObject({ panelCount: 2, refreshState: "unknown", sources: [] });
  });

  it("panelCount is the singular-friendly raw count", () => {
    expect(deriveDashboardMeta([makeTextPanel({ id: "t" })], {}, {}).panelCount).toBe(1);
  });
});
