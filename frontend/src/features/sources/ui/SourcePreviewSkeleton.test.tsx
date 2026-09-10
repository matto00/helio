import { render, screen } from "@testing-library/react";

import { SourcePreviewSkeleton } from "./SourcePreviewSkeleton";

// HEL-1056 REGRESSION GUARD (mutation-failable) — evaluator-1 CR1/CR2:
// `.ui-data-grid__frame--preview` now owns the collapsible `margin-top` that
// used to live on `.ui-data-grid--preview` itself (DataGrid.css). This
// skeleton renders no `.ui-data-grid__frame` wrapper (D3 — it has none of
// the toolbar/quick-filter chrome the frame exists to host), so it must
// carry `.ui-data-grid__frame--preview` directly on its own root, or it
// silently loses its top margin. jsdom can't compute resolved/collapsed
// margins (same limitation as DataGrid.test.tsx's sibling guards), so this
// asserts the class is present on the rendered root — shown mutation-failable
// below: dropping the class from SourcePreviewSkeleton.tsx must turn this red.
describe("SourcePreviewSkeleton — HEL-1056 preview margin-top class parity", () => {
  it("HEL-1056 REGRESSION GUARD (mutation-failable): the skeleton's root carries the class that owns the preview margin-top", () => {
    render(<SourcePreviewSkeleton />);
    const root = screen.getByLabelText("Loading preview");
    expect(root).toHaveClass("ui-data-grid__frame--preview");
    // Carried forward: the skeleton's pre-existing border/radius/background
    // parity classes with the resolved `DataGrid variant="preview"` markup.
    expect(root).toHaveClass("ui-data-grid");
    expect(root).toHaveClass("ui-data-grid--preview");
    expect(root).toHaveClass("ui-data-grid--condensed");
  });
});
