import type { SourceReferenceSummary } from "../types/dataSource";
import { sourceDeleteWarning, summarizeSourceUsage } from "./sourceReferences";

function summary(o: Partial<SourceReferenceSummary> = {}): SourceReferenceSummary {
  return {
    sourceId: "s",
    pipelines: [],
    panels: [],
    hiddenPipelineCount: 0,
    hiddenPanelCount: 0,
    ...o,
  };
}

describe("summarizeSourceUsage", () => {
  it("is '—' before load, 'Unused' after load with no entry", () => {
    expect(summarizeSourceUsage(undefined, false)).toEqual({ label: "—", total: 0 });
    expect(summarizeSourceUsage(undefined, true)).toEqual({ label: "Unused", total: 0 });
  });

  it("totals visible and hidden pipelines and panels, tooltip names only visible ones", () => {
    const u = summarizeSourceUsage(
      summary({
        pipelines: [{ id: "p", name: "Visible", references: ["root", "upsertTarget"] }],
        hiddenPipelineCount: 1,
        panels: [{ id: "pn", title: "Entry", dashboardId: "d", dashboardName: "Ops" }],
        hiddenPanelCount: 2,
      }),
      true,
    );
    expect(u.label).toBe("2 pipelines, 3 form panels");
    expect(u.total).toBe(5);
    expect(u.title).toBe(
      "Visible (root, upsert target)\nEntry (form panel on Ops)\n3 you cannot access",
    );
  });
});

describe("sourceDeleteWarning", () => {
  it("is null when nothing references the source", () => {
    expect(sourceDeleteWarning(undefined)).toBeNull();
    expect(sourceDeleteWarning(summary())).toBeNull();
  });

  it("uses singular copy for exactly one reference", () => {
    expect(sourceDeleteWarning(summary({ hiddenPanelCount: 1 }))).toBe(
      "1 form panel references this source, so deleting it will be refused until you remove that reference.",
    );
  });

  it("joins pipelines and form panels with plural copy", () => {
    expect(sourceDeleteWarning(summary({ hiddenPipelineCount: 1, hiddenPanelCount: 1 }))).toBe(
      "1 pipeline and 1 form panel reference this source, so deleting it will be refused until you remove those references.",
    );
  });
});
