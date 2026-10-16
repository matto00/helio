import { hidesBreadcrumbItemName } from "./hidesBreadcrumbItemName";

describe("hidesBreadcrumbItemName", () => {
  it("hides the item name on the rail shell's pipeline detail route", () => {
    expect(hidesBreadcrumbItemName("/pipelines/abc-123", false)).toBe(true);
    expect(hidesBreadcrumbItemName("/pipelines/abc-123/", false)).toBe(true);
  });

  it("keeps the name on the phone shell, whose title block is unchanged", () => {
    expect(hidesBreadcrumbItemName("/pipelines/abc-123", true)).toBe(false);
  });

  it("hides the dashboard name on the rail shell's dashboard view, where the tab bar shows it", () => {
    expect(hidesBreadcrumbItemName("/dashboards/dash-1", false)).toBe(true);
    expect(hidesBreadcrumbItemName("/home", false)).toBe(true);
  });

  it("keeps the dashboard name on the phone shell", () => {
    expect(hidesBreadcrumbItemName("/dashboards/dash-1", true)).toBe(false);
  });

  it("does not hide anything on other routes", () => {
    expect(hidesBreadcrumbItemName("/pipelines", false)).toBe(false);
    expect(hidesBreadcrumbItemName("/pipelines/", false)).toBe(false);
    expect(hidesBreadcrumbItemName("/sources/abc", false)).toBe(false);
  });
});
