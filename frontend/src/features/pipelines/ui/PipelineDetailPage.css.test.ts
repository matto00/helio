import fs from "fs";
import path from "path";
import { expectTapExpander } from "../../../shared/ui/tapTargetTestUtils";

// Static guard for what is left of PipelineDetailPage.css after the river view and its footer were retired
// (HEL-1582): the step editors' shared styles and the loading placeholder. The phone page's own touch floor is
// guarded in `mobile/PipelineMobile.css.test.ts`; the river footer / step-card header assertions that lived here
// were removed with those controls.

const css = fs.readFileSync(path.join(__dirname, "PipelineDetailPage.css"), "utf-8");

function findMediaBlock(source: string, preludeSubstring: string): string {
  const at = source.indexOf(`@media (${preludeSubstring})`);
  if (at === -1) throw new Error(`No @media (${preludeSubstring}) in PipelineDetailPage.css`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error("Unbalanced braces");
}

describe("PipelineDetailPage.css", () => {
  it("the AI step's Move output field icon buttons clear a 44x44 tap target on phone", () => {
    expectTapExpander(
      findMediaBlock(css, "max-width: 430px"),
      ".pipeline-detail-page__step-card-move-btn",
      "square",
    );
  });

  it("carries no rules of the retired river view or its footer", () => {
    for (const retired of [
      ".pipeline-detail-page__step-card {",
      ".pipeline-detail-page__footer {",
      ".pipeline-detail-page__footer-region",
      ".pipeline-detail-page__tabs",
      ".pipeline-detail-page__gap",
      ".pipeline-detail-page__tail-chain",
      ".pipeline-detail-page__root-column",
      ".pipeline-detail-page__run-status",
    ]) {
      expect(css).not.toContain(retired);
    }
  });

  it("styles the loading placeholder's header band and steps frame", () => {
    expect(css).toContain(".pipeline-detail-page__skeleton-header");
    expect(css).toContain(".pipeline-detail-page__river-inner--skeleton");
  });
});
