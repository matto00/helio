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

/**
 * HEL-1579: renders the page in its PHONE layout (the river view, cards, tabs and footer) by stubbing
 * `window.matchMedia` so the phone-shell query (`(max-width: 768px)`) matches. jsdom has no `matchMedia`,
 * so without this every page test renders the desktop step spine. Returns the restore function; call it
 * from `afterEach`. The legacy page tests in this folder assert phone-layout behaviour (and layout-
 * independent page logic reached through the phone's card DOM) and keep running against it, while the
 * desktop layout has its own tests (`PipelineDetailPage.spine*.test.tsx`).
 */
export function installPhoneShell(): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) =>
    ({
      matches: query === "(max-width: 768px)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
