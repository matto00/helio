// HEL-247 — narrowing coverage for the collection kind: the predicate plus the
// bound-capable getters (a collection binds via dataTypeId/fieldMapping like the
// bound trio).

import { getDataTypeId, getFieldMapping, isCollectionPanel } from "./panelNarrowing";
import type { CollectionPanel } from "../types/panel";

function collectionPanel(config: Partial<CollectionPanel["config"]> = {}): CollectionPanel {
  return {
    id: "p1",
    dashboardId: "d1",
    title: "c",
    meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
    appearance: { background: "", color: "", transparency: 0 },
    ownerId: "u",
    refreshInterval: null,
    type: "collection",
    config: { dataTypeId: "", fieldMapping: {}, baseType: "metric", layout: "grid", ...config },
  };
}

describe("panelNarrowing — collection", () => {
  it("isCollectionPanel narrows the collection kind", () => {
    expect(isCollectionPanel(collectionPanel())).toBe(true);
  });

  it("getDataTypeId reads a bound collection's dataTypeId and collapses empty to null", () => {
    expect(getDataTypeId(collectionPanel({ dataTypeId: "dt-1" }))).toBe("dt-1");
    expect(getDataTypeId(collectionPanel({ dataTypeId: "" }))).toBeNull();
  });

  it("getFieldMapping reads a bound collection's shared field mapping", () => {
    expect(getFieldMapping(collectionPanel({ fieldMapping: { value: "amount" } }))).toEqual({
      value: "amount",
    });
    expect(getFieldMapping(collectionPanel())).toBeNull();
  });
});
