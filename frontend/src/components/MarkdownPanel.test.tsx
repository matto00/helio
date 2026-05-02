import { render, screen } from "@testing-library/react";

import { MarkdownPanel } from "./MarkdownPanel";

describe("MarkdownPanel — with content", () => {
  it("renders markdown content via ReactMarkdown", () => {
    render(<MarkdownPanel content="# Hello World" />);
    expect(screen.getByTestId("markdown-content")).toHaveTextContent("# Hello World");
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
