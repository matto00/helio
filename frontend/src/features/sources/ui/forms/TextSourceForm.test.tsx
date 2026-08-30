import { fireEvent, render, screen } from "@testing-library/react";

import { TextSourceForm } from "./TextSourceForm";

const noop = () => undefined;

describe("TextSourceForm", () => {
  it("renders the file-picker sub-mode by default", () => {
    render(<TextSourceForm onSubmit={noop} isLoading={false} error={null} onCancel={noop} />);
    expect(screen.getByLabelText(/text\/markdown file/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("URL")).not.toBeInTheDocument();
  });

  it("switches to the URL sub-mode when 'From URL' is clicked", () => {
    render(<TextSourceForm onSubmit={noop} isLoading={false} error={null} onCancel={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(screen.queryByLabelText(/text\/markdown file/i)).not.toBeInTheDocument();
  });

  it("calls onSubmit with mode 'upload' and the selected file", () => {
    const onSubmit = jest.fn();
    render(<TextSourceForm onSubmit={onSubmit} isLoading={false} error={null} onCancel={noop} />);

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/text\/markdown file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(onSubmit).toHaveBeenCalledWith("upload", file, "");
  });

  it("calls onSubmit with mode 'url' and the entered URL", () => {
    const onSubmit = jest.fn();
    render(<TextSourceForm onSubmit={onSubmit} isLoading={false} error={null} onCancel={noop} />);

    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/notes.md" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(onSubmit).toHaveBeenCalledWith("url", null, "https://example.com/notes.md");
  });

  it("renders an error message when provided", () => {
    render(
      <TextSourceForm
        onSubmit={noop}
        isLoading={false}
        error="Unsupported file extension"
        onCancel={noop}
      />,
    );
    // F-051: routed through the shared <InlineError>, whose default "text"
    // variant intentionally carries no alert role (matches every other
    // plain-text InlineError consumer app-wide) — assert on the rendered
    // text instead.
    expect(screen.getByText(/unsupported file extension/i)).toBeInTheDocument();
  });

  it("disables the submit button while loading", () => {
    render(<TextSourceForm onSubmit={noop} isLoading={true} error={null} onCancel={noop} />);
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });

  // HEL-720: pins this form's config-driven surface (accept filter, group
  // aria-label, ids, url placeholder) so a config transposition/omission in
  // UnstructuredSourceForm's callers is caught. Verified failable by
  // mutation: temporarily swapping in another form's literal here turns
  // this test red.
  it("renders this form's config-specific surface (HEL-720)", () => {
    render(<TextSourceForm onSubmit={noop} isLoading={false} error={null} onCancel={noop} />);
    expect(screen.getByLabelText(/text\/markdown file/i)).toHaveAttribute(
      "accept",
      ".txt,.md,text/plain,text/markdown",
    );
    expect(screen.getByRole("group", { name: "Text ingestion method" })).toBeInTheDocument();
    expect(screen.getByLabelText(/text\/markdown file/i)).toHaveAttribute("id", "source-text-file");

    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    expect(screen.getByLabelText("URL")).toHaveAttribute("id", "source-text-url");
    expect(screen.getByLabelText("URL")).toHaveAttribute(
      "placeholder",
      "https://example.com/notes.md",
    );
  });
});
