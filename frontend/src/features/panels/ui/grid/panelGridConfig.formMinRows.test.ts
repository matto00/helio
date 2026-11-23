// HEL-1618 — the pure helpers behind the 5-row form minimum (design D4).
import {
  FORM_MIN_ROWS,
  createLayouts,
  isSpaceBelowFree,
  liftResizedForm,
  panelGridConfig,
  panelMinRows,
} from "./panelGridConfig";
import { isCompactCounterConfig } from "../form/compactCounter";
import { makeFormPanel, makeOutputPanel } from "../../../../test/panelFixtures";
import type { DashboardLayoutItem } from "../../../dashboards/types/dashboard";

const item = (
  panelId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): DashboardLayoutItem => ({
  panelId,
  x,
  y,
  w,
  h,
});
const text2 = [
  { sourceField: "a", control: "text" as const, label: "A" },
  { sourceField: "b", control: "text" as const, label: "B" },
];
const counter = [{ sourceField: "d", control: "counter" as const, label: "D" }];

describe("isCompactCounterConfig", () => {
  it("is true only for exactly one counter field", () => {
    expect(isCompactCounterConfig({ fields: counter })).toBe(true);
    expect(isCompactCounterConfig({ fields: [] })).toBe(false);
    expect(isCompactCounterConfig({ fields: text2 })).toBe(false);
    expect(isCompactCounterConfig({ fields: [...counter, ...text2] })).toBe(false);
    expect(isCompactCounterConfig(undefined)).toBe(false);
  });
});

describe("panelMinRows", () => {
  it("is 5 for a non-counter form whose stored h is 5 or more, 4 below that, 4 for a counter and any other kind", () => {
    const form = makeFormPanel({ id: "f", config: { fields: text2 } });
    expect(FORM_MIN_ROWS).toBe(5);
    expect(panelMinRows(form, 5)).toBe(5);
    expect(panelMinRows(form, 9)).toBe(5);
    expect(panelMinRows(form, 4)).toBe(panelGridConfig.itemHeights.min);
    expect(panelMinRows(form, 3)).toBe(panelGridConfig.itemHeights.min);
    expect(panelMinRows(makeFormPanel({ id: "c", config: { fields: counter } }), 5)).toBe(4);
    expect(panelMinRows(makeFormPanel({ id: "e" }), 5)).toBe(5);
    expect(panelMinRows(makeOutputPanel({ id: "o" }), 8)).toBe(4);
    expect(panelMinRows(undefined, 8)).toBe(4);
  });
});

describe("createLayouts minRowsFor", () => {
  it("uses the lookup at every breakpoint and defaults to the general minimum", () => {
    const l = {
      lg: [item("a", 0, 0, 3, 5)],
      md: [item("a", 0, 0, 3, 5)],
      sm: [item("a", 0, 0, 3, 5)],
      xs: [item("a", 0, 0, 2, 5)],
    };
    expect(createLayouts(l).lg?.[0].minH).toBe(4);
    const out = createLayouts(l, () => 5);
    for (const bp of ["lg", "md", "sm", "xs"] as const) expect(out[bp]?.[0].minH).toBe(5);
  });
});

describe("isSpaceBelowFree", () => {
  const form = item("f", 0, 0, 3, 4);
  it("is free with nothing below, including at the bottom edge of the layout", () => {
    expect(isSpaceBelowFree([form], form, 5)).toBe(true);
  });
  it("is blocked by an item occupying row y+4 in a spanned column", () => {
    expect(isSpaceBelowFree([form, item("o", 0, 4, 3, 2)], form, 5)).toBe(false);
  });
  it("is blocked by a one-column overlap", () => {
    expect(isSpaceBelowFree([form, item("o", 2, 4, 3, 2)], form, 5)).toBe(false);
  });
  it("is free for a neighbour beside it or below row y+4", () => {
    expect(isSpaceBelowFree([form, item("o", 3, 4, 3, 2)], form, 5)).toBe(true);
    expect(isSpaceBelowFree([form, item("o", 0, 5, 3, 2)], form, 5)).toBe(true);
  });
  it("ignores the form's own item", () => {
    expect(isSpaceBelowFree([form], form, 5)).toBe(true);
  });
});

describe("liftResizedForm", () => {
  const form = makeFormPanel({ id: "f", config: { fields: text2 } });
  const ctr = makeFormPanel({ id: "c", config: { fields: counter } });
  it("lifts only the resized non-counter form below 5 rows when free, returning a new array", () => {
    const items = [item("f", 0, 0, 3, 4)];
    expect(liftResizedForm(items, "f", [form])).toEqual([item("f", 0, 0, 3, 5)]);
    expect(items[0].h).toBe(4);
  });
  it("returns the same array when nothing lifts", () => {
    const items = [item("f", 0, 0, 3, 4), item("o", 0, 4, 3, 2)];
    expect(liftResizedForm(items, "f", [form])).toBe(items);
    expect(liftResizedForm(items, null, [form])).toBe(items);
    expect(liftResizedForm([item("c", 0, 0, 3, 4)], "c", [ctr])).toEqual([item("c", 0, 0, 3, 4)]);
    const at5 = [item("f", 0, 0, 3, 5)];
    expect(liftResizedForm(at5, "f", [form])).toBe(at5);
  });
});
