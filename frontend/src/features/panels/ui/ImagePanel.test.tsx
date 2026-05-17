import { render, screen } from "@testing-library/react";

import { ImagePanel } from "./ImagePanel";

// <img alt=""> is given the "presentation" ARIA role (decorative image), not "img".
// Use container.querySelector("img") to find the element directly.

describe("ImagePanel — with imageUrl", () => {
  it("renders an <img> element when imageUrl is set", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit={null} />,
    );
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/logo.png");
  });

  it("applies the imageFit value as objectFit style", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit="cover" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveStyle({ objectFit: "cover" });
  });

  it("defaults to contain when imageFit is null", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit={null} />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveStyle({ objectFit: "contain" });
  });

  it("applies fill objectFit when imageFit is fill", () => {
    const { container } = render(
      <ImagePanel imageUrl="https://example.com/logo.png" imageFit="fill" />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveStyle({ objectFit: "fill" });
  });
});

describe("ImagePanel — without imageUrl", () => {
  it("renders placeholder when imageUrl is null", () => {
    const { container } = render(<ImagePanel imageUrl={null} imageFit={null} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/No image URL set/)).toBeInTheDocument();
  });

  it("renders placeholder when imageUrl is empty string", () => {
    const { container } = render(<ImagePanel imageUrl="" imageFit={null} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/No image URL set/)).toBeInTheDocument();
  });
});
