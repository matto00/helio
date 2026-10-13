import { act } from "@testing-library/react";

/**
 * Lets the mount's own steps fetch settle after a page render (HEL-1483: until it lands the steps
 * area shows a loading skeleton, not the editor / empty state). Shared by the pipeline-detail page
 * tests; each file keeps its own `render*` helper because their mocks and stores differ.
 */
export async function settled<T>(rendered: T): Promise<T> {
  await act(async () => {});
  return rendered;
}
