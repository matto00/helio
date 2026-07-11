import { fireEvent, render, screen } from "@testing-library/react";

import { ImageSourceForm } from "./ImageSourceForm";

const noop = () => undefined;

describe("ImageSourceForm", () => {
  it("renders the file-picker sub-mode by default", () => {
    render(<ImageSourceForm onSubmit={noop} isLoading={false} error={null} onCancel={noop} />);
    expect(screen.getByLabelText(/image file/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("URL")).not.toBeInTheDocument();
  });

  it("switches to the URL sub-mode when 'From URL' is clicked", () => {
    render(<ImageSourceForm onSubmit={noop} isLoading={false} error={null} onCancel={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(screen.queryByLabelText(/image file/i)).not.toBeInTheDocument();
  });

  it("calls onSubmit with mode 'upload' and the selected file", () => {
    const onSubmit = jest.fn();
    render(<ImageSourceForm onSubmit={onSubmit} isLoading={false} error={null} onCancel={noop} />);

    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/image file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(onSubmit).toHaveBeenCalledWith("upload", file, "");
  });

  it("calls onSubmit with mode 'url' and the entered URL", () => {
    const onSubmit = jest.fn();
    render(<ImageSourceForm onSubmit={onSubmit} isLoading={false} error={null} onCancel={noop} />);

    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/photo.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(onSubmit).toHaveBeenCalledWith("url", null, "https://example.com/photo.png");
  });

  it("renders an error message when provided", () => {
    render(
      <ImageSourceForm
        onSubmit={noop}
        isLoading={false}
        error="Unsupported file extension"
        onCancel={noop}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/unsupported file extension/i);
  });

  it("disables the submit button while loading", () => {
    render(<ImageSourceForm onSubmit={noop} isLoading={true} error={null} onCancel={noop} />);
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });
});
