import { dashboard } from "../test/homeFixtures";
import { shelfOrder } from "./shelfOrder";

const d = (id: string, updated: string) => dashboard(id, id, updated);

describe("shelfOrder", () => {
  const all = [
    d("old", "2026-01-01T00:00:00Z"),
    d("new", "2026-10-01T00:00:00Z"),
    d("mid", "2026-05-01T00:00:00Z"),
    d("older", "2025-01-01T00:00:00Z"),
    d("oldest", "2024-01-01T00:00:00Z"),
  ];

  it("orders by last update, newest first, and keeps four", () => {
    expect(shelfOrder(all, new Set()).map((x) => x.id)).toEqual(["new", "mid", "old", "older"]);
  });

  it("puts changed dashboards first, even when old, then the rest by update", () => {
    expect(shelfOrder(all, new Set(["oldest", "old"])).map((x) => x.id)).toEqual([
      "old",
      "oldest",
      "new",
      "mid",
    ]);
  });

  it("does not mutate its input", () => {
    const copy = [...all];
    shelfOrder(all, new Set(["oldest"]));
    expect(all).toEqual(copy);
  });
});
