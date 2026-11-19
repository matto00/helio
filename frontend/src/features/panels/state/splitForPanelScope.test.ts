// HEL-1780 D4: the case table of the split between what the per-panel route may be sent and what the browser applies.
import { hasClientOps, splitForPanelScope } from "./splitForPanelScope";

const CONTROLS = new Set(["region"]);

describe("splitForPanelScope", () => {
  it("sends a control-column sort to the server", () => {
    const { server, client } = splitForPanelScope(
      { sort: { column: "region", direction: "asc" } },
      CONTROLS,
    );
    expect(server.sort).toEqual({ column: "region", direction: "asc" });
    expect(client.sort).toBeUndefined();
  });

  it("keeps a non-control sort in the browser", () => {
    const { server, client } = splitForPanelScope(
      { sort: { column: "amount", direction: "desc" } },
      CONTROLS,
    );
    expect(server.sort).toBeUndefined();
    expect(client.sort).toEqual({ key: "amount", direction: "desc" });
  });

  it("splits column filters by control column", () => {
    const { server, client } = splitForPanelScope(
      { filter: { columns: { region: "w", amount: "5" } } },
      CONTROLS,
    );
    expect(server.filter).toEqual({ columns: { region: "w" } });
    expect(client.columns).toEqual({ amount: "5" });
  });

  it("never sends quick", () => {
    const { server, client } = splitForPanelScope({ filter: { quick: "abc" } }, CONTROLS);
    expect(server.filter).toBeUndefined();
    expect(client.quick).toBe("abc");
  });

  it("drops blank terms", () => {
    const { server, client } = splitForPanelScope(
      { filter: { quick: "  ", columns: { region: "", amount: " " } } },
      CONTROLS,
    );
    expect(server.filter).toBeUndefined();
    expect(hasClientOps(client)).toBe(false);
  });

  it("keeps viewer-control ops on control columns and drops any other", () => {
    const { server } = splitForPanelScope(
      {
        filter: {
          ops: [
            { column: "region", op: "eq", value: "West" },
            { column: "amount", op: "gte", value: "1" },
          ],
        },
      },
      CONTROLS,
    );
    expect(server.filter).toEqual({ ops: [{ column: "region", op: "eq", value: "West" }] });
  });

  it("folds the cross-filter eq into the server ops only for a control column", () => {
    const control = splitForPanelScope(
      { crossFilterEq: { column: "region", value: "W" } },
      CONTROLS,
    );
    expect(control.server.filter).toEqual({ ops: [{ column: "region", op: "eq", value: "W" }] });
    const other = splitForPanelScope({ crossFilterEq: { column: "amount", value: "5" } }, CONTROLS);
    expect(other.server.filter).toBeUndefined();
    expect(hasClientOps(other.client)).toBe(false);
  });

  it("with no control columns nothing but paging reaches the server", () => {
    const { server } = splitForPanelScope(
      {
        sort: { column: "a", direction: "asc" },
        filter: { quick: "q", columns: { a: "1" }, ops: [{ column: "a", op: "eq", value: "1" }] },
        crossFilterEq: { column: "a", value: "1" },
      },
      new Set(),
    );
    expect(server).toEqual({});
  });
});
