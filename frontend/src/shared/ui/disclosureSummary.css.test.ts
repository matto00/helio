import fs from "node:fs";
import path from "node:path";

// HEL-1502: the disclosure-summary recipe lives once; feature stylesheets must not re-declare it.
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8");

describe("disclosureSummary.css", () => {
  const recipe = read("./disclosureSummary.css");

  it("draws an explicit chevron on ::before, rotated when open, with no native marker", () => {
    expect(recipe).toMatch(/\.disclosure-summary::before\s*{/);
    expect(recipe).toMatch(/details\[open\]\s*>\s*\.disclosure-summary::before/);
    expect(recipe).toContain("list-style: none");
    expect(recipe).toContain("::-webkit-details-marker");
    expect(recipe).toContain("min-height: var(--control-sm)");
    expect(recipe).toContain(":focus-visible");
  });

  it("is not duplicated by the compute Functions or usage card summaries", () => {
    expect(read("../../features/pipelines/ui/PipelineDetailPage.css")).not.toContain(
      "compute-functions-summary",
    );
    const usage = read("../../features/adminUsage/ui/UsageCard.css");
    expect(usage).not.toMatch(/\.usage-card__summary[^{]*{[^}]*(cursor|min-height)/);
  });
});
