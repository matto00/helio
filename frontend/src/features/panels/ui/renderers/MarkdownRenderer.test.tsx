import { render, screen } from "@testing-library/react";

import { MarkdownRenderer } from "./MarkdownRenderer";
import { makeMarkdownPanel } from "../../../../test/panelFixtures";

// react-markdown/remark-gfm are mocked globally (jest.config.cjs moduleNameMapper) — the mock
// renders raw content as text under a `markdown-content` testid (see MarkdownPanel.test.tsx).
//
// HEL-512 — `MarkdownPanel` is now a `React.lazy` target inside `MarkdownRenderer` (design.md
// Decision 1). `React.lazy`'s loader promise is memoized once per `MarkdownRenderer` module
// instance (module scope, matching production) — Jest shares one module registry across every
// test in this file, so once any test resolves it, every later render of `MarkdownRenderer` here
// sees the already-fulfilled chunk and never re-suspends (mirrors real dynamic-import caching in
// the browser). The "still pending" fallback state is therefore only observable in the very first
// test that touches the module below — it must stay first, and it awaits the resolution itself
// before finishing so the transition doesn't leak an "update not wrapped in act(...)" warning into
// whichever test runs next. Every other test here awaits `screen.findByTestId(...)` (Suspense-
// aware) rather than a synchronous `getByTestId`.
describe("MarkdownRenderer — Suspense fallback (HEL-512)", () => {
  it("shows the shared panel-loading fallback before the markdown chunk resolves", async () => {
    const panel = makeMarkdownPanel({ config: { content: "# Hello" } });
    render(<MarkdownRenderer panel={panel} />);
    expect(screen.getByLabelText("Loading data")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-content")).not.toBeInTheDocument();
    // Drain the mocked dynamic import within this test's own act() scope (see the file-level
    // comment above) rather than leaving it to resolve during the next test.
    await screen.findByTestId("markdown-content");
  });

  it("replaces the fallback with the rendered markdown once the chunk resolves", async () => {
    const panel = makeMarkdownPanel({ config: { content: "# Hello" } });
    render(<MarkdownRenderer panel={panel} />);
    expect(await screen.findByTestId("markdown-content")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading data")).not.toBeInTheDocument();
  });

  // Matches echarts-chart-panel's own "No console errors on mount" scenario — the markdown-panel
  // equivalent, now exercised through the lazy-loaded path.
  it("mounts through the fallback → markdown transition with no console errors", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const panel = makeMarkdownPanel({ config: { content: "# Hello" } });
    render(<MarkdownRenderer panel={panel} />);
    await screen.findByTestId("markdown-content");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

// specs/frontend-code-splitting/spec.md — "Markdown panel renders normally once its chunk loads":
// content-resolution behavior (bound vs. static) is preserved through the lazy-loaded path.
describe("MarkdownRenderer — bound/static content resolution", () => {
  it("renders static config.content when no bound data is present", async () => {
    const panel = makeMarkdownPanel({ config: { content: "# Static heading" } });
    render(<MarkdownRenderer panel={panel} />);
    expect(await screen.findByTestId("markdown-content")).toHaveTextContent("Static heading");
  });

  it("renders bound data.content over static config.content when both are present", async () => {
    const panel = makeMarkdownPanel({ config: { content: "Stale literal" } });
    render(<MarkdownRenderer panel={panel} data={{ content: "Fresh bound value" }} />);
    expect(await screen.findByTestId("markdown-content")).toHaveTextContent("Fresh bound value");
  });
});
