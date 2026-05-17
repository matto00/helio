import { render, screen } from "@testing-library/react";

import { MarkdownPanel } from "./MarkdownPanel";

// react-markdown and remark-gfm are mocked in jest.config.cjs.
// The mock renders raw content as text, so tests verify content is passed
// through correctly. Actual HTML rendering (headings, tables, checkboxes)
// is covered by react-markdown and remark-gfm's own test suites.

describe("MarkdownPanel — with content", () => {
  it("passes markdown content to the renderer", () => {
    render(<MarkdownPanel content="# Hello World" />);
    expect(screen.getByTestId("markdown-content")).toHaveTextContent("# Hello World");
  });

  it("passes GFM table syntax to the renderer", () => {
    const table = "| Name | Value |\n|------|-------|\n| Foo  | Bar   |";
    render(<MarkdownPanel content={table} />);
    expect(screen.getByTestId("markdown-content")).toHaveTextContent("Name");
  });

  it("passes GFM task list syntax to the renderer", () => {
    render(<MarkdownPanel content={"- [x] Done\n- [ ] Todo"} />);
    expect(screen.getByTestId("markdown-content")).toHaveTextContent("Done");
  });
});

describe("MarkdownPanel — without content", () => {
  it("shows placeholder when content is null", () => {
    render(<MarkdownPanel content={null} />);
    expect(screen.getByText(/No content yet/)).toBeInTheDocument();
  });

  it("shows placeholder when content is empty string", () => {
    render(<MarkdownPanel content="" />);
    expect(screen.getByText(/No content yet/)).toBeInTheDocument();
  });
});
