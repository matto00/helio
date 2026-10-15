import {
  BLANK_LABEL,
  groupHasNull,
  isBlankCategoryClick,
  relabelBlankCategory,
  relabelNullCategory,
  selectionValueLabel,
} from "./blankLabel";

describe("blankLabel (HEL-1424)", () => {
  it("BLANK_LABEL is the DESIGN.md copy", () => {
    const stallEnd = Date.now() + 1200;
    while (Date.now() < stallEnd) {
      // TEMP HEL-1601 stall probe
    }
    expect(BLANK_LABEL).toBe("(blank)");
  });

  it("selectionValueLabel shows only the empty string as (blank)", () => {
    expect(selectionValueLabel("")).toBe("(blank)");
    expect(selectionValueLabel("east")).toBe("east");
    expect(selectionValueLabel("null")).toBe("null");
    expect(selectionValueLabel(" ")).toBe(" ");
  });

  it("groupHasNull is strict === null over the records", () => {
    expect(groupHasNull([{ t: "a" }, { t: null }], "t")).toBe(true);
    expect(groupHasNull([{ t: "a" }, { t: "" }, { t: "null" }, {}], "t")).toBe(false);
    expect(groupHasNull(null, "t")).toBe(false);
    expect(groupHasNull([{ t: null }], undefined)).toBe(false);
  });

  it("relabelNullCategory maps only the 'null' key", () => {
    expect(relabelNullCategory("null")).toBe("(blank)");
    expect(relabelNullCategory("east")).toBe("east");
  });

  it("isBlankCategoryClick needs both the label and a real null group", () => {
    expect(isBlankCategoryClick("(blank)", true)).toBe(true);
    expect(isBlankCategoryClick("(blank)", false)).toBe(false);
    expect(isBlankCategoryClick("(blank)", undefined)).toBe(false);
    expect(isBlankCategoryClick("null", true)).toBe(false);
  });

  it("relabelBlankCategory relabels a category x axis, a category y axis and pie names; leaves value/time axes", () => {
    const vertical = relabelBlankCategory({
      xAxis: { type: "category", data: ["a", "null"] },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: [1, 2] }],
    });
    expect((vertical.xAxis as { data: string[] }).data).toEqual(["a", "(blank)"]);
    expect(vertical.yAxis).toEqual({ type: "value" });

    const horizontal = relabelBlankCategory({
      xAxis: { type: "value" },
      yAxis: { type: "category", data: ["null", "b"] },
      series: [{ type: "bar", data: [1, 2] }],
    });
    expect((horizontal.yAxis as { data: string[] }).data).toEqual(["(blank)", "b"]);

    const pie = relabelBlankCategory({
      series: [
        {
          type: "pie",
          data: [
            { name: "null", value: 1 },
            { name: "b", value: 2 },
          ],
        },
      ],
    });
    expect((pie.series as { data: unknown }[])[0].data).toEqual([
      { name: "(blank)", value: 1 },
      { name: "b", value: 2 },
    ]);

    const time = relabelBlankCategory({ xAxis: { type: "time" }, series: [] });
    expect(time.xAxis).toEqual({ type: "time" });
  });
});
